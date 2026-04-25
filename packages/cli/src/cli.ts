#!/usr/bin/env node

/**
 * @teammates/cli — Interactive teammate orchestrator.
 *
 * Start a session:
 *   teammates                     Launch interactive REPL
 *   teammates --adapter codex     Use a specific agent adapter
 *   teammates --dir <path>        Override .teammates/ location
 */

import { exec as execCb } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve as resolvePath } from "node:path";

import {
  App,
  ChatView,
  type Color,
  concat,
  pen,
  type StyledSpan,
  ThreadBar,
  type ThreadBarTab,
} from "@teammates/consolonia";
import chalk from "chalk";
import { ActivityManager } from "./activity-manager.js";
import type { AgentAdapter } from "./adapter.js";
import { syncRecallIndex } from "./adapter.js";
import { AnimatedBanner, type ServiceInfo } from "./banner.js";
import {
  type CliArgs,
  findTeammatesDir,
  PKG_VERSION,
  parseCliArgs,
  printUsage,
  resolveAdapter,
} from "./cli-args.js";
import {
  buildThreadContext,
  cleanResponseBody,
  isImagePath,
} from "./cli-utils.js";
import { CommandManager } from "./commands.js";
import { PromptInput } from "./console/prompt-input.js";
import { ConversationManager } from "./conversation.js";
import { FeedRenderer } from "./feed-renderer.js";
import { HandoffManager } from "./handoff-manager.js";
import { OnboardFlow } from "./onboard-flow.js";
import { Orchestrator } from "./orchestrator.js";
import { loadPersonas, type Persona } from "./personas.js";
import { RetroManager } from "./retro-manager.js";
import { detectServices } from "./service-config.js";
import { StartupManager } from "./startup-manager.js";
import { StatusTracker } from "./status-tracker.js";
import { writeAllSystemPrompts } from "./system-prompt.js";
import { theme, tp } from "./theme.js";
import { ThreadManager } from "./thread-manager.js";
import type {
  ActivityEvent,
  OrchestratorEvent,
  QueueEntry,
  SlashCommand,
  TaskResult,
  TaskThread,
  ThreadEntry,
} from "./types.js";
import { logUserTask } from "./user-task-logger.js";
import { Wordwheel } from "./wordwheel.js";

// ─── Parsed CLI arguments ────────────────────────────────────────────

const cliArgs: CliArgs = parseCliArgs();

// ─── REPL ────────────────────────────────────────────────────────────

class TeammatesREPL {
  private orchestrator!: Orchestrator;
  private adapter!: AgentAdapter;
  private input!: PromptInput;
  private chatView!: ChatView;
  private app!: App;
  private commands: Map<string, SlashCommand> = new Map();
  private lastResult: TaskResult | null = null;
  private lastResults: Map<string, TaskResult> = new Map();
  private conversation!: ConversationManager;

  private storeResult(result: TaskResult): void {
    this.lastResult = result;
    this.lastResults.set(result.teammate, result);
    this.conversation.storeInHistory(result);
  }

  private feedRenderer!: FeedRenderer;

  private adapterName: string;
  private teammatesDir!: string;
  private taskQueue: QueueEntry[] = [];
  private nextQueueEntryId = 1;
  /** Per-slot active tasks — keyed by `slotKey(threadId, teammate)`.
   *  A "slot" is a (tab, teammate) pair — the serialization unit.
   *  Same teammate in two tabs = two slots = two concurrent tasks. */
  private agentActive: Map<string, QueueEntry> = new Map();
  /** Per-slot abort controllers — abort to cancel the running agent. */
  private abortControllers: Map<string, AbortController> = new Map();
  /** Active system tasks — multiple can run concurrently per agent. */
  private systemActive: Map<string, QueueEntry> = new Map();
  /** Agents currently in a silent retry — suppress all events. */
  private silentAgents: Set<string> = new Set();
  /** Counter for pending migration compression tasks — triggers re-index when it hits 0. */
  private pendingMigrationSyncs = 0;
  private static readonly MIGRATION_TASK_ID = "__migration__";
  /** Per-slot drain locks — prevents double-draining a single slot. */
  private agentDrainLocks: Map<string, Promise<void>> = new Map();
  /** Stored pasted text keyed by paste number, expanded on Enter. */
  private pastedTexts: Map<number, string> = new Map();
  private pasteCounter = 0;
  private wordwheel!: Wordwheel;
  /** Cached persona list for wordwheel completion. */
  private cachedPersonas: Persona[] = [];
  private escPending = false; // true after first ESC, waiting for second
  private escTimer: ReturnType<typeof setTimeout> | null = null;
  private ctrlcPending = false; // true after first Ctrl+C, waiting for second
  private ctrlcTimer: ReturnType<typeof setTimeout> | null = null;
  private lastCleanedOutput = ""; // last teammate output for clipboard copy
  /** Maps copy action IDs to the cleaned output text for that response. */
  private _copyContexts: Map<string, string> = new Map();
  /** Last debug file paths per teammate — for /debug analysis. */
  private lastDebugFiles: Map<
    string,
    { promptFile?: string; logFile?: string }
  > = new Map();
  /** Last task prompt per teammate — for /debug analysis. */
  private lastTaskPrompts: Map<string, string> = new Map();
  private activityManager!: ActivityManager;
  private startupMgr!: StartupManager;
  private commandManager!: CommandManager;

  private handoffManager!: HandoffManager;
  private retroManager!: RetroManager;

  /** Maps reply action IDs to their context (teammate + message). */
  private _replyContexts: Map<
    string,
    { teammate: string; message: string; threadId?: number }
  > = new Map();
  /** Quoted reply text to expand on next submit. */
  private _pendingQuotedReply: string | null = null;
  /** Resolver for inline ask — when set, next submit resolves this instead of normal handling. */
  private _pendingAsk: ((answer: string) => void) | null = null;
  private defaultFooter: StyledSpan | null = null; // cached left footer content
  private defaultFooterRight: StyledSpan | null = null; // cached right footer content
  /** Cached service statuses for banner + /configure. */
  private serviceStatuses: ServiceInfo[] = [];
  /** Reference to the animated banner widget for live updates. */
  private banner: AnimatedBanner | null = null;
  /** The local user's alias (avatar name). Set after USER.md is read or interview completes. */
  private userAlias: string | null = null;

  // ── Thread management (delegated to ThreadManager) ──────────────
  private threadManager!: ThreadManager;
  /** ThreadBar widget (tabs between banner and feed). */
  private threadBar!: ThreadBar;
  /** Set of thread IDs with unread content. */
  private unreadThreads: Set<number> = new Set();

  private get shiftAllContainers() {
    return this.threadManager.shiftAllContainers;
  }

  // ── Animated status tracker (delegated to StatusTracker) ────────
  private statusTracker!: StatusTracker;

  constructor(adapterName: string) {
    this.adapterName = adapterName;
    this.onboardFlow = new OnboardFlow({
      feedLine: (text?) => this.feedLine(text),
      feedMarkdown: (source) => this.feedMarkdown(source),
      refreshView: () => this.refreshView(),
      askInline: (prompt) => this.askInline(prompt),
      get adapterName() {
        return adapterName;
      },
    });
  }

  private makeQueueEntryId(): string {
    return `q${this.nextQueueEntryId++}`;
  }

  /** Compute the slot key for a (thread, teammate) pair.
   *  Null/undefined threadId collapses to "0" (pre-thread legacy tasks). */
  private slotKey(threadId: number | undefined, teammate: string): string {
    return `t${threadId ?? 0}:${teammate}`;
  }

  /** Is the given (thread, teammate) slot currently busy (queued or active)? */
  private isSlotBusy(threadId: number | undefined, teammate: string): boolean {
    const slot = this.slotKey(threadId, teammate);
    return (
      this.agentActive.has(slot) ||
      this.taskQueue.some(
        (e) =>
          e.teammate === teammate &&
          e.threadId === threadId &&
          !this.isSystemTask(e),
      )
    );
  }

  /**
   * The name used for the local user in the roster.
   * Returns the user's alias if set, otherwise the adapter name.
   */
  private get selfName(): string {
    return this.userAlias ?? this.adapterName;
  }

  /** Show the prompt with the fenced border. */
  private showPrompt(): void {
    if (this.chatView) {
      // ChatView is always visible — just refresh
      this.app.refresh();
    } else {
      this.input.activate();
    }
  }

  private startMigrationProgress(message: string): void {
    this.statusTracker.startTask(
      TeammatesREPL.MIGRATION_TASK_ID,
      "teammates",
      message,
    );
  }

  private stopMigrationProgress(): void {
    this.statusTracker.stopTask(TeammatesREPL.MIGRATION_TASK_ID);
  }

  /**
   * Print the user's message as an inverted block in the feed.
   * White text on dark background, right-aligned indicator.
   */
  // ── Feed rendering (delegated to FeedRenderer) ──────────────────
  private feedLine(text?: string | StyledSpan): void {
    this.feedRenderer.feedLine(text);
  }
  private feedMarkdown(source: string): void {
    this.feedRenderer.feedMarkdown(source);
  }
  private feedUserLine(spans: StyledSpan): void {
    this.feedRenderer.feedUserLine(spans);
  }
  private makeSpan(
    ...segs: { text: string; style: { fg?: Color } }[]
  ): StyledSpan {
    return this.feedRenderer.makeSpan(...segs);
  }

  /**
   * Refresh the ChatView app if active. Coalesces multiple refreshes within
   * the same tick into a single render — important when many tabs are working
   * concurrently and firing feed updates/activity events in parallel.
   */
  private refreshView(): void {
    if (this.app) this.app.scheduleRefresh();
  }

  /** Rebuild the ThreadBar tabs from current thread state. */
  private refreshThreadBar(): void {
    if (!this.threadBar) return;
    const tabs: ThreadBarTab[] = [];
    for (const [id, thread] of this.threadManager.threads) {
      tabs.push({
        id,
        name: thread.originMessage || "Thread",
        focused: this.threadManager.focusedThreadId === id,
        unread: this.unreadThreads.has(id),
        working: this.threadManager.isThreadWorking(id),
      });
    }
    this.threadBar.tabs = tabs;
  }

  private queueTask(
    input: string,
    preMentions?: string[],
    threadId?: number,
  ): void {
    const allNames = this.orchestrator.listTeammates();

    // Create or reuse a thread. In the tab model, thread #1 is created
    // implicitly on first task. Explicit tabs come from /tab.
    let thread: TaskThread;
    let isNewThread = false;
    if (threadId != null) {
      const existing = this.threadManager.getThread(threadId);
      if (!existing) {
        this.feedLine(tp.error(`  Unknown thread #${threadId}`));
        this.refreshView();
        return;
      }
      thread = existing;
      thread.focusedAt = Date.now();
      // Switch to this thread if not already focused
      if (this.threadManager.focusedThreadId !== threadId) {
        this.threadManager.switchToThread(threadId);
      }
    } else {
      // Create thread #1 implicitly
      thread = this.threadManager.createThread(input);
      isNewThread = true;
    }
    // Add user message to thread
    this.threadManager.appendThreadEntry(thread.id, {
      type: "user",
      content: input,
      timestamp: Date.now(),
    });
    const tid = thread.id;

    // Render the user message in the thread's feed
    this.feedRenderer.printUserMessage(input);

    // Resolve @mentions
    let mentioned: string[];
    if (preMentions) {
      mentioned = preMentions;
    } else {
      const mentionRegex = /@(\S+)/g;
      let m: RegExpExecArray | null;
      mentioned = [];
      while ((m = mentionRegex.exec(input)) !== null) {
        const name =
          m[1] === this.adapterName && this.userAlias ? this.selfName : m[1];
        if (allNames.includes(name) && !mentioned.includes(name)) {
          mentioned.push(name);
        }
      }
    }

    // @everyone — queue to all teammates
    const everyoneMatch = input.match(/^@everyone\s+([\s\S]+)$/i);
    if (everyoneMatch) {
      const task = everyoneMatch[1];
      const names = allNames.filter(
        (n) => n !== this.selfName && n !== this.adapterName,
      );
      const contextSnapshot = {
        history: this.conversation.history.map((e) => ({ ...e })),
        summary: this.conversation.summary,
      };
      // Render dispatch header in the thread's own feed
      this.threadManager.renderThreadHeader(thread, names);
      const adapter = this.threadManager.getAdapter(tid);
      const c = this.threadManager.containers.get(tid);
      if (c && adapter) {
        const shift = this.threadManager.getShiftCallback(tid);
        c.insertLine(adapter, "", shift);
      }
      for (const teammate of names) {
        const entry = {
          id: this.makeQueueEntryId(),
          type: "agent",
          teammate,
          task,
          threadId: tid,
          contextSnapshot,
        } as const;
        const state = this.isSlotBusy(tid, teammate) ? "queued" : "working";
        this.taskQueue.push(entry);
        thread.pendingTasks.add(entry.id);
        this.threadManager.renderTaskPlaceholder(
          tid,
          entry.id,
          teammate,
          state,
        );
      }
      if (c && adapter) c.hideThreadActions(adapter);
      this.refreshView();
      this.kickDrain();
      return;
    }

    // Resolve target teammates
    let targets: string[];
    if (mentioned.length > 0) {
      targets = mentioned;
    } else {
      // No mentions — default to last responder or route
      let match: string | null = null;
      if (thread.entries.length > 0) {
        for (let i = thread.entries.length - 1; i >= 0; i--) {
          if (
            thread.entries[i].type === "agent" &&
            thread.entries[i].teammate
          ) {
            match = thread.entries[i].teammate!;
            break;
          }
        }
      }
      if (!match && this.lastResult) match = this.lastResult.teammate;
      if (!match) match = this.orchestrator.route(input) ?? this.selfName;
      targets = [match];
    }

    // Render dispatch header + placeholders in the thread's feed
    this.threadManager.renderThreadHeader(thread, targets);
    const adapter = this.threadManager.getAdapter(tid);
    const dc = this.threadManager.containers.get(tid);
    if (dc && adapter) {
      const shift = this.threadManager.getShiftCallback(tid);
      dc.insertLine(adapter, "", shift);
      dc.hideThreadActions(adapter);
    }
    for (const teammate of targets) {
      const entry = {
        id: this.makeQueueEntryId(),
        type: "agent",
        teammate,
        task: input,
        threadId: tid,
      } as const;
      const state = this.isSlotBusy(tid, teammate) ? "queued" : "working";
      this.taskQueue.push(entry);
      thread.pendingTasks.add(entry.id);
      this.threadManager.renderTaskPlaceholder(tid, entry.id, teammate, state);
    }
    this.refreshView();
    this.kickDrain();
  }

  /** Returns true if the queue entry is a system-initiated (non-blocking) task. */
  private isSystemTask(entry: QueueEntry): boolean {
    return (
      entry.type === "compact" ||
      entry.type === "summarize" ||
      (entry.type === "agent" && entry.system === true)
    );
  }

  /** Start draining per-agent queues in parallel. Each agent gets its own drain loop.
   *  System tasks are extracted and run concurrently without blocking user tasks. */
  private kickDrain(): void {
    // Extract system tasks and fire them concurrently (non-blocking)
    for (let i = this.taskQueue.length - 1; i >= 0; i--) {
      const entry = this.taskQueue[i];
      if (this.isSystemTask(entry)) {
        this.taskQueue.splice(i, 1);
        this.runSystemTask(entry);
      }
    }

    // Find slots that have user tasks but no active drain.
    // A slot is a (threadId, teammate) pair — same teammate in different
    // tabs runs concurrently.
    const slotsWithWork = new Map<
      string,
      { threadId: number | undefined; teammate: string }
    >();
    for (const entry of this.taskQueue) {
      const slot = this.slotKey(entry.threadId, entry.teammate);
      if (!slotsWithWork.has(slot)) {
        slotsWithWork.set(slot, {
          threadId: entry.threadId,
          teammate: entry.teammate,
        });
      }
    }
    for (const [slot, { threadId, teammate }] of slotsWithWork) {
      if (!this.agentDrainLocks.has(slot)) {
        const lock = this.drainSlot(threadId, teammate).finally(() => {
          this.agentDrainLocks.delete(slot);
        });
        this.agentDrainLocks.set(slot, lock);
      }
    }
  }

  /**
   * Run a system-initiated task concurrently without blocking user tasks.
   * Purely background — no progress bar, no /status. Only reports errors.
   */
  private async runSystemTask(entry: QueueEntry): Promise<void> {
    const taskId = `sys-${entry.teammate}-${Date.now()}`;
    this.systemActive.set(taskId, entry);

    const startTime = Date.now();
    try {
      if (entry.type === "compact") {
        await this.startupMgr.runCompact(entry.teammate, true);
      } else if (entry.type === "summarize") {
        const result = await this.orchestrator.assign({
          teammate: entry.teammate,
          task: entry.task,
          system: true,
        });
        const raw = result.rawOutput ?? "";
        this.conversation.summary = raw
          .replace(/^TO:\s*\S+\s*\n/im, "")
          .replace(/^#\s+.+\n*/m, "")
          .replace(/```json\s*\n\s*\{[\s\S]*?\}\s*\n\s*```\s*$/g, "")
          .trim();
      } else {
        // System agent tasks (e.g. wisdom distillation)
        const result = await this.orchestrator.assign({
          teammate: entry.teammate,
          task: entry.task,
          system: true,
        });
        // Write debug entry for system tasks too
        this.writeDebugEntry(entry.teammate, entry.task, result, startTime);
      }
    } catch (err: any) {
      // System task errors always show in feed
      const msg = err?.message ?? String(err);
      const displayName =
        entry.teammate === this.selfName ? this.adapterName : entry.teammate;
      this.feedLine(tp.error(`  ✖  @${displayName} (system): ${msg}`));
      this.refreshView();
    } finally {
      this.systemActive.delete(taskId);
      // Migration tasks: decrement counter and re-index when all are done
      if (entry.type === "agent" && entry.migration) {
        this.pendingMigrationSyncs--;
        if (this.pendingMigrationSyncs <= 0) {
          this.stopMigrationProgress();
          try {
            await syncRecallIndex(this.teammatesDir);
          } catch {
            /* re-index failed — non-fatal, next startup will retry */
          }
          // Persist version LAST — only after all migration tasks finish
          this.startupMgr.commitVersionUpdate();
        }
      }
    }
  }

  // ─── Onboarding (delegated to OnboardFlow) ─────────────────────────
  private onboardFlow!: OnboardFlow;

  /**
   * Ask for input using the ChatView's own prompt (no raw readline).
   * Temporarily replaces the footer with the prompt text and intercepts the next submit.
   */
  private askInline(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      if (!this.chatView) {
        return this.onboardFlow.askInput(prompt).then(resolve);
      }
      this.feedLine(tp.accent(`  ${prompt}`));
      this.chatView.setFooter(tp.accent(`  ${prompt}`));
      this._pendingAsk = (answer: string) => {
        if (this.chatView && this.defaultFooter) {
          this.chatView.setFooter(this.defaultFooter);
        }
        this.refreshView();
        resolve(answer.trim());
      };
      this.refreshView();
    });
  }

  // ─── Lifecycle ────────────────────────────────────────────────────

  async start(): Promise<void> {
    let teammatesDir = await findTeammatesDir(cliArgs.dirOverride);
    const adapter = await resolveAdapter(this.adapterName, {
      modelOverride: cliArgs.modelOverride,
      agentPassthrough: cliArgs.agentPassthrough,
    });
    this.adapter = adapter;

    // Detect whether this is a brand-new project (no .teammates/ at all)
    const isNewProject = !teammatesDir;
    if (!teammatesDir) {
      teammatesDir = join(process.cwd(), ".teammates");
      await mkdir(teammatesDir, { recursive: true });

      // Show welcome logo for new projects
      console.log();
      this.onboardFlow.printLogo([
        chalk.bold("Teammates") + chalk.gray(` v${PKG_VERSION}`),
        chalk.yellow("New project setup"),
        chalk.gray(process.cwd()),
      ]);
    }

    // Always onboard the user first if USER.md is missing
    if (this.onboardFlow.needsUserSetup(teammatesDir)) {
      await this.onboardFlow.runUserSetup(teammatesDir);
    }

    // Team onboarding if no agentic teammates configured (and not explicitly solo)
    const hasTeammates =
      await this.onboardFlow.hasAgenticTeammates(teammatesDir);
    const isSolo = this.onboardFlow.readSoloSetting(teammatesDir);
    if (isNewProject || (!hasTeammates && !isSolo)) {
      const cont = await this.onboardFlow.promptTeamOnboarding(
        adapter,
        teammatesDir,
        (raw) => this.onboardFlow.printAgentOutput(raw),
      );
      if (!cont) return; // user chose to exit
    }

    // Init orchestrator
    this.teammatesDir = teammatesDir;
    this.orchestrator = new Orchestrator({
      teammatesDir,
      adapter,
      onEvent: (e) => this.handleEvent(e),
    });
    await this.orchestrator.init();

    // Pre-load bundled personas for wordwheel completion
    this.cachedPersonas = await loadPersonas();

    // Shared closure ref — used by extracted modules below
    const repl = this;

    // Init conversation manager
    this.conversation = new ConversationManager({
      taskQueue: this.taskQueue,
      makeQueueEntryId: () => this.makeQueueEntryId(),
      kickDrain: () => this.kickDrain(),
      get selfName() {
        return repl.selfName;
      },
    });

    // Register the local user's avatar if alias is configured.
    // The user's avatar is the entry point for all generic/fallback tasks —
    // the coding agent is an internal execution engine, not an addressable teammate.
    const alias = this.onboardFlow.readUserAlias(teammatesDir);
    if (alias) {
      this.onboardFlow.registerUserAvatar(
        teammatesDir,
        alias,
        this.orchestrator,
      );
      this.userAlias = alias;
    } else {
      // No alias yet (solo mode or pre-interview). Register a minimal avatar
      // under the adapter name so internal tasks (btw, summarize, debug) can execute.
      const registry = this.orchestrator.getRegistry();
      registry.register({
        name: this.adapterName,
        type: "ai",
        role: "Coding agent that performs tasks on your behalf.",
        soul: "",
        goals: "",
        wisdom: "",
        dailyLogs: [],
        weeklyLogs: [],
        ownership: { primary: [], secondary: [] },
        routingKeywords: [],
        cwd: dirname(this.teammatesDir),
      });
      this.orchestrator
        .getAllStatuses()
        .set(this.adapterName, { state: "idle", presence: "online" });
    }

    // Populate roster on the adapter so prompts include team info
    // Exclude the user avatar and adapter fallback — neither is an addressable teammate
    if ("roster" in this.adapter) {
      const registry = this.orchestrator.getRegistry();
      (this.adapter as any).roster = this.orchestrator
        .listTeammates()
        .filter((n) => n !== this.adapterName && n !== this.userAlias)
        .map((name) => {
          const t = registry.get(name)!;
          return { name: t.name, role: t.role, ownership: t.ownership };
        });
    }

    // Background maintenance — startupMgr is initialized below after closures are defined
    // (moved to after StartupManager construction)

    // Register commands (extracted to CommandManager)
    this.commandManager = new CommandManager({
      get adapterName() {
        return repl.adapterName;
      },
      get selfName() {
        return repl.selfName;
      },
      get userAlias() {
        return repl.userAlias;
      },
      get orchestrator() {
        return repl.orchestrator;
      },
      get adapter() {
        return repl.adapter;
      },
      get taskQueue() {
        return repl.taskQueue;
      },
      get agentActive() {
        return repl.agentActive;
      },
      get abortControllers() {
        return repl.abortControllers;
      },
      get commands() {
        return repl.commands;
      },
      get conversation() {
        return repl.conversation;
      },
      get lastResult() {
        return repl.lastResult;
      },
      set lastResult(v) {
        repl.lastResult = v;
      },
      get lastResults() {
        return repl.lastResults;
      },
      get lastDebugFiles() {
        return repl.lastDebugFiles;
      },
      get lastTaskPrompts() {
        return repl.lastTaskPrompts;
      },
      get lastCleanedOutput() {
        return repl.lastCleanedOutput;
      },
      get serviceStatuses() {
        return repl.serviceStatuses;
      },
      get threadManager() {
        return repl.threadManager;
      },
      get handoffManager() {
        return repl.handoffManager;
      },
      get retroManager() {
        return repl.retroManager;
      },
      get statusTracker() {
        return repl.statusTracker;
      },
      get onboardFlow() {
        return repl.onboardFlow;
      },
      get banner() {
        return repl.banner;
      },
      get chatView() {
        return repl.chatView;
      },
      get app() {
        return repl.app;
      },
      get input() {
        return repl.input;
      },
      feedLine: (text?) => this.feedLine(text),
      feedMarkdown: (source) => this.feedMarkdown(source),
      feedUserLine: (spans) => this.feedUserLine(spans),
      refreshView: () => this.refreshView(),
      showPrompt: () => this.showPrompt(),
      makeSpan: (...args) => this.makeSpan(...args),
      makeQueueEntryId: () => this.makeQueueEntryId(),
      kickDrain: () => this.kickDrain(),
      isSystemTask: (entry) => this.isSystemTask(entry),
      isSlotBusy: (threadId, teammate) => this.isSlotBusy(threadId, teammate),
      slotKey: (threadId, teammate) => this.slotKey(threadId, teammate),
      getThread: (id) => this.threadManager.getThread(id),
      get threads() {
        return repl.threadManager.threads;
      },
      get focusedThreadId() {
        return repl.threadManager.focusedThreadId;
      },
      get containers() {
        return repl.threadManager.containers;
      },
      appendThreadEntry: (tid, entry) =>
        this.threadManager.appendThreadEntry(tid, entry),
      renderTaskPlaceholder: (tid, pid, tm, s) =>
        this.threadManager.renderTaskPlaceholder(tid, pid, tm, s),
      cleanupActivityLines: (taskId) =>
        this.activityManager.cleanupActivityLines(taskId),
      runOnboardingAgent: (adapter, dir) =>
        this.onboardFlow.runOnboardingAgent(
          adapter,
          dir,
          this.adapterName,
          (raw) => this.onboardFlow.printAgentOutput(raw),
        ),
      runPersonaOnboardingInline: (dir) =>
        this.onboardFlow.runPersonaOnboardingInline(dir),
      refreshTeammates: () => this.refreshTeammates(),
      removeTeammateFromDisk: async (name) => {
        const { rm } = await import("node:fs/promises");
        const dir = join(this.teammatesDir, name);
        await rm(dir, { recursive: true, force: true });
      },
      askInline: (prompt) => this.askInline(prompt),
      get serviceView() {
        return repl.serviceView;
      },
      get teammatesDir() {
        return repl.teammatesDir;
      },
      clearPastedTexts: () => {
        repl.pastedTexts.clear();
      },
    });
    this.commandManager.registerCommands();

    // Initialize extracted modules — they reference properties set above
    this.handoffManager = new HandoffManager({
      chatView: this.chatView,
      feedLine: (text?) => this.feedLine(text),
      refreshView: () => this.refreshView(),
      makeSpan: (...segs) => this.makeSpan(...segs),
      wordWrap: (text, maxW) => this.feedRenderer.wordWrap(text, maxW),
      listTeammates: () => this.orchestrator.listTeammates(),
      getThread: (id) => this.threadManager.getThread(id),
      makeQueueEntryId: () => this.makeQueueEntryId(),
      taskQueue: this.taskQueue,
      kickDrain: () => this.kickDrain(),
      teammatesDir: this.teammatesDir,
    });
    this.retroManager = new RetroManager({
      chatView: this.chatView,
      feedLine: (text?) => this.feedLine(text),
      refreshView: () => this.refreshView(),
      makeSpan: (...segs) => this.makeSpan(...segs),
      makeQueueEntryId: () => this.makeQueueEntryId(),
      taskQueue: this.taskQueue,
      kickDrain: () => this.kickDrain(),
      hasPendingHandoffs: () => this.handoffManager.pendingHandoffs.length > 0,
    });
    // Initialize feed renderer
    this.feedRenderer = new FeedRenderer({
      get chatView() {
        return repl.chatView;
      },
      get app() {
        return repl.app;
      },
      get input() {
        return repl.input;
      },
      get selfName() {
        return repl.selfName;
      },
      get adapterName() {
        return repl.adapterName;
      },
      get threadManager() {
        return repl.threadManager;
      },
      get handoffManager() {
        return repl.handoffManager;
      },
      _replyContexts: this._replyContexts,
      _copyContexts: this._copyContexts,
      get lastCleanedOutput() {
        return repl.lastCleanedOutput;
      },
      set lastCleanedOutput(v) {
        repl.lastCleanedOutput = v;
      },
      refreshTeammates: () => this.refreshTeammates(),
      showPrompt: () => this.showPrompt(),
    });
    // Create PromptInput — consolonia-based replacement for readline.
    // Uses raw stdin + InputProcessor for proper escape/paste/mouse parsing.
    // Kept as a fallback for pre-onboarding prompts; the main REPL uses ChatView.
    this.input = new PromptInput({
      prompt: chalk.gray("> "),
      borderStyle: (s) => chalk.gray(s),
      colorize: (value) => {
        const validNames = new Set([
          ...this.orchestrator
            .listTeammates()
            .filter((n) => n !== this.adapterName && n !== this.userAlias),
          this.adapterName,
          "everyone",
        ]);
        return value
          .replace(/@(\w+)/g, (match, name) =>
            validNames.has(name) ? chalk.blue(match) : match,
          )
          .replace(/^\/\w+/, (m) => chalk.blue(m));
      },
      hint: (value) => this.wordwheel.getCommandHint(value),
      onUpDown: (dir) => {
        if (this.wordwheel.items.length === 0) return false;
        if (dir === "up") {
          this.wordwheel.index = Math.max(this.wordwheel.index - 1, -1);
        } else {
          this.wordwheel.index = Math.min(
            this.wordwheel.index + 1,
            this.wordwheel.items.length - 1,
          );
        }
        this.wordwheel.render();
        return true;
      },
      beforeSubmit: (currentValue) => {
        if (this.wordwheel.items.length > 0 && this.wordwheel.index >= 0) {
          const item = this.wordwheel.items[this.wordwheel.index];
          if (item) {
            this.wordwheel.clear();
            this.wordwheel.items = [];
            this.wordwheel.index = -1;
            return item.completion;
          }
        }
        this.wordwheel.clear();
        this.wordwheel.items = [];
        this.wordwheel.index = -1;
        return currentValue;
      },
    });

    // ── Detect service statuses ────────────────────────────────────────

    this.serviceStatuses = detectServices();

    // ── Build animated banner for ChatView ─────────────────────────────

    const names = this.orchestrator
      .listTeammates()
      .filter((n) => n !== this.adapterName && n !== this.userAlias);
    const reg = this.orchestrator.getRegistry();
    const statuses = this.orchestrator.getAllStatuses();
    const bannerTeammates: {
      name: string;
      role: string;
      presence: import("./types.js").PresenceState;
    }[] = [];
    // Add user avatar first (displayed as adapter name alias)
    if (this.userAlias) {
      const up = statuses.get(this.userAlias)?.presence ?? "online";
      bannerTeammates.push({
        name: this.adapterName,
        role: "Coding agent that performs tasks on your behalf.",
        presence: up,
      });
    }
    for (const name of names) {
      const t = reg.get(name);
      const p = statuses.get(name)?.presence ?? "online";
      bannerTeammates.push({ name, role: t?.role ?? "", presence: p });
    }
    const bannerWidget = new AnimatedBanner({
      displayName: `@${this.adapterName}`,
      teammateCount: names.length,
      cwd: process.cwd(),
      teammates: bannerTeammates,
      services: this.serviceStatuses,
    });
    this.banner = bannerWidget;

    // ── Create ThreadBar ───────────────────────────────────────────────

    const t = theme();
    this.threadBar = new ThreadBar({
      focused: { fg: t.text, bold: true },
      normal: { fg: t.textMuted },
      unread: { fg: t.accent },
      working: { fg: t.info },
      close: { fg: t.textDim },
      add: { fg: t.textDim },
      separator: { fg: t.textDim },
      hover: { fg: t.accent },
    });
    this.threadBar.on("switch", (threadId: number) => {
      this.unreadThreads.delete(threadId);
      this.threadManager.switchToThread(threadId);
      this.refreshThreadBar();
      this.refreshView();
    });
    this.threadBar.on("close", (threadId: number) => {
      this.unreadThreads.delete(threadId);
      this.threadManager.closeThread(threadId);
      this.refreshThreadBar();
      this.refreshView();
    });
    this.threadBar.on("new", () => {
      // Load /tab into the input box so the user can add a description
      if (this.chatView) {
        this.chatView.inputValue = "/tab ";
      }
    });

    // ── Create ChatView and Consolonia App ────────────────────────────

    this.chatView = new ChatView({
      bannerWidget,
      dockedBar: this.threadBar,
      prompt: "> ",
      promptStyle: { fg: t.prompt },
      inputStyle: { fg: t.textMuted },
      cursorStyle: { fg: t.cursorFg, bg: t.cursorBg },
      placeholder: " @mention or type a task...",
      placeholderStyle: { fg: t.textDim, italic: true },
      inputColorize: (value: string) => {
        const styles: (import("@teammates/consolonia").TextStyle | null)[] =
          new Array(value.length).fill(null);
        const accentStyle = { fg: theme().accent };
        const dimStyle = { fg: theme().textDim };
        // Colorize /commands (only at start of input)
        const cmdPattern = /^\/[\w-]+/;
        let m = cmdPattern.exec(value);
        if (m) {
          for (let i = m.index; i < m.index + m[0].length; i++) {
            styles[i] = accentStyle;
          }
        }
        // Colorize @mentions only if they reference a valid teammate or the user
        const validNames = new Set([
          ...this.orchestrator
            .listTeammates()
            .filter((n) => n !== this.adapterName && n !== this.userAlias),
          this.adapterName,
          "everyone",
        ]);
        const mentionPattern = /@(\w+)/g;
        while ((m = mentionPattern.exec(value)) !== null) {
          if (validNames.has(m[1])) {
            for (let i = m.index; i < m.index + m[0].length; i++) {
              styles[i] = accentStyle;
            }
          }
        }
        // Colorize [placeholder] blocks as dim
        const placeholders = /\[[^[\]]+\]/g;
        while ((m = placeholders.exec(value)) !== null) {
          for (let i = m.index; i < m.index + m[0].length; i++) {
            styles[i] = dimStyle;
          }
        }
        return styles;
      },
      inputDeleteSize: (
        value: string,
        cursor: number,
        direction: "backward" | "forward",
      ) => {
        // Delete entire [placeholder] blocks as a unit (paste placeholders, quoted reply, etc.)
        const placeholder = /\[[^[\]]+\]/g;
        let m: RegExpExecArray | null;
        while ((m = placeholder.exec(value)) !== null) {
          const start = m.index;
          const end = start + m[0].length;
          if (direction === "backward" && cursor > start && cursor <= end) {
            return cursor - start;
          }
          if (direction === "forward" && cursor >= start && cursor < end) {
            return end - cursor;
          }
        }
        return 1;
      },
      inputHint: (value: string) => this.wordwheel.getCommandHint(value),
      inputHintStyle: { fg: t.textDim },
      maxInputHeight: 5,
      separatorStyle: { fg: t.separator },
      progressStyle: { fg: t.progress, italic: true },
      dropdownHighlightStyle: { fg: t.accent },
      dropdownStyle: { fg: t.textMuted },
      footer: concat(
        tp.accent(" Teammates"),
        tp.dim(` v${PKG_VERSION}`),
        tp.muted("  "),
        tp.text(this.adapterName),
        tp.muted("  "),
        tp.dim(StatusTracker.truncatePath(dirname(this.teammatesDir))),
      ),
      footerRight: tp.muted("? /help "),
      footerStyle: { fg: t.textDim },
    });
    this.defaultFooter = concat(
      tp.accent(" Teammates"),
      tp.dim(` v${PKG_VERSION}`),
      tp.muted("  "),
      tp.text(this.adapterName),
      tp.muted("  "),
      tp.dim(StatusTracker.truncatePath(dirname(this.teammatesDir))),
    );
    this.defaultFooterRight = tp.muted("? /help ");

    // Wire ChatView events for input handling
    this.chatView.on("submit", (rawLine: string) => {
      this.handleSubmit(rawLine).catch((err) => {
        this.feedLine(tp.error(`Unhandled error: ${err.message}`));
        this.refreshView();
      });
    });
    this.chatView.on("change", () => {
      // Clear quoted reply if user backspaced over the placeholder
      if (
        this._pendingQuotedReply &&
        this.chatView &&
        !this.chatView.inputValue.includes("[quoted reply]")
      ) {
        this._pendingQuotedReply = null;
      }
      this.wordwheel.items = [];
      this.wordwheel.index = -1;
      this.wordwheel.update();
      // Reset ESC / Ctrl+C pending state on any text change
      if (this.escPending) {
        this.escPending = false;
        if (this.escTimer) {
          clearTimeout(this.escTimer);
          this.escTimer = null;
        }
        this.chatView.setFooter(this.defaultFooter!);
        this.threadManager.updateFooterHint();
        this.refreshView();
      }
      if (this.ctrlcPending) {
        this.ctrlcPending = false;
        if (this.ctrlcTimer) {
          clearTimeout(this.ctrlcTimer);
          this.ctrlcTimer = null;
        }
        this.chatView.setFooter(this.defaultFooter!);
        this.threadManager.updateFooterHint();
        this.refreshView();
      }
    });
    this.chatView.on("tab", () => {
      if (this.wordwheel.items.length > 0) {
        if (this.wordwheel.index < 0) this.wordwheel.index = 0;
        this.wordwheel.acceptSelection();
      }
    });
    this.chatView.on("cancel", () => {
      this.wordwheel.clear();
      this.wordwheel.items = [];
      this.wordwheel.index = -1;

      if (this.escPending) {
        // Second ESC — clear input and restore footer
        this.escPending = false;
        if (this.escTimer) {
          clearTimeout(this.escTimer);
          this.escTimer = null;
        }
        this.chatView.inputValue = "";
        this.chatView.setFooter(this.defaultFooter!);
        this.threadManager.updateFooterHint();
        this.pastedTexts.clear();
        this.refreshView();
      } else if (this.chatView.inputValue.length > 0) {
        // First ESC with text — show hint in footer right, auto-expire after 2s
        this.escPending = true;
        this.chatView.setFooterRight(tp.muted("ESC again to clear "));
        this.refreshView();
        this.escTimer = setTimeout(() => {
          this.escTimer = null;
          if (this.escPending) {
            this.escPending = false;
            this.chatView.setFooter(this.defaultFooter!);
            this.threadManager.updateFooterHint();
            this.refreshView();
          }
        }, 2000);
      }
    });
    this.chatView.on("paste", (text: string) => {
      this.handlePaste(text);
    });
    this.chatView.on("ctrlc", () => {
      if (this.ctrlcPending) {
        // Second Ctrl+C — exit
        this.ctrlcPending = false;
        if (this.ctrlcTimer) {
          clearTimeout(this.ctrlcTimer);
          this.ctrlcTimer = null;
        }
        this.chatView.setFooter(this.defaultFooter!);
        this.threadManager.updateFooterHint();

        if (this.app) this.app.stop();
        this.orchestrator.shutdown().then(() => process.exit(0));
        return;
      }
      // First Ctrl+C — show hint in footer right, auto-expire after 2s
      this.ctrlcPending = true;
      this.chatView.setFooterRight(tp.muted("Ctrl+C again to exit "));
      this.refreshView();
      this.ctrlcTimer = setTimeout(() => {
        this.ctrlcTimer = null;
        if (this.ctrlcPending) {
          this.ctrlcPending = false;
          this.chatView.setFooter(this.defaultFooter!);
          this.threadManager.updateFooterHint();
          this.refreshView();
        }
      }, 2000);
    });
    this.chatView.on("action", (id: string) => {
      if (id.startsWith("thread-toggle-")) {
        const tid = parseInt(id.slice("thread-toggle-".length), 10);
        this.threadManager.toggleThreadCollapse(tid);
      } else if (id.startsWith("thread-copy-")) {
        const tid = parseInt(id.slice("thread-copy-".length), 10);
        this.commandManager.doCopy(
          this.threadManager.buildThreadClipboardText(tid),
        );
      } else if (id.startsWith("reply-collapse-")) {
        const key = id.slice("reply-collapse-".length);
        const tid = parseInt(key.split("-")[0], 10);
        this.threadManager.toggleReplyCollapse(tid, key);
      } else if (id.startsWith("activity-")) {
        const queueId = id.slice("activity-".length);
        this.activityManager.toggleActivity(queueId);
      } else if (id.startsWith("cancel-")) {
        const queueId = id.slice("cancel-".length);
        // Find the entry in queue or active to get threadId + teammate
        const entry =
          this.taskQueue.find((e) => e.id === queueId) ||
          [...this.agentActive.values()].find((e) => e.id === queueId);
        if (entry?.threadId != null && this.chatView) {
          this.chatView.inputValue = `/cancel #${entry.threadId} ${entry.teammate}`;
        }
      } else if (id.startsWith("copy-cmd:")) {
        this.commandManager.doCopy(id.slice("copy-cmd:".length));
      } else if (id.startsWith("copy-")) {
        const text = this._copyContexts.get(id);
        this.commandManager.doCopy(text || this.lastCleanedOutput || undefined);
      } else if (
        id.startsWith("retro-approve-") ||
        id.startsWith("retro-reject-")
      ) {
        this.retroManager.handleRetroAction(id);
      } else if (id.startsWith("revert-") || id.startsWith("allow-")) {
        this.handoffManager.handleViolationAction(id);
      } else if (id.startsWith("approve-") || id.startsWith("reject-")) {
        this.handoffManager.handleHandoffAction(id);
      } else if (id.startsWith("reply-")) {
        const ctx = this._replyContexts.get(id);
        if (ctx && this.chatView) {
          if (ctx.threadId != null) {
            // Tab model: switch to the thread
            if (this.threadManager.focusedThreadId !== ctx.threadId) {
              this.unreadThreads.delete(ctx.threadId);
              this.threadManager.switchToThread(ctx.threadId);
              this.refreshThreadBar();
            }
          } else {
            this.chatView.inputValue = `@${ctx.teammate} [quoted reply] `;
            this._pendingQuotedReply = ctx.message;
          }
          this.refreshView();
        }
      }
    });

    this.chatView.on("copy", (text: string) => {
      this.commandManager.doCopy(text);
    });

    this.chatView.on("link", (url: string) => {
      const quoted = JSON.stringify(url);
      const cmd =
        process.platform === "darwin"
          ? `open ${quoted}`
          : process.platform === "win32"
            ? `start "" ${quoted}`
            : `xdg-open ${quoted}`;
      execCb(cmd, () => {});
    });

    this.chatView.on("file", (filePath: string) => {
      // Always resolve to an absolute path before opening. Relative paths
      // (including Unix-style `/foo` on Windows, which is drive-relative)
      // break `start`/`open`/`xdg-open` unless fully qualified.
      const hasDriveLetter = /^[A-Za-z]:[\\/]/.test(filePath);
      const absPath = hasDriveLetter
        ? resolvePath(filePath)
        : resolvePath(process.cwd(), filePath.replace(/^[\\/]+/, ""));
      const quoted = JSON.stringify(absPath);
      const cmd =
        process.platform === "darwin"
          ? `open ${quoted}`
          : process.platform === "win32"
            ? `start "" ${quoted}`
            : `xdg-open ${quoted}`;
      execCb(cmd, () => {});
    });

    this.app = new App({
      root: this.chatView,
      alternateScreen: true,
      mouse: true,
    });

    // Initialize view-dependent modules now that chatView + app exist
    this.statusTracker = new StatusTracker({
      chatView: this.chatView,
      app: this.app,
      input: this.input,
      get selfName() {
        return selfNameFn();
      },
      get adapterName() {
        return adapterNameFn();
      },
    });
    // Re-bind handoff/retro managers with the real chatView
    (this.handoffManager as any).view.chatView = this.chatView;
    (this.retroManager as any).view.chatView = this.chatView;

    // Initialize activity manager now that chatView exists
    const containersFn = () => this.threadManager.containers;
    this.activityManager = new ActivityManager({
      get chatView() {
        return chatViewRef();
      },
      get selfName() {
        return selfNameFn();
      },
      get adapterName() {
        return adapterNameFn();
      },
      statusTracker: this.statusTracker,
      agentActive: this.agentActive,
      get containers() {
        return containersFn();
      },
      getAdapter: (threadId) => this.threadManager.getAdapter(threadId),
      getShiftCallback: (threadId) =>
        this.threadManager.getShiftCallback(threadId),
      makeSpan: (...segs) => this.makeSpan(...segs),
      refreshView: () => this.refreshView(),
      feedLine: (text?) => this.feedLine(text),
    });
    const chatViewRef = () => this.chatView;

    // Closures to bridge private accessors into the view interfaces
    const selfNameFn = () => this.selfName;
    const adapterNameFn = () => this.adapterName;
    const userBgRef = () => this.feedRenderer.userBg;
    const defaultFooterRightRef = () => this.defaultFooterRight;

    // Initialize thread manager now that chatView exists
    this.threadManager = new ThreadManager(
      {
        chatView: this.chatView,
        feedLine: (text?) => this.feedLine(text),
        feedUserLine: (spans) => this.feedUserLine(spans),
        feedMarkdown: (source) => this.feedMarkdown(source),
        refreshView: () => this.refreshView(),
        makeSpan: (...segs) => this.makeSpan(...segs),
        renderHandoffs: (from, handoffs, tid, containerCtx) =>
          this.handoffManager.renderHandoffs(from, handoffs, tid, containerCtx),
        doCopy: (content?) => this.commandManager.doCopy(content),
        get selfName() {
          return selfNameFn();
        },
        get adapterName() {
          return adapterNameFn();
        },
        get userBg() {
          return userBgRef();
        },
        get defaultFooterRight() {
          return defaultFooterRightRef();
        },
      },
      this._copyContexts,
      this.handoffManager.pendingHandoffs,
    );

    // Wire ThreadManager callbacks for tab bar updates
    this.threadManager.onTabsChanged = () => this.refreshThreadBar();
    this.threadManager.onUnread = (threadId) => {
      this.unreadThreads.add(threadId);
      this.refreshThreadBar();
    };

    // Create Task thread so the tab bar always shows at least one tab
    if (this.threadManager.threads.size === 0) {
      const defaultThread = this.threadManager.createThread("Task");
      this.threadManager.appendThreadEntry(defaultThread.id, {
        type: "user",
        content: "",
        timestamp: Date.now(),
      });
      this.refreshThreadBar();
    }

    // Wrap the ThreadManager's shift callback to also shift activity indices.
    // Without this, ThreadManager insertions (results, thread actions) would
    // leave activity indices stale, causing cleanup to hide wrong lines.
    const baseShift = this.threadManager.shiftAllContainers;
    this.threadManager.shiftAllContainers = (
      atIndex: number,
      delta: number,
    ) => {
      baseShift(atIndex, delta);
      for (const [, indices] of this.activityManager.lineIndices) {
        for (let i = 0; i < indices.length; i++) {
          if (indices[i] >= atIndex) indices[i] += delta;
        }
      }
      for (const [tm, idx] of this.activityManager.blankIdx) {
        if (idx >= atIndex) this.activityManager.blankIdx.set(tm, idx + delta);
      }
    };

    const userAliasFn = () => this.userAlias;
    const teammateDirFn = () => this.teammatesDir;
    const threadsFn = () => this.threadManager.threads;

    this.wordwheel = new Wordwheel({
      chatView: this.chatView,
      input: this.input,
      commands: this.commands,
      listTeammates: () => this.orchestrator.listTeammates(),
      getTeammateRole: (name) =>
        this.orchestrator.getRegistry().get(name)?.role ?? "",
      getAvailablePersonas: () => {
        const installed = new Set(this.orchestrator.listTeammates());
        return this.cachedPersonas
          .filter((p) => !installed.has(p.alias))
          .map((p) => ({
            alias: p.alias,
            description: `${p.persona} — ${p.description}`,
          }));
      },
      getRemovableTeammates: () => {
        const registry = this.orchestrator.getRegistry();
        return this.orchestrator.listTeammates().filter((name) => {
          const config = registry.get(name);
          if (!config) return false;
          if (config.type === "human") return false;
          if (name === this.adapterName) return false;
          if (name === this.selfName) return false;
          return true;
        });
      },
      get selfName() {
        return selfNameFn();
      },
      get adapterName() {
        return adapterNameFn();
      },
      get userAlias() {
        return userAliasFn();
      },
      get teammatesDir() {
        return teammateDirFn();
      },
      get threads() {
        return threadsFn();
      },
      refreshView: () => this.refreshView(),
    });

    // Initialize startup manager (uses closures defined above)
    this.startupMgr = new StartupManager({
      get teammatesDir() {
        return teammateDirFn();
      },
      get selfName() {
        return selfNameFn();
      },
      get adapterName() {
        return adapterNameFn();
      },
      get userAlias() {
        return repl.userAlias;
      },
      get chatView() {
        return chatViewRef();
      },
      taskQueue: this.taskQueue,
      get pendingMigrationSyncs() {
        return pendingMigrationRef();
      },
      set pendingMigrationSyncs(v: number) {
        setPendingMigrationRef(v);
      },
      makeQueueEntryId: () => this.makeQueueEntryId(),
      kickDrain: () => this.kickDrain(),
      feedLine: (text?) => this.feedLine(text),
      refreshView: () => this.refreshView(),
      startMigrationProgress: (msg) => this.startMigrationProgress(msg),
      stopMigrationProgress: () => this.stopMigrationProgress(),
      commitVersionUpdate: () => this.startupMgr.commitVersionUpdate(),
      listTeammates: () => this.orchestrator.listTeammates(),
      showNotification: (content) =>
        this.statusTracker.showNotification(content),
      generateSystemPrompts: async () => {
        const registry = this.orchestrator.getRegistry();
        const configs = this.orchestrator
          .listTeammates()
          .filter((n) => n !== this.adapterName && n !== this.userAlias)
          .map((n) => registry.get(n)!)
          .filter(Boolean);
        const roster = this.orchestrator
          .listTeammates()
          .filter((n) => n !== this.adapterName && n !== this.userAlias)
          .map((n) => {
            const t = registry.get(n)!;
            return { name: t.name, role: t.role, ownership: t.ownership };
          });
        const services = (this.adapter as any).services ?? [];
        await writeAllSystemPrompts(this.teammatesDir, configs, {
          roster,
          services,
        });
      },
    });
    const pendingMigrationRef = () => this.pendingMigrationSyncs;
    const setPendingMigrationRef = (v: number) => {
      this.pendingMigrationSyncs = v;
    };

    // Background maintenance
    this.startupMgr.startupMaintenance().catch(() => {});

    // Run the app — this takes over the terminal.
    // Start the banner animation after the first frame renders.
    bannerWidget.onDirty = () => this.app?.refresh();
    const runPromise = this.app.run();

    bannerWidget.start();

    await runPromise;
  }

  /**
   * Handle paste events from ChatView.
   * For multi-line or large pastes, store the text and replace
   * the input with a compact placeholder that gets expanded on submit.
   */
  /** Image extensions for drag & drop detection. */
  // IMAGE_EXTS is now imported from ./cli-utils.js

  private handlePaste(text: string): void {
    if (!this.chatView) return;

    // Check if the pasted text is a file path to an image (drag & drop)
    const trimmed = text.trim().replace(/^["']|["']$/g, ""); // strip quotes from drag & drop paths
    if (this.isImagePath(trimmed)) {
      const current = this.chatView.inputValue;
      const clean = text.replace(/[\r\n]/g, "");
      const idx = current.indexOf(clean);
      if (idx >= 0) {
        const fileName = trimmed.split(/[/\\]/).pop() || trimmed;
        const n = ++this.pasteCounter;
        this.pastedTexts.set(n, `[Image: source: ${trimmed}]`);
        const placeholder = `[Image ${fileName}] `;
        const newVal =
          current.slice(0, idx) +
          placeholder +
          current.slice(idx + clean.length);
        this.chatView.inputValue = newVal;
        this.refreshView();
      }
      return;
    }

    const lines = text.split(/\r?\n/).length;
    const sizeKB = (text.length / 1024).toFixed(1);
    // Only use placeholder for multi-line or large pastes
    if (lines <= 1 && text.length < 200) return;

    const n = ++this.pasteCounter;
    this.pastedTexts.set(n, text);

    // Replace the pasted text in the input with a placeholder.
    // The paste was already inserted by TextInput, so we need to
    // remove it and insert the placeholder instead.
    const current = this.chatView.inputValue;
    // The pasted text (with newlines stripped) was inserted at the cursor.
    // Find it and replace with placeholder.
    const clean = text.replace(/[\r\n]/g, "");
    const idx = current.indexOf(clean);
    if (idx >= 0) {
      const placeholder = `[Pasted text #${n} +${lines} lines, ${sizeKB}KB]`;
      const newVal =
        current.slice(0, idx) + placeholder + current.slice(idx + clean.length);
      this.chatView.inputValue = newVal;
    }
    this.refreshView();
  }

  /** Check if a string looks like a path to an image file. */
  private isImagePath(text: string): boolean {
    return isImagePath(text);
  }

  /** Handle line submission from ChatView. */
  private async handleSubmit(rawLine: string): Promise<void> {
    // If an inline ask is pending, resolve it instead of normal processing
    if (this._pendingAsk) {
      const resolve = this._pendingAsk;
      this._pendingAsk = null;
      resolve(rawLine);
      return;
    }

    this.wordwheel.clear();
    this.wordwheel.items = [];
    this.wordwheel.index = -1;

    // User submitted a message — always scroll to bottom so they see their own input
    if (this.chatView) this.chatView.scrollToBottom();

    // Resolve @mentions from the raw input BEFORE paste expansion.
    // This prevents @mentions inside pasted/expanded text from being picked up.
    const allNames = this.orchestrator.listTeammates();
    const preMentionRegex = /@(\S+)/g;
    let pm: RegExpExecArray | null;
    const preMentions: string[] = [];
    while ((pm = preMentionRegex.exec(rawLine)) !== null) {
      // Remap adapter name alias → user avatar for routing
      const name =
        pm[1] === this.adapterName && this.userAlias ? this.selfName : pm[1];
      if (allNames.includes(name) && !preMentions.includes(name)) {
        preMentions.push(name);
      }
    }

    // Expand paste placeholders with actual content
    let input = rawLine.replace(
      /\[Pasted text #(\d+) \+\d+ lines, [\d.]+KB\]\s*/g,
      (_match, num) => {
        const n = parseInt(num, 10);
        const text = this.pastedTexts.get(n);
        if (text) {
          this.pastedTexts.delete(n);
          return `${text}\n`;
        }
        return "";
      },
    );

    // Expand [Image filename] placeholders with stored image source paths
    input = input
      .replace(/\[Image [^\]]+\]/g, (match) => {
        // Find the matching pastedText entry by checking stored values
        for (const [n, stored] of this.pastedTexts) {
          if (stored.startsWith("[Image: source:")) {
            this.pastedTexts.delete(n);
            return stored;
          }
        }
        return match;
      })
      .trim();

    // Expand [quoted reply] placeholder with blockquoted message
    if (this._pendingQuotedReply && input.includes("[quoted reply]")) {
      const quoted = this._pendingQuotedReply
        .split("\n")
        .map((l) => `> ${l}`)
        .join("\n");
      const before = input.slice(0, input.indexOf("[quoted reply]")).trimEnd();
      const after = input
        .slice(input.indexOf("[quoted reply]") + "[quoted reply]".length)
        .trimStart();
      const parts = [before, quoted];
      if (after) parts.push(after);
      input = parts.join("\n");
      this._pendingQuotedReply = null;
    } else {
      this._pendingQuotedReply = null;
    }

    if (!input) return;

    // Handoff actions
    if (input === "/approve") {
      this.handoffManager.handleBulkHandoff("Approve all");
      return;
    }
    if (input === "/always-approve") {
      this.handoffManager.handleBulkHandoff("Always approve");
      return;
    }
    if (input === "/reject") {
      this.handoffManager.handleBulkHandoff("Reject all");
      return;
    }
    if (input === "/approve-retro") {
      this.retroManager.handleBulkRetro("Approve all");
      return;
    }
    if (input === "/reject-retro") {
      this.retroManager.handleBulkRetro("Reject all");
      return;
    }

    // Slash commands
    if (input.startsWith("/")) {
      try {
        await this.commandManager.dispatch(input);
      } catch (err: any) {
        this.feedLine(tp.error(`Error: ${err.message}`));
      }
      this.refreshView();
      return;
    }

    // Everything else gets queued.

    // Parse #id — bare #id switches focus, #id message dispatches in that thread
    const bareThreadMatch = input.match(/^#(\d+)\s*$/);
    if (bareThreadMatch) {
      const parsedId = parseInt(bareThreadMatch[1], 10);
      if (this.threadManager.getThread(parsedId)) {
        this.unreadThreads.delete(parsedId);
        this.threadManager.switchToThread(parsedId);
        this.refreshThreadBar();
        this.refreshView();
        return;
      }
    }

    let targetThreadId: number | undefined;
    let taskInput = input;
    const threadMatch = input.match(/^#(\d+)\s+([\s\S]+)/);
    if (threadMatch) {
      const parsedId = parseInt(threadMatch[1], 10);
      if (this.threadManager.getThread(parsedId)) {
        targetThreadId = parsedId;
        taskInput = threadMatch[2];
      }
    }

    // In the tab model, @mentions dispatch within the current thread.
    // Everything goes to the focused thread (or creates thread #1 if none).
    if (targetThreadId == null) {
      let focusId = this.threadManager.focusedThreadId;
      if (focusId == null && this.threadManager.threads.size > 0) {
        let best: TaskThread | null = null;
        for (const t of this.threadManager.threads.values()) {
          if (!best || (t.focusedAt ?? 0) > (best.focusedAt ?? 0)) best = t;
        }
        if (best) focusId = best.id;
      }
      if (focusId != null && this.threadManager.getThread(focusId)) {
        targetThreadId = focusId;
      }
    }

    // Pass pre-resolved mentions so @mentions inside expanded paste text are ignored.
    this.conversation.history.push({ role: this.selfName, text: taskInput });
    this.queueTask(taskInput, preMentions, targetThreadId);
    this.refreshThreadBar();
    this.refreshView();
  }

  // ─── Service detection/config (delegated to service-config.ts) ────

  private get serviceView() {
    return {
      chatView: this.chatView,
      feedLine: (text?: string | StyledSpan) => this.feedLine(text),
      feedCommand: (command: string) =>
        this.commandManager.feedCommand(command),
      refreshView: () => this.refreshView(),
      askInline: (prompt: string) => this.askInline(prompt),
      banner: this.banner,
    };
  }

  // ─── Event handler ───────────────────────────────────────────────

  private handleEvent(event: OrchestratorEvent): void {
    // Suppress all events for agents in silent retry
    const evtAgent =
      event.type === "task_assigned"
        ? event.assignment.teammate
        : event.type === "task_completed"
          ? event.result.teammate
          : event.teammate;
    if (this.silentAgents.has(evtAgent)) return;

    switch (event.type) {
      case "task_assigned":
      case "task_completed":
        // StatusTracker lifecycle is driven directly by the drain loop now,
        // keyed by queue entry ID so two concurrent tasks for the same
        // teammate don't collide. Orchestrator events are informational.
        break;

      case "error": {
        if (!this.chatView) this.input.deactivateAndErase();
        const displayErr =
          event.teammate === this.selfName ? this.adapterName : event.teammate;
        this.feedLine(tp.error(`  ✖  ${displayErr}: ${event.error}`));
        this.showPrompt();
        break;
      }
    }
  }

  /** Cancel a running task or remove a queued task from the queue. */
  /** Drain user tasks for a single (thread, teammate) slot — runs in parallel
   *  with other slots. Same teammate in different tabs runs concurrently.
   *  System tasks are handled separately by runSystemTask(). */
  private async drainSlot(
    threadId: number | undefined,
    teammate: string,
  ): Promise<void> {
    const slot = this.slotKey(threadId, teammate);
    while (true) {
      const idx = this.taskQueue.findIndex(
        (e) =>
          e.teammate === teammate &&
          e.threadId === threadId &&
          !this.isSystemTask(e),
      );
      if (idx < 0) break;

      const entry = this.taskQueue.splice(idx, 1)[0];
      this.agentActive.set(slot, entry);
      this.statusTracker.startTask(entry.id, entry.teammate, entry.task);
      if (entry.threadId != null) {
        this.activityManager.updatePlaceholderVerb(
          entry.id,
          entry.teammate,
          entry.threadId,
          "[show activity]",
        );
      }

      const startTime = Date.now();
      try {
        {
          // btw and debug tasks skip conversation context (not part of main thread)
          const isMainThread = entry.type !== "btw" && entry.type !== "debug";
          // Thread-local context: if the task belongs to a thread, use
          // that thread's entries instead of global conversation history.
          // This keeps the agent focused on the thread's topic.
          let extraContext = "";
          if (isMainThread && entry.threadId != null) {
            const thread = this.threadManager.getThread(entry.threadId);
            if (thread && thread.entries.length > 0) {
              extraContext = buildThreadContext(
                thread.entries,
                this.selfName,
                ConversationManager.CONV_HISTORY_CHARS,
              );
            }
          } else if (isMainThread) {
            // Snapshot-aware context building: if the entry has a frozen snapshot
            // (@everyone), use it directly — no mutation of shared state.
            // Otherwise, compress live state as before.
            const snapshot =
              entry.type === "agent" ? entry.contextSnapshot : undefined;
            if (!snapshot) this.conversation.preDispatchCompress();
            extraContext = this.conversation.buildContext(
              entry.teammate,
              snapshot,
            );
          }
          // Set up activity tracking for this task (keyed by task ID so
          // two concurrent tasks for the same teammate don't collide).
          const taskId = entry.id;
          const tid = entry.threadId;
          this.activityManager.initForTask(taskId, tid ?? undefined);

          // Create an AbortController for this task — cancel paths call abort()
          // to signal the adapter to kill/disconnect the running agent.
          const ac = new AbortController();
          this.abortControllers.set(slot, ac);

          let result = await this.orchestrator.assign({
            teammate: entry.teammate,
            task: entry.task,
            extraContext: extraContext || undefined,
            skipMemoryUpdates: entry.type === "btw",
            onActivity: (events) =>
              this.activityManager.handleActivityEvents(taskId, events),
            signal: ac.signal,
          });

          this.abortControllers.delete(slot);

          // If the task was canceled while running (abort resolved the
          // promise but the cancel path already removed us from agentActive),
          // skip result display and move on.
          if (!this.agentActive.has(slot)) {
            this.activityManager.cleanupActivityLines(taskId);
            this.statusTracker.stopTask(entry.id);
            continue;
          }

          // Defensive retry: if the agent produced no text output but exited
          // successfully, it likely ended its turn with only file edits.
          // Retry up to 2 times with progressively simpler prompts.
          const rawText = (result.rawOutput ?? "").trim();
          if (
            !rawText &&
            result.success &&
            entry.type !== "btw" &&
            entry.type !== "debug"
          ) {
            this.silentAgents.add(entry.teammate);

            // Attempt 1: ask the agent to summarize what it did
            const retry1 = await this.orchestrator.assign({
              teammate: entry.teammate,
              task: `You completed the previous task but produced no visible text output. The user cannot see your work without a text response.\n\nOriginal task: ${entry.task}\n\nPlease respond now with a summary of what you did. Do NOT update session or memory files. Do NOT use any tools. Just produce text output.\n\nFormat:\nTO: user\n# <Subject line>\n\n<Body — what you did, key decisions, files changed>`,
              raw: true,
            });
            const retry1Raw = (retry1.rawOutput ?? "").trim();
            if (retry1Raw) {
              result = {
                ...result,
                rawOutput: retry1.rawOutput,
                summary: retry1.summary || result.summary,
              };
            } else {
              // Attempt 2: absolute minimum prompt — just ask for one sentence
              const retry2 = await this.orchestrator.assign({
                teammate: entry.teammate,
                task: `Say "Done." followed by one sentence describing what you changed. No tools. No file edits. Just text.`,
                raw: true,
              });
              const retry2Raw = (retry2.rawOutput ?? "").trim();
              if (retry2Raw) {
                result = {
                  ...result,
                  rawOutput: retry2.rawOutput,
                  summary: retry2.summary || result.summary,
                };
              }
            }

            this.silentAgents.delete(entry.teammate);
          }

          // Hide and clean up activity lines before displaying the result
          this.activityManager.cleanupActivityLines(taskId);

          // Display the (possibly retried) result to the user
          this.feedRenderer.displayTaskResult(
            result,
            entry.type,
            entry.threadId,
            entry.id,
          );

          // Append result to thread
          if (entry.threadId != null) {
            const cleaned = cleanResponseBody(result.rawOutput ?? "");
            this.threadManager.appendThreadEntry(entry.threadId, {
              type: "agent",
              teammate: entry.teammate,
              content: cleaned || result.summary || "",
              subject: result.summary,
              timestamp: Date.now(),
            });
            const thread = this.threadManager.getThread(entry.threadId);
            if (thread) {
              thread.pendingTasks.delete(entry.id);
            }

            // Propagate threadId to handoff entries
            for (const h of result.handoffs) {
              this.threadManager.appendThreadEntry(entry.threadId, {
                type: "handoff",
                teammate: entry.teammate,
                content: `Handoff to @${h.to}: ${h.task}`,
                timestamp: Date.now(),
              });
            }
          }

          // Audit cross-folder writes for AI teammates
          const tmConfig = this.orchestrator.getRegistry().get(entry.teammate);
          if (tmConfig?.type === "ai" && result.changedFiles.length > 0) {
            const violations = this.handoffManager.auditCrossFolderWrites(
              entry.teammate,
              result.changedFiles,
            );
            if (violations.length > 0) {
              this.handoffManager.showViolationWarning(
                entry.teammate,
                violations,
              );
            }
          }

          // Write debug entry — skip for debug analysis tasks (avoid recursion)
          if (entry.type !== "debug") {
            this.writeDebugEntry(entry.teammate, entry.task, result, startTime);
          }
          // btw and debug results are not stored in conversation history
          if (entry.type !== "btw" && entry.type !== "debug") {
            this.storeResult(result);
            // Check if older history needs summarizing
            this.conversation.maybeQueueSummarization();
          }
          // Log to user's twin daily memory — track orchestration activity
          if (this.userAlias && entry.type === "agent" && !entry.system) {
            // Include result details only when user used coding agent directly
            const isSelf = entry.teammate === this.selfName;
            logUserTask(
              this.teammatesDir,
              this.userAlias,
              entry.teammate,
              entry.task,
              isSelf
                ? {
                    summary: result.summary,
                    changedFiles: result.changedFiles,
                  }
                : undefined,
            ).catch(() => {
              /* non-fatal — don't break task flow */
            });
          }
          if (entry.type === "retro") {
            this.retroManager.handleRetroResult(result);
          }
        }
      } catch (err: any) {
        // Write error debug entry to session file
        this.writeDebugEntry(entry.teammate, entry.task, null, startTime, err);
        // Handle spawn failures, network errors, etc. gracefully
        this.activityManager.cleanupActivityLines(entry.id);
        const msg = err?.message ?? String(err);
        const displayAgent =
          entry.teammate === this.selfName ? this.adapterName : entry.teammate;
        this.feedLine(tp.error(`  ✖  @${displayAgent}: ${msg}`));
        this.refreshView();
      }

      this.statusTracker.stopTask(entry.id);
      this.agentActive.delete(slot);
    }
  }

  /**
   * Record debug file paths from the adapter for /debug analysis.
   * The adapters themselves write:
   *   - `<logBase>-prompt.md` — full prompt
   *   - `<logBase>.md` — adapter-specific activity/debug log
   * This method just stores the paths and the task prompt for /debug.
   */
  private writeDebugEntry(
    teammate: string,
    task: string,
    result: TaskResult | null,
    _startTime: number,
    _error?: any,
  ): void {
    try {
      const promptFile = result?.promptFile;
      const logFile = result?.logFile;
      const fullPrompt = result?.fullPrompt;

      if (promptFile || logFile) {
        this.lastDebugFiles.set(teammate, { promptFile, logFile });
      }
      this.lastTaskPrompts.set(teammate, fullPrompt ?? task);
    } catch {
      // Don't let debug logging break task execution
    }
  }

  /**
   * Reload the registry from disk. If new teammates appeared,
   * announce them, update the adapter roster, and refresh statuses.
   */
  private refreshTeammates(): void {
    this.orchestrator
      .refresh()
      .then((added) => {
        if (added.length === 0) return;

        const registry = this.orchestrator.getRegistry();

        // Update adapter roster so prompts include the new teammates
        // Exclude the user avatar and adapter fallback — neither is an addressable teammate
        if ("roster" in this.adapter) {
          (this.adapter as any).roster = this.orchestrator
            .listTeammates()
            .filter((n) => n !== this.adapterName && n !== this.userAlias)
            .map((name) => {
              const t = registry.get(name)!;
              return { name: t.name, role: t.role, ownership: t.ownership };
            });
        }

        // Announce
        for (const name of added) {
          const config = registry.get(name);
          const role = config?.role ?? "teammate";
          this.feedLine(
            concat(
              tp.success(`  ✦ New teammate joined: `),
              tp.bold(name),
              tp.muted(` — ${role}`),
            ),
          );
        }
        this.refreshView();
      })
      .catch(() => {});
  }

  // Recall is now bundled as a library dependency — no watch process needed.
  // Sync happens via syncRecallIndex() after every task and on startup.
}

// ─── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (cliArgs.showHelp) {
    printUsage();
    process.exit(0);
  }

  const repl = new TeammatesREPL(cliArgs.adapterName);
  await repl.start();
}

main().catch((err) => {
  console.error(chalk.red(err.message));
  process.exit(1);
});
