/**
 * Generic CLI proxy adapter — spawns any coding agent as a subprocess
 * and streams its output live to the user's terminal.
 *
 * Supports any CLI agent that accepts a prompt and runs to completion:
 *   claude -p "prompt"
 *   codex exec "prompt" --full-auto
 *   aider --message "prompt"
 *   etc.
 *
 * The adapter:
 *   1. Writes the full prompt (identity + memory + task) to a temp file
 *   2. Spawns the agent with the prompt file
 *   3. Tees stdout/stderr to the user's terminal in real time
 *   4. Captures output for result parsing (changed files, handoff envelopes)
 */

import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  watchCodexDebugLog,
  watchDebugLog,
  watchDebugLogErrors,
} from "../activity-watcher.js";
import type {
  AgentAdapter,
  InstalledService,
  RosterEntry,
} from "../adapter.js";
import {
  buildTeammatePrompt,
  DAILY_LOG_BUDGET_TOKENS,
  queryRecallContext,
} from "../adapter.js";
import { autoCompactForBudget } from "../compact.js";
import type {
  ActivityEvent,
  HandoffEnvelope,
  SandboxLevel,
  TaskResult,
  TeammateConfig,
} from "../types.js";

// ─── Spawn result ───────────────────────────────────────────────────

/** Structured result from spawning an agent subprocess. */
export interface SpawnResult {
  /** Combined stdout + stderr (for backward compat / display) */
  output: string;
  /** stdout only */
  stdout: string;
  /** stderr only */
  stderr: string;
  /** Process exit code (null if killed by signal) */
  exitCode: number | null;
  /** Signal that killed the process (null if exited normally) */
  signal: string | null;
  /** Whether the process was killed by our timeout */
  timedOut: boolean;
  /** Path to the debug log file, if one was written */
  debugFile?: string;
  /** Path to the prompt file written for this task */
  promptFile?: string;
}

// ─── Agent presets ──────────────────────────────────────────────────

export interface AgentPreset {
  /** Display name */
  name: string;
  /** Binary / command to spawn */
  command: string;
  /** Build CLI args. `promptFile` is a temp file path, `prompt` is the raw text, `debugFile` is an optional path for agent debug logs. */
  buildArgs(
    ctx: { promptFile: string; prompt: string; debugFile?: string },
    teammate: TeammateConfig,
    options: CliProxyOptions,
  ): string[];
  /** Extra env vars to set (e.g. FORCE_COLOR) */
  env?: Record<string, string>;
  /** Whether the agent may prompt the user for input (connects stdin) */
  interactive?: boolean;
  /** Whether the command needs shell: true to run */
  shell?: boolean;
  /** Whether to pipe the prompt via stdin instead of as a CLI argument */
  stdinPrompt?: boolean;
  /** Whether this preset supports a debug log file (--debug-file) */
  supportsDebugFile?: boolean;
  /** Optional output parser — transforms raw stdout into clean agent output */
  parseOutput?(raw: string): string;
}

// ─── Built-in presets ────────────────────────────────────────────────
// Preset definitions live in presets.ts to avoid circular imports
// (claude.ts/codex.ts extend CliProxyAdapter from this file).
import { PRESETS } from "./presets.js";

export { PRESETS } from "./presets.js";

// ─── Adapter ────────────────────────────────────────────────────────

export interface CliProxyOptions {
  /** Preset name or custom preset */
  preset: string | AgentPreset;
  /** Model override */
  model?: string;
  /** Default sandbox level */
  defaultSandbox?: SandboxLevel;
  /** Timeout in ms (default: 600_000 = 10 min) */
  timeout?: number;
  /** Extra CLI flags appended to the command */
  extraFlags?: string[];
  /** Custom command path override (e.g. "/usr/local/bin/claude") */
  commandPath?: string;
}

let nextId = 1;

export class CliProxyAdapter implements AgentAdapter {
  readonly name: string;
  /** Team roster — set by the orchestrator so prompts include teammate info. */
  public roster: RosterEntry[] = [];
  /** Installed services — set by the CLI so prompts include service info. */
  public services: InstalledService[] = [];
  private preset: AgentPreset;
  private options: CliProxyOptions;
  private _tmpInitialized = false;
  /** Temp prompt files that need cleanup — guards against crashes before finally. */
  private pendingTempFiles: Set<string> = new Set();

  constructor(options: CliProxyOptions) {
    this.options = options;
    this.preset =
      typeof options.preset === "string"
        ? PRESETS[options.preset]
        : options.preset;

    if (!this.preset) {
      throw new Error(
        `Unknown agent preset: ${options.preset}. Available: ${Object.keys(PRESETS).join(", ")}`,
      );
    }
    this.name = this.preset.name;
  }

  async startSession(teammate: TeammateConfig): Promise<string> {
    const id = `${this.name}-${teammate.name}-${nextId++}`;

    // Ensure .tmp is gitignored (needed for debug dir)
    const tmpBase = join(teammate.cwd ?? process.cwd(), ".teammates", ".tmp");
    if (!this._tmpInitialized) {
      this._tmpInitialized = true;
      const gitignorePath = join(tmpBase, "..", ".gitignore");
      const existing = await readFile(gitignorePath, "utf-8").catch(() => "");
      if (!existing.includes(".tmp/")) {
        await writeFile(
          gitignorePath,
          existing +
            (existing.endsWith("\n") || !existing ? "" : "\n") +
            ".tmp/\n",
        ).catch(() => {});
      }
    }

    return id;
  }

  async executeTask(
    _sessionId: string,
    teammate: TeammateConfig,
    prompt: string,
    options?: {
      raw?: boolean;
      system?: boolean;
      skipMemoryUpdates?: boolean;
      onActivity?: (events: ActivityEvent[]) => void;
      signal?: AbortSignal;
    },
  ): Promise<TaskResult> {
    // If raw mode is set, skip all prompt wrapping — send prompt as-is
    // Used for defensive retries where the full prompt template is counterproductive
    let fullPrompt: string;
    if (options?.raw) {
      fullPrompt = prompt;
    } else if (teammate.soul) {
      // Query recall for relevant memories before building prompt
      const teammatesDir = teammate.cwd
        ? join(teammate.cwd, ".teammates")
        : undefined;
      const recall = teammatesDir
        ? await queryRecallContext(teammatesDir, teammate.name, prompt)
        : undefined;

      // Auto-compact daily logs if they exceed the token budget
      if (teammatesDir) {
        const teammateDir = join(teammatesDir, teammate.name);
        const compacted = await autoCompactForBudget(
          teammateDir,
          DAILY_LOG_BUDGET_TOKENS,
        );
        if (compacted) {
          // Filter compacted dates out of in-memory daily logs
          const compactedSet = new Set(compacted.compactedDates);
          teammate.dailyLogs = teammate.dailyLogs.filter(
            (log) => !compactedSet.has(log.date),
          );
        }
      }

      // Read USER.md for injection into the prompt
      let userProfile: string | undefined;
      if (teammatesDir) {
        try {
          userProfile = await readFile(join(teammatesDir, "USER.md"), "utf-8");
        } catch {
          // USER.md may not exist yet — that's fine
        }
      }

      fullPrompt = buildTeammatePrompt(teammate, prompt, {
        roster: this.roster,
        services: this.services,
        recallResults: recall?.results,
        userProfile,
        system: options?.system,
        skipMemoryUpdates: options?.skipMemoryUpdates,
      });
    } else {
      const parts = [prompt];
      const others = this.roster.filter((r) => r.name !== teammate.name);
      if (others.length > 0) {
        parts.push("\n\n---\n");
        parts.push(
          "If part of this task belongs to a specialist, you can hand it off.",
        );
        parts.push("Your teammates:");
        for (const t of others) {
          const owns =
            t.ownership.primary.length > 0
              ? ` — owns: ${t.ownership.primary.join(", ")}`
              : "";
          parts.push(`- @${t.name}: ${t.role}${owns}`);
        }
        parts.push(
          "\nTo hand off, include a fenced handoff block in your response:",
        );
        parts.push("```handoff\n@<teammate>\n<task details>\n```");
      }
      fullPrompt = parts.join("\n");
    }

    // Generate persistent log file paths in .teammates/.tmp/debug/
    // These survive after the task so /debug can read them later.
    //   <logBase>-prompt.md  — the full prompt sent to the agent
    //   <logBase>.md          — adapter-specific activity/debug log
    const debugDir = join(
      teammate.cwd ?? process.cwd(),
      ".teammates",
      ".tmp",
      "debug",
    );
    try {
      mkdirSync(debugDir, { recursive: true });
    } catch {
      /* best effort */
    }
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const baseName = `${teammate.name}-${ts}`;
    const persistentPromptFile = join(debugDir, `${baseName}-prompt.md`);
    const logFile = join(debugDir, `${baseName}.md`);

    // Write prompt to persistent file (also used as agent input for file-based presets)
    await writeFile(persistentPromptFile, fullPrompt, "utf-8");
    if (!this.preset.supportsDebugFile) {
      // Non-Claude adapters don't own their own debug file, so create it now.
      // This makes the paired file visible immediately instead of only on close.
      await writeFile(logFile, "", "utf-8");
    }
    this.pendingTempFiles.add(persistentPromptFile);

    try {
      const spawn = await this.spawnAndProxy(
        teammate,
        persistentPromptFile,
        fullPrompt,
        options?.onActivity,
        logFile,
        options?.signal,
      );
      const output = this.preset.parseOutput
        ? this.preset.parseOutput(spawn.output)
        : spawn.output;
      const teammateNames = this.roster.map((r) => r.name);
      const result = parseResult(teammate.name, output, teammateNames, prompt);
      result.fullPrompt = fullPrompt;
      result.promptFile = persistentPromptFile;
      result.logFile = logFile;
      result.diagnostics = {
        exitCode: spawn.exitCode,
        signal: spawn.signal,
        stderr: spawn.stderr,
        timedOut: spawn.timedOut,
        debugFile: spawn.debugFile,
      };
      return result;
    } finally {
      // Don't delete promptFile — it persists for /debug.
      // Old files cleaned by cleanOldTempFiles() on startup.
      this.pendingTempFiles.delete(persistentPromptFile);
    }
  }

  async routeTask(task: string, roster: RosterEntry[]): Promise<string | null> {
    const lines = [
      "You are a task router. Given a task and a list of teammates, reply with ONLY the name of the teammate who should handle it. No explanation, no punctuation — just the name.",
      "",
      "Teammates:",
    ];
    for (const t of roster) {
      const owns =
        t.ownership.primary.length > 0
          ? ` — owns: ${t.ownership.primary.join(", ")}`
          : "";
      lines.push(`- ${t.name}: ${t.role}${owns}`);
    }
    lines.push("", `Task: ${task}`);

    const prompt = lines.join("\n");
    const promptFile = join(tmpdir(), `teammates-route-${randomUUID()}.md`);
    await writeFile(promptFile, prompt, "utf-8");

    try {
      const command = this.options.commandPath ?? this.preset.command;
      const args = this.preset.buildArgs(
        { promptFile, prompt },
        {
          name: "_router",
          type: "ai" as const,
          role: "",
          soul: "",
          goals: "",
          wisdom: "",
          dailyLogs: [],
          weeklyLogs: [],
          ownership: { primary: [], secondary: [] },
          routingKeywords: [],
        },
        { ...this.options, model: this.options.model ?? "haiku" },
      );
      const env = { ...process.env, ...this.preset.env };

      // Suppress Node.js ExperimentalWarning in routing subprocesses
      const existingNodeOpts = env.NODE_OPTIONS ?? "";
      if (!existingNodeOpts.includes("--disable-warning=ExperimentalWarning")) {
        env.NODE_OPTIONS = existingNodeOpts
          ? `${existingNodeOpts} --disable-warning=ExperimentalWarning`
          : "--disable-warning=ExperimentalWarning";
      }

      const output = await new Promise<string>((resolve, reject) => {
        const routeStdin = this.preset.stdinPrompt ?? false;
        const needsShell = this.preset.shell ?? process.platform === "win32";
        const spawnCmd = needsShell ? [command, ...args].join(" ") : command;
        const spawnArgs = needsShell ? [] : args;
        const child = spawn(spawnCmd, spawnArgs, {
          cwd: process.cwd(),
          env,
          stdio: [routeStdin ? "pipe" : "ignore", "pipe", "pipe"],
          shell: needsShell,
        });

        if (routeStdin && child.stdin) {
          child.stdin.on("error", () => {});
          child.stdin.write(prompt);
          child.stdin.end();
        }

        const captured: Buffer[] = [];
        child.stdout?.on("data", (chunk: Buffer) => captured.push(chunk));
        child.stderr?.on("data", (chunk: Buffer) => captured.push(chunk));

        const timer = setTimeout(() => {
          if (!child.killed) child.kill("SIGTERM");
        }, 30_000);

        child.on("close", () => {
          clearTimeout(timer);
          resolve(Buffer.concat(captured).toString("utf-8"));
        });
        child.on("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });

      // Extract the teammate name from the output
      const rosterNames = roster.map((r) => r.name);
      const trimmed = output.trim().toLowerCase();
      // Check each name — the agent should have returned just one
      for (const name of rosterNames) {
        if (
          trimmed === name.toLowerCase() ||
          trimmed.endsWith(name.toLowerCase())
        ) {
          return name;
        }
      }
      // Fuzzy: check if any name appears in the output
      for (const name of rosterNames) {
        if (trimmed.includes(name.toLowerCase())) {
          return name;
        }
      }
      return null;
    } catch {
      return null;
    } finally {
      await unlink(promptFile).catch(() => {});
    }
  }

  async destroySession(_sessionId: string): Promise<void> {
    // Clean up any leaked temp prompt files
    for (const file of this.pendingTempFiles) {
      await unlink(file).catch(() => {});
    }
    this.pendingTempFiles.clear();
  }

  /**
   * Spawn the agent, stream its output live, and capture it.
   * @param logFile Path where adapter-specific activity log is written:
   *   - Claude: passed as --debug-file (Claude writes debug output here)
   *   - Codex: JSONL stdout is dumped here on process close
   *   - Others: raw stdout is written here on close
   */
  private spawnAndProxy(
    teammate: TeammateConfig,
    promptFile: string,
    fullPrompt: string,
    onActivity?: (events: ActivityEvent[]) => void,
    logFile?: string,
    signal?: AbortSignal,
  ): Promise<SpawnResult> {
    let resolveOuter!: (result: SpawnResult) => void;
    let rejectOuter!: (err: Error) => void;
    const done = new Promise<SpawnResult>((res, rej) => {
      resolveOuter = res;
      rejectOuter = rej;
    });

    // For Claude, the logFile IS the debug file (passed via --debug-file).
    // For other presets, debugFile stays undefined (they don't support it).
    const debugFile = this.preset.supportsDebugFile ? logFile : undefined;

    const args = [
      ...this.preset.buildArgs(
        { promptFile, prompt: fullPrompt, debugFile },
        teammate,
        this.options,
      ),
      ...(this.options.extraFlags ?? []),
    ];

    const command = this.options.commandPath ?? this.preset.command;
    const env = { ...process.env, ...this.preset.env };
    const timeout = this.options.timeout ?? 600_000;
    const interactive = this.preset.interactive ?? false;
    const useStdin = this.preset.stdinPrompt ?? false;

    // Suppress Node.js ExperimentalWarning (e.g. SQLite) in agent
    // subprocesses so it doesn't leak into the terminal UI.
    const existingNodeOpts = env.NODE_OPTIONS ?? "";
    if (!existingNodeOpts.includes("--disable-warning=ExperimentalWarning")) {
      env.NODE_OPTIONS = existingNodeOpts
        ? `${existingNodeOpts} --disable-warning=ExperimentalWarning`
        : "--disable-warning=ExperimentalWarning";
    }

    // On Windows, npm-installed CLIs are .cmd wrappers that require shell.
    // When using shell mode, pass command+args as a single string to avoid
    // Node DEP0190 deprecation warning about unescaped args with shell: true.
    const needsShell = this.preset.shell ?? process.platform === "win32";
    const spawnCmd = needsShell ? [command, ...args].join(" ") : command;
    const spawnArgs = needsShell ? [] : args;
    const child: ChildProcess = spawn(spawnCmd, spawnArgs, {
      cwd: teammate.cwd ?? process.cwd(),
      env,
      stdio: [interactive || useStdin ? "pipe" : "ignore", "pipe", "pipe"],
      shell: needsShell,
    });
    const taskStartTime = Date.now();

    // Listen for abort signal — kill the child process on cancellation.
    // Uses SIGTERM → 5s → SIGKILL escalation, same as the old killAgent().
    let abortKillTimer: ReturnType<typeof setTimeout> | null = null;
    const onAbort = () => {
      if (!child.killed) {
        child.kill("SIGTERM");
        abortKillTimer = setTimeout(() => {
          if (!child.killed) {
            child.kill("SIGKILL");
          }
        }, 5_000);
      }
    };
    if (signal) {
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    // Start watching for real-time activity events.
    // Claude: parse the debug log for tool names + errors (Claude writes this file via --debug-file).
    // Codex: tail the JSONL debug log file we append during execution.
    const stopWatchers: (() => void)[] = [];
    if (onActivity) {
      if (this.preset.name === "codex" && logFile) {
        stopWatchers.push(
          watchCodexDebugLog(logFile, taskStartTime, onActivity),
        );
      } else if (debugFile) {
        stopWatchers.push(watchDebugLog(debugFile, taskStartTime, onActivity));
        stopWatchers.push(
          watchDebugLogErrors(debugFile, taskStartTime, onActivity),
        );
      }
    }

    // Pipe prompt via stdin if the preset requires it.
    // Swallow EPIPE / EOF errors — the child may close stdin before
    // the write completes (e.g. Codex exits early on bad input).
    if (useStdin && child.stdin) {
      child.stdin.on("error", () => {});
      child.stdin.write(fullPrompt);
      child.stdin.end();
    }

    // ── Timeout with SIGTERM → SIGKILL escalation ──────────────
    let killed = false;
    let killTimer: ReturnType<typeof setTimeout> | null = null;
    const timeoutTimer = setTimeout(() => {
      if (!child.killed) {
        killed = true;
        child.kill("SIGTERM");
        // If SIGTERM doesn't work after 5s, force-kill
        killTimer = setTimeout(() => {
          if (!child.killed) {
            child.kill("SIGKILL");
          }
        }, 5_000);
      }
    }, timeout);

    // Connect user's stdin → child only if agent may ask questions
    let onUserInput: ((chunk: Buffer) => void) | null = null;
    if (interactive && !useStdin && child.stdin) {
      child.stdin.on("error", () => {});
      onUserInput = (chunk: Buffer) => {
        child.stdin?.write(chunk);
      };
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.resume();
      process.stdin.on("data", onUserInput);
    }

    const stdoutBufs: Buffer[] = [];
    const stderrBufs: Buffer[] = [];

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBufs.push(chunk);
      if (logFile && !this.preset.supportsDebugFile) {
        try {
          appendFileSync(logFile, chunk);
        } catch {
          /* best effort */
        }
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBufs.push(chunk);
      if (logFile && !this.preset.supportsDebugFile) {
        try {
          appendFileSync(logFile, chunk);
        } catch {
          /* best effort */
        }
      }
    });

    const cleanup = () => {
      clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      if (abortKillTimer) clearTimeout(abortKillTimer);
      if (signal) signal.removeEventListener("abort", onAbort);
      if (onUserInput) {
        process.stdin.removeListener("data", onUserInput);
      }
      for (const stop of stopWatchers) stop();
    };

    child.on("close", (code, signal) => {
      cleanup();
      const stdout = Buffer.concat(stdoutBufs).toString("utf-8");
      const stderr = Buffer.concat(stderrBufs).toString("utf-8");
      const output = stdout + (stderr ? `\n${stderr}` : "");

      // Write the logFile for non-Claude adapters.
      // Claude writes its own debug log via --debug-file; others need us to dump stdout.
      if (logFile && !this.preset.supportsDebugFile) {
        try {
          // For Codex: dump raw JSONL stdout. For others: dump raw stdout.
          writeFileSync(logFile, stdout, "utf-8");
        } catch {
          /* best effort */
        }
      }

      resolveOuter({
        output: killed
          ? `${output}\n\n[TIMEOUT] Agent process killed after ${timeout}ms`
          : output,
        stdout,
        stderr,
        exitCode: code,
        signal: signal ?? null,
        timedOut: killed,
        debugFile,
      });
    });

    child.on("error", (err) => {
      cleanup();
      if (logFile && !this.preset.supportsDebugFile) {
        try {
          appendFileSync(logFile, `\n[SPAWN ERROR] ${err.message}\n`, "utf-8");
        } catch {
          /* best effort */
        }
      }
      rejectOuter(new Error(`Failed to spawn ${command}: ${err.message}`));
    });

    return done;
  }
}

// ─── Output parsing (shared across all agents) ─────────────────────

export function parseResult(
  teammateName: string,
  output: string,
  teammateNames: string[] = [],
  _originalTask?: string,
): TaskResult {
  // Parse the TO: / # Subject protocol
  const parsed = parseMessageProtocol(output, teammateName, teammateNames);
  if (parsed) return parsed;

  // Fallback: no structured output detected
  return {
    teammate: teammateName,
    success: true,
    summary: "",
    changedFiles: parseChangedFiles(output),
    handoffs: [],
    rawOutput: output,
  };
}

/**
 * Parse the message protocol from agent output.
 *
 * Detects two things:
 *   1. ```handoff blocks — fenced code blocks with language "handoff"
 *      containing @<teammate> on the first line and the task body below.
 *   2. TO: / # Subject headers for message framing.
 *
 * The ```handoff block is the primary handoff signal and works reliably
 * regardless of where it appears in the output.
 */
function parseMessageProtocol(
  output: string,
  teammateName: string,
  _teammateNames: string[],
): TaskResult | null {
  const lines = output.split("\n");

  // Find # Subject heading
  let subjectLineIdx = -1;
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    // Skip TO: lines
    if (lines[i].match(/^TO:\s/i)) continue;
    const headingMatch = lines[i].match(/^#\s+(.+)/);
    if (headingMatch) {
      subjectLineIdx = i;
      break;
    }
  }

  // Find all ```handoff blocks (primary) + natural-language fallback
  const handoffBlocks = findHandoffBlocks(output);
  if (handoffBlocks.length === 0) {
    // Fallback: detect natural-language handoff patterns mentioning known teammates
    handoffBlocks.push(...findNaturalLanguageHandoffs(output, _teammateNames));
  }
  const handoffs: HandoffEnvelope[] = handoffBlocks.map((h) => ({
    from: teammateName,
    to: h.target,
    task: h.task,
  }));

  // If no heading and no handoffs, can't parse
  if (subjectLineIdx < 0 && handoffs.length === 0) return null;

  const subject =
    subjectLineIdx >= 0
      ? lines[subjectLineIdx].replace(/^#\s+/, "").trim()
      : "";

  return {
    teammate: teammateName,
    success: true,
    summary: subject,
    changedFiles: parseChangedFiles(output),
    handoffs,
    rawOutput: output,
  };
}

/**
 * Find a ```handoff fenced code block in the output.
 *
 * Format:
 *   ```handoff
 *   @<teammate>
 *   <task description>
 *   ```
 *
 * Returns the target teammate name and task body, or null.
 */
function findHandoffBlocks(output: string): { target: string; task: string }[] {
  const results: { target: string; task: string }[] = [];
  const pattern = /```handoff\s*\n@(\w+)\s*\n([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(output)) !== null) {
    results.push({ target: match[1].toLowerCase(), task: match[2].trim() });
  }
  return results;
}

/**
 * Fallback handoff detector: catches natural-language handoff patterns when
 * the agent fails to use the ```handoff fenced block format.
 *
 * Looks for sentences like:
 *   - "hand off to @beacon: implement the feature"
 *   - "handing this to @scribe for documentation"
 *   - "I'll delegate to @pipeline"
 *   - "queued a handoff to @beacon"
 *
 * Only triggers if the @mentioned name is in the known teammate list.
 * Extracts the surrounding sentence as the task description.
 */
function findNaturalLanguageHandoffs(
  output: string,
  teammateNames: string[],
): { target: string; task: string }[] {
  if (teammateNames.length === 0) return [];

  const results: { target: string; task: string }[] = [];
  const seen = new Set<string>();

  // Pattern: handoff-related verb/noun near @teammate
  const pattern =
    /(?:hand(?:off|ing off| off| this off)|delegat(?:e|ing)|pass(?:ing)? (?:this |it )?(?:to|off to)|queued? (?:a )?handoff (?:to|for))\s+@(\w+)\b[.:,]?\s*(.*)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(output)) !== null) {
    const target = match[1].toLowerCase();
    if (!teammateNames.includes(target)) continue;
    if (seen.has(target)) continue;
    seen.add(target);

    // Use the rest of the sentence as the task, or a generic description
    let task = match[2]
      .replace(/\n.*/s, "") // first line only
      .replace(/[.!]+$/, "") // strip trailing punctuation
      .trim();
    if (!task || task.length < 5) {
      task =
        "(handoff detected from natural language — no task details provided)";
    }
    results.push({ target, task });
  }

  return results;
}

/** Extract file paths from agent output. */
export function parseChangedFiles(output: string): string[] {
  const files = new Set<string>();

  // diff --git a/path b/path
  for (const match of output.matchAll(/diff --git a\/(.+?) b\//g)) {
    files.add(match[1]);
  }

  // "Created/Modified/Updated/Wrote/Edited <path>" patterns
  for (const match of output.matchAll(
    /(?:Created|Modified|Updated|Wrote|Edited)\s+(?:file:\s*)?[`"]?([^\s`"]+\.\w+)[`"]?/gi,
  )) {
    files.add(match[1]);
  }

  return Array.from(files);
}
