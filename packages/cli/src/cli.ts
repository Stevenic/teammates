#!/usr/bin/env node

/**
 * @teammates/cli — Interactive teammate orchestrator.
 *
 * Start a session:
 *   teammates                     Launch interactive REPL
 *   teammates --adapter codex     Use a specific agent adapter
 *   teammates --dir <path>        Override .teammates/ location
 */

import { exec as execCb, execSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, readdir, rm, stat, unlink } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { createInterface } from "node:readline";

import {
  App,
  ChatView,
  type Color,
  concat,
  type DropdownItem,
  esc,
  pen,
  renderMarkdown,
  type StyledSpan,
  stripAnsi,
} from "@teammates/consolonia";
import chalk from "chalk";
import ora, { type Ora } from "ora";
import type { AgentAdapter } from "./adapter.js";
import { DAILY_LOG_BUDGET_TOKENS, syncRecallIndex } from "./adapter.js";
import {
  AnimatedBanner,
  type ServiceInfo,
  type ServiceStatus,
} from "./banner.js";
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
  cleanResponseBody,
  findAtMention,
  findSummarizationSplit,
  isImagePath,
  relativeTime,
  wrapLine,
} from "./cli-utils.js";
import {
  autoCompactForBudget,
  buildWisdomPrompt,
  compactEpisodic,
  purgeStaleDailies,
} from "./compact.js";
import { PromptInput } from "./console/prompt-input.js";
import { buildTitle } from "./console/startup.js";
import {
  buildImportAdaptationPrompt,
  copyTemplateFiles,
  getOnboardingPrompt,
  importTeammates,
} from "./onboard.js";
import { Orchestrator } from "./orchestrator.js";
import { loadPersonas, scaffoldFromPersona } from "./personas.js";
import { colorToHex, theme, tp } from "./theme.js";
import type {
  HandoffEnvelope,
  OrchestratorEvent,
  QueueEntry,
  SlashCommand,
  TaskResult,
} from "./types.js";

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
  private displayTaskResult(result: TaskResult, entryType: string): void {
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

    // Header: "teammate: subject"
    const subject = result.summary || "Task completed";
    const displayTeammate =
      result.teammate === this.selfName ? this.adapterName : result.teammate;
    this.feedLine(concat(tp.accent(`${displayTeammate}: `), tp.text(subject)));
    this.lastCleanedOutput = cleaned;

    if (cleaned) {
      this.feedMarkdown(cleaned);
    } else if (result.changedFiles.length > 0 || result.summary) {
      // Agent produced no body text but DID do work — generate a synthetic
      // summary from available metadata so the user sees something useful.
      const syntheticLines: string[] = [];
      if (result.summary) {
        syntheticLines.push(result.summary);
      }
      if (result.changedFiles.length > 0) {
        syntheticLines.push("");
        syntheticLines.push("**Files changed:**");
        for (const f of result.changedFiles) {
          syntheticLines.push(`- ${f}`);
        }
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
      // Show diagnostic hints for empty responses
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
    const handoffs = result.handoffs;
    if (handoffs.length > 0) {
      this.renderHandoffs(result.teammate, handoffs);
    }

    // Clickable [reply] [copy] actions after the response
    if (this.chatView && cleaned) {
      const t = theme();
      const teammate = result.teammate;
      const replyId = `reply-${teammate}-${Date.now()}`;
      this._replyContexts.set(replyId, { teammate, message: cleaned });
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
          id: "copy",
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

    // Auto-detect new teammates added during this task
    this.refreshTeammates();

    this.showPrompt();
  }

  /** Token budget for recent conversation history (24k tokens ≈ 96k chars). */
  private static readonly CONV_HISTORY_CHARS = 24_000 * 4;

  private buildConversationContext(): string {
    return buildConvCtx(
      this.conversationHistory,
      this.conversationSummary,
      TeammatesREPL.CONV_HISTORY_CHARS,
    );
  }

  /**
   * Check if conversation history exceeds the 24k token budget.
   * If so, take the older entries that won't fit, combine with existing summary,
   * and queue a summarization task to the coding agent.
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
      type: "summarize",
      teammate: this.selfName,
      task: prompt,
    });
    this.kickDrain();
  }
  private adapterName: string;
  private teammatesDir!: string;
  private taskQueue: QueueEntry[] = [];
  /** Per-agent active tasks — one per agent running in parallel. */
  private agentActive: Map<string, QueueEntry> = new Map();
  /** Active system tasks — multiple can run concurrently per agent. */
  private systemActive: Map<string, QueueEntry> = new Map();
  /** Agents currently in a silent retry — suppress all events. */
  private silentAgents: Set<string> = new Set();
  /** Per-agent drain locks — prevents double-draining a single agent. */
  private agentDrainLocks: Map<string, Promise<void>> = new Map();
  /** Stored pasted text keyed by paste number, expanded on Enter. */
  private pastedTexts: Map<number, string> = new Map();
  private pasteCounter = 0;
  private wordwheelItems: DropdownItem[] = [];
  private wordwheelIndex = -1; // -1 = no selection, 0+ = highlighted row
  private escPending = false; // true after first ESC, waiting for second
  private escTimer: ReturnType<typeof setTimeout> | null = null;
  private ctrlcPending = false; // true after first Ctrl+C, waiting for second
  private ctrlcTimer: ReturnType<typeof setTimeout> | null = null;
  private lastCleanedOutput = ""; // last teammate output for clipboard copy
  private autoApproveHandoffs = false;
  /** Last debug log file path per teammate — for /debug analysis. */
  private lastDebugFiles: Map<string, string> = new Map();
  /** Last task prompt per teammate — for /debug analysis. */
  private lastTaskPrompts: Map<string, string> = new Map();

  /** Pending handoffs awaiting user approval. */
  private pendingHandoffs: {
    id: string;
    envelope: HandoffEnvelope;
    approveIdx: number;
    rejectIdx: number;
  }[] = [];
  /** Pending retro proposals awaiting user approval. */
  private pendingRetroProposals: {
    id: string;
    teammate: string;
    index: number;
    title: string;
    section: string;
    before: string;
    after: string;
    why: string;
    actionIdx: number;
  }[] = [];
  /** Pending cross-folder violations awaiting user decision. */
  private pendingViolations: {
    id: string;
    teammate: string;
    files: string[];
    actionIdx: number;
  }[] = [];

  /** Maps reply action IDs to their context (teammate + message). */
  private _replyContexts: Map<string, { teammate: string; message: string }> =
    new Map();
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

  // ── Animated status tracker ─────────────────────────────────────
  private activeTasks: Map<
    string,
    { teammate: string; task: string; startTime: number }
  > = new Map();
  private statusTimer: ReturnType<typeof setInterval> | null = null;
  private statusFrame = 0;
  private statusRotateIndex = 0;
  private statusRotateTimer: ReturnType<typeof setInterval> | null = null;

  private static readonly SPINNER = [
    "⠋",
    "⠙",
    "⠹",
    "⠸",
    "⠼",
    "⠴",
    "⠦",
    "⠧",
    "⠇",
    "⠏",
  ];

  constructor(adapterName: string) {
    this.adapterName = adapterName;
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

  /** Start or update the animated status tracker above the prompt. */
  private startStatusAnimation(): void {
    if (this.statusTimer) return; // already running

    this.statusFrame = 0;
    this.statusRotateIndex = 0;
    this.renderStatusFrame();

    // Animate spinner at ~80ms
    this.statusTimer = setInterval(() => {
      this.statusFrame++;
      this.renderStatusFrame();
    }, 80);

    // Rotate through teammates every 3 seconds
    this.statusRotateTimer = setInterval(() => {
      if (this.activeTasks.size > 1) {
        this.statusRotateIndex =
          (this.statusRotateIndex + 1) % this.activeTasks.size;
      }
    }, 3000);
  }

  /** Stop the status animation and clear the status line. */
  private stopStatusAnimation(): void {
    if (this.statusTimer) {
      clearInterval(this.statusTimer);
      this.statusTimer = null;
    }
    if (this.statusRotateTimer) {
      clearInterval(this.statusRotateTimer);
      this.statusRotateTimer = null;
    }
    if (this.chatView) {
      this.chatView.setProgress(null);
      this.app.refresh();
    } else {
      this.input.setStatus(null);
    }
  }

  /**
   * Truncate a path for display, collapsing middle segments if too long.
   * E.g. C:\source\some\deep\project → C:\source\...\project
   */
  private static truncatePath(fullPath: string, maxLen = 30): string {
    if (fullPath.length <= maxLen) return fullPath;
    const parts = fullPath.split(sep);
    if (parts.length <= 2) return fullPath;
    const last = parts[parts.length - 1];
    // Keep adding segments from the front until we'd exceed maxLen
    let front = parts[0];
    for (let i = 1; i < parts.length - 1; i++) {
      const candidate = `${front + sep + parts[i] + sep}...${sep}${last}`;
      if (candidate.length > maxLen) break;
      front += sep + parts[i];
    }
    return `${front + sep}...${sep}${last}`;
  }

  /** Format elapsed seconds as (Ns), (Nm Ns), or (Nh Nm Ns). */
  private static formatElapsed(totalSeconds: number): string {
    const s = totalSeconds % 60;
    const m = Math.floor(totalSeconds / 60) % 60;
    const h = Math.floor(totalSeconds / 3600);
    if (h > 0) return `(${h}h ${m}m ${s}s)`;
    if (m > 0) return `(${m}m ${s}s)`;
    return `(${s}s)`;
  }

  /** Render one frame of the status animation. */
  private renderStatusFrame(): void {
    if (this.activeTasks.size === 0) return;

    const entries = Array.from(this.activeTasks.values());
    const total = entries.length;
    const idx = this.statusRotateIndex % total;
    const { teammate, task, startTime } = entries[idx];
    const displayName =
      teammate === this.selfName ? this.adapterName : teammate;

    const spinChar =
      TeammatesREPL.SPINNER[this.statusFrame % TeammatesREPL.SPINNER.length];
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const elapsedStr = TeammatesREPL.formatElapsed(elapsed);

    // Build the tag: (1/3 - 2m 5s) when multiple, (2m 5s) when single
    const tag =
      total > 1
        ? `(${idx + 1}/${total} - ${elapsedStr.slice(1, -1)})`
        : elapsedStr;

    // Target 80 chars total: "<spinner> <name>... <task> <tag>"
    const prefix = `${spinChar} ${displayName}... `;
    const suffix = ` ${tag}`;
    const maxTask = 80 - prefix.length - suffix.length;
    const cleanTask = task.replace(/[\r\n]+/g, " ").trim();
    const taskText =
      maxTask <= 3
        ? ""
        : cleanTask.length > maxTask
          ? `${cleanTask.slice(0, maxTask - 1)}…`
          : cleanTask;

    if (this.chatView) {
      this.chatView.setProgress(
        concat(
          tp.accent(`${spinChar} ${displayName}... `),
          tp.muted(`${taskText}${suffix}`),
        ),
      );
      this.app.refresh();
    } else {
      const spinColor =
        this.statusFrame % 8 === 0 ? chalk.blue : chalk.blueBright;
      const line =
        `  ${spinColor(spinChar)} ` +
        chalk.bold(displayName) +
        chalk.gray(`... ${taskText}`) +
        chalk.gray(suffix);
      this.input.setStatus(line);
    }
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

  private renderHandoffs(_from: string, handoffs: HandoffEnvelope[]): void {
    const t = theme();
    const names = this.orchestrator.listTeammates();
    const avail = (process.stdout.columns || 80) - 4; // -4 for "  │ " + " │"
    const boxW = Math.max(40, Math.round(avail * 0.6));
    const innerW = boxW - 4; // space inside │ _ content _ │

    for (let i = 0; i < handoffs.length; i++) {
      const h = handoffs[i];
      const isValid = names.includes(h.to);
      const handoffId = `handoff-${Date.now()}-${i}`;
      const chrome = isValid ? t.accentDim : t.error;

      // Top border with label
      this.feedLine();
      const label = ` handoff → @${h.to} `;
      const topFill = Math.max(0, boxW - 2 - label.length);
      this.feedLine(
        this.makeSpan({
          text: `  ┌${label}${"─".repeat(topFill)}┐`,
          style: { fg: chrome },
        }),
      );

      // Task body — word-wrap each paragraph line
      for (const rawLine of h.task.split("\n")) {
        const wrapped =
          rawLine.length === 0 ? [""] : this.wordWrap(rawLine, innerW);
        for (const wl of wrapped) {
          const pad = Math.max(0, innerW - wl.length);
          this.feedLine(
            this.makeSpan(
              { text: "  │ ", style: { fg: chrome } },
              { text: wl + " ".repeat(pad), style: { fg: t.textMuted } },
              { text: " │", style: { fg: chrome } },
            ),
          );
        }
      }

      // Bottom border
      this.feedLine(
        this.makeSpan({
          text: `  └${"─".repeat(Math.max(0, boxW - 2))}┘`,
          style: { fg: chrome },
        }),
      );

      if (!isValid) {
        this.feedLine(tp.error(`  ✖  Unknown teammate: @${h.to}`));
      } else if (this.autoApproveHandoffs) {
        this.taskQueue.push({ type: "agent", teammate: h.to, task: h.task });
        this.feedLine(tp.muted("  automatically approved"));
        this.kickDrain();
      } else if (this.chatView) {
        const actionIdx = this.chatView.feedLineCount;
        this.chatView.appendActionList([
          {
            id: `approve-${handoffId}`,
            normalStyle: this.makeSpan({
              text: "  [approve]",
              style: { fg: t.textDim },
            }),
            hoverStyle: this.makeSpan({
              text: "  [approve]",
              style: { fg: t.accent },
            }),
          },
          {
            id: `reject-${handoffId}`,
            normalStyle: this.makeSpan({
              text: " [reject]",
              style: { fg: t.textDim },
            }),
            hoverStyle: this.makeSpan({
              text: " [reject]",
              style: { fg: t.accent },
            }),
          },
        ]);
        this.pendingHandoffs.push({
          id: handoffId,
          envelope: h,
          approveIdx: actionIdx,
          rejectIdx: actionIdx,
        });
      }
    }

    // Show global approval options as dropdown when there are pending handoffs
    this.showHandoffDropdown();
    this.refreshView();
  }

  /** Show/hide the handoff approval dropdown based on pending handoffs. */
  private showHandoffDropdown(): void {
    if (!this.chatView) return;
    if (this.pendingHandoffs.length > 0) {
      const items: {
        label: string;
        description: string;
        completion: string;
      }[] = [];
      if (this.pendingHandoffs.length === 1) {
        items.push({
          label: "approve",
          description: `approve handoff to @${this.pendingHandoffs[0].envelope.to}`,
          completion: "/approve",
        });
      } else {
        items.push({
          label: "approve",
          description: `approve ${this.pendingHandoffs.length} handoffs`,
          completion: "/approve",
        });
      }
      items.push({
        label: "always approve",
        description: "auto-approve future handoffs",
        completion: "/always-approve",
      });
      if (this.pendingHandoffs.length === 1) {
        items.push({
          label: "reject",
          description: `reject handoff to @${this.pendingHandoffs[0].envelope.to}`,
          completion: "/reject",
        });
      } else {
        items.push({
          label: "reject",
          description: `reject ${this.pendingHandoffs.length} handoffs`,
          completion: "/reject",
        });
      }
      this.chatView.showDropdown(items);
    } else {
      this.chatView.hideDropdown();
    }
    this.refreshView();
  }

  /** Handle handoff approve/reject actions. */
  private handleHandoffAction(actionId: string): void {
    const approveMatch = actionId.match(/^approve-(.+)$/);
    if (approveMatch) {
      const hId = approveMatch[1];
      const idx = this.pendingHandoffs.findIndex((h) => h.id === hId);
      if (idx >= 0 && this.chatView) {
        const h = this.pendingHandoffs.splice(idx, 1)[0];
        this.taskQueue.push({
          type: "agent",
          teammate: h.envelope.to,
          task: h.envelope.task,
        });
        this.chatView.updateFeedLine(
          h.approveIdx,
          this.makeSpan({ text: "  approved", style: { fg: theme().success } }),
        );
        this.kickDrain();
        this.showHandoffDropdown();
      }
      return;
    }

    const rejectMatch = actionId.match(/^reject-(.+)$/);
    if (rejectMatch) {
      const hId = rejectMatch[1];
      const idx = this.pendingHandoffs.findIndex((h) => h.id === hId);
      if (idx >= 0 && this.chatView) {
        const h = this.pendingHandoffs.splice(idx, 1)[0];
        this.chatView.updateFeedLine(
          h.approveIdx,
          this.makeSpan({ text: "  rejected", style: { fg: theme().error } }),
        );
        this.showHandoffDropdown();
      }
      return;
    }
  }

  /**
   * Audit a task result for cross-folder writes.
   * AI teammates must not write to another teammate's folder.
   * Returns violating file paths (relative), or empty array if clean.
   */
  private auditCrossFolderWrites(
    teammate: string,
    changedFiles: string[],
  ): string[] {
    // Normalize .teammates/ prefix for comparison
    const tmPrefix = ".teammates/";
    const ownPrefix = `${tmPrefix}${teammate}/`;

    return changedFiles.filter((f) => {
      const normalized = f.replace(/\\/g, "/");
      // Only care about files inside .teammates/
      if (!normalized.startsWith(tmPrefix)) return false;
      // Own folder is fine
      if (normalized.startsWith(ownPrefix)) return false;
      // Shared folders (_prefix) are fine
      const subPath = normalized.slice(tmPrefix.length);
      if (subPath.startsWith("_")) return false;
      // Ephemeral folders (.prefix) are fine
      if (subPath.startsWith(".")) return false;
      // Root-level shared files (USER.md, settings.json, CROSS-TEAM.md, etc.)
      if (!subPath.includes("/")) return false;
      // Everything else is a violation
      return true;
    });
  }

  /**
   * Show cross-folder violation warning with [revert] / [allow] actions.
   */
  private showViolationWarning(teammate: string, violations: string[]): void {
    const t = theme();
    this.feedLine(
      tp.warning(`  ⚠  @${teammate} wrote to another teammate's folder:`),
    );
    for (const f of violations) {
      this.feedLine(tp.muted(`     ${f}`));
    }

    if (this.chatView) {
      const violationId = `violation-${Date.now()}`;
      const actionIdx = this.chatView.feedLineCount;
      this.chatView.appendActionList([
        {
          id: `revert-${violationId}`,
          normalStyle: this.makeSpan({
            text: "  [revert]",
            style: { fg: t.error },
          }),
          hoverStyle: this.makeSpan({
            text: "  [revert]",
            style: { fg: t.accent },
          }),
        },
        {
          id: `allow-${violationId}`,
          normalStyle: this.makeSpan({
            text: " [allow]",
            style: { fg: t.textDim },
          }),
          hoverStyle: this.makeSpan({
            text: " [allow]",
            style: { fg: t.accent },
          }),
        },
      ]);
      this.pendingViolations.push({
        id: violationId,
        teammate,
        files: violations,
        actionIdx,
      });
    }
  }

  /**
   * Handle revert/allow actions for cross-folder violations.
   */
  private handleViolationAction(actionId: string): void {
    const revertMatch = actionId.match(/^revert-(violation-.+)$/);
    if (revertMatch) {
      const vId = revertMatch[1];
      const idx = this.pendingViolations.findIndex((v) => v.id === vId);
      if (idx >= 0 && this.chatView) {
        const v = this.pendingViolations.splice(idx, 1)[0];
        // Revert violating files via git checkout
        for (const f of v.files) {
          try {
            execSync(`git checkout -- "${f}"`, {
              cwd: resolve(this.teammatesDir, ".."),
              stdio: "pipe",
            });
          } catch {
            // File might be untracked — try git rm
            try {
              execSync(`git rm -f "${f}"`, {
                cwd: resolve(this.teammatesDir, ".."),
                stdio: "pipe",
              });
            } catch {
              // Best effort — file may already be clean
            }
          }
        }
        this.chatView.updateFeedLine(
          v.actionIdx,
          this.makeSpan({
            text: `  reverted ${v.files.length} file(s)`,
            style: { fg: theme().success },
          }),
        );
        this.refreshView();
      }
      return;
    }

    const allowMatch = actionId.match(/^allow-(violation-.+)$/);
    if (allowMatch) {
      const vId = allowMatch[1];
      const idx = this.pendingViolations.findIndex((v) => v.id === vId);
      if (idx >= 0 && this.chatView) {
        const v = this.pendingViolations.splice(idx, 1)[0];
        this.chatView.updateFeedLine(
          v.actionIdx,
          this.makeSpan({
            text: "  allowed",
            style: { fg: theme().textDim },
          }),
        );
        this.refreshView();
      }
      return;
    }
  }

  /** Handle bulk handoff actions. */
  private handleBulkHandoff(action: string): void {
    if (!this.chatView) return;
    const t = theme();
    const isApprove = action === "Approve all" || action === "Always approve";

    if (action === "Always approve") {
      this.autoApproveHandoffs = true;
    }

    for (const h of this.pendingHandoffs) {
      if (isApprove) {
        this.taskQueue.push({
          type: "agent",
          teammate: h.envelope.to,
          task: h.envelope.task,
        });
        const label =
          action === "Always approve"
            ? "  automatically approved"
            : "  approved";
        this.chatView.updateFeedLine(
          h.approveIdx,
          this.makeSpan({ text: label, style: { fg: t.success } }),
        );
      } else {
        this.chatView.updateFeedLine(
          h.approveIdx,
          this.makeSpan({ text: "  rejected", style: { fg: t.error } }),
        );
      }
    }
    this.pendingHandoffs = [];
    if (isApprove) this.kickDrain();
    this.showHandoffDropdown();
  }

  // ─── Retro Phase 2: proposal approval ─────────────────────────

  /** Parse retro proposals from agent output and render approval UI. */
  private handleRetroResult(result: TaskResult): void {
    const raw = result.rawOutput ?? "";
    const proposals = this.parseRetroProposals(raw);
    if (proposals.length === 0) return;

    const t = theme();
    const teammate = result.teammate;
    const retroId = `retro-${Date.now()}`;

    this.feedLine();
    this.feedLine(
      concat(
        tp.accent(
          `  ${proposals.length} SOUL.md proposal${proposals.length > 1 ? "s" : ""}`,
        ),
        tp.muted(" — approve or reject each:"),
      ),
    );

    for (let i = 0; i < proposals.length; i++) {
      const p = proposals[i];
      const pId = `${retroId}-${i}`;

      this.feedLine();
      this.feedLine(tp.text(`  Proposal ${i + 1}: ${p.title}`));
      this.feedLine(tp.muted(`    Section: ${p.section}`));
      if (p.before === "(new entry)") {
        this.feedLine(tp.muted("    Before: (new entry)"));
      } else {
        this.feedLine(tp.muted(`    Before: ${p.before}`));
      }
      this.feedLine(concat(tp.muted("    After: "), tp.text(p.after)));
      this.feedLine(tp.muted(`    Why: ${p.why}`));

      if (this.chatView) {
        const actionIdx = this.chatView.feedLineCount;
        this.chatView.appendActionList([
          {
            id: `retro-approve-${pId}`,
            normalStyle: this.makeSpan({
              text: "    [approve]",
              style: { fg: t.textDim },
            }),
            hoverStyle: this.makeSpan({
              text: "    [approve]",
              style: { fg: t.accent },
            }),
          },
          {
            id: `retro-reject-${pId}`,
            normalStyle: this.makeSpan({
              text: " [reject]",
              style: { fg: t.textDim },
            }),
            hoverStyle: this.makeSpan({
              text: " [reject]",
              style: { fg: t.accent },
            }),
          },
        ]);
        this.pendingRetroProposals.push({
          id: pId,
          teammate,
          index: i + 1,
          title: p.title,
          section: p.section,
          before: p.before,
          after: p.after,
          why: p.why,
          actionIdx,
        });
      }
    }

    this.feedLine();
    this.showRetroDropdown();
    this.refreshView();
  }

  /** Parse Proposal N blocks from retro output. */
  private parseRetroProposals(text: string): {
    title: string;
    section: string;
    before: string;
    after: string;
    why: string;
  }[] {
    const proposals: {
      title: string;
      section: string;
      before: string;
      after: string;
      why: string;
    }[] = [];
    // Match **Proposal N: title** blocks
    const proposalPattern = /\*\*Proposal\s+\d+[:.]\s*(.+?)\*\*/gi;
    let match: RegExpExecArray | null;
    const positions: { title: string; start: number }[] = [];
    while ((match = proposalPattern.exec(text)) !== null) {
      positions.push({ title: match[1].trim(), start: match.index });
    }

    for (let i = 0; i < positions.length; i++) {
      const end =
        i + 1 < positions.length ? positions[i + 1].start : text.length;
      const block = text.slice(positions[i].start, end);

      const section = this.extractField(block, "Section") || "Unknown";
      const before = this.extractField(block, "Before") || "(new entry)";
      const after = this.extractField(block, "After") || "";
      const why = this.extractField(block, "Why") || "";

      if (after) {
        proposals.push({
          title: positions[i].title,
          section,
          before,
          after,
          why,
        });
      }
    }
    return proposals;
  }

  /** Extract a **Field:** value from a proposal block. */
  private extractField(block: string, field: string): string {
    // Match "- **Field:** value" or "**Field:** value" across potential line breaks
    const pattern = new RegExp(
      `\\*\\*${field}:\\*\\*\\s*(.+?)(?=\\n\\s*[-*]\\s*\\*\\*|\\n\\s*\\n|$)`,
      "is",
    );
    const m = block.match(pattern);
    if (!m) return "";
    // Clean up: remove backticks and trim
    return m[1].trim().replace(/^`+|`+$/g, "");
  }

  /** Show/hide the retro approval dropdown based on pending proposals. */
  private showRetroDropdown(): void {
    if (!this.chatView) return;
    if (
      this.pendingRetroProposals.length > 0 &&
      this.pendingHandoffs.length === 0
    ) {
      const n = this.pendingRetroProposals.length;
      const items: {
        label: string;
        description: string;
        completion: string;
      }[] = [];
      items.push({
        label: "approve all",
        description: `approve ${n} SOUL.md proposal${n > 1 ? "s" : ""}`,
        completion: "/approve-retro",
      });
      items.push({
        label: "reject all",
        description: `reject ${n} SOUL.md proposal${n > 1 ? "s" : ""}`,
        completion: "/reject-retro",
      });
      this.chatView.showDropdown(items);
    } else if (this.pendingHandoffs.length === 0) {
      this.chatView.hideDropdown();
    }
    this.refreshView();
  }

  /** Handle retro approve/reject actions (individual clicks). */
  private handleRetroAction(actionId: string): void {
    const approveMatch = actionId.match(/^retro-approve-(.+)$/);
    if (approveMatch) {
      const pId = approveMatch[1];
      const idx = this.pendingRetroProposals.findIndex((p) => p.id === pId);
      if (idx >= 0 && this.chatView) {
        const p = this.pendingRetroProposals.splice(idx, 1)[0];
        this.chatView.updateFeedLine(
          p.actionIdx,
          this.makeSpan({
            text: "    approved",
            style: { fg: theme().success },
          }),
        );
        this.queueRetroApply(p.teammate, [p]);
        this.showRetroDropdown();
      }
      return;
    }
    const rejectMatch = actionId.match(/^retro-reject-(.+)$/);
    if (rejectMatch) {
      const pId = rejectMatch[1];
      const idx = this.pendingRetroProposals.findIndex((p) => p.id === pId);
      if (idx >= 0 && this.chatView) {
        const p = this.pendingRetroProposals.splice(idx, 1)[0];
        this.chatView.updateFeedLine(
          p.actionIdx,
          this.makeSpan({ text: "    rejected", style: { fg: theme().error } }),
        );
        this.showRetroDropdown();
      }
      return;
    }
  }

  /** Handle bulk retro approve/reject. */
  private handleBulkRetro(action: string): void {
    if (!this.chatView) return;
    const t = theme();
    const isApprove = action === "Approve all";
    const grouped = new Map<string, typeof this.pendingRetroProposals>();

    for (const p of this.pendingRetroProposals) {
      if (isApprove) {
        this.chatView.updateFeedLine(
          p.actionIdx,
          this.makeSpan({ text: "    approved", style: { fg: t.success } }),
        );
        const list = grouped.get(p.teammate) || [];
        list.push(p);
        grouped.set(p.teammate, list);
      } else {
        this.chatView.updateFeedLine(
          p.actionIdx,
          this.makeSpan({ text: "    rejected", style: { fg: t.error } }),
        );
      }
    }

    if (isApprove) {
      for (const [teammate, proposals] of grouped) {
        this.queueRetroApply(teammate, proposals);
      }
    }

    this.pendingRetroProposals = [];
    this.showRetroDropdown();
  }

  /** Queue a follow-up task for the teammate to apply approved SOUL.md changes. */
  private queueRetroApply(
    teammate: string,
    proposals: typeof this.pendingRetroProposals,
  ): void {
    const changes = proposals
      .map(
        (p) =>
          `- **Proposal ${p.index}: ${p.title}**\n  - Section: ${p.section}\n  - Before: ${p.before}\n  - After: ${p.after}`,
      )
      .join("\n\n");

    const applyPrompt = `The user approved the following SOUL.md changes from your retrospective. Apply them now.

**Edit your SOUL.md file** (\`.teammates/${teammate}/SOUL.md\`) to incorporate these changes:

${changes}

After editing SOUL.md, record a brief summary of the retro outcome in your daily log: which proposals were approved and what changed.

Do NOT modify any other teammate's files. Only edit your own SOUL.md and daily log.`;

    this.taskQueue.push({ type: "agent", teammate, task: applyPrompt });
    this.feedLine(
      concat(
        tp.muted("  Queued SOUL.md update for "),
        tp.accent(`@${teammate}`),
      ),
    );
    this.refreshView();
    this.kickDrain();
  }

  /** Refresh the ChatView app if active. */
  private refreshView(): void {
    if (this.app) this.app.refresh();
  }

  private queueTask(input: string, preMentions?: string[]): void {
    const allNames = this.orchestrator.listTeammates();

    // Check for @everyone — queue to all teammates except the coding agent
    const everyoneMatch = input.match(/^@everyone\s+([\s\S]+)$/i);
    if (everyoneMatch) {
      const task = everyoneMatch[1];
      const names = allNames.filter(
        (n) => n !== this.selfName && n !== this.adapterName,
      );
      for (const teammate of names) {
        this.taskQueue.push({ type: "agent", teammate, task });
      }
      const bg = this._userBg;
      const t = theme();
      this.feedUserLine(
        concat(
          pen.fg(t.textMuted).bg(bg)("  → "),
          pen.fg(t.accent).bg(bg)(names.map((n) => `@${n}`).join(", ")),
        ),
      );
      this.feedLine();
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
        this.taskQueue.push({ type: "agent", teammate, task: input });
      }
      const bg = this._userBg;
      const t = theme();
      this.feedUserLine(
        concat(
          pen.fg(t.textMuted).bg(bg)("  → "),
          pen.fg(t.accent).bg(bg)(mentioned.map((n) => `@${n}`).join(", ")),
        ),
      );
      this.feedLine();
      this.refreshView();
      this.kickDrain();
      return;
    }

    // No mentions — default to the teammate you're chatting with, then try auto-route
    let match: string | null = null;
    if (this.lastResult) {
      match = this.lastResult.teammate;
    }
    if (!match) {
      match = this.orchestrator.route(input) ?? this.selfName;
    }
    {
      const bg = this._userBg;
      const t = theme();
      const displayName = match === this.selfName ? this.adapterName : match;
      this.feedUserLine(
        concat(
          pen.fg(t.textMuted).bg(bg)("  → "),
          pen.fg(t.accent).bg(bg)(`@${displayName}`),
        ),
      );
    }
    this.feedLine();
    this.refreshView();
    this.taskQueue.push({ type: "agent", teammate: match, task: input });
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
    }
  }

  // ─── Onboarding ───────────────────────────────────────────────────

  /**
   * Interactive prompt for team onboarding after user profile is set up.
   * .teammates/ already exists at this point. Returns false if user chose to exit.
   */
  private async promptTeamOnboarding(
    adapter: AgentAdapter,
    teammatesDir: string,
  ): Promise<boolean> {
    const cwd = process.cwd();
    const termWidth = process.stdout.columns || 100;

    console.log();
    console.log(chalk.gray("─".repeat(termWidth)));
    console.log();
    console.log(chalk.white("  Set up teammates for this project?\n"));
    console.log(
      chalk.cyan("  1") +
        chalk.gray(") ") +
        chalk.white("Pick teammates") +
        chalk.gray(" — choose from persona templates"),
    );
    console.log(
      chalk.cyan("  2") +
        chalk.gray(") ") +
        chalk.white("Auto-generate") +
        chalk.gray(
          " — let your agent analyze the codebase and create teammates",
        ),
    );
    console.log(
      chalk.cyan("  3") +
        chalk.gray(") ") +
        chalk.white("Import team") +
        chalk.gray(" — copy teammates from another project"),
    );
    console.log(
      chalk.cyan("  4") +
        chalk.gray(") ") +
        chalk.white("Solo mode") +
        chalk.gray(" — use your agent without teammates"),
    );
    console.log(chalk.cyan("  5") + chalk.gray(") ") + chalk.white("Exit"));
    console.log();

    const choice = await this.askChoice("Pick an option (1/2/3/4/5): ", [
      "1",
      "2",
      "3",
      "4",
      "5",
    ]);

    if (choice === "5") {
      console.log(chalk.gray("  Goodbye."));
      return false;
    }

    if (choice === "4") {
      console.log(
        chalk.gray("  Running in solo mode — all tasks go to your agent."),
      );
      console.log(chalk.gray("  Run /init later to set up teammates."));
      console.log();
      return true;
    }

    if (choice === "3") {
      await this.runImport(cwd);
      return true;
    }

    if (choice === "2") {
      // Auto-generate via agent
      await this.runOnboardingAgent(adapter, cwd);
      return true;
    }

    // choice === "1": Pick from persona templates
    await this.runPersonaOnboarding(teammatesDir);
    return true;
  }

  /**
   * Persona-based onboarding: show a list of bundled personas, let the user
   * pick which ones to create, optionally rename them, and scaffold the folders.
   */
  private async runPersonaOnboarding(teammatesDir: string): Promise<void> {
    const personas = await loadPersonas();
    if (personas.length === 0) {
      console.log(chalk.yellow("  No persona templates found."));
      return;
    }

    console.log();
    console.log(chalk.white("  Available personas:\n"));

    // Display personas grouped by tier
    let currentTier = 0;
    for (let i = 0; i < personas.length; i++) {
      const p = personas[i];
      if (p.tier !== currentTier) {
        currentTier = p.tier;
        const label = currentTier === 1 ? "Core" : "Specialized";
        console.log(chalk.gray(`  ── ${label} ──`));
      }
      const num = String(i + 1).padStart(2, " ");
      console.log(
        chalk.cyan(`  ${num}`) +
          chalk.gray(") ") +
          chalk.white(p.persona) +
          chalk.gray(` (${p.alias})`) +
          chalk.gray(` — ${p.description}`),
      );
    }

    console.log();
    console.log(chalk.gray("  Enter numbers separated by commas, e.g. 1,3,5"));
    console.log();

    const input = await this.askInput("Personas: ");
    if (!input) {
      console.log(chalk.gray("  No personas selected."));
      return;
    }

    // Parse comma-separated numbers
    const indices = input
      .split(",")
      .map((s) => parseInt(s.trim(), 10) - 1)
      .filter((i) => i >= 0 && i < personas.length);

    const unique = [...new Set(indices)];
    if (unique.length === 0) {
      console.log(chalk.yellow("  No valid selections."));
      return;
    }

    console.log();

    // Copy framework files first
    await copyTemplateFiles(teammatesDir);

    const created: string[] = [];
    for (const idx of unique) {
      const p = personas[idx];
      const nameInput = await this.askInput(
        `Name for ${p.persona} [${p.alias}]: `,
      );
      const name = nameInput || p.alias;
      const folderName = name.toLowerCase().replace(/[^a-z0-9_-]/g, "");

      await scaffoldFromPersona(teammatesDir, folderName, p);
      created.push(folderName);
      console.log(
        chalk.green("  ✔  ") +
          chalk.white(`@${folderName}`) +
          chalk.gray(` — ${p.persona}`),
      );
    }

    console.log();
    console.log(
      chalk.green(
        `  ✔  Created ${created.length} teammate${created.length > 1 ? "s" : ""}: `,
      ) + chalk.white(created.map((n) => `@${n}`).join(", ")),
    );
    console.log(
      chalk.gray(
        "  Tip: Your agent will adapt ownership and capabilities to this codebase on first task.",
      ),
    );
    console.log();
  }

  /**
   * In-TUI persona picker for /init pick. Uses feedLine + askInline instead
   * of console.log + askInput.
   */
  private async runPersonaOnboardingInline(
    teammatesDir: string,
  ): Promise<void> {
    const personas = await loadPersonas();
    if (personas.length === 0) {
      this.feedLine(tp.warning("  No persona templates found."));
      this.refreshView();
      return;
    }

    // Display personas in the feed
    this.feedLine(tp.text("  Available personas:\n"));

    let currentTier = 0;
    for (let i = 0; i < personas.length; i++) {
      const p = personas[i];
      if (p.tier !== currentTier) {
        currentTier = p.tier;
        const label = currentTier === 1 ? "Core" : "Specialized";
        this.feedLine(tp.muted(`  ── ${label} ──`));
      }
      const num = String(i + 1).padStart(2, " ");
      this.feedLine(
        concat(
          tp.text(`  ${num}) ${p.persona} `),
          tp.muted(`(${p.alias}) — ${p.description}`),
        ),
      );
    }

    this.feedLine(
      tp.muted("\n  Enter numbers separated by commas, e.g. 1,3,5"),
    );
    this.refreshView();

    const input = await this.askInline("Personas: ");
    if (!input) {
      this.feedLine(tp.muted("  No personas selected."));
      this.refreshView();
      return;
    }

    const indices = input
      .split(",")
      .map((s) => parseInt(s.trim(), 10) - 1)
      .filter((i) => i >= 0 && i < personas.length);

    const unique = [...new Set(indices)];
    if (unique.length === 0) {
      this.feedLine(tp.warning("  No valid selections."));
      this.refreshView();
      return;
    }

    await copyTemplateFiles(teammatesDir);

    const created: string[] = [];
    for (const idx of unique) {
      const p = personas[idx];
      const nameInput = await this.askInline(
        `Name for ${p.persona} [${p.alias}]: `,
      );
      const name = nameInput || p.alias;
      const folderName = name.toLowerCase().replace(/[^a-z0-9_-]/g, "");

      await scaffoldFromPersona(teammatesDir, folderName, p);
      created.push(folderName);
      this.feedLine(
        concat(tp.success(`  ✔  @${folderName}`), tp.muted(` — ${p.persona}`)),
      );
    }

    this.feedLine(
      concat(
        tp.success(
          `\n  ✔  Created ${created.length} teammate${created.length > 1 ? "s" : ""}: `,
        ),
        tp.text(created.map((n) => `@${n}`).join(", ")),
      ),
    );
    this.refreshView();
  }

  /**
   * Run the onboarding agent to analyze the codebase and create teammates.
   * Used by both promptOnboarding (pre-orchestrator) and cmdInit (post-orchestrator).
   */
  private async runOnboardingAgent(
    adapter: AgentAdapter,
    projectDir: string,
  ): Promise<void> {
    console.log();
    console.log(
      chalk.blue("  Starting onboarding...") +
        chalk.gray(
          " Your agent will analyze your codebase and create .teammates/",
        ),
    );
    console.log();

    // Copy framework files from bundled template
    const teammatesDir = join(projectDir, ".teammates");
    const copied = await copyTemplateFiles(teammatesDir);
    if (copied.length > 0) {
      console.log(
        chalk.green("  ✔ ") +
          chalk.gray(` Copied template files: ${copied.join(", ")}`),
      );
      console.log();
    }

    const onboardingPrompt = await getOnboardingPrompt(projectDir);
    const tempConfig = {
      name: this.adapterName,
      type: "ai" as const,
      role: "Onboarding agent",
      soul: "",
      wisdom: "",
      dailyLogs: [] as { date: string; content: string }[],
      weeklyLogs: [] as { week: string; content: string }[],
      ownership: { primary: [] as string[], secondary: [] as string[] },
      routingKeywords: [] as string[],
      cwd: projectDir,
    };

    const sessionId = await adapter.startSession(tempConfig);
    const spinner = ora({
      text: chalk.gray("Analyzing your codebase..."),
      spinner: "dots",
    }).start();

    try {
      const result = await adapter.executeTask(
        sessionId,
        tempConfig,
        onboardingPrompt,
      );
      spinner.stop();
      this.printAgentOutput(result.rawOutput);

      if (result.success) {
        console.log(chalk.green("  ✔  Onboarding complete!"));
      } else {
        console.log(
          chalk.yellow(
            `  ⚠ Onboarding finished with issues: ${result.summary}`,
          ),
        );
      }
    } catch (err: any) {
      spinner.fail(chalk.red(`Onboarding failed: ${err.message}`));
    }

    if (adapter.destroySession) {
      await adapter.destroySession(sessionId);
    }

    // Verify .teammates/ now has content
    try {
      const entries = await readdir(teammatesDir);
      if (!entries.some((e) => !e.startsWith("."))) {
        console.log(
          chalk.yellow("  ⚠ .teammates/ was created but appears empty."),
        );
        console.log(
          chalk.gray(
            "  You may need to run the onboarding agent again or set up manually.",
          ),
        );
      }
    } catch {
      /* dir might not exist if onboarding failed badly */
    }
    console.log();
  }

  /**
   * Import teammates from another project's .teammates/ directory.
   * Prompts for a path, copies teammate folders + framework files,
   * then optionally runs the agent to adapt ownership for this codebase.
   */
  private async runImport(projectDir: string): Promise<void> {
    console.log();
    console.log(
      chalk.white("  Enter the path to another project") +
        chalk.gray(" (the project root or its .teammates/ directory):"),
    );
    console.log();

    const rawPath = await this.askInput("Path: ");
    if (!rawPath) {
      console.log(chalk.yellow("  No path provided. Aborting import."));
      return;
    }

    // Resolve the source — accept either project root or .teammates/ directly
    const resolved = resolve(rawPath);
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

    const teammatesDir = join(projectDir, ".teammates");
    console.log();

    try {
      const { teammates, skipped, files } = await importTeammates(
        sourceDir,
        teammatesDir,
      );

      const allTeammates = [...teammates, ...skipped];

      if (allTeammates.length === 0) {
        console.log(
          chalk.yellow("  No teammates found at ") + chalk.white(sourceDir),
        );
        console.log(
          chalk.gray(
            "  The directory should contain teammate folders (each with a SOUL.md).",
          ),
        );
        return;
      }

      if (teammates.length > 0) {
        console.log(
          chalk.green("  ✔ ") +
            chalk.white(
              ` Imported ${teammates.length} teammate${teammates.length > 1 ? "s" : ""}: `,
            ) +
            chalk.cyan(teammates.join(", ")),
        );
        console.log(chalk.gray(`    (${files.length} files copied)`));
      }
      if (skipped.length > 0) {
        console.log(
          chalk.gray(
            `  ${skipped.length} already present: ${skipped.join(", ")} (will re-adapt)`,
          ),
        );
      }
      console.log();

      // Copy framework files so the agent has TEMPLATE.md etc. available
      await copyTemplateFiles(teammatesDir);

      // Ask if user wants the agent to adapt teammates to this codebase
      console.log(chalk.white("  Adapt teammates to this codebase?"));
      console.log(
        chalk.gray(
          "  The agent will scan this project, evaluate which teammates are needed,",
        ),
      );
      console.log(
        chalk.gray(
          "  adapt their files, and create any new teammates the project needs.",
        ),
      );
      console.log(chalk.gray("  You can also do this later with /init."));
      console.log();

      const adapt = await this.askChoice("Adapt now? (y/n): ", ["y", "n"]);

      if (adapt === "y") {
        await this.runAdaptationAgent(
          this.adapter,
          projectDir,
          allTeammates,
          sourceDir,
        );
      } else {
        console.log(
          chalk.gray("  Skipped adaptation. Run /init to adapt later."),
        );
      }
    } catch (err: any) {
      console.log(chalk.red(`  Import failed: ${err.message}`));
    }
    console.log();
  }

  /**
   * Run the agent to adapt imported teammates to the current codebase.
   * Uses a single comprehensive session that scans the project, evaluates
   * which teammates to keep/drop/create, adapts kept teammates (with
   * Previous Projects sections), and creates any new teammates needed.
   */
  private async runAdaptationAgent(
    adapter: AgentAdapter,
    projectDir: string,
    teammateNames: string[],
    sourceProjectPath: string,
  ): Promise<void> {
    const teammatesDir = join(projectDir, ".teammates");
    console.log();
    console.log(
      chalk.blue("  Starting adaptation...") +
        chalk.gray(" Your agent will scan this project and adapt the team"),
    );
    console.log();

    const prompt = await buildImportAdaptationPrompt(
      teammatesDir,
      teammateNames,
      sourceProjectPath,
    );
    const tempConfig = {
      name: this.adapterName,
      type: "ai" as const,
      role: "Adaptation agent",
      soul: "",
      wisdom: "",
      dailyLogs: [] as { date: string; content: string }[],
      weeklyLogs: [] as { week: string; content: string }[],
      ownership: { primary: [] as string[], secondary: [] as string[] },
      routingKeywords: [] as string[],
      cwd: projectDir,
    };

    const sessionId = await adapter.startSession(tempConfig);
    const spinner = ora({
      text: chalk.gray("Scanning the project and adapting teammates..."),
      spinner: "dots",
    }).start();

    try {
      const result = await adapter.executeTask(sessionId, tempConfig, prompt);
      spinner.stop();
      this.printAgentOutput(result.rawOutput);

      if (result.success) {
        console.log(chalk.green("  ✔  Team adaptation complete!"));
      } else {
        console.log(
          chalk.yellow(
            `  ⚠ Adaptation finished with issues: ${result.summary}`,
          ),
        );
      }
    } catch (err: any) {
      spinner.fail(chalk.red(`Adaptation failed: ${err.message}`));
    }

    if (adapter.destroySession) {
      await adapter.destroySession(sessionId);
    }

    console.log();
  }

  /**
   * Simple blocking prompt — reads one line from stdin and validates.
   */
  private askChoice(prompt: string, valid: string[]): Promise<string> {
    return new Promise((resolve) => {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      const ask = () => {
        rl.question(chalk.cyan("  ") + prompt, (answer) => {
          const trimmed = answer.trim();
          if (valid.includes(trimmed)) {
            rl.close();
            resolve(trimmed);
          } else {
            ask();
          }
        });
      };
      ask();
    });
  }

  private askInput(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      rl.question(chalk.cyan("  ") + prompt, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });
  }

  /**
   * Ask for input using the ChatView's own prompt (no raw readline).
   * Temporarily replaces the footer with the prompt text and intercepts the next submit.
   */
  private askInline(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      if (!this.chatView) {
        // Fallback if no ChatView (shouldn't happen during /configure)
        return this.askInput(prompt).then(resolve);
      }
      // Show the prompt in the feed so it's visible
      this.feedLine(tp.accent(`  ${prompt}`));
      this.chatView.setFooter(tp.accent(`  ${prompt}`));
      this._pendingAsk = (answer: string) => {
        // Restore footer
        if (this.chatView && this.defaultFooter) {
          this.chatView.setFooter(this.defaultFooter);
        }
        this.refreshView();
        resolve(answer.trim());
      };
      this.refreshView();
    });
  }

  /**
   * Check whether USER.md needs to be created or is still template placeholders.
   */
  private needsUserSetup(teammatesDir: string): boolean {
    const userMdPath = join(teammatesDir, "USER.md");
    try {
      const content = readFileSync(userMdPath, "utf-8");
      // Template placeholders contain "<your name>" — treat as not set up
      return !content.trim() || content.includes("<your name>");
    } catch {
      // File doesn't exist
      return true;
    }
  }

  /**
   * Pre-TUI user profile setup. Runs in the console before the ChatView is created.
   * Offers GitHub-based or manual profile creation.
   */
  private async runUserSetup(teammatesDir: string): Promise<void> {
    const termWidth = process.stdout.columns || 100;

    console.log();
    console.log(chalk.gray("─".repeat(termWidth)));
    console.log();
    console.log(chalk.white("  Set up your profile\n"));
    console.log(
      chalk.cyan("  1") +
        chalk.gray(") ") +
        chalk.white("Use GitHub account") +
        chalk.gray(" — import your name and username from GitHub"),
    );
    console.log(
      chalk.cyan("  2") +
        chalk.gray(") ") +
        chalk.white("Manual setup") +
        chalk.gray(" — enter your details manually"),
    );
    console.log(
      chalk.cyan("  3") +
        chalk.gray(") ") +
        chalk.white("Skip") +
        chalk.gray(" — set up later with /user"),
    );
    console.log();

    const choice = await this.askChoice("Pick an option (1/2/3): ", [
      "1",
      "2",
      "3",
    ]);

    if (choice === "3") {
      console.log(
        chalk.gray("  Skipped — run /user to set up your profile later."),
      );
      console.log();
      return;
    }

    if (choice === "1") {
      await this.setupGitHubProfile(teammatesDir);
    } else {
      await this.setupManualProfile(teammatesDir);
    }
  }

  /**
   * GitHub-based profile setup. Ensures gh is installed and authenticated,
   * then fetches user info from the GitHub API to create the profile.
   */
  private async setupGitHubProfile(teammatesDir: string): Promise<void> {
    console.log();

    // Step 1: Check if gh is installed
    let ghInstalled = false;
    try {
      execSync("gh --version", { stdio: "pipe" });
      ghInstalled = true;
    } catch {
      // not installed
    }

    if (!ghInstalled) {
      console.log(chalk.yellow("  GitHub CLI is not installed.\n"));

      const plat = process.platform;
      console.log(chalk.white("  Run this in another terminal:"));
      if (plat === "win32") {
        console.log(chalk.cyan("    winget install --id GitHub.cli"));
      } else if (plat === "darwin") {
        console.log(chalk.cyan("    brew install gh"));
      } else {
        console.log(chalk.cyan("    sudo apt install gh"));
        console.log(chalk.gray("    (or see https://cli.github.com)"));
      }
      console.log();

      const answer = await this.askChoice(
        "Press Enter when done, or s to skip: ",
        ["", "s", "S"],
      );
      if (answer.toLowerCase() === "s") {
        console.log(chalk.gray("  Falling back to manual setup.\n"));
        return this.setupManualProfile(teammatesDir);
      }

      // Re-check
      try {
        execSync("gh --version", { stdio: "pipe" });
        ghInstalled = true;
        console.log(chalk.green("  ✔  GitHub CLI installed"));
      } catch {
        console.log(
          chalk.yellow(
            "  GitHub CLI still not found. You may need to restart your terminal.",
          ),
        );
        console.log(chalk.gray("  Falling back to manual setup.\n"));
        return this.setupManualProfile(teammatesDir);
      }
    } else {
      console.log(chalk.green("  ✔  GitHub CLI installed"));
    }

    // Step 2: Check auth
    let authed = false;
    try {
      execSync("gh auth status", { stdio: "pipe" });
      authed = true;
    } catch {
      // not authenticated
    }

    if (!authed) {
      console.log();
      console.log(chalk.gray("  Authenticating with GitHub...\n"));

      const result = spawnSync(
        "gh",
        ["auth", "login", "--web", "--git-protocol", "https"],
        {
          stdio: "inherit",
          shell: true,
        },
      );

      if (result.status !== 0) {
        console.log(chalk.yellow("  Authentication failed or was cancelled."));
        console.log(chalk.gray("  Falling back to manual setup.\n"));
        return this.setupManualProfile(teammatesDir);
      }

      // Verify
      try {
        execSync("gh auth status", { stdio: "pipe" });
        authed = true;
      } catch {
        console.log(chalk.yellow("  Authentication could not be verified."));
        console.log(chalk.gray("  Falling back to manual setup.\n"));
        return this.setupManualProfile(teammatesDir);
      }
    }

    console.log(chalk.green("  ✔  GitHub authenticated"));

    // Step 3: Fetch user info from GitHub API
    let login = "";
    let name = "";
    try {
      const json = execSync("gh api user", {
        stdio: "pipe",
        encoding: "utf-8",
      });
      const user = JSON.parse(json);
      login = (user.login || "").toLowerCase().replace(/[^a-z0-9_-]/g, "");
      name = user.name || user.login || "";
    } catch {
      console.log(chalk.yellow("  Could not fetch GitHub user info."));
      console.log(chalk.gray("  Falling back to manual setup.\n"));
      return this.setupManualProfile(teammatesDir);
    }

    if (!login) {
      console.log(chalk.yellow("  No GitHub username found."));
      console.log(chalk.gray("  Falling back to manual setup.\n"));
      return this.setupManualProfile(teammatesDir);
    }

    console.log(
      chalk.green(`  ✔  Authenticated as `) +
        chalk.cyan(`@${login}`) +
        (name && name !== login ? chalk.gray(` (${name})`) : ""),
    );
    console.log();

    // Ask for remaining fields since GitHub doesn't provide them
    const role = await this.askInput(
      "Your role (optional, press Enter to skip): ",
    );
    const experience = await this.askInput(
      "Relevant experience (e.g., 10 years Go, new to React): ",
    );
    const preferences = await this.askInput(
      "How you like to work (e.g., terse responses): ",
    );
    // Auto-detect timezone
    const detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const timezone = await this.askInput(
      `Primary timezone${detectedTz ? ` [${detectedTz}]` : ""}: `,
    );

    const answers: Record<string, string> = {
      alias: login,
      name: name || login,
      role: role || "",
      experience: experience || "",
      preferences: preferences || "",
      timezone: timezone || detectedTz || "",
    };

    this.writeUserProfile(teammatesDir, login, answers);
    this.createUserAvatar(teammatesDir, login, answers);

    console.log(
      chalk.green("  ✔  ") + chalk.gray(`Profile created — avatar @${login}`),
    );
    console.log();
  }

  /**
   * Manual (console-based) profile setup. Collects fields via askInput().
   */
  private async setupManualProfile(teammatesDir: string): Promise<void> {
    console.log();
    console.log(
      chalk.gray("  (alias is required, press Enter to skip others)\n"),
    );

    const aliasRaw = await this.askInput("Your alias (e.g., alex): ");
    const alias = aliasRaw
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "")
      .trim();
    if (!alias) {
      console.log(
        chalk.yellow("  Alias is required. Run /user to try again.\n"),
      );
      return;
    }

    const name = await this.askInput("Your name: ");
    const role = await this.askInput(
      "Your role (e.g., senior backend engineer): ",
    );
    const experience = await this.askInput(
      "Relevant experience (e.g., 10 years Go, new to React): ",
    );
    const preferences = await this.askInput(
      "How you like to work (e.g., terse responses): ",
    );
    // Auto-detect timezone
    const detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const timezone = await this.askInput(
      `Primary timezone${detectedTz ? ` [${detectedTz}]` : ""}: `,
    );

    const answers: Record<string, string> = {
      alias,
      name,
      role,
      experience,
      preferences,
      timezone: timezone || detectedTz || "",
    };

    this.writeUserProfile(teammatesDir, alias, answers);
    this.createUserAvatar(teammatesDir, alias, answers);

    console.log();
    console.log(
      chalk.green("  ✔  ") + chalk.gray(`Profile created — avatar @${alias}`),
    );
    console.log(chalk.gray("  Update anytime with /user"));
    console.log();
  }

  /**
   * Write USER.md from collected answers.
   */
  private writeUserProfile(
    teammatesDir: string,
    alias: string,
    answers: Record<string, string>,
  ): void {
    const userMdPath = join(teammatesDir, "USER.md");
    const lines = ["# User\n"];
    lines.push(`- **Alias:** ${alias}`);
    lines.push(`- **Name:** ${answers.name || "_not provided_"}`);
    lines.push(`- **Role:** ${answers.role || "_not provided_"}`);
    lines.push(`- **Experience:** ${answers.experience || "_not provided_"}`);
    lines.push(`- **Preferences:** ${answers.preferences || "_not provided_"}`);
    lines.push(
      `- **Primary Timezone:** ${answers.timezone || "_not provided_"}`,
    );
    writeFileSync(userMdPath, `${lines.join("\n")}\n`, "utf-8");
  }

  /**
   * Create the user's avatar folder with SOUL.md and WISDOM.md.
   * The avatar is a teammate folder with type: human.
   */
  private createUserAvatar(
    teammatesDir: string,
    alias: string,
    answers: Record<string, string>,
  ): void {
    const avatarDir = join(teammatesDir, alias);
    const memoryDir = join(avatarDir, "memory");
    mkdirSync(avatarDir, { recursive: true });
    mkdirSync(memoryDir, { recursive: true });

    const name = answers.name || alias;
    const role = answers.role || "I'm a human working on this project";
    const experience = answers.experience || "";
    const preferences = answers.preferences || "";
    const timezone = answers.timezone || "";

    // Write SOUL.md
    const soulLines = [
      `# ${name}`,
      "",
      "## Identity",
      "",
      `**Type:** human`,
      `**Alias:** ${alias}`,
      `**Role:** ${role}`,
    ];
    if (experience) soulLines.push(`**Experience:** ${experience}`);
    if (preferences) soulLines.push(`**Preferences:** ${preferences}`);
    if (timezone) soulLines.push(`**Primary Timezone:** ${timezone}`);
    soulLines.push("");

    const soulPath = join(avatarDir, "SOUL.md");
    writeFileSync(soulPath, soulLines.join("\n"), "utf-8");

    // Write empty WISDOM.md
    const wisdomPath = join(avatarDir, "WISDOM.md");
    writeFileSync(
      wisdomPath,
      `# ${name} — Wisdom\n\nDistilled from work history. Updated during compaction.\n`,
      "utf-8",
    );

    // Avatar registration happens later in start() after the orchestrator is initialized.
    // During pre-TUI setup, the orchestrator doesn't exist yet.
  }

  /**
   * Read USER.md and extract the alias field.
   * Returns null if USER.md doesn't exist or has no alias.
   */
  private readUserAlias(teammatesDir: string): string | null {
    try {
      const content = readFileSync(join(teammatesDir, "USER.md"), "utf-8");
      const match = content.match(/\*\*Alias:\*\*\s*(\S+)/);
      return match ? match[1].toLowerCase().replace(/[^a-z0-9_-]/g, "") : null;
    } catch {
      return null;
    }
  }

  /**
   * Register the user's avatar as a teammate in the orchestrator.
   * Sets presence to "online" since the local user is always online.
   * Replaces the old coding agent entry.
   */
  private registerUserAvatar(teammatesDir: string, alias: string): void {
    const registry = this.orchestrator.getRegistry();
    const avatarDir = join(teammatesDir, alias);

    // Read the avatar's SOUL.md if it exists
    let soul = "";
    let role = "I'm a human working on this project";
    try {
      soul = readFileSync(join(avatarDir, "SOUL.md"), "utf-8");
      const roleMatch = soul.match(/\*\*Role:\*\*\s*(.+)/);
      if (roleMatch) role = roleMatch[1].trim();
    } catch {
      /* avatar folder may not exist yet */
    }

    let wisdom = "";
    try {
      wisdom = readFileSync(join(avatarDir, "WISDOM.md"), "utf-8");
    } catch {
      /* ok */
    }

    registry.register({
      name: alias,
      type: "human",
      role,
      soul,
      wisdom,
      dailyLogs: [],
      weeklyLogs: [],
      ownership: { primary: [], secondary: [] },
      routingKeywords: [],
    });

    // Set presence to online (local user is always online)
    this.orchestrator
      .getAllStatuses()
      .set(alias, { state: "idle", presence: "online" });

    // Update the adapter name so tasks route to the avatar
    this.userAlias = alias;
  }

  // ─── Display helpers ──────────────────────────────────────────────

  /**
   * Render the box logo with up to 4 info lines on the right side.
   */
  private printLogo(infoLines: string[]): void {
    const [top, bot] = buildTitle("teammates");
    console.log(`  ${chalk.cyan(top)}`);
    console.log(`  ${chalk.cyan(bot)}`);
    if (infoLines.length > 0) {
      console.log();
      for (const line of infoLines) {
        console.log(`  ${line}`);
      }
    }
  }

  /**
   * Print agent raw output, stripping the trailing JSON protocol block.
   */
  private printAgentOutput(rawOutput: string | undefined): void {
    const raw = rawOutput ?? "";
    if (!raw) return;
    const cleaned = raw
      .replace(/```json\s*\n\s*\{[\s\S]*?\}\s*\n\s*```\s*$/, "")
      .trim();
    if (cleaned) {
      this.feedMarkdown(cleaned);
    }
    this.feedLine();
  }

  // ─── Wordwheel ─────────────────────────────────────────────────────

  private getUniqueCommands(): SlashCommand[] {
    const seen = new Set<string>();
    const result: SlashCommand[] = [];
    for (const [, cmd] of this.commands) {
      if (seen.has(cmd.name)) continue;
      seen.add(cmd.name);
      result.push(cmd);
    }
    return result;
  }

  private clearWordwheel(): void {
    if (this.chatView) {
      this.chatView.hideDropdown();
      // Don't refreshView here — caller will either showDropdown + refresh,
      // or the next App render pass will pick up the cleared state.
    } else {
      this.input.clearDropdown();
    }
  }

  private writeWordwheel(lines: string[]): void {
    if (this.chatView) {
      // Lines are pre-formatted for PromptInput — convert to DropdownItems
      // This path is used for static usage hints; wordwheel items use showDropdown directly
      this.chatView.showDropdown(
        lines.map((l) => ({
          label: stripAnsi(l).trim(),
          description: "",
          completion: "",
        })),
      );
      this.refreshView();
    } else {
      this.input.setDropdown(lines);
    }
  }

  /**
   * Which argument positions are teammate-name completable per command.
   * Key = command name, value = set of 0-based arg positions that take a teammate.
   */
  private static readonly TEAMMATE_ARG_POSITIONS: Record<string, Set<number>> =
    {
      assign: new Set([0]),
      handoff: new Set([0, 1]),
      compact: new Set([0]),
      debug: new Set([0]),
      retro: new Set([0]),
    };

  /** Build param-completion items for the current line, if any. */
  private getParamItems(
    cmdName: string,
    argsBefore: string,
    partial: string,
  ): DropdownItem[] {
    // Service name completion for /configure
    if (cmdName === "configure" || cmdName === "config") {
      const completedArgs = argsBefore.trim()
        ? argsBefore.trim().split(/\s+/).length
        : 0;
      if (completedArgs > 0) return [];
      const lower = partial.toLowerCase();
      return TeammatesREPL.CONFIGURABLE_SERVICES.filter((s) =>
        s.startsWith(lower),
      ).map((s) => ({
        label: s,
        description: `configure ${s}`,
        completion: `/${cmdName} ${s} `,
      }));
    }

    const positions = TeammatesREPL.TEAMMATE_ARG_POSITIONS[cmdName];
    if (!positions) return [];

    // Count how many complete args precede the current partial
    const completedArgs = argsBefore.trim()
      ? argsBefore.trim().split(/\s+/).length
      : 0;
    if (!positions.has(completedArgs)) return [];

    const teammates = this.orchestrator.listTeammates();
    const lower = partial.toLowerCase();
    const items: DropdownItem[] = [];

    // Add "everyone" option at the top (only for first arg position)
    if (completedArgs === 0 && "everyone".startsWith(lower)) {
      const linePrefix = `/${cmdName} ${argsBefore ? argsBefore : ""}`;
      items.push({
        label: "everyone",
        description: "all teammates",
        completion: `${linePrefix}everyone `,
      });
    }

    for (const name of teammates) {
      if (!name.toLowerCase().startsWith(lower)) continue;
      const t = this.orchestrator.getRegistry().get(name);
      const linePrefix = `/${cmdName} ${argsBefore ? argsBefore : ""}`;
      items.push({
        label: name,
        description: t?.role ?? "",
        completion: `${linePrefix + name} `,
      });
    }
    return items;
  }

  /**
   * Return dim placeholder hint text for the current input value.
   * e.g. typing "/log" shows " <teammate>", typing "/log b" shows nothing.
   */
  private getCommandHint(value: string): string | null {
    const trimmed = value.trimStart();
    if (!trimmed.startsWith("/")) return null;

    // Extract command name and what's been typed after it
    const spaceIdx = trimmed.indexOf(" ");
    const cmdName =
      spaceIdx < 0 ? trimmed.slice(1) : trimmed.slice(1, spaceIdx);
    const cmd = this.commands.get(cmdName);
    if (!cmd) return null;

    // Extract placeholder tokens from usage (e.g. "/log [teammate]" → ["[teammate]"])
    const usageParts = cmd.usage.split(/\s+/).slice(1); // drop the "/command" part
    if (usageParts.length === 0) return null;

    // Count how many args the user has typed after the command
    const afterCmd = spaceIdx < 0 ? "" : trimmed.slice(spaceIdx + 1);
    const typedArgs = afterCmd
      .trim()
      .split(/\s+/)
      .filter((s) => s.length > 0);

    // Show remaining placeholders
    const remaining = usageParts.slice(typedArgs.length);
    if (remaining.length === 0) return null;

    // Add a leading space if the value doesn't already end with one
    const pad = value.endsWith(" ") ? "" : " ";
    return pad + remaining.join(" ");
  }

  /**
   * Find the @mention token the cursor is currently inside, if any.
   * Returns { before, partial, atPos } or null.
   */
  private findAtMention(
    line: string,
    cursor: number,
  ): { before: string; partial: string; atPos: number } | null {
    return findAtMention(line, cursor);
  }

  /** Build @mention teammate completion items. */
  private getAtMentionItems(
    line: string,
    before: string,
    partial: string,
    atPos: number,
  ): DropdownItem[] {
    const teammates = this.orchestrator.listTeammates();
    const lower = partial.toLowerCase();
    const after = line.slice(atPos + 1 + partial.length);
    const items: DropdownItem[] = [];

    // @everyone alias
    if ("everyone".startsWith(lower)) {
      items.push({
        label: "@everyone",
        description: "Send to all teammates",
        completion: `${before}@everyone ${after.replace(/^\s+/, "")}`,
      });
    }

    for (const name of teammates) {
      // For user avatar, display and match using the adapter name alias
      const display = name === this.userAlias ? this.adapterName : name;
      if (display.toLowerCase().startsWith(lower)) {
        const t = this.orchestrator.getRegistry().get(name);
        items.push({
          label: `@${display}`,
          description: t?.role ?? "",
          completion: `${before}@${display} ${after.replace(/^\s+/, "")}`,
        });
      }
    }
    return items;
  }

  /** Recompute matches and draw the wordwheel. */
  private updateWordwheel(): void {
    this.clearWordwheel();
    const line: string = this.chatView
      ? this.chatView.inputValue
      : this.input.line;
    const cursor: number = this.chatView
      ? this.chatView.inputValue.length
      : this.input.cursor;

    // ── @mention anywhere in the line ──────────────────────────────
    const mention = this.findAtMention(line, cursor);
    if (mention) {
      this.wordwheelItems = this.getAtMentionItems(
        line,
        mention.before,
        mention.partial,
        mention.atPos,
      );
      if (this.wordwheelItems.length > 0) {
        if (this.wordwheelIndex >= this.wordwheelItems.length) {
          this.wordwheelIndex = this.wordwheelItems.length - 1;
        }
        this.renderItems();
        return;
      }
    }

    // ── /command completion ─────────────────────────────────────────
    if (!line.startsWith("/") || line.length < 2) {
      this.wordwheelItems = [];
      this.wordwheelIndex = -1;
      return;
    }

    const spaceIdx = line.indexOf(" ");

    if (spaceIdx > 0) {
      // Command is known — check for param completions
      const cmdName = line.slice(1, spaceIdx);
      const cmd = this.commands.get(cmdName);
      if (!cmd) {
        this.wordwheelItems = [];
        this.wordwheelIndex = -1;
        return;
      }

      const afterCmd = line.slice(spaceIdx + 1);
      // Split into completed args + current partial token
      const lastSpace = afterCmd.lastIndexOf(" ");
      const argsBefore = lastSpace >= 0 ? afterCmd.slice(0, lastSpace + 1) : "";
      const partial = lastSpace >= 0 ? afterCmd.slice(lastSpace + 1) : afterCmd;

      this.wordwheelItems = this.getParamItems(cmdName, argsBefore, partial);

      if (this.wordwheelItems.length > 0) {
        if (this.wordwheelIndex >= this.wordwheelItems.length) {
          this.wordwheelIndex = this.wordwheelItems.length - 1;
        }
        this.renderItems();
      } else {
        // No param completions — hide dropdown
        this.wordwheelItems = [];
        this.wordwheelIndex = -1;
      }
      return;
    }

    // Partial command — find matching commands
    const partial = line.slice(1).toLowerCase();
    this.wordwheelItems = this.getUniqueCommands()
      .filter(
        (c) =>
          c.name.startsWith(partial) ||
          c.aliases.some((a) => a.startsWith(partial)),
      )
      .map((c) => {
        const hasParams = /^\/\S+\s+.+$/.test(c.usage);
        return {
          label: `/${c.name}`,
          description: c.description,
          completion: hasParams ? `/${c.name} ` : `/${c.name}`,
        };
      });

    if (this.wordwheelItems.length === 0) {
      this.wordwheelIndex = -1;
      return;
    }

    if (this.wordwheelIndex >= this.wordwheelItems.length) {
      this.wordwheelIndex = this.wordwheelItems.length - 1;
    }

    this.renderItems();
  }

  /** Render the current wordwheelItems list with selection highlight. */
  private renderItems(): void {
    if (this.chatView) {
      this.chatView.showDropdown(this.wordwheelItems);
      // Sync selection index
      if (this.wordwheelIndex >= 0) {
        while (this.chatView.dropdownIndex < this.wordwheelIndex)
          this.chatView.dropdownDown();
        while (this.chatView.dropdownIndex > this.wordwheelIndex)
          this.chatView.dropdownUp();
      }
      this.refreshView();
    } else {
      this.writeWordwheel(
        this.wordwheelItems.map((item, i) => {
          const prefix = i === this.wordwheelIndex ? chalk.cyan("▸ ") : "  ";
          const label = item.label.padEnd(14);
          if (i === this.wordwheelIndex) {
            return (
              prefix +
              chalk.cyanBright.bold(label) +
              " " +
              chalk.white(item.description)
            );
          }
          return `${prefix + chalk.cyan(label)} ${chalk.gray(item.description)}`;
        }),
      );
    }
  }

  /** Accept the currently highlighted item into the input line. */
  private acceptWordwheelSelection(): void {
    const item = this.wordwheelItems[this.wordwheelIndex];
    if (!item) return;
    this.clearWordwheel();
    if (this.chatView) {
      this.chatView.inputValue = item.completion;
    } else {
      this.input.setLine(item.completion);
    }
    this.wordwheelItems = [];
    this.wordwheelIndex = -1;
    // Re-render for next param or usage hint
    this.updateWordwheel();
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

    this.serviceStatuses = this.detectServices();

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
        tp.dim(TeammatesREPL.truncatePath(dirname(this.teammatesDir))),
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
      tp.dim(TeammatesREPL.truncatePath(dirname(this.teammatesDir))),
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
        this.chatView.setFooterRight(this.defaultFooterRight!);
        this.refreshView();
      }
      if (this.ctrlcPending) {
        this.ctrlcPending = false;
        if (this.ctrlcTimer) {
          clearTimeout(this.ctrlcTimer);
          this.ctrlcTimer = null;
        }
        this.chatView.setFooter(this.defaultFooter!);
        this.chatView.setFooterRight(this.defaultFooterRight!);
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
        this.chatView.setFooterRight(this.defaultFooterRight!);
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
            this.chatView.setFooterRight(this.defaultFooterRight!);
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
        this.chatView.setFooterRight(this.defaultFooterRight!);

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
          this.chatView.setFooterRight(this.defaultFooterRight!);
          this.refreshView();
        }
      }, 2000);
    });
    this.chatView.on("action", (id: string) => {
      if (id.startsWith("copy-cmd:")) {
        this.doCopy(id.slice("copy-cmd:".length));
      } else if (id === "copy") {
        this.doCopy(this.lastCleanedOutput || undefined);
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
          this.chatView.inputValue = `@${ctx.teammate} [quoted reply] `;
          this._pendingQuotedReply = ctx.message;
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
    // Pass pre-resolved mentions so @mentions inside expanded paste text are ignored.
    this.conversationHistory.push({ role: this.selfName, text: input });
    this.printUserMessage(input);
    this.queueTask(input, preMentions);
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

  // ─── Service detection ────────────────────────────────────────────

  private detectGitHub(): ServiceStatus {
    try {
      execSync("gh --version", { stdio: "pipe" });
    } catch {
      return "missing";
    }
    try {
      execSync("gh auth status", { stdio: "pipe" });
      return "configured";
    } catch {
      return "not-configured";
    }
  }

  private detectServices(): ServiceInfo[] {
    return [
      { name: "recall", status: "bundled" },
      { name: "GitHub", status: this.detectGitHub() },
    ];
  }

  // ─── /configure command ─────────────────────────────────────────

  private static readonly CONFIGURABLE_SERVICES = ["github"];

  private async cmdConfigure(argsStr: string): Promise<void> {
    const serviceName = argsStr.trim().toLowerCase();

    if (!serviceName) {
      // Show status table
      this.feedLine();
      this.feedLine(tp.bold("  Services:"));
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
                ? "not configured"
                : "missing";
        this.feedLine(
          concat(
            tp.text("    "),
            color(icon),
            color(svc.name.padEnd(12)),
            tp.muted(label),
          ),
        );
      }
      this.feedLine();
      this.feedLine(tp.muted("  Use /configure [service] to set up a service"));
      this.feedLine();
      this.refreshView();
      return;
    }

    if (serviceName === "github") {
      await this.configureGitHub();
    } else {
      this.feedLine(tp.warning(`  Unknown service: ${serviceName}`));
      this.feedLine(
        tp.muted(
          `  Available: ${TeammatesREPL.CONFIGURABLE_SERVICES.join(", ")}`,
        ),
      );
      this.refreshView();
    }
  }

  private async configureGitHub(): Promise<void> {
    // Step 1: Check if gh is installed
    let ghInstalled = false;
    try {
      execSync("gh --version", { stdio: "pipe" });
      ghInstalled = true;
    } catch {
      // not installed
    }

    if (!ghInstalled) {
      this.feedLine();
      this.feedLine(tp.warning("  GitHub CLI is not installed."));
      this.feedLine();

      const plat = process.platform;
      this.feedLine(tp.text("  Run this in another terminal:"));
      if (plat === "win32") {
        this.feedCommand("winget install --id GitHub.cli");
      } else if (plat === "darwin") {
        this.feedCommand("brew install gh");
      } else {
        this.feedCommand("sudo apt install gh");
        this.feedLine(tp.muted("    (or see https://cli.github.com)"));
      }

      this.feedLine();
      const answer = await this.askInline(
        "Press Enter when done (or n to skip)",
      );
      if (answer.toLowerCase() === "n") {
        this.feedLine(tp.muted("  Skipped. Run /configure github when ready."));
        this.refreshView();
        return;
      }

      // Re-check
      try {
        execSync("gh --version", { stdio: "pipe" });
        ghInstalled = true;
        this.feedLine(tp.success("  ✓ GitHub CLI installed"));
      } catch {
        this.feedLine(
          tp.error(
            "  GitHub CLI still not found. You may need to restart your terminal.",
          ),
        );
        this.refreshView();
        return;
      }
    } else {
      this.feedLine();
      this.feedLine(tp.success("  ✓ GitHub CLI installed"));
    }

    // Step 2: Check auth
    let authed = false;
    try {
      execSync("gh auth status", { stdio: "pipe" });
      authed = true;
    } catch {
      // not authenticated
    }

    if (!authed) {
      this.feedLine();
      this.feedLine(tp.text("  Run this in another terminal to authenticate:"));
      this.feedCommand("gh auth login --web --git-protocol https");
      this.feedLine();
      this.feedLine(
        tp.muted("  This will open your browser for GitHub OAuth."),
      );
      this.feedLine();

      const answer = await this.askInline(
        "Press Enter when done (or n to skip)",
      );
      if (answer.toLowerCase() === "n") {
        this.feedLine(tp.muted("  Skipped. Run /configure github when ready."));
        this.refreshView();
        this.updateServiceStatus("GitHub", "not-configured");
        return;
      }

      // Verify
      try {
        execSync("gh auth status", { stdio: "pipe" });
        authed = true;
      } catch {
        this.feedLine(
          tp.error(
            "  Authentication could not be verified. Try again with /configure github",
          ),
        );
        this.refreshView();
        this.updateServiceStatus("GitHub", "not-configured");
        return;
      }
    }

    // Get username for confirmation
    let username = "";
    try {
      username = execSync("gh api user --jq .login", {
        stdio: "pipe",
        encoding: "utf-8",
      }).trim();
    } catch {
      // non-critical
    }

    this.feedLine(
      tp.success(
        `  ✓ GitHub configured${username ? ` — authenticated as @${username}` : ""}`,
      ),
    );
    this.feedLine();
    this.refreshView();
    this.updateServiceStatus("GitHub", "configured");
  }

  private updateServiceStatus(name: string, status: ServiceStatus): void {
    const svc = this.serviceStatuses.find((s) => s.name === name);
    if (svc) {
      svc.status = status;
      if (this.banner) {
        this.banner.updateServices(this.serviceStatuses);
        this.refreshView();
      }
    }
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
        run: (args) => this.cmdConfigure(args),
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

        // Track this task and start the animated status bar
        const key = event.assignment.teammate;
        this.activeTasks.set(key, {
          teammate: event.assignment.teammate,
          task: event.assignment.task,
          startTime: Date.now(),
        });
        this.startStatusAnimation();
        break;
      }

      case "task_completed": {
        // System task completions — don't touch activeTasks (was never added)
        if (event.result.system) break;

        // Remove from active tasks and stop spinner.
        // Result display is deferred to drainAgentQueue() so the defensive
        // retry can update rawOutput before anything is shown to the user.
        this.activeTasks.delete(event.result.teammate);

        // Stop animation if no more active tasks
        if (this.activeTasks.size === 0) {
          this.stopStatusAnimation();
        }
        break;
      }

      case "error": {
        this.activeTasks.delete(event.teammate);
        if (this.activeTasks.size === 0) this.stopStatusAnimation();
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
    const debugFile = this.lastDebugFiles.get(teammate);
    const lastPrompt = this.lastTaskPrompts.get(teammate);

    if (!debugFile) {
      this.feedLine(tp.muted(`  No debug log available for @${teammate}.`));
      this.refreshView();
      return;
    }

    // Read the debug log file
    let debugContent: string;
    try {
      debugContent = readFileSync(debugFile, "utf-8");
    } catch {
      this.feedLine(tp.muted(`  Could not read debug log: ${debugFile}`));
      this.refreshView();
      return;
    }

    const focusLine = debugFocus
      ? `\n\n**Focus your analysis on:** ${debugFocus}`
      : "";

    const analysisPrompt = [
      `Analyze the following debug log from @${teammate}'s last task execution. Identify any issues, errors, or anomalies. If the response was empty, explain likely causes. Provide a concise diagnosis and suggest fixes if applicable.${focusLine}`,
      "",
      "## Last Request Sent to Agent",
      "",
      lastPrompt ?? "(not available)",
      "",
      "## Debug Log",
      "",
      debugContent,
    ].join("\n");

    // Show the debug log path — ctrl+click to open
    this.feedLine(concat(tp.muted("  Debug log: "), tp.accent(debugFile)));
    if (debugFocus) {
      this.feedLine(tp.muted(`  Focus: ${debugFocus}`));
    }
    this.feedLine(tp.muted("  Queuing analysis…"));
    this.refreshView();

    this.taskQueue.push({
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

  /** Drain user tasks for a single agent — runs in parallel with other agents.
   *  System tasks are handled separately by runSystemTask(). */
  private async drainAgentQueue(agent: string): Promise<void> {
    while (true) {
      const idx = this.taskQueue.findIndex(
        (e) => e.teammate === agent && !this.isSystemTask(e),
      );
      if (idx < 0) break;

      const entry = this.taskQueue.splice(idx, 1)[0];
      this.agentActive.set(agent, entry);

      const startTime = Date.now();
      try {
        {
          // btw and debug tasks skip conversation context (not part of main thread)
          const extraContext =
            entry.type === "btw" || entry.type === "debug"
              ? ""
              : this.buildConversationContext();
          let result = await this.orchestrator.assign({
            teammate: entry.teammate,
            task: entry.task,
            extraContext: extraContext || undefined,
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

          // Display the (possibly retried) result to the user
          this.displayTaskResult(result, entry.type);

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
        this.activeTasks.delete(agent);
        if (this.activeTasks.size === 0) this.stopStatusAnimation();
        const msg = err?.message ?? String(err);
        const displayAgent = agent === this.selfName ? this.adapterName : agent;
        this.feedLine(tp.error(`  ✖  @${displayAgent}: ${msg}`));
        this.refreshView();
      }

      this.agentActive.delete(agent);
    }
  }

  /**
   * Write a debug log file to .teammates/.tmp/debug/ for the task.
   * Each task gets its own file. The path is stored in lastDebugFiles for /debug.
   */
  private writeDebugEntry(
    teammate: string,
    task: string,
    result: TaskResult | null,
    startTime: number,
    error?: any,
  ): void {
    try {
      const debugDir = join(this.teammatesDir, ".tmp", "debug");
      try {
        mkdirSync(debugDir, { recursive: true });
      } catch {
        return;
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const timestamp = new Date().toISOString();
      const ts = timestamp.replace(/[:.]/g, "-");
      const debugFile = join(debugDir, `${teammate}-${ts}.md`);

      const lines: string[] = [
        `# Debug — ${teammate}`,
        "",
        `**Timestamp:** ${timestamp}`,
        `**Duration:** ${elapsed}s`,
        "",
        "## Request",
        "",
        task,
        "",
      ];

      // Include the full prompt sent to the agent (with identity, memory, etc.)
      const fullPrompt = result?.fullPrompt;
      if (fullPrompt) {
        lines.push("## Full Prompt");
        lines.push("");
        lines.push(fullPrompt);
        lines.push("");
      }

      if (error) {
        lines.push("## Result");
        lines.push("");
        lines.push(`**Status:** ERROR`);
        lines.push(`**Error:** ${error?.message ?? String(error)}`);
      } else if (result) {
        lines.push("## Result");
        lines.push("");
        lines.push(`**Status:** ${result.success ? "OK" : "FAILED"}`);
        lines.push(`**Summary:** ${result.summary || "(no summary)"}`);
        if (result.changedFiles.length > 0) {
          lines.push(`**Changed files:** ${result.changedFiles.join(", ")}`);
        }
        if (result.handoffs.length > 0) {
          lines.push(
            `**Handoffs:** ${result.handoffs.map((h) => `@${h.to}`).join(", ")}`,
          );
        }

        // Process diagnostics — exit code, signal, stderr
        const diag = result.diagnostics;
        if (diag) {
          lines.push("");
          lines.push("### Process");
          lines.push(`**Exit code:** ${diag.exitCode ?? "(killed by signal)"}`);
          if (diag.signal) lines.push(`**Signal:** ${diag.signal}`);
          if (diag.timedOut) lines.push(`**Timed out:** yes`);
          if (diag.debugFile) {
            lines.push(`**Agent debug log:** ${diag.debugFile}`);
            // Inline Claude's debug file content if it exists
            try {
              const agentDebugContent = readFileSync(diag.debugFile, "utf-8");
              lines.push("");
              lines.push("### Agent Debug Log");
              lines.push("");
              lines.push(agentDebugContent);
            } catch {
              /* debug file may not exist yet or be unreadable */
            }
          }

          if (diag.stderr.trim()) {
            lines.push("");
            lines.push("### stderr");
            lines.push("");
            lines.push(diag.stderr);
          }
        }

        lines.push("");
        lines.push("### Raw Output");
        lines.push("");
        lines.push(result.rawOutput ?? "(empty)");
      }

      lines.push("");
      writeFileSync(debugFile, lines.join("\n"), "utf-8");
      this.lastDebugFiles.set(teammate, debugFile);
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
    this.pendingRetroProposals = [];
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
      this.chatView.setProgress(`Compacting ${name}...`);
      this.refreshView();
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

      if (!silent && this.chatView) this.chatView.setProgress(null);

      // Sync recall index for this teammate (bundled library call)
      try {
        if (!silent && this.chatView) {
          this.chatView.setProgress(`Syncing ${name} index...`);
          this.refreshView();
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
        if (this.chatView) {
          if (!silent) this.chatView.setProgress(null);
          if (!silent) this.feedLine(tp.success(`  ✔  ${name}: index synced`));
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
        if (!silent) this.chatView.setProgress(null);
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
      this.taskQueue.push({ type: "retro", teammate: name, task: retroPrompt });
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
        // recreated concurrently (sessions by startSession, debug by writeDebugEntry).
        if (entry.name !== "sessions" && entry.name !== "debug") {
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

    // 1. Run compaction for all teammates (auto-compact + episodic + sync + wisdom)
    //    Progress bar shows status; feed only shows lines when actual work is done
    for (const name of teammates) {
      await this.runCompact(name, true);
    }

    // 2. Purge daily logs older than 30 days (disk + Vectra)
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

    // 3. Sync recall indexes (bundled library call)
    try {
      await syncRecallIndex(this.teammatesDir);
    } catch {
      /* sync failed — non-fatal */
    }
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
      // Show brief "Copied" message in the progress area
      if (this.chatView) {
        this.chatView.setProgress(
          concat(tp.success("✔  "), tp.muted("Copied to clipboard")),
        );
        this.refreshView();
        setTimeout(() => {
          this.chatView.setProgress(null);
          this.refreshView();
        }, 1500);
      }
    } catch {
      if (this.chatView) {
        this.chatView.setProgress(
          concat(tp.error("✖  "), tp.muted("Failed to copy")),
        );
        this.refreshView();
        setTimeout(() => {
          this.chatView.setProgress(null);
          this.refreshView();
        }, 1500);
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
    this.taskQueue.push({ type: "agent", teammate: this.selfName, task });
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
