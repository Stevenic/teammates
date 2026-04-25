/**
 * Startup maintenance manager — handles version migration, compaction,
 * recall sync, temp file cleanup, and version tracking.
 *
 * Extracted from cli.ts to reduce file size for more reliable agent patching.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { readdir, rm, stat, unlink } from "node:fs/promises";
import { join } from "node:path";

import type { StyledSpan } from "@teammates/consolonia";
import ora, { type Ora } from "ora";
import { DAILY_LOG_BUDGET_TOKENS, syncRecallIndex } from "./adapter.js";
import { PKG_VERSION } from "./cli-args.js";
import {
  autoCompactForBudget,
  buildDailyCompressionPrompt,
  buildWisdomPrompt,
  compactEpisodic,
  purgeStaleDailies,
} from "./compact.js";
import { buildMigrationPrompt } from "./migrations.js";
import { tp } from "./theme.js";
import type { QueueEntry } from "./types.js";

// ─── Dependency interface ────────────────────────────────────────────

export interface StartupManagerDeps {
  readonly teammatesDir: string;
  readonly selfName: string;
  readonly adapterName: string;
  readonly userAlias: string | null;
  readonly chatView: any; // ChatView or null
  taskQueue: QueueEntry[];
  pendingMigrationSyncs: number;
  makeQueueEntryId(): string;
  kickDrain(): void;
  feedLine(text?: string | StyledSpan): void;
  refreshView(): void;
  startMigrationProgress(message: string): void;
  stopMigrationProgress(): void;
  commitVersionUpdate(): void;
  listTeammates(): string[];
  showNotification(content: StyledSpan): void;
  /** Generate SYSTEM-PROMPT.md files for all teammates. Called at startup. */
  generateSystemPrompts(): Promise<void>;
}

// ─── StartupManager ──────────────────────────────────────────────────

export class StartupManager {
  private readonly deps: StartupManagerDeps;

  constructor(deps: StartupManagerDeps) {
    this.deps = deps;
  }

  /** Current index version. Increment when indexing logic changes to force a full rebuild. */
  static readonly INDEX_VERSION = 2;

  /**
   * Check if the CLI version has changed since last run.
   * Does NOT update settings.json — call `commitVersionUpdate()` after
   * migration tasks are complete to persist the new version.
   */
  checkVersionUpdate(): { previous: string; current: string } | null {
    const settingsPath = join(this.deps.teammatesDir, "settings.json");
    let settings: {
      version?: number;
      cliVersion?: string;
      indexVersion?: number;
      services?: unknown[];
    } = {};

    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    } catch {
      // No settings file or invalid JSON
    }

    const previous = settings.cliVersion ?? "";
    const current = PKG_VERSION;

    if (previous === current) return null;
    return { previous, current };
  }

  /**
   * Check if the index version has changed since last run.
   * Returns true if indexes need a full rebuild.
   */
  checkIndexVersionChanged(): boolean {
    const settingsPath = join(this.deps.teammatesDir, "settings.json");
    let settings: { indexVersion?: number } = {};
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    } catch {
      // No settings file — treat as needing rebuild
      return true;
    }
    return (settings.indexVersion ?? 0) < StartupManager.INDEX_VERSION;
  }

  /**
   * Persist the current index version to settings.json.
   */
  commitIndexVersion(): void {
    const settingsPath = join(this.deps.teammatesDir, "settings.json");
    let settings: Record<string, unknown> = {};
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    } catch {
      // No settings file — create one
    }
    settings.indexVersion = StartupManager.INDEX_VERSION;
    try {
      writeFileSync(
        settingsPath,
        `${JSON.stringify(settings, null, 2)}\n`,
        "utf-8",
      );
    } catch {
      /* write failed — non-fatal */
    }
  }

  /**
   * Persist the current CLI version to settings.json.
   * Called after all migration tasks complete (or immediately if no migration needed).
   */
  commitVersionUpdate(): void {
    const settingsPath = join(this.deps.teammatesDir, "settings.json");
    let settings: {
      version?: number;
      cliVersion?: string;
      indexVersion?: number;
      services?: unknown[];
    } = {};

    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    } catch {
      // No settings file or invalid JSON — create one
    }

    const previous = settings.cliVersion ?? "";
    const current = PKG_VERSION;

    settings.cliVersion = current;
    settings.indexVersion = StartupManager.INDEX_VERSION;
    if (!settings.version) settings.version = 1;
    try {
      writeFileSync(
        settingsPath,
        `${JSON.stringify(settings, null, 2)}\n`,
        "utf-8",
      );
    } catch {
      /* write failed — non-fatal */
    }

    // Detect major/minor version change (not just patch)
    const [prevMajor, prevMinor] = previous.split(".").map(Number);
    const [curMajor, curMinor] = current.split(".").map(Number);
    const _isMajorMinor =
      previous !== "" && (prevMajor !== curMajor || prevMinor !== curMinor);
  }

  /** Recursively delete files/directories older than maxAgeMs. Removes empty parent dirs. */
  async cleanOldTempFiles(dir: string, maxAgeMs: number): Promise<void> {
    const now = Date.now();
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.cleanOldTempFiles(fullPath, maxAgeMs);
        // Remove dir if now empty — but skip structural dirs that are
        // recreated concurrently (debug by writeDebugEntry).
        if (entry.name !== "debug") {
          const remaining = await readdir(fullPath).catch(() => [""]);
          if (remaining.length === 0)
            await rm(fullPath, { recursive: true }).catch(() => {});
        }
      } else {
        const info = await stat(fullPath).catch(() => null);
        if (info && now - info.mtimeMs > maxAgeMs) {
          await unlink(fullPath).catch(() => {});
        }
      }
    }
  }

  /**
   * Run compaction + recall index update for a single teammate.
   * When `silent` is true, routine status messages go to the progress bar
   * only — the feed is reserved for actual work (weeklies/monthlies created).
   */
  async runCompact(name: string, silent = false): Promise<void> {
    const teammateDir = join(this.deps.teammatesDir, name);

    if (!silent && this.deps.chatView) {
      this.deps.showNotification(tp.muted(`Compacting ${name}...`));
    }
    let spinner: Ora | null = null;
    if (!silent && !this.deps.chatView) {
      spinner = ora({ text: `Compacting ${name}...`, color: "cyan" }).start();
    }

    try {
      // Auto-compact daily logs if they exceed the token budget (creates partial weeklies)
      const autoResult = await autoCompactForBudget(
        teammateDir,
        DAILY_LOG_BUDGET_TOKENS,
      );

      // Regular episodic compaction (complete weeks → weeklies, old weeklies → monthlies)
      const result = await compactEpisodic(teammateDir, name);

      const parts: string[] = [];
      if (autoResult) {
        parts.push(
          `${autoResult.created.length} auto-compacted (budget overflow)`,
        );
      }
      if (result.weekliesCreated.length > 0) {
        parts.push(`${result.weekliesCreated.length} weekly summaries created`);
      }
      if (result.monthliesCreated.length > 0) {
        parts.push(
          `${result.monthliesCreated.length} monthly summaries created`,
        );
      }
      if (result.dailiesRemoved.length > 0) {
        parts.push(`${result.dailiesRemoved.length} daily logs compacted`);
      }
      if (result.weekliesRemoved.length > 0) {
        parts.push(
          `${result.weekliesRemoved.length} old weekly summaries archived`,
        );
      }

      if (parts.length === 0) {
        if (spinner) spinner.info(`${name}: nothing to compact`);
        if (this.deps.chatView && !silent)
          this.deps.feedLine(tp.muted(`  ℹ ${name}: nothing to compact`));
      } else {
        if (spinner) spinner.succeed(`${name}: ${parts.join(", ")}`);
        if (this.deps.chatView)
          this.deps.feedLine(tp.success(`  ✔  ${name}: ${parts.join(", ")}`));
      }

      // Sync recall index for this teammate (bundled library call)
      try {
        if (!silent && this.deps.chatView) {
          this.deps.showNotification(tp.muted(`Syncing ${name} index...`));
        }
        let syncSpinner: Ora | null = null;
        if (!silent && !this.deps.chatView) {
          syncSpinner = ora({
            text: `Syncing ${name} index...`,
            color: "cyan",
          }).start();
        }
        await syncRecallIndex(this.deps.teammatesDir, name);
        if (syncSpinner) syncSpinner.succeed(`${name}: index synced`);
        if (this.deps.chatView && !silent) {
          this.deps.feedLine(tp.success(`  ✔  ${name}: index synced`));
        }
      } catch {
        /* sync failed — non-fatal */
      }
      // Queue wisdom distillation agent task
      try {
        const wisdomPrompt = await buildWisdomPrompt(teammateDir, name);
        if (wisdomPrompt) {
          this.deps.taskQueue.push({
            id: this.deps.makeQueueEntryId(),
            type: "agent",
            teammate: name,
            task: wisdomPrompt,
            system: true,
          });
          this.deps.kickDrain();
        }
      } catch {
        /* wisdom prompt build failed — non-fatal */
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (spinner) spinner.fail(`${name}: ${msg}`);
      if (this.deps.chatView) {
        this.deps.feedLine(tp.error(`  ✖  ${name}: ${msg}`));
      }
    }
    this.deps.refreshView();
  }

  /**
   * Background startup maintenance:
   * 1. Version migrations
   * 2. Compaction + compression
   * 3. Purge stale dailies
   * 4. Sync recall indexes
   */
  async startupMaintenance(): Promise<void> {
    // Generate SYSTEM-PROMPT.md for all teammates (stable system prompt files)
    try {
      await this.deps.generateSystemPrompts();
    } catch {
      /* non-fatal — prompts will be built dynamically as fallback */
    }

    const versionUpdate = this.checkVersionUpdate();

    const tmpDir = join(this.deps.teammatesDir, ".tmp");

    // Clean up debug log files older than 1 day
    const debugDir = join(tmpDir, "debug");
    try {
      await this.cleanOldTempFiles(debugDir, 24 * 60 * 60 * 1000);
    } catch {
      /* debug dir may not exist yet — non-fatal */
    }

    // Clean up other .tmp files older than 1 week
    try {
      await this.cleanOldTempFiles(tmpDir, 7 * 24 * 60 * 60 * 1000);
    } catch {
      /* .tmp dir may not exist yet — non-fatal */
    }

    const teammates = this.deps
      .listTeammates()
      .filter((n) => n !== this.deps.selfName && n !== this.deps.adapterName);
    if (teammates.length === 0) return;

    // 1. Version migrations
    if (versionUpdate) {
      let migrationCount = 0;
      for (const name of teammates) {
        const prompt = buildMigrationPrompt(
          versionUpdate.previous,
          name,
          join(this.deps.teammatesDir, name),
        );
        if (prompt) {
          if (migrationCount === 0) {
            this.deps.startMigrationProgress(
              `Upgrading to v${versionUpdate.current}...`,
            );
          }
          migrationCount++;
          this.deps.taskQueue.push({
            id: this.deps.makeQueueEntryId(),
            type: "agent",
            teammate: name,
            task: prompt,
            system: true,
            migration: true,
          });
        }
      }
      this.deps.pendingMigrationSyncs = migrationCount;
      if (migrationCount === 0) {
        this.deps.commitVersionUpdate();
      }
    }

    // 2. Compaction + compression — skip when a migration is pending
    // Include the user's twin for compaction/compression (human orchestration logs)
    const compactTargets = [...teammates];
    if (this.deps.userAlias && !compactTargets.includes(this.deps.userAlias)) {
      compactTargets.push(this.deps.userAlias);
    }

    if (!versionUpdate) {
      for (const name of compactTargets) {
        await this.runCompact(name, true);
      }

      for (const name of compactTargets) {
        try {
          const compression = await buildDailyCompressionPrompt(
            join(this.deps.teammatesDir, name),
          );
          if (compression) {
            // Route compression task through the user's avatar (coding agent)
            const assignee =
              name === this.deps.userAlias ? this.deps.selfName : name;
            this.deps.taskQueue.push({
              id: this.deps.makeQueueEntryId(),
              type: "agent",
              teammate: assignee,
              task: compression.prompt,
              system: true,
            });
          }
        } catch {
          /* compression check failed — non-fatal */
        }
      }
    }

    this.deps.kickDrain();

    // 3. Purge daily logs older than 30 days (disk + Vectra)
    const { Indexer } = await import("@teammates/recall");
    const indexer = new Indexer({ teammatesDir: this.deps.teammatesDir });
    for (const name of compactTargets) {
      try {
        const purged = await purgeStaleDailies(
          join(this.deps.teammatesDir, name),
        );
        for (const file of purged) {
          const uri = `${name}/memory/${file}`;
          await indexer.deleteDocument(name, uri).catch(() => {});
        }
      } catch {
        /* purge failed — non-fatal */
      }
    }

    // 4. Rebuild or sync recall indexes
    const needsRebuild = this.checkIndexVersionChanged();
    if (needsRebuild) {
      // Index version changed — full rebuild of all teammate indexes
      try {
        const { Indexer: RebuildIndexer } = await import("@teammates/recall");
        const rebuildIndexer = new RebuildIndexer({
          teammatesDir: this.deps.teammatesDir,
        });
        await rebuildIndexer.indexAll();
        this.commitIndexVersion();
      } catch {
        /* full rebuild failed — non-fatal, will retry next startup */
      }
    } else {
      // Incremental sync only
      try {
        await syncRecallIndex(this.deps.teammatesDir);
      } catch {
        /* sync failed — non-fatal */
      }
    }
  }
}
