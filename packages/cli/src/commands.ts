/**
 * Extracted slash-command implementations for the Teammates REPL.
 *
 * Every cmd* method that was in cli.ts lives here, plus registerCommands,
 * dispatch, and supporting helpers (queueDebugAnalysis, cancelTeammateInThread,
 * getThreadTeammates, buildSessionMarkdown, doCopy, feedCommand, printBanner).
 */

import { exec as execCb } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import {
  type ChatView,
  concat,
  esc,
  pen,
  type StyledSpan,
} from "@teammates/consolonia";
import type { AgentAdapter } from "./adapter.js";
import type { AnimatedBanner, ServiceInfo } from "./banner.js";
import { PKG_VERSION } from "./cli-args.js";
import { relativeTime } from "./cli-utils.js";
import type { ConversationManager } from "./conversation.js";
import type { HandoffManager } from "./handoff-manager.js";
import {
  buildImportAdaptationPrompt,
  copyTemplateFiles,
  importTeammates,
} from "./onboard.js";
import type { OnboardFlow } from "./onboard-flow.js";
import type { Orchestrator } from "./orchestrator.js";
import type { RetroManager } from "./retro-manager.js";
import { cmdConfigure, type ServiceView } from "./service-config.js";
import type { StatusTracker } from "./status-tracker.js";
import { colorToHex, theme, tp } from "./theme.js";
import type { ThreadContainer } from "./thread-container.js";
import type { ThreadManager } from "./thread-manager.js";
import type {
  QueueEntry,
  SlashCommand,
  TaskResult,
  TaskThread,
} from "./types.js";

// ─── Dependency interface ─────────────────────────────────────────────

export interface CommandsDeps {
  // ── Identity ──
  readonly adapterName: string;
  readonly selfName: string;
  readonly userAlias: string | null;

  // ── Core state ──
  readonly orchestrator: Orchestrator;
  readonly adapter: AgentAdapter;
  readonly taskQueue: QueueEntry[];
  readonly agentActive: Map<string, QueueEntry>;
  readonly abortControllers: Map<string, AbortController>;
  readonly commands: Map<string, SlashCommand>;
  readonly conversation: ConversationManager;
  lastResult: TaskResult | null;
  readonly lastResults: Map<string, TaskResult>;
  readonly lastDebugFiles: Map<
    string,
    { promptFile?: string; logFile?: string }
  >;
  readonly lastTaskPrompts: Map<string, string>;
  readonly lastCleanedOutput: string;
  readonly serviceStatuses: ServiceInfo[];

  // ── Sub-managers ──
  readonly threadManager: ThreadManager;
  readonly handoffManager: HandoffManager;
  readonly retroManager: RetroManager;
  readonly statusTracker: StatusTracker;
  readonly onboardFlow: OnboardFlow;
  readonly banner: AnimatedBanner | null;

  // ── UI widgets ──
  readonly chatView: ChatView | undefined;
  readonly app: { refresh(): void; stop(): void } | undefined;
  readonly input: { activate(): void; deactivateAndErase(): void } | undefined;

  // ── Feed rendering ──
  feedLine(text?: string | StyledSpan): void;
  feedMarkdown(source: string): void;
  feedUserLine(spans: StyledSpan): void;
  refreshView(): void;
  showPrompt(): void;
  makeSpan(opts: { text: string; style: { fg?: any; bg?: any } }): StyledSpan;

  // ── Task lifecycle ──
  makeQueueEntryId(): string;
  kickDrain(): void;
  isSystemTask(entry: QueueEntry): boolean;
  isAgentBusy(teammate: string): boolean;

  // ── Thread helpers ──
  getThread(id: number): TaskThread | undefined;
  readonly threads: Map<number, TaskThread>;
  readonly focusedThreadId: number | null;
  readonly containers: Map<number, ThreadContainer>;
  appendThreadEntry(
    threadId: number,
    entry: import("./types.js").ThreadEntry,
  ): void;
  renderTaskPlaceholder(
    threadId: number,
    placeholderId: string,
    teammate: string,
    state: "queued" | "working",
  ): void;

  // ── Activity ──
  cleanupActivityLines(teammate: string): void;

  // ── Onboarding ──
  runOnboardingAgent(adapter: AgentAdapter, projectDir: string): Promise<void>;
  runPersonaOnboardingInline(teammatesDir: string): Promise<void>;
  refreshTeammates(): void;

  // ── Clipboard helper ──
  askInline(prompt: string): Promise<string>;

  // ── Service config view ──
  readonly serviceView: ServiceView;

  // ── Misc ──
  readonly teammatesDir: string;
  clearPastedTexts(): void;
}

// ─── CommandManager ───────────────────────────────────────────────────

export class CommandManager {
  constructor(private deps: CommandsDeps) {}

  // ── Registration & dispatch ────────────────────────────────────────

  registerCommands(): void {
    const d = this.deps;
    const cmds: SlashCommand[] = [
      {
        name: "status",
        aliases: ["s", "queue", "qu"],
        usage: "/status",
        description: "Show teammates, active tasks, and queue",
        run: () => this.cmdStatus(),
      },
      {
        name: "help",
        aliases: ["h", "?"],
        usage: "/help",
        description: "Show available commands",
        run: () => this.cmdHelp(),
      },
      {
        name: "debug",
        aliases: ["raw"],
        usage: "/debug [teammate] [focus]",
        description: "Analyze the last agent task with the coding agent",
        run: (args) => this.cmdDebug(args),
      },
      {
        name: "cancel",
        aliases: [],
        usage: "/cancel [task-id] [teammate]",
        description: "Cancel a task or a specific teammate within a task",
        run: (args) => this.cmdCancel(args),
      },
      {
        name: "interrupt",
        aliases: ["int"],
        usage: "/interrupt [task-id] [teammate] [message]",
        description:
          "Interrupt a teammate and restart with additional instructions",
        run: (args) => this.cmdInterrupt(args),
      },
      {
        name: "init",
        aliases: ["onboard", "setup"],
        usage: "/init [pick | from-path]",
        description:
          "Set up teammates (pick from personas, or import from another project)",
        run: (args) => this.cmdInit(args),
      },
      {
        name: "clear",
        aliases: ["cls", "reset"],
        usage: "/clear",
        description: "Clear history and reset the session",
        run: () => this.cmdClear(),
      },
      {
        name: "compact",
        aliases: [],
        usage: "/compact [teammate]",
        description: "Compact daily logs into weekly/monthly summaries",
        run: (args) => this.cmdCompact(args),
      },
      {
        name: "retro",
        aliases: [],
        usage: "/retro [teammate]",
        description: "Run a structured self-retrospective for a teammate",
        run: (args) => this.cmdRetro(args),
      },
      {
        name: "copy",
        aliases: ["cp"],
        usage: "/copy",
        description: "Copy session text to clipboard",
        run: () => this.cmdCopy(),
      },
      {
        name: "user",
        aliases: [],
        usage: "/user [change]",
        description: "View or update USER.md",
        run: (args) => this.cmdUser(args),
      },
      {
        name: "btw",
        aliases: [],
        usage: "/btw [question]",
        description:
          "Ask a quick side question without interrupting the main conversation",
        run: (args) => this.cmdBtw(args),
      },
      {
        name: "script",
        aliases: [],
        usage: "/script [description]",
        description: "Write and run reusable scripts via the coding agent",
        run: (args) => this.cmdScript(args),
      },
      {
        name: "theme",
        aliases: [],
        usage: "/theme",
        description: "Show current theme colors",
        run: () => this.cmdTheme(),
      },
      {
        name: "configure",
        aliases: ["config"],
        usage: "/configure [service]",
        description: "Configure external services (github)",
        run: (args) => cmdConfigure(args, d.serviceStatuses, d.serviceView),
      },
      {
        name: "exit",
        aliases: ["q", "quit"],
        usage: "/exit",
        description: "Exit the session",
        run: async () => {
          d.feedLine(tp.muted("Shutting down..."));
          if (d.app) d.app.stop();
          await d.orchestrator.shutdown();
          process.exit(0);
        },
      },
    ];

    for (const cmd of cmds) {
      d.commands.set(cmd.name, cmd);
      for (const alias of cmd.aliases) {
        d.commands.set(alias, cmd);
      }
    }
  }

  async dispatch(input: string): Promise<void> {
    const d = this.deps;
    const spaceIdx = input.indexOf(" ");
    const cmdName = spaceIdx > 0 ? input.slice(1, spaceIdx) : input.slice(1);
    const cmdArgs = spaceIdx > 0 ? input.slice(spaceIdx + 1).trim() : "";

    const cmd = d.commands.get(cmdName);
    if (cmd) {
      await cmd.run(cmdArgs);
    } else {
      d.feedLine(tp.warning(`Unknown command: /${cmdName}`));
      d.feedLine(tp.muted("Type /help for available commands"));
    }
  }

  // ── /status ────────────────────────────────────────────────────────

  private async cmdStatus(): Promise<void> {
    const d = this.deps;
    const statuses = d.orchestrator.getAllStatuses();
    const registry = d.orchestrator.getRegistry();

    d.feedLine();
    d.feedLine(tp.bold("  Status"));
    d.feedLine(tp.muted(`  ${"─".repeat(50)}`));

    // Show user avatar first if present (displayed as adapter name alias)
    if (d.userAlias) {
      const userStatus = statuses.get(d.userAlias);
      if (userStatus) {
        d.feedLine(
          concat(
            tp.success("●"),
            tp.accent(` @${d.adapterName}`),
            tp.muted(" (you)"),
          ),
        );
        d.feedLine(
          tp.muted("    Coding agent that performs tasks on your behalf."),
        );
        d.feedLine();
      }
    }

    for (const [name, status] of statuses) {
      if (name === d.adapterName || name === d.userAlias) continue;

      const t = registry.get(name);
      const active = d.agentActive.get(name);
      const queued = d.taskQueue.filter((e) => e.teammate === name);

      const presenceIcon =
        status.presence === "online"
          ? tp.success("●")
          : status.presence === "reachable"
            ? tp.warning("●")
            : tp.error("●");

      const stateLabel = active ? "working" : status.state;
      const stateColor =
        stateLabel === "working"
          ? tp.info(` (${stateLabel})`)
          : tp.muted(` (${stateLabel})`);
      d.feedLine(concat(presenceIcon, tp.accent(` @${name}`), stateColor));

      if (t) {
        d.feedLine(tp.muted(`    ${t.role}`));
      }

      if (active) {
        const taskText =
          active.task.length > 60
            ? `${active.task.slice(0, 57)}…`
            : active.task;
        d.feedLine(concat(tp.info("    ▸ "), tp.text(taskText)));
      }

      for (let i = 0; i < queued.length; i++) {
        const taskText =
          queued[i].task.length > 60
            ? `${queued[i].task.slice(0, 57)}…`
            : queued[i].task;
        d.feedLine(concat(tp.muted(`    ${i + 1}. `), tp.muted(taskText)));
      }

      if (!active && status.lastSummary) {
        const time = status.lastTimestamp
          ? ` ${relativeTime(status.lastTimestamp)}`
          : "";
        d.feedLine(
          tp.muted(`    last: ${status.lastSummary.slice(0, 50)}${time}`),
        );
      }

      d.feedLine();
    }

    // ── Active threads ────────────────────────────────────────────
    if (d.threads.size > 0) {
      d.feedLine(tp.bold("  Threads"));
      d.feedLine(tp.muted(`  ${"─".repeat(50)}`));
      for (const [id, thread] of d.threads) {
        const isFocused = d.focusedThreadId === id;
        const origin =
          thread.originMessage.length > 50
            ? `${thread.originMessage.slice(0, 47)}…`
            : thread.originMessage;
        const replies = thread.entries.filter(
          (e) => e.type !== "user" || thread.entries.indexOf(e) > 0,
        ).length;
        const { working, queued } = this.getThreadTaskCounts(id);
        const focusTag = isFocused ? tp.info(" ◀ focused") : "";
        d.feedLine(
          concat(tp.accent(`  #${id}`), tp.text(`  ${origin}`), focusTag),
        );
        const parts: string[] = [];
        if (replies > 0)
          parts.push(`${replies} repl${replies === 1 ? "y" : "ies"}`);
        if (working > 0) parts.push(`${working} working`);
        if (queued > 0) parts.push(`${queued} queued`);
        if (thread.collapsed) parts.push("collapsed");
        if (parts.length > 0) {
          d.feedLine(tp.muted(`    ${parts.join(" · ")}`));
        }
        d.feedLine();
      }
    }

    d.refreshView();
  }

  // ── /debug ─────────────────────────────────────────────────────────

  private async cmdDebug(argsStr: string): Promise<void> {
    const d = this.deps;
    const parts = argsStr.trim().split(/\s+/);
    const firstArg = (parts[0] ?? "").replace(/^@/, "");
    const debugFocus = parts.slice(1).join(" ").trim() || undefined;

    let targetName: string;
    if (firstArg === "everyone") {
      const names: string[] = [];
      for (const [name] of d.lastDebugFiles) {
        if (name !== d.selfName) names.push(name);
      }
      if (names.length === 0) {
        d.feedLine(tp.muted("  No debug info available from any teammate."));
        d.refreshView();
        return;
      }
      for (const name of names) {
        this.queueDebugAnalysis(name, debugFocus);
      }
      return;
    } else if (firstArg) {
      targetName = firstArg;
    } else if (d.lastResult) {
      targetName = d.lastResult.teammate;
    } else {
      d.feedLine(
        tp.muted("  No debug info available. Try: /debug [teammate] [focus]"),
      );
      d.refreshView();
      return;
    }

    this.queueDebugAnalysis(targetName, debugFocus);
  }

  private queueDebugAnalysis(teammate: string, debugFocus?: string): void {
    const d = this.deps;
    const files = d.lastDebugFiles.get(teammate);
    const lastPrompt = d.lastTaskPrompts.get(teammate);

    if (!files?.promptFile && !files?.logFile) {
      d.feedLine(tp.muted(`  No debug log available for @${teammate}.`));
      d.refreshView();
      return;
    }

    let promptContent = "";
    if (files.promptFile) {
      try {
        promptContent = readFileSync(files.promptFile, "utf-8");
      } catch {
        /* may not exist */
      }
    }

    let logContent = "";
    if (files.logFile) {
      try {
        logContent = readFileSync(files.logFile, "utf-8");
      } catch {
        /* may not exist */
      }
    }

    const focusLine = debugFocus
      ? `\n\n**Focus your analysis on:** ${debugFocus}`
      : "";

    const analysisPrompt = [
      `Analyze the following debug information from @${teammate}'s last task execution. Identify any issues, errors, or anomalies. If the response was empty, explain likely causes. Provide a concise diagnosis and suggest fixes if applicable.${focusLine}`,
      "",
      "## Prompt Sent to Agent",
      "",
      promptContent || lastPrompt || "(not available)",
      "",
      "## Activity / Debug Log",
      "",
      logContent || "(no activity log)",
    ].join("\n");

    if (files.promptFile) {
      d.feedLine(concat(tp.muted("  Prompt: "), tp.accent(files.promptFile)));
    }
    if (files.logFile) {
      d.feedLine(concat(tp.muted("  Activity: "), tp.accent(files.logFile)));
    }
    if (debugFocus) {
      d.feedLine(tp.muted(`  Focus: ${debugFocus}`));
    }
    d.feedLine(tp.muted("  Queuing analysis…"));
    d.refreshView();

    d.taskQueue.push({
      id: d.makeQueueEntryId(),
      type: "debug",
      teammate: d.selfName,
      task: analysisPrompt,
    });
    d.kickDrain();
  }

  // ── /cancel ────────────────────────────────────────────────────────

  private async cmdCancel(argsStr: string): Promise<void> {
    const d = this.deps;
    const parts = argsStr.trim().split(/\s+/).filter(Boolean);
    const taskId = parseInt(parts[0]?.replace(/^#/, ""), 10);
    const teammateName = parts[1]?.replace(/^@/, "").toLowerCase();

    if (Number.isNaN(taskId)) {
      d.feedLine(tp.warning("  Usage: /cancel [task-id] [teammate]"));
      d.refreshView();
      return;
    }

    const thread = d.getThread(taskId);
    if (!thread) {
      d.feedLine(tp.warning(`  Unknown task #${taskId}`));
      d.refreshView();
      return;
    }

    if (teammateName) {
      const resolvedName =
        teammateName === d.adapterName ? d.selfName : teammateName;
      await this.cancelTeammateInThread(resolvedName, taskId, thread);
    } else {
      const teammates = this.getThreadTeammates(taskId);
      for (const name of teammates) {
        await this.cancelTeammateInThread(name, taskId, thread);
      }
    }

    const container = d.containers.get(taskId);
    if (container?.placeholderCount === 0 && d.chatView) {
      container.showThreadActions(d.chatView);
    }
    d.refreshView();
  }

  getThreadTeammates(threadId: number): string[] {
    const d = this.deps;
    const names = new Set<string>();
    for (const entry of d.taskQueue) {
      if (entry.threadId === threadId && !d.isSystemTask(entry)) {
        names.add(entry.teammate);
      }
    }
    for (const entry of d.agentActive.values()) {
      if (entry.threadId === threadId && !d.isSystemTask(entry)) {
        names.add(entry.teammate);
      }
    }
    return [...names];
  }

  async cancelTeammateInThread(
    teammate: string,
    threadId: number,
    thread: TaskThread,
  ): Promise<void> {
    const d = this.deps;
    const container = d.containers.get(threadId);

    const queuedIdx = d.taskQueue.findIndex(
      (e) =>
        e.teammate === teammate &&
        e.threadId === threadId &&
        !d.isSystemTask(e),
    );
    if (queuedIdx >= 0) {
      const removed = d.taskQueue.splice(queuedIdx, 1)[0];
      thread.pendingTasks.delete(removed.id);
      if (container && d.chatView) {
        d.threadManager.displayCanceledInThread(
          teammate,
          threadId,
          container,
          removed.id,
        );
      }
      d.appendThreadEntry(threadId, {
        type: "system",
        teammate,
        content: "canceled",
        subject: "canceled",
        timestamp: Date.now(),
      });
      return;
    }

    const activeEntry = d.agentActive.get(teammate);
    if (activeEntry?.threadId === threadId) {
      d.abortControllers.get(teammate)?.abort();
      d.abortControllers.delete(teammate);
      d.cleanupActivityLines(teammate);
      d.statusTracker.stopTask(teammate);
      d.agentActive.delete(teammate);
      thread.pendingTasks.delete(activeEntry.id);
      if (container && d.chatView) {
        d.threadManager.displayCanceledInThread(
          teammate,
          threadId,
          container,
          activeEntry.id,
        );
      }
      d.appendThreadEntry(threadId, {
        type: "system",
        teammate,
        content: "canceled",
        subject: "canceled",
        timestamp: Date.now(),
      });
    }
  }

  // ── /interrupt ─────────────────────────────────────────────────────

  private async cmdInterrupt(argsStr: string): Promise<void> {
    const d = this.deps;
    const parts = argsStr.trim().split(/\s+/);
    const taskId = parseInt(parts[0]?.replace(/^#/, ""), 10);
    const teammateName = parts[1]?.replace(/^@/, "").toLowerCase();
    const interruptionText = parts.slice(2).join(" ").trim();

    if (Number.isNaN(taskId) || !teammateName) {
      d.feedLine(
        tp.warning("  Usage: /interrupt [task-id] [teammate] [message]"),
      );
      d.refreshView();
      return;
    }

    const thread = d.getThread(taskId);
    if (!thread) {
      d.feedLine(tp.warning(`  Unknown task #${taskId}`));
      d.refreshView();
      return;
    }

    const resolvedName =
      teammateName === d.adapterName ? d.selfName : teammateName;
    const displayName =
      resolvedName === d.selfName ? d.adapterName : resolvedName;

    const activeEntry = d.agentActive.get(resolvedName);
    const isActive = activeEntry?.threadId === taskId;
    const queuedIdx = d.taskQueue.findIndex(
      (e) =>
        e.teammate === resolvedName &&
        e.threadId === taskId &&
        !d.isSystemTask(e),
    );

    if (!isActive && queuedIdx < 0) {
      d.feedLine(
        tp.warning(`  @${displayName} has no task in #${taskId} to interrupt.`),
      );
      d.refreshView();
      return;
    }

    const originalTask = isActive
      ? activeEntry!.task
      : d.taskQueue[queuedIdx].task;

    const updatedTask = interruptionText
      ? `${originalTask}\n\nUPDATE:\n${interruptionText}`
      : originalTask;

    const container = d.containers.get(taskId);

    try {
      if (isActive) {
        d.abortControllers.get(resolvedName)?.abort();
        d.abortControllers.delete(resolvedName);
        d.cleanupActivityLines(resolvedName);
        d.statusTracker.stopTask(resolvedName);
        d.agentActive.delete(resolvedName);
        thread.pendingTasks.delete(activeEntry!.id);
        if (container && d.chatView) {
          container.hidePlaceholder(d.chatView, activeEntry!.id);
        }
      } else {
        const removed = d.taskQueue.splice(queuedIdx, 1)[0];
        thread.pendingTasks.delete(removed.id);
        if (container && d.chatView) {
          container.hidePlaceholder(d.chatView, removed.id);
        }
      }

      const newEntry = {
        id: d.makeQueueEntryId(),
        type: "agent" as const,
        teammate: resolvedName,
        task: updatedTask,
        threadId: taskId,
      };
      d.taskQueue.push(newEntry);
      thread.pendingTasks.add(newEntry.id);

      const state = d.isAgentBusy(resolvedName) ? "queued" : "working";
      d.renderTaskPlaceholder(taskId, newEntry.id, resolvedName, state);

      d.appendThreadEntry(taskId, {
        type: "user",
        content: interruptionText
          ? `Interrupted @${displayName}: ${interruptionText}`
          : `Interrupted @${displayName}`,
        timestamp: Date.now(),
      });

      d.refreshView();
      d.kickDrain();
    } catch (err: any) {
      d.feedLine(
        tp.error(
          `  ✖  Failed to interrupt @${displayName}: ${err?.message ?? String(err)}`,
        ),
      );
      d.refreshView();
    }
  }

  // ── /init ──────────────────────────────────────────────────────────

  private async cmdInit(argsStr: string): Promise<void> {
    const d = this.deps;
    const cwd = process.cwd();
    const teammatesDir = join(cwd, ".teammates");
    await mkdir(teammatesDir, { recursive: true });

    const fromPath = argsStr.trim();
    if (fromPath === "pick") {
      await d.runPersonaOnboardingInline(teammatesDir);
    } else if (fromPath) {
      const resolved = resolve(fromPath);
      let sourceDir: string;
      try {
        const s = await stat(join(resolved, ".teammates"));
        if (s.isDirectory()) {
          sourceDir = join(resolved, ".teammates");
        } else {
          sourceDir = resolved;
        }
      } catch {
        sourceDir = resolved;
      }

      try {
        const { teammates, skipped, files } = await importTeammates(
          sourceDir,
          teammatesDir,
        );

        const allTeammates = [...teammates, ...skipped];

        if (allTeammates.length === 0) {
          d.feedLine(tp.warning(`  No teammates found at ${sourceDir}`));
          d.refreshView();
          return;
        }

        if (teammates.length > 0) {
          d.feedLine(
            tp.success(
              `  Imported ${teammates.length} teammate${teammates.length > 1 ? "s" : ""}: ${teammates.join(", ")} (${files.length} files)`,
            ),
          );
        }
        if (skipped.length > 0) {
          d.feedLine(
            tp.muted(
              `  ${skipped.length} already present: ${skipped.join(", ")} (will re-adapt)`,
            ),
          );
        }

        await copyTemplateFiles(teammatesDir);

        d.feedLine(
          tp.muted(
            "  Queuing agent to scan this project and adapt the team...",
          ),
        );
        const prompt = await buildImportAdaptationPrompt(
          teammatesDir,
          allTeammates,
          sourceDir,
        );
        d.taskQueue.push({
          id: d.makeQueueEntryId(),
          type: "agent",
          teammate: d.selfName,
          task: prompt,
        });
        d.kickDrain();
      } catch (err: any) {
        d.feedLine(tp.error(`  Import failed: ${err.message}`));
      }
    } else {
      await d.runOnboardingAgent(d.adapter, cwd);
    }

    const added = await d.orchestrator.refresh();
    if (added.length > 0) {
      const registry = d.orchestrator.getRegistry();
      if ("roster" in d.adapter) {
        (d.adapter as any).roster = d.orchestrator
          .listTeammates()
          .map((name) => {
            const t = registry.get(name)!;
            return { name: t.name, role: t.role, ownership: t.ownership };
          });
      }
    }
    d.feedLine(tp.muted("  Run /status to see the roster."));
    d.refreshView();
  }

  // ── /clear ─────────────────────────────────────────────────────────

  private async cmdClear(): Promise<void> {
    const d = this.deps;
    d.conversation.history.length = 0;
    d.conversation.summary = "";
    d.lastResult = null;
    d.lastResults.clear();
    d.taskQueue.length = 0;
    for (const ac of d.abortControllers.values()) ac.abort();
    d.abortControllers.clear();
    d.agentActive.clear();
    d.clearPastedTexts();
    d.handoffManager.clear();
    d.retroManager.clear();
    d.threadManager.clear();
    await d.orchestrator.reset();

    if (d.chatView) {
      d.chatView.clear();
      d.refreshView();
    } else {
      process.stdout.write(esc.clearScreen + esc.moveTo(0, 0));
      this.printBanner(d.orchestrator.listTeammates());
    }
  }

  // ── /compact ───────────────────────────────────────────────────────

  private async cmdCompact(argsStr: string): Promise<void> {
    const d = this.deps;
    const arg = argsStr.trim().replace(/^@/, "");
    const allTeammates = d.orchestrator
      .listTeammates()
      .filter((n) => n !== d.selfName && n !== d.adapterName);
    const names = !arg || arg === "everyone" ? allTeammates : [arg];

    const valid: string[] = [];
    for (const name of names) {
      const teammateDir = join(d.teammatesDir, name);
      try {
        const s = await stat(teammateDir);
        if (!s.isDirectory()) {
          d.feedLine(tp.warning(`  ${name}: not a directory, skipping`));
          continue;
        }
        valid.push(name);
      } catch {
        d.feedLine(tp.warning(`  ${name}: no directory found, skipping`));
      }
    }

    if (valid.length === 0) return;

    for (const name of valid) {
      d.taskQueue.push({
        id: d.makeQueueEntryId(),
        type: "compact",
        teammate: name,
        task: "compact + index update",
      });
    }

    d.feedLine();
    d.feedLine(
      concat(
        tp.muted("  Queued compaction for "),
        tp.accent(valid.map((n) => `@${n}`).join(", ")),
        tp.muted(` (${valid.length} task${valid.length === 1 ? "" : "s"})`),
      ),
    );
    d.feedLine();
    d.refreshView();

    d.kickDrain();
  }

  // ── /retro ─────────────────────────────────────────────────────────

  private async cmdRetro(argsStr: string): Promise<void> {
    const d = this.deps;
    const arg = argsStr.trim().replace(/^@/, "");

    const allTeammates = d.orchestrator
      .listTeammates()
      .filter((n) => n !== d.selfName && n !== d.adapterName);
    let targets: string[];

    if (arg === "everyone") {
      targets = allTeammates;
    } else if (arg) {
      const names = d.orchestrator.listTeammates();
      if (!names.includes(arg)) {
        d.feedLine(tp.warning(`  Unknown teammate: @${arg}`));
        d.refreshView();
        return;
      }
      targets = [arg];
    } else if (d.lastResult) {
      targets = [d.lastResult.teammate];
    } else {
      d.feedLine(
        tp.warning("  No teammate specified and no recent task to infer from."),
      );
      d.feedLine(tp.muted("  Usage: /retro <teammate>"));
      d.refreshView();
      return;
    }

    const retroPrompt = `Run a structured self-retrospective. Review your SOUL.md, GOALS.md, WISDOM.md, your last 2-3 weekly summaries (or last 7 daily logs if no weeklies exist), and any typed memories in your memory/ folder.

Produce a response with these four sections:

## 1. What's Working
Things you do well, based on evidence from recent work. Patterns worth reinforcing or codifying into wisdom. Cite specific examples from daily logs or memories.

## 2. What's Not Working
Friction, recurring issues, or patterns that aren't serving the project. Be specific — cite examples from daily logs or memories if possible.

## 3. Proposed SOUL.md Changes
The core output. Each proposal is a **specific edit** to your SOUL.md. Use this exact format for each proposal:

**Proposal N: <short title>**
- **Section:** <which SOUL.md section to change, e.g. Boundaries, Core Principles, Ownership>
- **Before:** <the current text to replace, or "(new entry)" if adding>
- **After:** <the exact replacement text>
- **Why:** <evidence from recent work justifying the change>

Only propose changes to your own SOUL.md. If a change affects shared files, note that it needs a handoff.

## 4. Questions for the Team
Issues that can't be resolved unilaterally — they need input from other teammates or the user.

**Rules:**
- This is a self-review of YOUR work. Do not evaluate other teammates.
- Evidence over opinion — cite specific examples.
- No busywork — if everything is working well, say "all good, no changes." That's a valid outcome.
- Number each proposal (Proposal 1, Proposal 2, etc.) so the user can approve or reject individually.`;

    const label =
      targets.length > 1
        ? targets.map((n) => `@${n}`).join(", ")
        : `@${targets[0]}`;
    d.feedLine();
    d.feedLine(concat(tp.muted("  Queued retro for "), tp.accent(label)));
    d.feedLine();
    d.refreshView();

    for (const name of targets) {
      d.taskQueue.push({
        id: d.makeQueueEntryId(),
        type: "retro",
        teammate: name,
        task: retroPrompt,
      });
    }
    d.kickDrain();
  }

  // ── /copy ──────────────────────────────────────────────────────────

  private async cmdCopy(): Promise<void> {
    this.doCopy();
  }

  buildSessionMarkdown(): string {
    const d = this.deps;
    if (d.conversation.history.length === 0) return "";
    const lines: string[] = [];
    lines.push("# Chat Session\n");
    for (const entry of d.conversation.history) {
      if (entry.role === "user") {
        lines.push(`**User:** ${entry.text}\n`);
      } else {
        const cleaned = entry.text
          .replace(/^TO:\s*\S+\s*\n/im, "")
          .replace(/```json\s*\n\s*\{[\s\S]*?\}\s*\n\s*```\s*$/g, "")
          .trim();
        lines.push(`**${entry.role}:**\n\n${cleaned}\n`);
      }
      lines.push("---\n");
    }
    return lines.join("\n");
  }

  doCopy(content?: string): void {
    const d = this.deps;
    const text = content ?? this.buildSessionMarkdown();
    if (!text) {
      d.feedLine(tp.muted("  Nothing to copy."));
      d.refreshView();
      return;
    }
    try {
      const isWin = process.platform === "win32";
      const cmd = isWin
        ? "clip"
        : process.platform === "darwin"
          ? "pbcopy"
          : "xclip -selection clipboard";
      const child = execCb(cmd, () => {});
      child.stdin?.write(text);
      child.stdin?.end();
      if (d.chatView) {
        d.statusTracker.showNotification(
          concat(tp.success("✔  "), tp.muted("Copied to clipboard")),
        );
      }
    } catch {
      if (d.chatView) {
        d.statusTracker.showNotification(
          concat(tp.error("✖  "), tp.muted("Failed to copy")),
        );
      }
    }
  }

  feedCommand(command: string): void {
    const d = this.deps;
    if (!d.chatView) {
      d.feedLine(tp.accent(`    ${command}`));
      return;
    }
    const normal = concat(tp.accent(`    ${command}  `), tp.muted("[copy]"));
    const hover = concat(tp.accent(`    ${command}  `), tp.accent("[copy]"));
    d.chatView.appendAction(`copy-cmd:${command}`, normal, hover);
  }

  // ── /help ──────────────────────────────────────────────────────────

  private async cmdHelp(): Promise<void> {
    const d = this.deps;
    d.feedLine();
    d.feedLine(tp.bold("  Commands"));
    d.feedLine(tp.muted(`  ${"─".repeat(50)}`));

    const seen = new Set<string>();
    for (const [, cmd] of d.commands) {
      if (seen.has(cmd.name)) continue;
      seen.add(cmd.name);

      const aliases =
        cmd.aliases.length > 0
          ? ` (${cmd.aliases.map((a) => `/${a}`).join(", ")})`
          : "";
      d.feedLine(
        concat(
          tp.accent(`  ${cmd.usage}`.padEnd(36)),
          pen(cmd.description),
          tp.muted(aliases),
        ),
      );
    }
    d.feedLine();
    d.feedLine(
      concat(
        tp.muted("  Tip: "),
        tp.text("Type text without / to auto-route to the best teammate"),
      ),
    );
    d.feedLine(
      concat(
        tp.muted("  Tip: "),
        tp.text("Press Tab to autocomplete commands and teammate names"),
      ),
    );
    d.feedLine();
    d.refreshView();
  }

  // ── /user ──────────────────────────────────────────────────────────

  private async cmdUser(argsStr: string): Promise<void> {
    const d = this.deps;
    const userMdPath = join(d.teammatesDir, "USER.md");
    const change = argsStr.trim();

    if (!change) {
      let content: string;
      try {
        content = readFileSync(userMdPath, "utf-8");
      } catch {
        d.feedLine(tp.muted("  USER.md not found."));
        d.feedLine(
          tp.muted("  Run /init or create .teammates/USER.md manually."),
        );
        d.refreshView();
        return;
      }

      if (!content.trim()) {
        d.feedLine(tp.muted("  USER.md is empty."));
        d.refreshView();
        return;
      }

      d.feedLine();
      d.feedLine(tp.muted("  ── USER.md ──"));
      d.feedLine();
      d.feedMarkdown(content);
      d.feedLine();
      d.feedLine(tp.muted("  ── end ──"));
      d.feedLine();
      d.refreshView();
      return;
    }

    const task = `Update the file ${userMdPath} with the following change:\n\n${change}\n\nKeep the existing content intact unless the change explicitly replaces something. This is the user's profile — be concise and accurate.`;
    d.taskQueue.push({
      id: d.makeQueueEntryId(),
      type: "agent",
      teammate: d.selfName,
      task,
    });
    d.feedLine(
      concat(
        tp.muted("  Queued USER.md update → "),
        tp.accent(`@${d.adapterName}`),
      ),
    );
    d.feedLine();
    d.refreshView();
    d.kickDrain();
  }

  // ── /btw ───────────────────────────────────────────────────────────

  private async cmdBtw(argsStr: string): Promise<void> {
    const d = this.deps;
    const question = argsStr.trim();
    if (!question) {
      d.feedLine(tp.muted("  Usage: /btw <question>"));
      d.refreshView();
      return;
    }

    d.taskQueue.push({
      id: d.makeQueueEntryId(),
      type: "btw",
      teammate: d.selfName,
      task: question,
    });
    d.feedLine(
      concat(tp.muted("  Side question → "), tp.accent(`@${d.adapterName}`)),
    );
    d.feedLine();
    d.refreshView();
    d.kickDrain();
  }

  // ── /script ────────────────────────────────────────────────────────

  private async cmdScript(argsStr: string): Promise<void> {
    const d = this.deps;
    const args = argsStr.trim();
    const scriptsDir = join(d.teammatesDir, d.selfName, "scripts");

    if (!args) {
      d.feedLine();
      d.feedLine(tp.bold("  /script — write and run reusable scripts"));
      d.feedLine(tp.muted(`  ${"─".repeat(50)}`));
      d.feedLine(
        concat(
          tp.accent("  /script list".padEnd(36)),
          tp.text("List saved scripts"),
        ),
      );
      d.feedLine(
        concat(
          tp.accent("  /script run <name>".padEnd(36)),
          tp.text("Run an existing script"),
        ),
      );
      d.feedLine(
        concat(
          tp.accent("  /script <description>".padEnd(36)),
          tp.text("Create and run a new script"),
        ),
      );
      d.feedLine();
      d.feedLine(tp.muted(`  Scripts are saved to ${scriptsDir}`));
      d.feedLine();
      d.refreshView();
      return;
    }

    if (args === "list") {
      let files: string[] = [];
      try {
        files = readdirSync(scriptsDir).filter((f) => !f.startsWith("."));
      } catch {
        /* directory doesn't exist yet */
      }

      d.feedLine();
      if (files.length === 0) {
        d.feedLine(tp.muted("  No scripts saved yet."));
        d.feedLine(tp.muted("  Use /script <description> to create one."));
      } else {
        d.feedLine(tp.bold("  Saved scripts"));
        d.feedLine(tp.muted(`  ${"─".repeat(50)}`));
        for (const f of files) {
          d.feedLine(concat(tp.accent(`  ${f}`)));
        }
      }
      d.feedLine();
      d.refreshView();
      return;
    }

    if (args.startsWith("run ")) {
      const name = args.slice(4).trim();
      if (!name) {
        d.feedLine(tp.muted("  Usage: /script run <name>"));
        d.refreshView();
        return;
      }

      const candidates = [
        name,
        `${name}.sh`,
        `${name}.ts`,
        `${name}.js`,
        `${name}.ps1`,
        `${name}.py`,
      ];
      let scriptPath: string | null = null;
      for (const c of candidates) {
        const p = join(scriptsDir, c);
        if (existsSync(p)) {
          scriptPath = p;
          break;
        }
      }

      if (!scriptPath) {
        d.feedLine(tp.warning(`  Script not found: ${name}`));
        d.feedLine(tp.muted("  Use /script list to see available scripts."));
        d.refreshView();
        return;
      }

      const scriptContent = readFileSync(scriptPath, "utf-8");
      const task = `Run the following script located at ${scriptPath}:\n\n\`\`\`\n${scriptContent}\n\`\`\`\n\nExecute it and report the results. If it fails, diagnose the issue and fix it.`;

      d.taskQueue.push({
        id: d.makeQueueEntryId(),
        type: "script",
        teammate: d.selfName,
        task,
      });
      d.feedLine(
        concat(
          tp.muted("  Running script "),
          tp.accent(basename(scriptPath)),
          tp.muted(" → "),
          tp.accent(`@${d.adapterName}`),
        ),
      );
      d.feedLine();
      d.refreshView();
      d.kickDrain();
      return;
    }

    const task = [
      "The user wants a reusable script. Their request:",
      "",
      args,
      "",
      "Instructions:",
      `1. Write the script and save it to the scripts directory: ${scriptsDir}`,
      "2. Create the directory if it doesn't exist.",
      "3. Choose a short, descriptive filename (kebab-case, with appropriate extension like .sh, .ts, .js, .py, .ps1).",
      "4. Make the script executable if applicable.",
      "5. Run the script and report the results.",
      "6. If the script needs to be parameterized, use command-line arguments.",
    ].join("\n");

    d.taskQueue.push({
      id: d.makeQueueEntryId(),
      type: "script",
      teammate: d.selfName,
      task,
    });
    d.feedLine(
      concat(tp.muted("  Script task → "), tp.accent(`@${d.adapterName}`)),
    );
    d.feedLine();
    d.refreshView();
    d.kickDrain();
  }

  // ── /theme ─────────────────────────────────────────────────────────

  private async cmdTheme(): Promise<void> {
    const d = this.deps;
    const t = theme();
    d.feedLine();
    d.feedLine(tp.bold("  Theme"));
    d.feedLine(tp.muted(`  ${"─".repeat(50)}`));
    d.feedLine();

    const row = (
      name: string,
      c: import("@teammates/consolonia").Color,
      example: string,
    ) => {
      const hex = colorToHex(c);
      d.feedLine(
        concat(
          pen.fg(c)("  ██"),
          tp.text(`  ${name}`.padEnd(24)),
          tp.muted(hex.padEnd(12)),
          pen.fg(c)(example),
        ),
      );
    };

    d.feedLine(tp.muted("       Variable                Hex         Example"));
    d.feedLine(tp.muted(`  ${"─".repeat(50)}`));

    row("accent", t.accent, "@beacon  /status  ● teammate");
    row("accentBright", t.accentBright, "▸ highlighted item");
    row("accentDim", t.accentDim, "┌─── border ───┐");

    d.feedLine();

    row("text", t.text, "Primary text content");
    row("textMuted", t.textMuted, "Description or secondary info");
    row("textDim", t.textDim, "─── separator ───");

    d.feedLine();

    row("success", t.success, "✔  Task completed");
    row("warning", t.warning, "⚠  Pending handoff");
    row("error", t.error, "✖  Something went wrong");
    row("info", t.info, "⠋ Working on task...");

    d.feedLine();

    row("prompt", t.prompt, "> ");
    row("input", t.input, "user typed text");
    row("separator", t.separator, "────────────────");
    row("progress", t.progress, "analyzing codebase...");
    row("dropdown", t.dropdown, "/status  session overview");
    row("dropdownHighlight", t.dropdownHighlight, "▸ /help   all commands");

    d.feedLine();

    d.feedLine(
      concat(
        pen.fg(t.cursorFg).bg(t.cursorBg)("  ██"),
        tp.text("  cursorFg/cursorBg".padEnd(24)),
        tp.muted(
          `${colorToHex(t.cursorFg)}/${colorToHex(t.cursorBg)}`.padEnd(12),
        ),
        pen.fg(t.cursorFg).bg(t.cursorBg)(" block cursor "),
      ),
    );

    d.feedLine();
    d.feedLine(tp.muted("  Base accent: #3A96DD"));
    d.feedLine();

    // ── Markdown preview ──────────────────────────────────────
    d.feedLine(tp.bold("  Markdown Preview"));
    d.feedLine(tp.muted(`  ${"─".repeat(50)}`));
    d.feedLine();

    const mdSample = [
      "# Heading 1",
      "",
      "## Heading 2",
      "",
      "### Heading 3",
      "",
      "Regular text with **bold**, *italic*, and `inline code`.",
      "A [link](https://example.com) and ~~strikethrough~~.",
      "",
      "- Bullet item one",
      "- Bullet item with **bold**",
      "  - Nested item",
      "",
      "1. Ordered first",
      "2. Ordered second",
      "",
      "> Blockquote text",
      "> across multiple lines",
      "",
      "```js",
      'const greeting = "hello";',
      "async function main() {",
      '  await fetch("/api");',
      "  return 42;",
      "}",
      "```",
      "",
      "```python",
      "def greet(name: str) -> None:",
      '    print(f"Hello, {name}")',
      "```",
      "",
      "```bash",
      'echo "$HOME" | grep --color user',
      "if [ -f .env ]; then source .env; fi",
      "```",
      "",
      "```json",
      "{",
      '  "name": "teammates",',
      '  "version": "0.1.0",',
      '  "active": true',
      "}",
      "```",
      "",
      "| Language   | Status  |",
      "|------------|---------|",
      "| JavaScript | ✔  Ready |",
      "| Python     | ✔  Ready |",
      "| C#         | ✔  Ready |",
      "",
      "---",
    ].join("\n");

    d.feedMarkdown(mdSample);
    d.feedLine();
    d.refreshView();
  }

  // ── printBanner (pre-TUI fallback) ─────────────────────────────────

  printBanner(teammates: string[]): void {
    const d = this.deps;
    const registry = d.orchestrator.getRegistry();
    const termWidth = process.stdout.columns || 100;

    d.feedLine();
    d.feedLine(concat(tp.bold("  Teammates"), tp.muted(` v${PKG_VERSION}`)));
    d.feedLine(
      concat(
        tp.text(`  @${d.adapterName}`),
        tp.muted(
          ` · ${teammates.length} teammate${teammates.length === 1 ? "" : "s"}`,
        ),
      ),
    );
    d.feedLine(`  ${process.cwd()}`);
    for (const svc of d.serviceStatuses) {
      const ok = svc.status === "bundled" || svc.status === "configured";
      const icon = ok ? "● " : svc.status === "not-configured" ? "◐ " : "○ ";
      const color = ok ? tp.success : tp.warning;
      const label =
        svc.status === "bundled"
          ? "bundled"
          : svc.status === "configured"
            ? "configured"
            : svc.status === "not-configured"
              ? `not configured — /configure ${svc.name.toLowerCase()}`
              : `missing — /configure ${svc.name.toLowerCase()}`;
      d.feedLine(
        concat(
          tp.text("  "),
          color(icon),
          color(svc.name),
          tp.muted(` ${label}`),
        ),
      );
    }

    d.feedLine();
    const statuses = d.orchestrator.getAllStatuses();
    if (d.userAlias) {
      const up = statuses.get(d.userAlias)?.presence ?? "online";
      const udot =
        up === "online"
          ? tp.success("●")
          : up === "reachable"
            ? tp.warning("●")
            : tp.error("●");
      d.feedLine(
        concat(
          tp.text("  "),
          udot,
          tp.accent(` @${d.adapterName.padEnd(14)}`),
          tp.muted("Coding agent that performs tasks on your behalf."),
        ),
      );
    }
    for (const name of teammates) {
      const t = registry.get(name);
      if (t) {
        const p = statuses.get(name)?.presence ?? "online";
        const dot =
          p === "online"
            ? tp.success("●")
            : p === "reachable"
              ? tp.warning("●")
              : tp.error("●");
        d.feedLine(
          concat(
            tp.text("  "),
            dot,
            tp.accent(` @${name.padEnd(14)}`),
            tp.muted(t.role),
          ),
        );
      }
    }

    d.feedLine();
    d.feedLine(tp.muted("─".repeat(termWidth)));

    let col1: string[][];
    let col2: string[][];
    let col3: string[][];

    if (teammates.length === 0) {
      col1 = [
        ["/init", "set up teammates"],
        ["/help", "all commands"],
      ];
      col2 = [
        ["/exit", "exit session"],
        ["", ""],
      ];
      col3 = [
        ["", ""],
        ["", ""],
      ];
    } else {
      col1 = [
        ["@mention", "assign to teammate"],
        ["text", "auto-route task"],
        ["[image]", "drag & drop images"],
      ];
      col2 = [
        ["/status", "teammates & queue"],
        ["/compact", "compact memory"],
        ["/retro", "run retrospective"],
      ];
      col3 = [
        ["/copy", "copy session text"],
        ["/help", "all commands"],
        ["/exit", "exit session"],
      ];
    }

    for (let i = 0; i < col1.length; i++) {
      d.feedLine(
        concat(
          tp.accent(`  ${col1[i][0]}`.padEnd(12)),
          tp.muted(col1[i][1].padEnd(22)),
          tp.accent(col2[i][0].padEnd(12)),
          tp.muted(col2[i][1].padEnd(22)),
          tp.accent(col3[i][0].padEnd(12)),
          tp.muted(col3[i][1]),
        ),
      );
    }

    d.feedLine();
    d.refreshView();
  }

  // ── Helpers ────────────────────────────────────────────────────────

  private getThreadTaskCounts(threadId: number): {
    working: number;
    queued: number;
  } {
    const d = this.deps;
    let working = 0;
    let queued = 0;
    for (const entry of d.agentActive.values()) {
      if (entry.threadId === threadId && !d.isSystemTask(entry)) working++;
    }
    for (const entry of d.taskQueue) {
      if (entry.threadId === threadId && !d.isSystemTask(entry)) queued++;
    }
    return { working, queued };
  }
}
