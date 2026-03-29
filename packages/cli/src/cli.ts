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
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { mkdir, readdir, rm, stat, unlink } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import {
  App,
  ChatView,
  type Color,
  concat,
  esc,
  pen,
  renderMarkdown,
  type StyledSpan,
  stripAnsi,
} from "@teammates/consolonia";
import chalk from "chalk";
import ora, { type Ora } from "ora";
import { ActivityManager } from "./activity-manager.js";
import type { AgentAdapter } from "./adapter.js";
import { DAILY_LOG_BUDGET_TOKENS, syncRecallIndex } from "./adapter.js";
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
  buildConversationContext as buildConvCtx,
  buildSummarizationPrompt,
  buildThreadContext,
  cleanResponseBody,
  compressConversationEntries,
  findSummarizationSplit,
  formatConversationEntry,
  isImagePath,
  relativeTime,
  wrapLine,
} from "./cli-utils.js";
import {
  autoCompactForBudget,
  buildDailyCompressionPrompt,
  buildWisdomPrompt,
  compactEpisodic,
  purgeStaleDailies,
} from "./compact.js";
import { PromptInput } from "./console/prompt-input.js";
import { HandoffManager } from "./handoff-manager.js";
import { buildConversationLog } from "./log-parser.js";
import { buildMigrationPrompt } from "./migrations.js";
import {
  buildImportAdaptationPrompt,
  copyTemplateFiles,
  importTeammates,
} from "./onboard.js";
import { OnboardFlow } from "./onboard-flow.js";
import { Orchestrator } from "./orchestrator.js";
import { RetroManager } from "./retro-manager.js";
import { cmdConfigure, detectServices } from "./service-config.js";
import { StatusTracker } from "./status-tracker.js";
import { colorToHex, theme, tp } from "./theme.js";
import type { ThreadContainer } from "./thread-container.js";
import { ThreadManager } from "./thread-manager.js";
import type {
  ActivityEvent,
  HandoffEnvelope,
  OrchestratorEvent,
  QueueEntry,
  SlashCommand,
  TaskResult,
  TaskThread,
  ThreadEntry,
} from "./types.js";
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
  private conversationHistory: { role: string; text: string }[] = [];
  /** Running summary of older conversation history maintained by the coding agent. */
  private conversationSummary = "";

  private storeResult(result: TaskResult): void {
    this.lastResult = result;
    this.lastResults.set(result.teammate, result);

    // Store the full response body in conversation history — not just the
    // subject line.  The 24k-token budget + auto-summarization handle size.
    const body = cleanResponseBody(result.rawOutput ?? "");

    this.conversationHistory.push({
      role: result.teammate,
      text: body || result.summary,
    });
  }

  /**
   * Render a task result to the feed. Called from drainAgentQueue() AFTER
   * the defensive retry so the user sees the final (possibly retried) output.
   */
  private displayTaskResult(
    result: TaskResult,
    entryType: string,
    threadId?: number,
    placeholderId?: string,
  ): void {
    // Suppress display for internal summarization tasks
    if (entryType === "summarize") return;

    if (!this.chatView) this.input.deactivateAndErase();

    const raw = result.rawOutput ?? "";
    // Strip protocol artifacts
    const cleaned = raw
      .replace(/^TO:\s*\S+\s*\n/im, "")
      .replace(/^#\s+.+\n*/m, "")
      .replace(/```handoff\s*\n@\w+\s*\n[\s\S]*?```/g, "")
      .replace(/```json\s*\n\s*\{[\s\S]*?\}\s*\n\s*```\s*$/g, "")
      .trim();

    this.lastCleanedOutput = cleaned;

    // Check if we should render inside a thread
    const container =
      threadId != null ? this.containers.get(threadId) : undefined;
    if (container && this.chatView) {
      this.displayThreadedResult(
        result,
        cleaned,
        threadId!,
        container,
        placeholderId ?? result.teammate,
      );
    } else {
      this.displayFlatResult(result, cleaned, entryType, threadId);
    }

    // Auto-detect new teammates added during this task
    this.refreshTeammates();
    this.showPrompt();
  }

  /** Render a task result as a flat (non-threaded) entry in the feed. */
  private displayFlatResult(
    result: TaskResult,
    cleaned: string,
    _entryType: string,
    threadId?: number,
  ): void {
    const subject = result.summary || "Task completed";
    const displayTeammate =
      result.teammate === this.selfName ? this.adapterName : result.teammate;
    this.feedLine(concat(tp.accent(`${displayTeammate}: `), tp.text(subject)));

    if (cleaned) {
      this.feedMarkdown(cleaned);
    } else if (result.changedFiles.length > 0 || result.summary) {
      const syntheticLines: string[] = [];
      if (result.summary) syntheticLines.push(result.summary);
      if (result.changedFiles.length > 0) {
        syntheticLines.push("", "**Files changed:**");
        for (const f of result.changedFiles) syntheticLines.push(`- ${f}`);
      }
      this.feedMarkdown(syntheticLines.join("\n"));
    } else {
      this.feedLine(
        tp.muted(
          "  (no response text — the agent may have only performed tool actions)",
        ),
      );
      this.feedLine(
        tp.muted(`  Use /debug ${result.teammate} to view full output`),
      );
      const diag = result.diagnostics;
      if (diag) {
        if (diag.exitCode !== 0 && diag.exitCode !== null) {
          this.feedLine(
            tp.warning(`  ⚠  Process exited with code ${diag.exitCode}`),
          );
        }
        if (diag.signal) {
          this.feedLine(
            tp.warning(`  ⚠  Process killed by signal: ${diag.signal}`),
          );
        }
        if (diag.debugFile) {
          this.feedLine(tp.muted(`  Debug log: ${diag.debugFile}`));
        }
      }
    }

    // Render handoffs
    if (result.handoffs.length > 0) {
      this.renderHandoffs(result.teammate, result.handoffs, threadId);
    }

    // Clickable [reply] [copy] actions after the response
    if (this.chatView && cleaned) {
      const t = theme();
      const ts = Date.now();
      const replyId = `reply-${result.teammate}-${ts}`;
      const copyId = `copy-${result.teammate}-${ts}`;
      this._replyContexts.set(replyId, {
        teammate: result.teammate,
        message: cleaned,
        threadId,
      });
      this._copyContexts.set(copyId, cleaned);
      this.chatView.appendActionList([
        {
          id: replyId,
          normalStyle: this.makeSpan({
            text: "  [reply]",
            style: { fg: t.textDim },
          }),
          hoverStyle: this.makeSpan({
            text: "  [reply]",
            style: { fg: t.accent },
          }),
        },
        {
          id: copyId,
          normalStyle: this.makeSpan({
            text: " [copy]",
            style: { fg: t.textDim },
          }),
          hoverStyle: this.makeSpan({
            text: " [copy]",
            style: { fg: t.accent },
          }),
        },
      ]);
    }
    this.feedLine();
  }

  /** Render a task result indented inside a thread (delegated to ThreadManager). */
  private displayThreadedResult(
    result: TaskResult,
    cleaned: string,
    threadId: number,
    container: ThreadContainer,
    placeholderId: string,
  ): void {
    this.threadManager.displayThreadedResult(
      result,
      cleaned,
      threadId,
      container,
      placeholderId,
    );
  }

  /** Target context window in tokens. Conversation history budget is derived from this. */
  private static readonly TARGET_CONTEXT_TOKENS = 128_000;

  /** Estimated tokens used by non-conversation prompt sections (identity, wisdom, logs, recall, instructions, task). */
  private static readonly PROMPT_OVERHEAD_TOKENS = 32_000;

  /** Chars-per-token approximation (matches adapter.ts). */
  private static readonly CHARS_PER_TOKEN = 4;

  /** Character budget for conversation history = (target − overhead) × chars/token. */
  private static readonly CONV_HISTORY_CHARS =
    (TeammatesREPL.TARGET_CONTEXT_TOKENS -
      TeammatesREPL.PROMPT_OVERHEAD_TOKENS) *
    TeammatesREPL.CHARS_PER_TOKEN;

  private buildConversationContext(
    _teammate?: string,
    snapshot?: { history: { role: string; text: string }[]; summary: string },
  ): string {
    const history = snapshot ? snapshot.history : this.conversationHistory;
    const summary = snapshot ? snapshot.summary : this.conversationSummary;

    return buildConvCtx(history, summary, TeammatesREPL.CONV_HISTORY_CHARS);
  }

  /**
   * Check if conversation history exceeds the token budget.
   * If so, take the older entries that won't fit, combine with existing summary,
   * and queue a summarization task to the coding agent for high-quality compression.
   */
  private maybeQueueSummarization(): void {
    const splitIdx = findSummarizationSplit(
      this.conversationHistory,
      TeammatesREPL.CONV_HISTORY_CHARS,
    );

    if (splitIdx === 0) return; // everything fits — nothing to summarize

    const toSummarize = this.conversationHistory.slice(0, splitIdx);
    const prompt = buildSummarizationPrompt(
      toSummarize,
      this.conversationSummary,
    );

    // Remove the summarized entries — they'll be captured in the summary
    this.conversationHistory.splice(0, splitIdx);

    // Queue the summarization task through the user's agent
    this.taskQueue.push({
      id: this.makeQueueEntryId(),
      type: "summarize",
      teammate: this.selfName,
      task: prompt,
    });
    this.kickDrain();
  }

  /**
   * Pre-dispatch compression: if conversation history exceeds the token budget,
   * mechanically compress older entries into bullet summaries BEFORE building the
   * prompt. This ensures the prompt always fits within the target context window,
   * even if the async agent-quality summarization hasn't completed yet.
   */
  private preDispatchCompress(): void {
    const totalChars = this.conversationHistory.reduce(
      (sum, e) => sum + formatConversationEntry(e.role, e.text).length,
      0,
    );

    if (totalChars <= TeammatesREPL.CONV_HISTORY_CHARS) return;

    const splitIdx = findSummarizationSplit(
      this.conversationHistory,
      TeammatesREPL.CONV_HISTORY_CHARS,
    );

    if (splitIdx === 0) return;

    const toCompress = this.conversationHistory.slice(0, splitIdx);
    this.conversationSummary = compressConversationEntries(
      toCompress,
      this.conversationSummary,
    );
    this.conversationHistory.splice(0, splitIdx);
  }
  private adapterName: string;
  private teammatesDir!: string;
  private taskQueue: QueueEntry[] = [];
  private nextQueueEntryId = 1;
  /** Per-agent active tasks - one per agent running in parallel. */
  private agentActive: Map<string, QueueEntry> = new Map();
  /** Active system tasks — multiple can run concurrently per agent. */
  private systemActive: Map<string, QueueEntry> = new Map();
  /** Agents currently in a silent retry — suppress all events. */
  private silentAgents: Set<string> = new Set();
  /** Counter for pending migration compression tasks — triggers re-index when it hits 0. */
  private pendingMigrationSyncs = 0;
  private static readonly MIGRATION_TASK_ID = "__migration__";
  /** Per-agent drain locks — prevents double-draining a single agent. */
  private agentDrainLocks: Map<string, Promise<void>> = new Map();
  /** Stored pasted text keyed by paste number, expanded on Enter. */
  private pastedTexts: Map<number, string> = new Map();
  private pasteCounter = 0;
  private wordwheel!: Wordwheel;
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

  private get threads() {
    return this.threadManager.threads;
  }
  private get focusedThreadId() {
    return this.threadManager.focusedThreadId;
  }
  private set focusedThreadId(v: number | null) {
    this.threadManager.focusedThreadId = v;
  }
  private get containers() {
    return this.threadManager.containers;
  }
  private get shiftAllContainers() {
    const base = this.threadManager.shiftAllContainers;
    return (atIndex: number, delta: number) => {
      base(atIndex, delta);
      // Also shift activity line indices so cleanup hides the correct lines
      for (const [_tm, indices] of this.activityManager.lineIndices) {
        for (let i = 0; i < indices.length; i++) {
          if (indices[i] >= atIndex) indices[i] += delta;
        }
      }
      // Shift trailing blank line indices
      for (const [tm, idx] of this.activityManager.blankIdx) {
        if (idx >= atIndex) this.activityManager.blankIdx.set(tm, idx + delta);
      }
    };
  }

  private createThread(originMessage: string): TaskThread {
    return this.threadManager.createThread(originMessage);
  }
  private updateFooterHint(): void {
    this.threadManager.updateFooterHint();
  }
  private getThread(id: number): TaskThread | undefined {
    return this.threadManager.getThread(id);
  }
  private buildThreadClipboardText(threadId: number): string {
    return this.threadManager.buildThreadClipboardText(threadId);
  }
  private appendThreadEntry(threadId: number, entry: ThreadEntry): void {
    this.threadManager.appendThreadEntry(threadId, entry);
  }
  private threadFeedMarkdown(threadId: number, source: string): void {
    this.threadManager.threadFeedMarkdown(threadId, source);
  }
  private renderThreadHeader(thread: TaskThread, targetNames: string[]): void {
    this.threadManager.renderThreadHeader(thread, targetNames);
  }
  private updateThreadHeader(threadId: number): void {
    this.threadManager.updateThreadHeader(threadId);
  }
  private renderThreadReply(
    threadId: number,
    displayText: string,
    targetNames: string[],
  ): void {
    this.threadManager.renderThreadReply(threadId, displayText, targetNames);
  }
  private renderTaskPlaceholder(
    threadId: number,
    placeholderId: string,
    teammate: string,
    state: "queued" | "working",
  ): void {
    this.threadManager.renderTaskPlaceholder(
      threadId,
      placeholderId,
      teammate,
      state,
    );
  }
  private toggleThreadCollapse(threadId: number): void {
    this.threadManager.toggleThreadCollapse(threadId);
  }
  private toggleReplyCollapse(threadId: number, replyKey: string): void {
    this.threadManager.toggleReplyCollapse(threadId, replyKey);
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

  private isAgentBusy(teammate: string): boolean {
    return (
      this.agentActive.has(teammate) ||
      this.taskQueue.some(
        (e) => e.teammate === teammate && !this.isSystemTask(e),
      )
    );
  }

  private getThreadTaskCounts(threadId: number): {
    working: number;
    queued: number;
  } {
    let working = 0;
    let queued = 0;
    for (const entry of this.agentActive.values()) {
      if (entry.threadId === threadId && !this.isSystemTask(entry)) working++;
    }
    for (const entry of this.taskQueue) {
      if (entry.threadId === threadId && !this.isSystemTask(entry)) queued++;
    }
    return { working, queued };
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
  private readonly _userBg: Color = { r: 25, g: 25, b: 25, a: 255 };

  /** Feed a line with the user message background, padded to full width. */
  private feedUserLine(spans: StyledSpan): void {
    if (!this.chatView) return;
    const termW = (process.stdout.columns || 80) - 1; // -1 for scrollbar
    // Calculate visible length of spans
    let len = 0;
    for (const seg of spans) len += seg.text.length;
    const pad = Math.max(0, termW - len);
    const padded = concat(
      spans,
      pen.fg(this._userBg).bg(this._userBg)(" ".repeat(pad)),
    );
    this.chatView.appendStyledToFeed(padded);
  }

  /** Word-wrap text to maxWidth, breaking at spaces. */
  private wrapLine(text: string, maxWidth: number): string[] {
    return wrapLine(text, maxWidth);
  }

  private printUserMessage(text: string): void {
    if (this.chatView) {
      const bg = this._userBg;
      const t = theme();
      const termW = (process.stdout.columns || 80) - 1; // -1 for scrollbar
      const allLines = text.split("\n");

      // Separate non-quote lines from blockquote lines (> prefix)
      // Find contiguous blockquote regions and fence them with empty lines
      const rendered: { type: "text" | "quote"; content: string }[] = [];
      let inQuote = false;
      for (const line of allLines) {
        const isQuote = line.startsWith("> ") || line === ">";
        if (isQuote && !inQuote) {
          rendered.push({ type: "text", content: "" }); // empty line before quotes
          inQuote = true;
        } else if (!isQuote && inQuote) {
          rendered.push({ type: "text", content: "" }); // empty line after quotes
          inQuote = false;
        }
        if (isQuote) {
          rendered.push({
            type: "quote",
            content: line.startsWith("> ") ? line.slice(2) : "",
          });
        } else {
          rendered.push({ type: "text", content: line });
        }
      }

      // Render first line with alias label
      const label = `${this.selfName}: `;
      const first = rendered.shift();
      if (first) {
        if (first.type === "text") {
          const firstWrapW = termW - label.length;
          const firstWrapped = this.wrapLine(first.content, firstWrapW);
          // First wrapped segment gets the label
          const seg0 = firstWrapped.shift() ?? "";
          const pad0 = Math.max(0, termW - label.length - seg0.length);
          this.chatView.appendStyledToFeed(
            concat(
              pen.fg(t.accent).bg(bg)(label),
              pen.fg(t.text).bg(bg)(seg0 + " ".repeat(pad0)),
            ),
          );
          // Remaining wrapped segments are indented to align with content
          for (const wl of firstWrapped) {
            this.feedUserLine(concat(pen.fg(t.text).bg(bg)(wl)));
          }
        } else {
          // First line is a quote (unusual but handle it)
          const pad = Math.max(0, termW - label.length);
          this.chatView.appendStyledToFeed(
            concat(pen.fg(t.accent).bg(bg)(label + " ".repeat(pad))),
          );
          // Re-add to render as quote
          rendered.unshift(first);
        }
      }

      // Render remaining lines
      for (const entry of rendered) {
        if (entry.type === "quote") {
          const prefix = "│ ";
          const wrapWidth = termW - prefix.length;
          const wrapped = this.wrapLine(entry.content, wrapWidth);
          for (const wl of wrapped) {
            const pad = Math.max(0, termW - prefix.length - wl.length);
            this.chatView.appendStyledToFeed(
              concat(
                pen.fg(t.textDim).bg(bg)(prefix),
                pen.fg(t.textMuted).bg(bg)(wl + " ".repeat(pad)),
              ),
            );
          }
        } else {
          const wrapWidth = termW;
          const wrapped = this.wrapLine(entry.content, wrapWidth);
          for (const wl of wrapped) {
            this.feedUserLine(concat(pen.fg(t.text).bg(bg)(wl)));
          }
        }
      }

      this.app.refresh();
      return;
    }

    const termWidth = process.stdout.columns || 100;
    const maxWidth = Math.min(termWidth - 4, 80);
    const lines = text.split("\n");

    console.log();
    for (const line of lines) {
      // Truncate long lines
      const display =
        line.length > maxWidth ? `${line.slice(0, maxWidth - 1)}…` : line;
      const padded =
        display + " ".repeat(Math.max(0, maxWidth - stripAnsi(display).length));
      console.log(`  ${chalk.bgGray.white(` ${padded} `)}`);
    }
    console.log();
  }

  /**
   * Route text input to the right teammate and queue it for execution.
   * Returns immediately — the task runs in the background via drainQueue.
   */
  /**
   * Write a line to the chat feed.
   * Accepts a plain string or a StyledSpan for colored output.
   */
  private feedLine(text: string | StyledSpan = ""): void {
    if (this.chatView) {
      if (typeof text === "string") {
        this.chatView.appendToFeed(text);
      } else {
        this.chatView.appendStyledToFeed(text);
      }
      return;
    }
    // Fallback: convert StyledSpan to plain text for console
    if (typeof text !== "string") {
      console.log(text.map((s) => s.text).join(""));
    } else {
      console.log(text);
    }
  }

  /** Render markdown text to the feed using the consolonia markdown widget. */
  private feedMarkdown(source: string): void {
    const t = theme();
    const width = process.stdout.columns || 80;
    const lines = renderMarkdown(source, {
      width: width - 3, // -2 for indent, -1 for scrollbar
      indent: "  ",
      theme: {
        text: { fg: t.textMuted },
        bold: { fg: t.text, bold: true },
        italic: { fg: t.textMuted, italic: true },
        boldItalic: { fg: t.text, bold: true, italic: true },
        code: { fg: t.accentDim },
        h1: { fg: t.accent, bold: true },
        h2: { fg: t.accent, bold: true },
        h3: { fg: t.accent },
        codeBlockChrome: { fg: t.textDim },
        codeBlock: { fg: t.success },
        blockquote: { fg: t.textMuted, italic: true },
        listMarker: { fg: t.accent },
        tableBorder: { fg: t.textDim },
        tableHeader: { fg: t.text, bold: true },
        hr: { fg: t.textDim },
        link: { fg: t.accent, underline: true },
        linkUrl: { fg: t.textMuted },
        strikethrough: { fg: t.textMuted, strikethrough: true },
        checkbox: { fg: t.accent },
      },
    });

    for (const line of lines) {
      // Convert markdown Line (Seg[]) to StyledSpan, preserving all style flags
      const styledSpan = line.map((seg) => ({
        text: seg.text,
        style: seg.style,
      })) as StyledSpan;
      (styledSpan as any).__brand = "StyledSpan";
      this.feedLine(styledSpan);
    }
  }

  /** Render handoff blocks with approve/reject actions. */
  /** Helper to create a branded StyledSpan from segments. */
  private makeSpan(
    ...segs: { text: string; style: { fg?: Color } }[]
  ): StyledSpan {
    const s = segs as unknown as StyledSpan;
    (s as any).__brand = "StyledSpan";
    return s;
  }

  /** Word-wrap a string to fit within maxWidth. */
  private wordWrap(text: string, maxWidth: number): string[] {
    const words = text.split(" ");
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      if (current.length === 0) {
        current = word;
      } else if (current.length + 1 + word.length <= maxWidth) {
        current += ` ${word}`;
      } else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
    return lines.length > 0 ? lines : [""];
  }

  // ── Handoff + violation management (delegated to HandoffManager) ──
  private renderHandoffs(
    from: string,
    handoffs: HandoffEnvelope[],
    threadId?: number,
    containerCtx?: import("./handoff-manager.js").HandoffContainerCtx,
  ): void {
    this.handoffManager.renderHandoffs(from, handoffs, threadId, containerCtx);
  }
  private showHandoffDropdown(): void {
    this.handoffManager.showHandoffDropdown();
  }
  private handleHandoffAction(actionId: string): void {
    this.handoffManager.handleHandoffAction(actionId);
  }
  private auditCrossFolderWrites(
    teammate: string,
    changedFiles: string[],
  ): string[] {
    return this.handoffManager.auditCrossFolderWrites(teammate, changedFiles);
  }
  private showViolationWarning(teammate: string, violations: string[]): void {
    this.handoffManager.showViolationWarning(teammate, violations);
  }
  private handleViolationAction(actionId: string): void {
    this.handoffManager.handleViolationAction(actionId);
  }
  private handleBulkHandoff(action: string): void {
    this.handoffManager.handleBulkHandoff(action);
  }
  private get pendingHandoffs() {
    return this.handoffManager.pendingHandoffs;
  }
  private get autoApproveHandoffs() {
    return this.handoffManager.autoApproveHandoffs;
  }

  // ── Retro management (delegated to RetroManager) ────────────────
  private handleRetroResult(result: TaskResult): void {
    this.retroManager.handleRetroResult(result);
  }
  private showRetroDropdown(): void {
    this.retroManager.showRetroDropdown();
  }
  private handleRetroAction(actionId: string): void {
    this.retroManager.handleRetroAction(actionId);
  }
  private handleBulkRetro(action: string): void {
    this.retroManager.handleBulkRetro(action);
  }
  private get pendingRetroProposals() {
    return this.retroManager.pendingRetroProposals;
  }

  /** Refresh the ChatView app if active. */
  private refreshView(): void {
    if (this.app) this.app.refresh();
  }

  private queueTask(
    input: string,
    preMentions?: string[],
    threadId?: number,
    replyDisplayText?: string,
  ): void {
    const allNames = this.orchestrator.listTeammates();

    // Create or reuse a thread for this task
    let thread: TaskThread;
    if (threadId != null) {
      const existing = this.getThread(threadId);
      if (!existing) {
        this.feedLine(tp.error(`  Unknown thread #${threadId}`));
        this.refreshView();
        return;
      }
      thread = existing;
      thread.focusedAt = Date.now();
      this.focusedThreadId = threadId;
      this.updateFooterHint();
      // Add user reply to the thread
      this.appendThreadEntry(threadId, {
        type: "user",
        content: input,
        timestamp: Date.now(),
      });
    } else {
      thread = this.createThread(input);
      // Add user's origin message as first entry
      this.appendThreadEntry(thread.id, {
        type: "user",
        content: input,
        timestamp: Date.now(),
      });
    }
    const tid = thread.id;

    // Check for @everyone — queue to all teammates except the coding agent
    const everyoneMatch = input.match(/^@everyone\s+([\s\S]+)$/i);
    if (everyoneMatch) {
      const task = everyoneMatch[1];
      const names = allNames.filter(
        (n) => n !== this.selfName && n !== this.adapterName,
      );
      // Atomic snapshot: freeze conversation state ONCE so all agents see
      // the same context regardless of concurrent preDispatchCompress mutations.
      const contextSnapshot = {
        history: this.conversationHistory.map((e) => ({ ...e })),
        summary: this.conversationSummary,
      };
      for (const teammate of names) {
        const entry = {
          id: this.makeQueueEntryId(),
          type: "agent",
          teammate,
          task,
          threadId: tid,
          contextSnapshot,
        } as const;
        const state = this.isAgentBusy(teammate) ? "queued" : "working";
        this.taskQueue.push(entry);
        thread.pendingTasks.add(entry.id);
        this.renderTaskPlaceholder(tid, entry.id, teammate, state);
      }
      // Render dispatch line (part of user message) + blank line + working placeholders
      if (threadId == null) {
        this.renderThreadHeader(thread, names);
        const c = this.containers.get(tid);
        if (c && this.chatView) {
          c.insertLine(this.chatView, "", this.shiftAllContainers);
        }
      } else if (replyDisplayText) {
        this.renderThreadReply(tid, replyDisplayText, names);
      }
      const ec = this.containers.get(tid);
      if (ec && this.chatView) ec.hideThreadActions(this.chatView);
      this.refreshView();
      this.kickDrain();
      return;
    }

    // Use pre-resolved mentions if provided (avoids picking up @mentions from expanded paste text),
    // otherwise scan the input directly.
    let mentioned: string[];
    if (preMentions) {
      mentioned = preMentions;
    } else {
      const mentionRegex = /@(\S+)/g;
      let m: RegExpExecArray | null;
      mentioned = [];
      while ((m = mentionRegex.exec(input)) !== null) {
        // Remap adapter name alias → user avatar for routing
        const name =
          m[1] === this.adapterName && this.userAlias ? this.selfName : m[1];
        if (allNames.includes(name) && !mentioned.includes(name)) {
          mentioned.push(name);
        }
      }
    }

    if (mentioned.length > 0) {
      // Queue a copy of the full message to every mentioned teammate
      for (const teammate of mentioned) {
        const entry = {
          id: this.makeQueueEntryId(),
          type: "agent",
          teammate,
          task: input,
          threadId: tid,
        } as const;
        const state = this.isAgentBusy(teammate) ? "queued" : "working";
        this.taskQueue.push(entry);
        thread.pendingTasks.add(entry.id);
        this.renderTaskPlaceholder(tid, entry.id, teammate, state);
      }
      // Render dispatch line (part of user message) + blank line + working placeholders
      if (threadId == null) {
        this.renderThreadHeader(thread, mentioned);
        const c = this.containers.get(tid);
        if (c && this.chatView) {
          c.insertLine(this.chatView, "", this.shiftAllContainers);
        }
      } else if (replyDisplayText) {
        this.renderThreadReply(tid, replyDisplayText, mentioned);
      }
      const mc = this.containers.get(tid);
      if (mc && this.chatView) mc.hideThreadActions(this.chatView);
      this.refreshView();
      this.kickDrain();
      return;
    }

    // No mentions — if in a focused thread, default to that thread's last responder
    let match: string | null = null;
    if (threadId != null && thread.entries.length > 0) {
      // Find the last agent entry in this thread for default routing
      for (let i = thread.entries.length - 1; i >= 0; i--) {
        if (thread.entries[i].type === "agent" && thread.entries[i].teammate) {
          match = thread.entries[i].teammate!;
          break;
        }
      }
    }
    if (!match && this.lastResult) {
      match = this.lastResult.teammate;
    }
    if (!match) {
      match = this.orchestrator.route(input) ?? this.selfName;
    }
    // Render dispatch line (part of user message) + blank line + working placeholder
    if (threadId == null) {
      this.renderThreadHeader(thread, [match]);
      const c = this.containers.get(tid);
      if (c && this.chatView) {
        c.insertLine(this.chatView, "", this.shiftAllContainers);
      }
    } else if (replyDisplayText) {
      this.renderThreadReply(tid, replyDisplayText, [match]);
    }
    const dc = this.containers.get(tid);
    if (dc && this.chatView) dc.hideThreadActions(this.chatView);
    const entry = {
      id: this.makeQueueEntryId(),
      type: "agent",
      teammate: match,
      task: input,
      threadId: tid,
    } as const;
    const state = this.isAgentBusy(match) ? "queued" : "working";
    this.renderTaskPlaceholder(tid, entry.id, match, state);
    this.refreshView();
    this.taskQueue.push(entry);
    thread.pendingTasks.add(entry.id);
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

    // Find agents that have user tasks but no active drain
    const agentsWithWork = new Set<string>();
    for (const entry of this.taskQueue) {
      agentsWithWork.add(entry.teammate);
    }
    for (const agent of agentsWithWork) {
      if (!this.agentDrainLocks.has(agent)) {
        const lock = this.drainAgentQueue(agent).finally(() => {
          this.agentDrainLocks.delete(agent);
        });
        this.agentDrainLocks.set(agent, lock);
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
        await this.runCompact(entry.teammate, true);
      } else if (entry.type === "summarize") {
        const result = await this.orchestrator.assign({
          teammate: entry.teammate,
          task: entry.task,
          system: true,
        });
        const raw = result.rawOutput ?? "";
        this.conversationSummary = raw
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
          this.commitVersionUpdate();
        }
      }
    }
  }

  // ─── Onboarding (delegated to OnboardFlow) ─────────────────────────
  private onboardFlow!: OnboardFlow;

  private needsUserSetup(teammatesDir: string): boolean {
    return this.onboardFlow.needsUserSetup(teammatesDir);
  }
  private readUserAlias(teammatesDir: string): string | null {
    return this.onboardFlow.readUserAlias(teammatesDir);
  }
  private registerUserAvatar(teammatesDir: string, alias: string): void {
    this.onboardFlow.registerUserAvatar(teammatesDir, alias, this.orchestrator);
    this.userAlias = alias;
  }
  private printLogo(infoLines: string[]): void {
    this.onboardFlow.printLogo(infoLines);
  }
  private printAgentOutput(rawOutput: string | undefined): void {
    this.onboardFlow.printAgentOutput(rawOutput);
  }
  private async runUserSetup(teammatesDir: string): Promise<void> {
    return this.onboardFlow.runUserSetup(teammatesDir);
  }
  private async runPersonaOnboardingInline(
    teammatesDir: string,
  ): Promise<void> {
    return this.onboardFlow.runPersonaOnboardingInline(teammatesDir);
  }
  private async runOnboardingAgent(
    adapter: AgentAdapter,
    projectDir: string,
  ): Promise<void> {
    return this.onboardFlow.runOnboardingAgent(
      adapter,
      projectDir,
      this.adapterName,
      (raw) => this.printAgentOutput(raw),
    );
  }

  private async promptTeamOnboarding(
    adapter: AgentAdapter,
    teammatesDir: string,
  ): Promise<boolean> {
    return this.onboardFlow.promptTeamOnboarding(adapter, teammatesDir, (raw) =>
      this.printAgentOutput(raw),
    );
  }

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

  // ─── Wordwheel (delegated to Wordwheel) ───────────────────────────
  private get wordwheelItems() {
    return this.wordwheel.items;
  }
  private set wordwheelItems(v) {
    this.wordwheel.items = v;
  }
  private get wordwheelIndex() {
    return this.wordwheel.index;
  }
  private set wordwheelIndex(v) {
    this.wordwheel.index = v;
  }
  private clearWordwheel(): void {
    this.wordwheel.clear();
  }
  private getCommandHint(value: string): string | null {
    return this.wordwheel.getCommandHint(value);
  }
  private updateWordwheel(): void {
    this.wordwheel.update();
  }
  private renderItems(): void {
    this.wordwheel.render();
  }
  private acceptWordwheelSelection(): void {
    this.wordwheel.acceptSelection();
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
      this.printLogo([
        chalk.bold("Teammates") + chalk.gray(` v${PKG_VERSION}`),
        chalk.yellow("New project setup"),
        chalk.gray(process.cwd()),
      ]);
    }

    // Always onboard the user first if USER.md is missing
    if (this.needsUserSetup(teammatesDir)) {
      await this.runUserSetup(teammatesDir);
    }

    // Team onboarding if .teammates/ was missing
    if (isNewProject) {
      const cont = await this.promptTeamOnboarding(adapter, teammatesDir);
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

    // Register the local user's avatar if alias is configured.
    // The user's avatar is the entry point for all generic/fallback tasks —
    // the coding agent is an internal execution engine, not an addressable teammate.
    const alias = this.readUserAlias(teammatesDir);
    if (alias) {
      this.registerUserAvatar(teammatesDir, alias);
    } else {
      // No alias yet (solo mode or pre-interview). Register a minimal avatar
      // under the adapter name so internal tasks (btw, summarize, debug) can execute.
      const registry = this.orchestrator.getRegistry();
      registry.register({
        name: this.adapterName,
        type: "ai",
        role: "Coding agent that performs tasks on your behalf.",
        soul: "",
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

    // Background maintenance: compact stale dailies + sync recall indexes
    this.startupMaintenance().catch(() => {});

    // Register commands
    this.registerCommands();

    // Initialize extracted modules — they reference properties set above
    this.handoffManager = new HandoffManager({
      chatView: this.chatView,
      feedLine: (text?) => this.feedLine(text),
      refreshView: () => this.refreshView(),
      makeSpan: (...segs) => this.makeSpan(...segs),
      wordWrap: (text, maxW) => this.wordWrap(text, maxW),
      listTeammates: () => this.orchestrator.listTeammates(),
      getThread: (id) => this.getThread(id),
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
      hint: (value) => this.getCommandHint(value),
      onUpDown: (dir) => {
        if (this.wordwheelItems.length === 0) return false;
        if (dir === "up") {
          this.wordwheelIndex = Math.max(this.wordwheelIndex - 1, -1);
        } else {
          this.wordwheelIndex = Math.min(
            this.wordwheelIndex + 1,
            this.wordwheelItems.length - 1,
          );
        }
        this.renderItems();
        return true;
      },
      beforeSubmit: (currentValue) => {
        if (this.wordwheelItems.length > 0 && this.wordwheelIndex >= 0) {
          const item = this.wordwheelItems[this.wordwheelIndex];
          if (item) {
            this.clearWordwheel();
            this.wordwheelItems = [];
            this.wordwheelIndex = -1;
            return item.completion;
          }
        }
        this.clearWordwheel();
        this.wordwheelItems = [];
        this.wordwheelIndex = -1;
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

    // ── Create ChatView and Consolonia App ────────────────────────────

    const t = theme();
    this.chatView = new ChatView({
      bannerWidget,
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
      inputHint: (value: string) => this.getCommandHint(value),
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
      this.wordwheelItems = [];
      this.wordwheelIndex = -1;
      this.updateWordwheel();
      // Reset ESC / Ctrl+C pending state on any text change
      if (this.escPending) {
        this.escPending = false;
        if (this.escTimer) {
          clearTimeout(this.escTimer);
          this.escTimer = null;
        }
        this.chatView.setFooter(this.defaultFooter!);
        this.updateFooterHint();
        this.refreshView();
      }
      if (this.ctrlcPending) {
        this.ctrlcPending = false;
        if (this.ctrlcTimer) {
          clearTimeout(this.ctrlcTimer);
          this.ctrlcTimer = null;
        }
        this.chatView.setFooter(this.defaultFooter!);
        this.updateFooterHint();
        this.refreshView();
      }
    });
    this.chatView.on("tab", () => {
      if (this.wordwheelItems.length > 0) {
        if (this.wordwheelIndex < 0) this.wordwheelIndex = 0;
        this.acceptWordwheelSelection();
      }
    });
    this.chatView.on("cancel", () => {
      this.clearWordwheel();
      this.wordwheelItems = [];
      this.wordwheelIndex = -1;

      if (this.escPending) {
        // Second ESC — clear input and restore footer
        this.escPending = false;
        if (this.escTimer) {
          clearTimeout(this.escTimer);
          this.escTimer = null;
        }
        this.chatView.inputValue = "";
        this.chatView.setFooter(this.defaultFooter!);
        this.updateFooterHint();
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
            this.updateFooterHint();
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
        this.updateFooterHint();

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
          this.updateFooterHint();
          this.refreshView();
        }
      }, 2000);
    });
    this.chatView.on("action", (id: string) => {
      if (id.startsWith("thread-toggle-")) {
        const tid = parseInt(id.slice("thread-toggle-".length), 10);
        this.toggleThreadCollapse(tid);
      } else if (id.startsWith("thread-reply-")) {
        const tid = parseInt(id.slice("thread-reply-".length), 10);
        this.focusedThreadId = tid;
        this.chatView.inputValue = `#${tid} `;
        this.updateFooterHint();
        this.refreshView();
      } else if (id.startsWith("thread-copy-")) {
        const tid = parseInt(id.slice("thread-copy-".length), 10);
        this.doCopy(this.buildThreadClipboardText(tid));
      } else if (id.startsWith("reply-collapse-")) {
        const key = id.slice("reply-collapse-".length);
        const tid = parseInt(key.split("-")[0], 10);
        this.toggleReplyCollapse(tid, key);
      } else if (id.startsWith("activity-")) {
        const queueId = id.slice("activity-".length);
        this.toggleActivity(queueId);
      } else if (id.startsWith("cancel-")) {
        const queueId = id.slice("cancel-".length);
        this.cancelTask(queueId);
      } else if (id.startsWith("copy-cmd:")) {
        this.doCopy(id.slice("copy-cmd:".length));
      } else if (id.startsWith("copy-")) {
        const text = this._copyContexts.get(id);
        this.doCopy(text || this.lastCleanedOutput || undefined);
      } else if (
        id.startsWith("retro-approve-") ||
        id.startsWith("retro-reject-")
      ) {
        this.handleRetroAction(id);
      } else if (id.startsWith("revert-") || id.startsWith("allow-")) {
        this.handleViolationAction(id);
      } else if (id.startsWith("approve-") || id.startsWith("reject-")) {
        this.handleHandoffAction(id);
      } else if (id.startsWith("reply-")) {
        const ctx = this._replyContexts.get(id);
        if (ctx && this.chatView) {
          if (ctx.threadId != null) {
            // Thread-aware reply: set focus (auto-focus routes to this thread)
            this.focusedThreadId = ctx.threadId;
            this.updateFooterHint();
          } else {
            this.chatView.inputValue = `@${ctx.teammate} [quoted reply] `;
            this._pendingQuotedReply = ctx.message;
          }
          this.refreshView();
        }
      }
    });

    this.chatView.on("copy", (text: string) => {
      this.doCopy(text);
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
      const quoted = JSON.stringify(filePath);
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
      containers: this.containers,
      shiftAllContainers: (at, delta) => this.shiftAllContainers(at, delta),
      makeSpan: (...segs) => this.makeSpan(...segs),
      refreshView: () => this.refreshView(),
      feedLine: (text?) => this.feedLine(text),
      getAdapter: () => this.orchestrator.getAdapter(),
    });
    const chatViewRef = () => this.chatView;

    // Closures to bridge private accessors into the view interfaces
    const selfNameFn = () => this.selfName;
    const adapterNameFn = () => this.adapterName;

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
          this.renderHandoffs(from, handoffs, tid, containerCtx),
        doCopy: (content?) => this.doCopy(content),
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
      this.pendingHandoffs,
    );
    const userBgRef = () => this._userBg;
    const defaultFooterRightRef = () => this.defaultFooterRight;
    const userAliasFn = () => this.userAlias;
    const teammateDirFn = () => this.teammatesDir;
    const threadsFn = () => this.threads;

    this.wordwheel = new Wordwheel({
      chatView: this.chatView,
      input: this.input,
      commands: this.commands,
      listTeammates: () => this.orchestrator.listTeammates(),
      getTeammateRole: (name) =>
        this.orchestrator.getRegistry().get(name)?.role ?? "",
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

    this.clearWordwheel();
    this.wordwheelItems = [];
    this.wordwheelIndex = -1;

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
      this.handleBulkHandoff("Approve all");
      return;
    }
    if (input === "/always-approve") {
      this.handleBulkHandoff("Always approve");
      return;
    }
    if (input === "/reject") {
      this.handleBulkHandoff("Reject all");
      return;
    }
    if (input === "/approve-retro") {
      this.handleBulkRetro("Approve all");
      return;
    }
    if (input === "/reject-retro") {
      this.handleBulkRetro("Reject all");
      return;
    }

    // Slash commands
    if (input.startsWith("/")) {
      try {
        await this.dispatch(input);
      } catch (err: any) {
        this.feedLine(tp.error(`Error: ${err.message}`));
      }
      this.refreshView();
      return;
    }

    // Everything else gets queued.
    // Parse #id prefix to target an existing thread
    let targetThreadId: number | undefined;
    let taskInput = input;
    const threadMatch = input.match(/^#(\d+)\s+([\s\S]+)/);
    if (threadMatch) {
      const parsedId = parseInt(threadMatch[1], 10);
      if (this.getThread(parsedId)) {
        targetThreadId = parsedId;
        taskInput = threadMatch[2];
      }
      // If thread doesn't exist, fall through — treat as normal input
    }

    // Auto-focus: if no explicit #id and no @mentions, continue in focused thread.
    // @mentions without #id always start a new thread (breaks focus).
    if (
      targetThreadId == null &&
      preMentions.length === 0 &&
      !input.match(/^@everyone\s/i)
    ) {
      // Use explicit focus, or fall back to the last thread in the feed
      let focusId = this.focusedThreadId;
      if (focusId == null && this.threads.size > 0) {
        // Pick the most recently focused thread
        let best: TaskThread | null = null;
        for (const t of this.threads.values()) {
          if (!best || (t.focusedAt ?? 0) > (best.focusedAt ?? 0)) best = t;
        }
        if (best) focusId = best.id;
      }
      if (focusId != null && this.getThread(focusId)) {
        targetThreadId = focusId;
      }
    }

    // Pass pre-resolved mentions so @mentions inside expanded paste text are ignored.
    this.conversationHistory.push({ role: this.selfName, text: taskInput });
    // For threaded replies, render user message inside the thread container
    // instead of at the feed end — keeps the reply visually connected to the thread.
    if (targetThreadId == null) {
      this.printUserMessage(input);
    }
    this.queueTask(
      taskInput,
      preMentions,
      targetThreadId,
      targetThreadId != null ? input : undefined,
    );
    this.refreshView();
  }

  private printBanner(teammates: string[]): void {
    const registry = this.orchestrator.getRegistry();
    const termWidth = process.stdout.columns || 100;

    this.feedLine();
    this.feedLine(concat(tp.bold("  Teammates"), tp.muted(` v${PKG_VERSION}`)));
    this.feedLine(
      concat(
        tp.text(`  @${this.adapterName}`),
        tp.muted(
          ` · ${teammates.length} teammate${teammates.length === 1 ? "" : "s"}`,
        ),
      ),
    );
    this.feedLine(`  ${process.cwd()}`);
    // Service status rows
    for (const svc of this.serviceStatuses) {
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
      this.feedLine(
        concat(
          tp.text("  "),
          color(icon),
          color(svc.name),
          tp.muted(` ${label}`),
        ),
      );
    }

    // Roster (with presence indicators)
    this.feedLine();
    const statuses = this.orchestrator.getAllStatuses();
    // Show user avatar first (displayed as adapter name alias)
    if (this.userAlias) {
      const up = statuses.get(this.userAlias)?.presence ?? "online";
      const udot =
        up === "online"
          ? tp.success("●")
          : up === "reachable"
            ? tp.warning("●")
            : tp.error("●");
      this.feedLine(
        concat(
          tp.text("  "),
          udot,
          tp.accent(` @${this.adapterName.padEnd(14)}`),
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
        this.feedLine(
          concat(
            tp.text("  "),
            dot,
            tp.accent(` @${name.padEnd(14)}`),
            tp.muted(t.role),
          ),
        );
      }
    }

    this.feedLine();
    this.feedLine(tp.muted("─".repeat(termWidth)));

    // Quick reference — 3 columns (different set for first run vs normal)
    let col1: string[][];
    let col2: string[][];
    let col3: string[][];

    if (teammates.length === 0) {
      // First run — no teammates yet
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
      this.feedLine(
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

    this.feedLine();
    this.refreshView();
  }

  // ─── Service detection/config (delegated to service-config.ts) ────

  private get serviceView() {
    return {
      chatView: this.chatView,
      feedLine: (text?: string | StyledSpan) => this.feedLine(text),
      feedCommand: (command: string) => this.feedCommand(command),
      refreshView: () => this.refreshView(),
      askInline: (prompt: string) => this.askInline(prompt),
      banner: this.banner,
    };
  }

  private registerCommands(): void {
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
        usage: "/cancel [n]",
        description: "Cancel a queued task by number",
        run: (args) => this.cmdCancel(args),
      },
      {
        name: "interrupt",
        aliases: ["int"],
        usage: "/interrupt [teammate] [message]",
        description:
          "Interrupt a running agent and resume with a steering message",
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
        run: (args) =>
          cmdConfigure(args, this.serviceStatuses, this.serviceView),
      },
      {
        name: "exit",
        aliases: ["q", "quit"],
        usage: "/exit",
        description: "Exit the session",
        run: async () => {
          this.feedLine(tp.muted("Shutting down..."));

          if (this.app) this.app.stop();
          await this.orchestrator.shutdown();
          process.exit(0);
        },
      },
    ];

    for (const cmd of cmds) {
      this.commands.set(cmd.name, cmd);
      for (const alias of cmd.aliases) {
        this.commands.set(alias, cmd);
      }
    }
  }

  private async dispatch(input: string): Promise<void> {
    // Dispatch only handles slash commands — text input is queued via queueTask()
    const spaceIdx = input.indexOf(" ");
    const cmdName = spaceIdx > 0 ? input.slice(1, spaceIdx) : input.slice(1);
    const cmdArgs = spaceIdx > 0 ? input.slice(spaceIdx + 1).trim() : "";

    const cmd = this.commands.get(cmdName);
    if (cmd) {
      await cmd.run(cmdArgs);
    } else {
      this.feedLine(tp.warning(`Unknown command: /${cmdName}`));
      this.feedLine(tp.muted("Type /help for available commands"));
    }
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
      case "task_assigned": {
        // System tasks (compaction, summarization, wisdom distillation) are
        // invisible — don't track them in the progress bar.
        if (event.assignment.system) break;

        this.statusTracker.startTask(
          event.assignment.teammate,
          event.assignment.teammate,
          event.assignment.task,
        );
        break;
      }

      case "task_completed": {
        // System task completions — don't touch tasks (was never added)
        if (event.result.system) break;

        // Remove from active tasks. StatusTracker auto-stops when empty.
        this.statusTracker.stopTask(event.result.teammate);
        break;
      }

      case "error": {
        this.statusTracker.stopTask(event.teammate);
        if (!this.chatView) this.input.deactivateAndErase();
        const displayErr =
          event.teammate === this.selfName ? this.adapterName : event.teammate;
        this.feedLine(tp.error(`  ✖  ${displayErr}: ${event.error}`));
        this.showPrompt();
        break;
      }
    }
  }

  private async cmdStatus(): Promise<void> {
    const statuses = this.orchestrator.getAllStatuses();
    const registry = this.orchestrator.getRegistry();

    this.feedLine();
    this.feedLine(tp.bold("  Status"));
    this.feedLine(tp.muted(`  ${"─".repeat(50)}`));

    // Show user avatar first if present (displayed as adapter name alias)
    if (this.userAlias) {
      const userStatus = statuses.get(this.userAlias);
      if (userStatus) {
        this.feedLine(
          concat(
            tp.success("●"),
            tp.accent(` @${this.adapterName}`),
            tp.muted(" (you)"),
          ),
        );
        this.feedLine(
          tp.muted("    Coding agent that performs tasks on your behalf."),
        );
        this.feedLine();
      }
    }

    for (const [name, status] of statuses) {
      // Skip the user avatar (shown above) and adapter fallback (not addressable)
      if (name === this.adapterName || name === this.userAlias) continue;

      const t = registry.get(name);
      const active = this.agentActive.get(name);
      const queued = this.taskQueue.filter((e) => e.teammate === name);

      // Presence indicator: ● green=online, ● red=offline, ● yellow=reachable
      const presenceIcon =
        status.presence === "online"
          ? tp.success("●")
          : status.presence === "reachable"
            ? tp.warning("●")
            : tp.error("●");

      // Teammate name + state
      const stateLabel = active ? "working" : status.state;
      const stateColor =
        stateLabel === "working"
          ? tp.info(` (${stateLabel})`)
          : tp.muted(` (${stateLabel})`);
      this.feedLine(concat(presenceIcon, tp.accent(` @${name}`), stateColor));

      // Role
      if (t) {
        this.feedLine(tp.muted(`    ${t.role}`));
      }

      // Active task
      if (active) {
        const taskText =
          active.task.length > 60
            ? `${active.task.slice(0, 57)}…`
            : active.task;
        this.feedLine(concat(tp.info("    ▸ "), tp.text(taskText)));
      }

      // Queued tasks
      for (let i = 0; i < queued.length; i++) {
        const taskText =
          queued[i].task.length > 60
            ? `${queued[i].task.slice(0, 57)}…`
            : queued[i].task;
        this.feedLine(concat(tp.muted(`    ${i + 1}. `), tp.muted(taskText)));
      }

      // Last result
      if (!active && status.lastSummary) {
        const time = status.lastTimestamp
          ? ` ${relativeTime(status.lastTimestamp)}`
          : "";
        this.feedLine(
          tp.muted(`    last: ${status.lastSummary.slice(0, 50)}${time}`),
        );
      }

      this.feedLine();
    }

    // ── Active threads ────────────────────────────────────────────
    if (this.threads.size > 0) {
      this.feedLine(tp.bold("  Threads"));
      this.feedLine(tp.muted(`  ${"─".repeat(50)}`));
      for (const [id, thread] of this.threads) {
        const isFocused = this.focusedThreadId === id;
        const origin =
          thread.originMessage.length > 50
            ? `${thread.originMessage.slice(0, 47)}…`
            : thread.originMessage;
        const replies = thread.entries.filter(
          (e) => e.type !== "user" || thread.entries.indexOf(e) > 0,
        ).length;
        const { working, queued } = this.getThreadTaskCounts(id);
        const focusTag = isFocused ? tp.info(" ◀ focused") : "";
        this.feedLine(
          concat(tp.accent(`  #${id}`), tp.text(`  ${origin}`), focusTag),
        );
        const parts: string[] = [];
        if (replies > 0)
          parts.push(`${replies} repl${replies === 1 ? "y" : "ies"}`);
        if (working > 0) parts.push(`${working} working`);
        if (queued > 0) parts.push(`${queued} queued`);
        if (thread.collapsed) parts.push("collapsed");
        if (parts.length > 0) {
          this.feedLine(tp.muted(`    ${parts.join(" · ")}`));
        }
        this.feedLine();
      }
    }

    this.refreshView();
  }

  private async cmdDebug(argsStr: string): Promise<void> {
    const parts = argsStr.trim().split(/\s+/);
    const firstArg = (parts[0] ?? "").replace(/^@/, "");
    // Everything after the teammate name is the debug focus
    const debugFocus = parts.slice(1).join(" ").trim() || undefined;

    // Resolve which teammate to debug
    let targetName: string;
    if (firstArg === "everyone") {
      // Pick all teammates with debug files, queue one analysis per teammate
      const names: string[] = [];
      for (const [name] of this.lastDebugFiles) {
        if (name !== this.selfName) names.push(name);
      }
      if (names.length === 0) {
        this.feedLine(tp.muted("  No debug info available from any teammate."));
        this.refreshView();
        return;
      }
      for (const name of names) {
        this.queueDebugAnalysis(name, debugFocus);
      }
      return;
    } else if (firstArg) {
      targetName = firstArg;
    } else if (this.lastResult) {
      targetName = this.lastResult.teammate;
    } else {
      this.feedLine(
        tp.muted("  No debug info available. Try: /debug [teammate] [focus]"),
      );
      this.refreshView();
      return;
    }

    this.queueDebugAnalysis(targetName, debugFocus);
  }

  /**
   * Queue a debug analysis task — sends the last request + debug log
   * to the base coding agent for analysis.
   * @param debugFocus Optional focus area the user wants to investigate
   */
  private queueDebugAnalysis(teammate: string, debugFocus?: string): void {
    const files = this.lastDebugFiles.get(teammate);
    const lastPrompt = this.lastTaskPrompts.get(teammate);

    if (!files?.promptFile && !files?.logFile) {
      this.feedLine(tp.muted(`  No debug log available for @${teammate}.`));
      this.refreshView();
      return;
    }

    // Read both debug files
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

    // Show file paths — ctrl+click to open
    if (files.promptFile) {
      this.feedLine(
        concat(tp.muted("  Prompt: "), tp.accent(files.promptFile)),
      );
    }
    if (files.logFile) {
      this.feedLine(concat(tp.muted("  Activity: "), tp.accent(files.logFile)));
    }
    if (debugFocus) {
      this.feedLine(tp.muted(`  Focus: ${debugFocus}`));
    }
    this.feedLine(tp.muted("  Queuing analysis…"));
    this.refreshView();

    this.taskQueue.push({
      id: this.makeQueueEntryId(),
      type: "debug",
      teammate: this.selfName,
      task: analysisPrompt,
    });
    this.kickDrain();
  }

  private async cmdCancel(argsStr: string): Promise<void> {
    const n = parseInt(argsStr.trim(), 10);
    if (Number.isNaN(n) || n < 1 || n > this.taskQueue.length) {
      if (this.taskQueue.length === 0) {
        this.feedLine(tp.muted("  Queue is empty."));
      } else {
        this.feedLine(
          tp.warning(`  Usage: /cancel <1-${this.taskQueue.length}>`),
        );
      }
      this.refreshView();
      return;
    }

    const removed = this.taskQueue.splice(n - 1, 1)[0];
    if (removed.threadId != null) {
      const thread = this.getThread(removed.threadId);
      thread?.pendingTasks.delete(removed.id);
      const container = this.containers.get(removed.threadId);
      if (container && this.chatView) {
        container.hidePlaceholder(this.chatView, removed.id);
        if (container.placeholderCount === 0) {
          container.showThreadActions(this.chatView);
        }
      }
    }
    const cancelDisplay =
      removed.teammate === this.selfName ? this.adapterName : removed.teammate;
    this.feedLine(
      concat(
        tp.muted("  Cancelled: "),
        tp.accent(`@${cancelDisplay}`),
        tp.muted(" — "),
        tp.text(removed.task.slice(0, 60)),
      ),
    );
    this.refreshView();
  }

  /**
   * /interrupt [teammate] [message] — Kill a running agent and resume with context.
   */
  private async cmdInterrupt(argsStr: string): Promise<void> {
    const parts = argsStr.trim().split(/\s+/);
    const teammateName = parts[0]?.replace(/^@/, "").toLowerCase();
    const steeringMessage =
      parts.slice(1).join(" ").trim() ||
      "Wrap up your current work and report what you've done so far.";

    if (!teammateName) {
      this.feedLine(tp.warning("  Usage: /interrupt [teammate] [message]"));
      this.refreshView();
      return;
    }

    // Resolve display name → internal name
    const resolvedName =
      teammateName === this.adapterName ? this.selfName : teammateName;

    // Check if the teammate has an active task
    const activeEntry = this.agentActive.get(resolvedName);
    if (!activeEntry) {
      this.feedLine(
        tp.warning(`  @${teammateName} has no active task to interrupt.`),
      );
      this.refreshView();
      return;
    }

    // Check if the adapter supports killing
    const adapter = this.orchestrator.getAdapter();
    if (!adapter?.killAgent) {
      this.feedLine(
        tp.warning("  This adapter does not support interruption."),
      );
      this.refreshView();
      return;
    }

    // Show interruption status
    const displayName =
      resolvedName === this.selfName ? this.adapterName : resolvedName;
    this.feedLine(
      concat(
        tp.warning("  ⚡  Interrupting "),
        tp.accent(`@${displayName}`),
        tp.warning("..."),
      ),
    );
    this.refreshView();

    try {
      // Kill the agent process and capture its output
      const spawnResult = await adapter.killAgent(resolvedName);
      if (!spawnResult) {
        this.feedLine(tp.warning(`  @${displayName} process already exited.`));
        this.refreshView();
        return;
      }

      // Get the original full prompt for this agent
      const _originalFullPrompt = this.lastTaskPrompts.get(resolvedName) ?? "";
      const originalTask = activeEntry.task;

      // Parse the conversation log from available sources
      const presetName = adapter.name ?? "unknown";
      const { log, toolCallCount, filesChanged } = buildConversationLog(
        spawnResult.debugFile,
        spawnResult.stdout,
        presetName,
      );

      // Build the resume prompt
      const resumePrompt = this.buildResumePrompt(
        originalTask,
        log,
        steeringMessage,
        toolCallCount,
        filesChanged,
      );

      // Report what happened
      const taskEntry = this.statusTracker.getTask(resolvedName);
      const elapsed = taskEntry
        ? `${((Date.now() - taskEntry.startTime) / 1000).toFixed(0)}s`
        : "unknown";
      this.feedLine(
        concat(
          tp.success("  ⚡  Interrupted "),
          tp.accent(`@${displayName}`),
          tp.muted(
            ` (${elapsed}, ${toolCallCount} tool calls, ${filesChanged.length} files changed)`,
          ),
        ),
      );
      this.feedLine(
        concat(
          tp.muted("  Resuming with: "),
          tp.text(steeringMessage.slice(0, 70)),
        ),
      );
      this.refreshView();

      // Clean up the active task state — the drainAgentQueue loop will see
      // the agent as inactive and the queue entry was already removed
      this.statusTracker.stopTask(resolvedName);
      this.agentActive.delete(resolvedName);

      // Queue the resumed task
      this.taskQueue.push({
        id: this.makeQueueEntryId(),
        type: "agent",
        teammate: resolvedName,
        task: resumePrompt,
      });
      this.kickDrain();
    } catch (err: any) {
      this.feedLine(
        tp.error(
          `  ✖  Failed to interrupt @${displayName}: ${err?.message ?? String(err)}`,
        ),
      );
      this.refreshView();
    }
  }

  /**
   * Build a resume prompt from the original task, conversation log, and steering message.
   */
  private buildResumePrompt(
    originalTask: string,
    conversationLog: string,
    steeringMessage: string,
    toolCallCount: number,
    filesChanged: string[],
  ): string {
    const parts: string[] = [];

    parts.push("<RESUME_CONTEXT>");
    parts.push(
      "This is a resumed task. You were previously working on this task but were interrupted.",
    );
    parts.push(
      "Below is the log of what you accomplished before the interruption.",
    );
    parts.push("");
    parts.push(
      "DO NOT repeat work that is already done. Check the filesystem for files you already wrote.",
    );
    parts.push("Continue from where you left off.");
    parts.push("");

    parts.push("## What You Did Before Interruption");
    parts.push("");
    parts.push(`Tool calls: ${toolCallCount}`);
    if (filesChanged.length > 0) {
      parts.push(
        `Files changed: ${filesChanged.slice(0, 20).join(", ")}${filesChanged.length > 20 ? ` (+${filesChanged.length - 20} more)` : ""}`,
      );
    }
    parts.push("");
    parts.push(conversationLog);
    parts.push("");

    parts.push("## Interruption");
    parts.push("");
    parts.push(steeringMessage);
    parts.push("");

    parts.push("## Your Task Now");
    parts.push("");
    parts.push(
      "Continue the original task from where you left off. The original task was:",
    );
    parts.push("");
    parts.push(originalTask);
    parts.push("</RESUME_CONTEXT>");

    return parts.join("\n");
  }

  // ── Activity tracking (delegated to ActivityManager) ──────────────

  private handleActivityEvents(
    teammate: string,
    events: ActivityEvent[],
  ): void {
    this.activityManager.handleActivityEvents(teammate, events);
  }
  private cleanupActivityLines(teammate: string): void {
    this.activityManager.cleanupActivityLines(teammate);
  }
  private toggleActivity(queueId: string): void {
    this.activityManager.toggleActivity(queueId);
  }
  private updatePlaceholderVerb(
    queueId: string,
    teammate: string,
    threadId: number,
    label: string,
  ): void {
    this.activityManager.updatePlaceholderVerb(queueId, teammate, threadId, label);
  }

  /** Cancel a running task or remove a queued task from the queue. */
  private async cancelTask(queueId: string): Promise<void> {
    // Try cancelling an active running task first
    const cancelled = await this.activityManager.cancelRunningTask(queueId);
    if (cancelled) return;

    const queuedIdx = this.taskQueue.findIndex((e) => e.id === queueId);
    if (queuedIdx < 0) {
      this.feedLine(tp.warning("  No queued task found."));
      return;
    }

    const removed = this.taskQueue.splice(queuedIdx, 1)[0];
    if (removed.threadId != null) {
      const thread = this.getThread(removed.threadId);
      thread?.pendingTasks.delete(removed.id);
      const container = this.containers.get(removed.threadId);
      if (container && this.chatView) {
        container.hidePlaceholder(this.chatView, removed.id);
        if (container.placeholderCount === 0) {
          container.showThreadActions(this.chatView);
        }
      }
    }

    const displayName =
      removed.teammate === this.selfName ? this.adapterName : removed.teammate;
    this.statusTracker.showNotification(
      tp.warning(`? ${displayName}: queued task cancelled`),
    );
    this.refreshView();
  }

  /** Drain user tasks for a single agent - runs in parallel with other agents.
   *  System tasks are handled separately by runSystemTask(). */
  private async drainAgentQueue(agent: string): Promise<void> {
    while (true) {
      const idx = this.taskQueue.findIndex(
        (e) => e.teammate === agent && !this.isSystemTask(e),
      );
      if (idx < 0) break;

      const entry = this.taskQueue.splice(idx, 1)[0];
      this.agentActive.set(agent, entry);
      if (entry.threadId != null) {
        this.updatePlaceholderVerb(
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
            const thread = this.getThread(entry.threadId);
            if (thread && thread.entries.length > 0) {
              extraContext = buildThreadContext(
                thread.entries,
                this.selfName,
                TeammatesREPL.CONV_HISTORY_CHARS,
              );
            }
          } else if (isMainThread) {
            // Snapshot-aware context building: if the entry has a frozen snapshot
            // (@everyone), use it directly — no mutation of shared state.
            // Otherwise, compress live state as before.
            const snapshot =
              entry.type === "agent" ? entry.contextSnapshot : undefined;
            if (!snapshot) this.preDispatchCompress();
            extraContext = this.buildConversationContext(
              entry.teammate,
              snapshot,
            );
          }
          // Set up activity tracking for this task
          const teammate = entry.teammate;
          const tid = entry.threadId;
          this.activityManager.initForTask(teammate, tid ?? undefined);

          let result = await this.orchestrator.assign({
            teammate: entry.teammate,
            task: entry.task,
            extraContext: extraContext || undefined,
            skipMemoryUpdates: entry.type === "btw",
            onActivity: (events) => this.handleActivityEvents(teammate, events),
          });

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
          this.cleanupActivityLines(entry.teammate);

          // Display the (possibly retried) result to the user
          this.displayTaskResult(result, entry.type, entry.threadId, entry.id);

          // Append result to thread
          if (entry.threadId != null) {
            const cleaned = cleanResponseBody(result.rawOutput ?? "");
            this.appendThreadEntry(entry.threadId, {
              type: "agent",
              teammate: entry.teammate,
              content: cleaned || result.summary || "",
              subject: result.summary,
              timestamp: Date.now(),
            });
            const thread = this.getThread(entry.threadId);
            if (thread) {
              thread.pendingTasks.delete(entry.id);
            }

            // Propagate threadId to handoff entries
            for (const h of result.handoffs) {
              this.appendThreadEntry(entry.threadId, {
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
            const violations = this.auditCrossFolderWrites(
              entry.teammate,
              result.changedFiles,
            );
            if (violations.length > 0) {
              this.showViolationWarning(entry.teammate, violations);
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
            this.maybeQueueSummarization();
          }
          if (entry.type === "retro") {
            this.handleRetroResult(result);
          }
        }
      } catch (err: any) {
        // Write error debug entry to session file
        this.writeDebugEntry(entry.teammate, entry.task, null, startTime, err);
        // Handle spawn failures, network errors, etc. gracefully
        this.statusTracker.stopTask(agent);
        const msg = err?.message ?? String(err);
        const displayAgent = agent === this.selfName ? this.adapterName : agent;
        this.feedLine(tp.error(`  ✖  @${displayAgent}: ${msg}`));
        this.refreshView();
      }

      this.agentActive.delete(agent);
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

  private async cmdInit(argsStr: string): Promise<void> {
    const cwd = process.cwd();
    const teammatesDir = join(cwd, ".teammates");
    await mkdir(teammatesDir, { recursive: true });

    const fromPath = argsStr.trim();
    if (fromPath === "pick") {
      // Persona picker mode: /init pick
      await this.runPersonaOnboardingInline(teammatesDir);
    } else if (fromPath) {
      // Import mode: /init <path-to-another-project>
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

        // Combine newly imported + already existing for adaptation
        const allTeammates = [...teammates, ...skipped];

        if (allTeammates.length === 0) {
          this.feedLine(tp.warning(`  No teammates found at ${sourceDir}`));
          this.refreshView();
          return;
        }

        if (teammates.length > 0) {
          this.feedLine(
            tp.success(
              `  Imported ${teammates.length} teammate${teammates.length > 1 ? "s" : ""}: ${teammates.join(", ")} (${files.length} files)`,
            ),
          );
        }
        if (skipped.length > 0) {
          this.feedLine(
            tp.muted(
              `  ${skipped.length} already present: ${skipped.join(", ")} (will re-adapt)`,
            ),
          );
        }

        // Copy framework files so the agent has TEMPLATE.md etc. available
        await copyTemplateFiles(teammatesDir);

        // Queue a single adaptation task that handles all teammates
        this.feedLine(
          tp.muted(
            "  Queuing agent to scan this project and adapt the team...",
          ),
        );
        const prompt = await buildImportAdaptationPrompt(
          teammatesDir,
          allTeammates,
          sourceDir,
        );
        this.taskQueue.push({
          id: this.makeQueueEntryId(),
          type: "agent",
          teammate: this.selfName,
          task: prompt,
        });
        this.kickDrain();
      } catch (err: any) {
        this.feedLine(tp.error(`  Import failed: ${err.message}`));
      }
    } else {
      // Normal onboarding
      await this.runOnboardingAgent(this.adapter, cwd);
    }

    // Reload the registry to pick up newly created teammates
    const added = await this.orchestrator.refresh();
    if (added.length > 0) {
      const registry = this.orchestrator.getRegistry();
      if ("roster" in this.adapter) {
        (this.adapter as any).roster = this.orchestrator
          .listTeammates()
          .map((name) => {
            const t = registry.get(name)!;
            return { name: t.name, role: t.role, ownership: t.ownership };
          });
      }
    }
    this.feedLine(tp.muted("  Run /status to see the roster."));
    this.refreshView();
  }

  private async cmdClear(): Promise<void> {
    this.conversationHistory.length = 0;
    this.conversationSummary = "";
    this.lastResult = null;
    this.lastResults.clear();
    this.taskQueue.length = 0;
    this.agentActive.clear();
    this.pastedTexts.clear();
    this.handoffManager.clear();
    this.retroManager.clear();
    this.threadManager.clear();
    await this.orchestrator.reset();

    if (this.chatView) {
      this.chatView.clear();
      this.refreshView();
    } else {
      process.stdout.write(esc.clearScreen + esc.moveTo(0, 0));
      this.printBanner(this.orchestrator.listTeammates());
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

  private async cmdCompact(argsStr: string): Promise<void> {
    const arg = argsStr.trim().replace(/^@/, "");
    const allTeammates = this.orchestrator
      .listTeammates()
      .filter((n) => n !== this.selfName && n !== this.adapterName);
    const names = !arg || arg === "everyone" ? allTeammates : [arg];

    // Validate all names first
    const valid: string[] = [];
    for (const name of names) {
      const teammateDir = join(this.teammatesDir, name);
      try {
        const s = await stat(teammateDir);
        if (!s.isDirectory()) {
          this.feedLine(tp.warning(`  ${name}: not a directory, skipping`));
          continue;
        }
        valid.push(name);
      } catch {
        this.feedLine(tp.warning(`  ${name}: no directory found, skipping`));
      }
    }

    if (valid.length === 0) return;

    // Queue a compact task for each teammate
    for (const name of valid) {
      this.taskQueue.push({
        id: this.makeQueueEntryId(),
        type: "compact",
        teammate: name,
        task: "compact + index update",
      });
    }

    this.feedLine();
    this.feedLine(
      concat(
        tp.muted("  Queued compaction for "),
        tp.accent(valid.map((n) => `@${n}`).join(", ")),
        tp.muted(` (${valid.length} task${valid.length === 1 ? "" : "s"})`),
      ),
    );
    this.feedLine();
    this.refreshView();

    // Start draining
    this.kickDrain();
  }

  /**
   * Run compaction + recall index update for a single teammate.
   * When `silent` is true, routine status messages go to the progress bar
   * only — the feed is reserved for actual work (weeklies/monthlies created).
   */
  private async runCompact(name: string, silent = false): Promise<void> {
    const teammateDir = join(this.teammatesDir, name);

    if (!silent && this.chatView) {
      this.statusTracker.showNotification(tp.muted(`Compacting ${name}...`));
    }
    let spinner: Ora | null = null;
    if (!silent && !this.chatView) {
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
        // Silent: progress bar only; verbose: feed line
        if (this.chatView && !silent)
          this.feedLine(tp.muted(`  ℹ ${name}: nothing to compact`));
      } else {
        // Actual work done — always show in feed
        if (spinner) spinner.succeed(`${name}: ${parts.join(", ")}`);
        if (this.chatView)
          this.feedLine(tp.success(`  ✔  ${name}: ${parts.join(", ")}`));
      }

      // Sync recall index for this teammate (bundled library call)
      try {
        if (!silent && this.chatView) {
          this.statusTracker.showNotification(
            tp.muted(`Syncing ${name} index...`),
          );
        }
        let syncSpinner: Ora | null = null;
        if (!silent && !this.chatView) {
          syncSpinner = ora({
            text: `Syncing ${name} index...`,
            color: "cyan",
          }).start();
        }
        await syncRecallIndex(this.teammatesDir, name);
        if (syncSpinner) syncSpinner.succeed(`${name}: index synced`);
        if (this.chatView && !silent) {
          this.feedLine(tp.success(`  ✔  ${name}: index synced`));
        }
      } catch {
        /* sync failed — non-fatal */
      }
      // Queue wisdom distillation agent task
      try {
        const teammateDir = join(this.teammatesDir, name);
        const wisdomPrompt = await buildWisdomPrompt(teammateDir, name);
        if (wisdomPrompt) {
          this.taskQueue.push({
            id: this.makeQueueEntryId(),
            type: "agent",
            teammate: name,
            task: wisdomPrompt,
            system: true,
          });
          this.kickDrain();
        }
      } catch {
        /* wisdom prompt build failed — non-fatal */
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (spinner) spinner.fail(`${name}: ${msg}`);
      if (this.chatView) {
        // Errors always show in feed
        this.feedLine(tp.error(`  ✖  ${name}: ${msg}`));
      }
    }
    this.refreshView();
  }

  private async cmdRetro(argsStr: string): Promise<void> {
    const arg = argsStr.trim().replace(/^@/, "");

    // Resolve target list
    const allTeammates = this.orchestrator
      .listTeammates()
      .filter((n) => n !== this.selfName && n !== this.adapterName);
    let targets: string[];

    if (arg === "everyone") {
      targets = allTeammates;
    } else if (arg) {
      // Validate teammate exists
      const names = this.orchestrator.listTeammates();
      if (!names.includes(arg)) {
        this.feedLine(tp.warning(`  Unknown teammate: @${arg}`));
        this.refreshView();
        return;
      }
      targets = [arg];
    } else if (this.lastResult) {
      targets = [this.lastResult.teammate];
    } else {
      this.feedLine(
        tp.warning("  No teammate specified and no recent task to infer from."),
      );
      this.feedLine(tp.muted("  Usage: /retro <teammate>"));
      this.refreshView();
      return;
    }

    const retroPrompt = `Run a structured self-retrospective. Review your SOUL.md, WISDOM.md, your last 2-3 weekly summaries (or last 7 daily logs if no weeklies exist), and any typed memories in your memory/ folder.

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
    this.feedLine();
    this.feedLine(concat(tp.muted("  Queued retro for "), tp.accent(label)));
    this.feedLine();
    this.refreshView();

    for (const name of targets) {
      this.taskQueue.push({
        id: this.makeQueueEntryId(),
        type: "retro",
        teammate: name,
        task: retroPrompt,
      });
    }
    this.kickDrain();
  }

  /**
   * Background startup maintenance:
   * 1. Scan all teammates for daily logs older than a week → compact them
   * 2. Sync recall indexes if recall is installed
   */
  /** Recursively delete files/directories older than maxAgeMs. Removes empty parent dirs. */
  private async cleanOldTempFiles(
    dir: string,
    maxAgeMs: number,
  ): Promise<void> {
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

  private async startupMaintenance(): Promise<void> {
    // Check and update installed CLI version
    const versionUpdate = this.checkVersionUpdate();

    const tmpDir = join(this.teammatesDir, ".tmp");

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

    const teammates = this.orchestrator
      .listTeammates()
      .filter((n) => n !== this.selfName && n !== this.adapterName);
    if (teammates.length === 0) return;

    // 1. Version migrations — must run BEFORE compaction so the migration
    //    agent can scrub system-task noise from daily logs before compaction
    //    bakes them into weekly summaries.
    if (versionUpdate) {
      let migrationCount = 0;
      for (const name of teammates) {
        const prompt = buildMigrationPrompt(
          versionUpdate.previous,
          name,
          join(this.teammatesDir, name),
        );
        if (prompt) {
          if (migrationCount === 0) {
            this.startMigrationProgress(
              `Upgrading to v${versionUpdate.current}...`,
            );
          }
          migrationCount++;
          this.taskQueue.push({
            id: this.makeQueueEntryId(),
            type: "agent",
            teammate: name,
            task: prompt,
            system: true,
            migration: true,
          });
        }
      }
      this.pendingMigrationSyncs = migrationCount;
      if (migrationCount === 0) {
        this.commitVersionUpdate();
      }
    }

    // 2. Compaction + compression — skip when a migration is pending so the
    //    migration agent can scrub noise first. Compaction will run next startup.
    if (!versionUpdate) {
      // 2a. Run compaction for all teammates (auto-compact + episodic + sync + wisdom)
      //     Progress bar shows status; feed only shows lines when actual work is done
      for (const name of teammates) {
        await this.runCompact(name, true);
      }

      // 2b. Compress previous day's log for each teammate (queued as system tasks)
      for (const name of teammates) {
        try {
          const compression = await buildDailyCompressionPrompt(
            join(this.teammatesDir, name),
          );
          if (compression) {
            this.taskQueue.push({
              id: this.makeQueueEntryId(),
              type: "agent",
              teammate: name,
              task: compression.prompt,
              system: true,
            });
          }
        } catch {
          /* compression check failed — non-fatal */
        }
      }
    }

    this.kickDrain();

    // 3. Purge daily logs older than 30 days (disk + Vectra)
    const { Indexer } = await import("@teammates/recall");
    const indexer = new Indexer({ teammatesDir: this.teammatesDir });
    for (const name of teammates) {
      try {
        const purged = await purgeStaleDailies(join(this.teammatesDir, name));
        for (const file of purged) {
          const uri = `${name}/memory/${file}`;
          await indexer.deleteDocument(name, uri).catch(() => {});
        }
      } catch {
        /* purge failed — non-fatal */
      }
    }

    // 4. Sync recall indexes (bundled library call)
    try {
      await syncRecallIndex(this.teammatesDir);
    } catch {
      /* sync failed — non-fatal */
    }
  }

  /**
   * Check if the CLI version has changed since last run.
   * Does NOT update settings.json — call `commitVersionUpdate()` after
   * migration tasks are complete to persist the new version.
   */
  private checkVersionUpdate(): { previous: string; current: string } | null {
    const settingsPath = join(this.teammatesDir, "settings.json");
    let settings: {
      version?: number;
      cliVersion?: string;
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
   * Persist the current CLI version to settings.json.
   * Called after all migration tasks complete (or immediately if no migration needed).
   */
  private commitVersionUpdate(): void {
    const settingsPath = join(this.teammatesDir, "settings.json");
    let settings: {
      version?: number;
      cliVersion?: string;
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

  private async cmdCopy(): Promise<void> {
    this.doCopy(); // copies entire session
  }

  /** Build the full chat session as a markdown document. */
  private buildSessionMarkdown(): string {
    if (this.conversationHistory.length === 0) return "";
    const lines: string[] = [];
    lines.push(`# Chat Session\n`);
    for (const entry of this.conversationHistory) {
      if (entry.role === "user") {
        lines.push(`**User:** ${entry.text}\n`);
      } else {
        // Strip protocol artifacts from the raw output
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

  private doCopy(content?: string): void {
    // Build content: if none specified, export the entire chat session as markdown
    const text = content ?? this.buildSessionMarkdown();
    if (!text) {
      this.feedLine(tp.muted("  Nothing to copy."));
      this.refreshView();
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
      if (this.chatView) {
        this.statusTracker.showNotification(
          concat(tp.success("✔  "), tp.muted("Copied to clipboard")),
        );
      }
    } catch {
      if (this.chatView) {
        this.statusTracker.showNotification(
          concat(tp.error("✖  "), tp.muted("Failed to copy")),
        );
      }
    }
  }

  /**
   * Feed a command line with a clickable [copy] button.
   * Renders as: `    command text  [copy]`
   */
  private feedCommand(command: string): void {
    if (!this.chatView) {
      this.feedLine(tp.accent(`    ${command}`));
      return;
    }
    const normal = concat(tp.accent(`    ${command}  `), tp.muted("[copy]"));
    const hover = concat(tp.accent(`    ${command}  `), tp.accent("[copy]"));
    this.chatView.appendAction(`copy-cmd:${command}`, normal, hover);
  }

  private async cmdHelp(): Promise<void> {
    this.feedLine();
    this.feedLine(tp.bold("  Commands"));
    this.feedLine(tp.muted(`  ${"─".repeat(50)}`));

    // De-duplicate (aliases map to same command)
    const seen = new Set<string>();
    for (const [, cmd] of this.commands) {
      if (seen.has(cmd.name)) continue;
      seen.add(cmd.name);

      const aliases =
        cmd.aliases.length > 0
          ? ` (${cmd.aliases.map((a) => `/${a}`).join(", ")})`
          : "";
      this.feedLine(
        concat(
          tp.accent(`  ${cmd.usage}`.padEnd(36)),
          pen(cmd.description),
          tp.muted(aliases),
        ),
      );
    }
    this.feedLine();
    this.feedLine(
      concat(
        tp.muted("  Tip: "),
        tp.text("Type text without / to auto-route to the best teammate"),
      ),
    );
    this.feedLine(
      concat(
        tp.muted("  Tip: "),
        tp.text("Press Tab to autocomplete commands and teammate names"),
      ),
    );
    this.feedLine();
    this.refreshView();
  }

  private async cmdUser(argsStr: string): Promise<void> {
    const userMdPath = join(this.teammatesDir, "USER.md");
    const change = argsStr.trim();

    if (!change) {
      // No args — print current USER.md
      let content: string;
      try {
        content = readFileSync(userMdPath, "utf-8");
      } catch {
        this.feedLine(tp.muted("  USER.md not found."));
        this.feedLine(
          tp.muted("  Run /init or create .teammates/USER.md manually."),
        );
        this.refreshView();
        return;
      }

      if (!content.trim()) {
        this.feedLine(tp.muted("  USER.md is empty."));
        this.refreshView();
        return;
      }

      this.feedLine();
      this.feedLine(tp.muted("  ── USER.md ──"));
      this.feedLine();
      this.feedMarkdown(content);
      this.feedLine();
      this.feedLine(tp.muted("  ── end ──"));
      this.feedLine();
      this.refreshView();
      return;
    }

    // Has args — queue a task to apply the change
    const task = `Update the file ${userMdPath} with the following change:\n\n${change}\n\nKeep the existing content intact unless the change explicitly replaces something. This is the user's profile — be concise and accurate.`;
    this.taskQueue.push({
      id: this.makeQueueEntryId(),
      type: "agent",
      teammate: this.selfName,
      task,
    });
    this.feedLine(
      concat(
        tp.muted("  Queued USER.md update → "),
        tp.accent(`@${this.adapterName}`),
      ),
    );
    this.feedLine();
    this.refreshView();
    this.kickDrain();
  }

  private async cmdBtw(argsStr: string): Promise<void> {
    const question = argsStr.trim();
    if (!question) {
      this.feedLine(tp.muted("  Usage: /btw <question>"));
      this.refreshView();
      return;
    }

    this.taskQueue.push({
      id: this.makeQueueEntryId(),
      type: "btw",
      teammate: this.selfName,
      task: question,
    });
    this.feedLine(
      concat(tp.muted("  Side question → "), tp.accent(`@${this.adapterName}`)),
    );
    this.feedLine();
    this.refreshView();
    this.kickDrain();
  }

  private async cmdScript(argsStr: string): Promise<void> {
    const args = argsStr.trim();
    const scriptsDir = join(this.teammatesDir, this.selfName, "scripts");

    // /script (no args) — show usage
    if (!args) {
      this.feedLine();
      this.feedLine(tp.bold("  /script — write and run reusable scripts"));
      this.feedLine(tp.muted(`  ${"─".repeat(50)}`));
      this.feedLine(
        concat(
          tp.accent("  /script list".padEnd(36)),
          tp.text("List saved scripts"),
        ),
      );
      this.feedLine(
        concat(
          tp.accent("  /script run <name>".padEnd(36)),
          tp.text("Run an existing script"),
        ),
      );
      this.feedLine(
        concat(
          tp.accent("  /script <description>".padEnd(36)),
          tp.text("Create and run a new script"),
        ),
      );
      this.feedLine();
      this.feedLine(tp.muted(`  Scripts are saved to ${scriptsDir}`));
      this.feedLine();
      this.refreshView();
      return;
    }

    // /script list — list saved scripts
    if (args === "list") {
      let files: string[] = [];
      try {
        files = readdirSync(scriptsDir).filter((f) => !f.startsWith("."));
      } catch {
        // directory doesn't exist yet
      }

      this.feedLine();
      if (files.length === 0) {
        this.feedLine(tp.muted("  No scripts saved yet."));
        this.feedLine(tp.muted("  Use /script <description> to create one."));
      } else {
        this.feedLine(tp.bold("  Saved scripts"));
        this.feedLine(tp.muted(`  ${"─".repeat(50)}`));
        for (const f of files) {
          this.feedLine(concat(tp.accent(`  ${f}`)));
        }
      }
      this.feedLine();
      this.refreshView();
      return;
    }

    // /script run <name> — run an existing script
    if (args.startsWith("run ")) {
      const name = args.slice(4).trim();
      if (!name) {
        this.feedLine(tp.muted("  Usage: /script run <name>"));
        this.refreshView();
        return;
      }

      // Find the script file (try exact match, then with common extensions)
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
        this.feedLine(tp.warning(`  Script not found: ${name}`));
        this.feedLine(tp.muted("  Use /script list to see available scripts."));
        this.refreshView();
        return;
      }

      const scriptContent = readFileSync(scriptPath, "utf-8");
      const task = `Run the following script located at ${scriptPath}:\n\n\`\`\`\n${scriptContent}\n\`\`\`\n\nExecute it and report the results. If it fails, diagnose the issue and fix it.`;

      this.taskQueue.push({
        id: this.makeQueueEntryId(),
        type: "script",
        teammate: this.selfName,
        task,
      });
      this.feedLine(
        concat(
          tp.muted("  Running script "),
          tp.accent(basename(scriptPath)),
          tp.muted(" → "),
          tp.accent(`@${this.adapterName}`),
        ),
      );
      this.feedLine();
      this.refreshView();
      this.kickDrain();
      return;
    }

    // /script <description> — create and run a new script
    const task = [
      `The user wants a reusable script. Their request:`,
      ``,
      args,
      ``,
      `Instructions:`,
      `1. Write the script and save it to the scripts directory: ${scriptsDir}`,
      `2. Create the directory if it doesn't exist.`,
      `3. Choose a short, descriptive filename (kebab-case, with appropriate extension like .sh, .ts, .js, .py, .ps1).`,
      `4. Make the script executable if applicable.`,
      `5. Run the script and report the results.`,
      `6. If the script needs to be parameterized, use command-line arguments.`,
    ].join("\n");

    this.taskQueue.push({
      id: this.makeQueueEntryId(),
      type: "script",
      teammate: this.selfName,
      task,
    });
    this.feedLine(
      concat(tp.muted("  Script task → "), tp.accent(`@${this.adapterName}`)),
    );
    this.feedLine();
    this.refreshView();
    this.kickDrain();
  }

  private async cmdTheme(): Promise<void> {
    const t = theme();
    this.feedLine();
    this.feedLine(tp.bold("  Theme"));
    this.feedLine(tp.muted(`  ${"─".repeat(50)}`));
    this.feedLine();

    // Helper: show a swatch + variable name + hex + example text
    const row = (name: string, c: Color, example: string) => {
      const hex = colorToHex(c);
      this.feedLine(
        concat(
          pen.fg(c)("  ██"),
          tp.text(`  ${name}`.padEnd(24)),
          tp.muted(hex.padEnd(12)),
          pen.fg(c)(example),
        ),
      );
    };

    this.feedLine(
      tp.muted("       Variable                Hex         Example"),
    );
    this.feedLine(tp.muted(`  ${"─".repeat(50)}`));

    // Brand / accent
    row("accent", t.accent, "@beacon  /status  ● teammate");
    row("accentBright", t.accentBright, "▸ highlighted item");
    row("accentDim", t.accentDim, "┌─── border ───┐");

    this.feedLine();

    // Foreground
    row("text", t.text, "Primary text content");
    row("textMuted", t.textMuted, "Description or secondary info");
    row("textDim", t.textDim, "─── separator ───");

    this.feedLine();

    // Status
    row("success", t.success, "✔  Task completed");
    row("warning", t.warning, "⚠  Pending handoff");
    row("error", t.error, "✖  Something went wrong");
    row("info", t.info, "⠋ Working on task...");

    this.feedLine();

    // Interactive
    row("prompt", t.prompt, "> ");
    row("input", t.input, "user typed text");
    row("separator", t.separator, "────────────────");
    row("progress", t.progress, "analyzing codebase...");
    row("dropdown", t.dropdown, "/status  session overview");
    row("dropdownHighlight", t.dropdownHighlight, "▸ /help   all commands");

    this.feedLine();

    // Cursor
    this.feedLine(
      concat(
        pen.fg(t.cursorFg).bg(t.cursorBg)("  ██"),
        tp.text("  cursorFg/cursorBg".padEnd(24)),
        tp.muted(
          `${colorToHex(t.cursorFg)}/${colorToHex(t.cursorBg)}`.padEnd(12),
        ),
        pen.fg(t.cursorFg).bg(t.cursorBg)(" block cursor "),
      ),
    );

    this.feedLine();
    this.feedLine(tp.muted("  Base accent: #3A96DD"));
    this.feedLine();

    // ── Markdown preview ──────────────────────────────────────
    this.feedLine(tp.bold("  Markdown Preview"));
    this.feedLine(tp.muted(`  ${"─".repeat(50)}`));
    this.feedLine();

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

    this.feedMarkdown(mdSample);
    this.feedLine();
    this.refreshView();
  }
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
