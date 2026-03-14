#!/usr/bin/env node

/**
 * @teammates/cli — Interactive teammate orchestrator.
 *
 * Start a session:
 *   teammates                     Launch interactive REPL
 *   teammates --adapter codex     Use a specific agent adapter
 *   teammates --dir <path>        Override .teammates/ location
 */

import { createInterface } from "node:readline";
import { resolve, join } from "node:path";
import { stat, mkdir, readdir } from "node:fs/promises";
import { execSync, exec as execCb, spawn as cpSpawn, type ChildProcess } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";

const execAsync = promisify(execCb);
import chalk from "chalk";
import ora, { type Ora } from "ora";
import { Orchestrator } from "./orchestrator.js";
import type { AgentAdapter } from "./adapter.js";
import type { OrchestratorEvent, HandoffEnvelope, TaskResult } from "./types.js";
import { EchoAdapter } from "./adapters/echo.js";
import { CliProxyAdapter, PRESETS } from "./adapters/cli-proxy.js";
import {
  esc, stripAnsi, App, ChatView, type DropdownItem,
  pen, concat, type StyledSpan,
  StyledText, type StyledLine,
  Control, type DrawingContext, type Constraint, type Size, type Rect,
  color,
  CYAN, GREEN, YELLOW, RED, GRAY, WHITE, BLUE,
  type Color,
  renderMarkdown,
} from "@teammates/consolonia";
import { theme, colorToHex, type Theme } from "./theme.js";
import { PromptInput } from "./console/prompt-input.js";
import { renderMarkdownTables } from "./console/markdown-table.js";
import { buildTitle } from "./console/startup.js";
import { getOnboardingPrompt, copyTemplateFiles } from "./onboard.js";
import { compactEpisodic } from "./compact.js";

// ─── Argument parsing ────────────────────────────────────────────────

const args = process.argv.slice(2);

function getFlag(name: string): boolean {
  const idx = args.indexOf(`--${name}`);
  if (idx >= 0) { args.splice(idx, 1); return true; }
  return false;
}

function getOption(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < args.length) {
    const val = args[idx + 1];
    args.splice(idx, 2);
    return val;
  }
  return undefined;
}

const showHelp = getFlag("help");
const modelOverride = getOption("model");
const dirOverride = getOption("dir");
// First remaining positional arg is the agent name (default: echo)
const adapterName = args.shift() ?? "echo";
// Everything left passes through to the agent CLI
const agentPassthrough = [...args];
args.length = 0;

// ─── Helpers ─────────────────────────────────────────────────────────

async function findTeammatesDir(): Promise<string | null> {
  if (dirOverride) return resolve(dirOverride);
  let dir = process.cwd();
  while (true) {
    const candidate = join(dir, ".teammates");
    try {
      const s = await stat(candidate);
      if (s.isDirectory()) return candidate;
    } catch { /* keep looking */ }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function resolveAdapter(name: string): AgentAdapter {
  if (name === "echo") return new EchoAdapter();

  // All other adapters go through the CLI proxy
  if (PRESETS[name]) {
    return new CliProxyAdapter({
      preset: name,
      model: modelOverride,
      extraFlags: agentPassthrough,
    });
  }

  const available = ["echo", ...Object.keys(PRESETS)].join(", ");
  console.error(chalk.red(`Unknown adapter: ${name}`));
  console.error(`Available adapters: ${available}`);
  process.exit(1);
}

function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

// ─── Service registry ────────────────────────────────────────────────

interface ServiceEntry {
  /** npm package to install globally */
  package: string;
  /** Command to verify the service binary exists */
  checkCmd: string[];
  /** Command to build the initial index after install */
  indexCmd?: string[];
  /** Human-readable description */
  description: string;
  /** Task to give the coding agent after install to wire the service into the project */
  wireupTask?: string;
}

/** A task queue entry — either an agent task or an internal operation. */
type QueueEntry =
  | { type: "agent"; teammate: string; task: string }
  | { type: "compact"; teammate: string; task: string };

const SERVICE_REGISTRY: Record<string, ServiceEntry> = {
  recall: {
    package: "@teammates/recall",
    checkCmd: ["teammates-recall", "--help"],
    indexCmd: ["teammates-recall", "index"],
    description: "Local semantic search for teammate memory",
    wireupTask: [
      "The `teammates-recall` service was just installed globally.",
      "Wire it up so every teammate knows it's available:",
      "",
      "1. Verify `teammates-recall --help` works. If it does, great. If not, figure out the correct path to the binary (check recall/package.json bin field) and note it.",
      "2. Read .teammates/PROTOCOL.md and .teammates/CROSS-TEAM.md.",
      "3. If recall is not already documented there, add a short section explaining that `teammates-recall` is now available for semantic memory search, with basic usage (e.g. `teammates-recall search \"query\"`).",
      "4. Check each teammate's SOUL.md (under .teammates/*/SOUL.md). If a teammate's role involves memory or search, note in their SOUL.md that recall is installed and available.",
      "5. Do NOT modify code files — only update .teammates/ markdown files.",
    ].join("\n"),
  },
};

// ─── Slash commands ──────────────────────────────────────────────────

interface SlashCommand {
  name: string;
  aliases: string[];
  usage: string;
  description: string;
  run: (args: string) => Promise<void>;
}

// WordwheelItem is now DropdownItem from @teammates/consolonia

// ── Themed pen shortcuts ────────────────────────────────────────────
//
// Thin wrappers that read from the active theme() at call time, so
// every styled span picks up the current palette automatically.

const tp = {
  accent:    (s: string) => pen.fg(theme().accent)(s),
  accentBright: (s: string) => pen.fg(theme().accentBright)(s),
  accentDim: (s: string) => pen.fg(theme().accentDim)(s),
  text:      (s: string) => pen.fg(theme().text)(s),
  muted:     (s: string) => pen.fg(theme().textMuted)(s),
  dim:       (s: string) => pen.fg(theme().textDim)(s),
  success:   (s: string) => pen.fg(theme().success)(s),
  warning:   (s: string) => pen.fg(theme().warning)(s),
  error:     (s: string) => pen.fg(theme().error)(s),
  info:      (s: string) => pen.fg(theme().info)(s),
  bold:      (s: string) => pen.bold.fg(theme().text)(s),
};

// ─── Animated banner widget ─────────────────────────────────────────

interface BannerInfo {
  adapterName: string;
  teammateCount: number;
  cwd: string;
  recallInstalled: boolean;
  teammates: { name: string; role: string }[];
}

/**
 * Custom banner widget that plays a reveal animation inside the
 * consolonia rendering loop (alternate screen already active).
 *
 * Phases:
 *  1. Reveal "teammates" letter by letter in block font
 *  2. Collapse to "TM" + stats panel
 *  3. Fade in teammate roster
 *  4. Fade in command reference
 */
class AnimatedBanner extends Control {
  private _lines: StyledLine[] = [];
  private _info: BannerInfo;
  private _phase: "idle" | "spelling" | "pause" | "compact" | "roster" | "commands" | "done" = "idle";
  private _inner: StyledText;
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _onDirty: (() => void) | null = null;

  // Spelling state
  private _word = "teammates";
  private _charIndex = 0;
  private _builtTop = "";
  private _builtBot = "";

  // Roster/command reveal state
  private _revealIndex = 0;

  // The final lines (built once, revealed progressively)
  private _finalLines: StyledLine[] = [];

  // Line index where roster starts and commands start
  private _rosterStart = 0;
  private _commandsStart = 0;

  private static GLYPHS: Record<string, [string, string]> = {
    t: ["▀█▀", " █ "],
    e: ["█▀▀", "██▄"],
    a: ["▄▀█", "█▀█"],
    m: ["█▀▄▀█", "█ ▀ █"],
    s: ["█▀", "▄█"],
  };

  constructor(info: BannerInfo) {
    super();
    this._info = info;
    this._inner = new StyledText({ lines: [], wrap: true });
    this.addChild(this._inner);
    this._buildFinalLines();
  }

  /** Set a callback that fires when the banner needs a re-render. */
  set onDirty(fn: () => void) {
    this._onDirty = fn;
  }

  /** Start the animation sequence. */
  start(): void {
    this._phase = "spelling";
    this._charIndex = 0;
    this._builtTop = "";
    this._builtBot = "";
    this._tick();
  }

  private _buildFinalLines(): void {
    const info = this._info;
    const [tmTop, tmBot] = buildTitle("tm");
    const tmPad = " ".repeat(tmTop.length);
    const gap = "   ";

    const lines: StyledLine[] = [];

    // TM logo row 1 + adapter info
    lines.push(concat(
      tp.accent(tmTop), tp.text(gap + info.adapterName),
      tp.muted(` · ${info.teammateCount} teammate${info.teammateCount === 1 ? "" : "s"}`),
      tp.muted(" · v0.1.0"),
    ));
    // TM logo row 2 + cwd
    lines.push(concat(tp.accent(tmBot), tp.muted(gap + info.cwd)));
    // Recall status (indented to align with info above)
    lines.push(info.recallInstalled
      ? concat(tp.text(tmPad + gap), tp.success("● "), tp.success("recall"), tp.muted(" installed"))
      : concat(tp.text(tmPad + gap), tp.warning("○ "), tp.warning("recall"), tp.muted(" not installed")),
    );

    // blank
    lines.push("");
    this._rosterStart = lines.length;

    // Teammate roster
    for (const t of info.teammates) {
      lines.push(concat(
        tp.accent("  ● "),
        tp.accent(`@${t.name}`.padEnd(14)),
        tp.muted(t.role),
      ));
    }

    // blank
    lines.push("");
    this._commandsStart = lines.length;

    // Command reference
    const col1 = [
      ["@mention", "assign to teammate"],
      ["text", "auto-route task"],
      ["/queue", "view task queue"],
    ];
    const col2 = [
      ["/status", "session overview"],
      ["/debug", "raw agent output"],
      ["/log", "last task output"],
    ];
    const col3 = [
      ["/install", "add a service"],
      ["/help", "all commands"],
      ["/exit", "exit session"],
    ];
    for (let i = 0; i < col1.length; i++) {
      lines.push(concat(
        tp.accent("  " + col1[i][0].padEnd(12)), tp.muted(col1[i][1].padEnd(22)),
        tp.accent(col2[i][0].padEnd(12)), tp.muted(col2[i][1].padEnd(22)),
        tp.accent(col3[i][0].padEnd(12)), tp.muted(col3[i][1]),
      ));
    }

    this._finalLines = lines;
  }

  private _tick(): void {
    switch (this._phase) {
      case "spelling": {
        const ch = this._word[this._charIndex];
        const g = AnimatedBanner.GLYPHS[ch];
        if (g) {
          if (this._builtTop.length > 0) {
            this._builtTop += " ";
            this._builtBot += " ";
          }
          this._builtTop += g[0];
          this._builtBot += g[1];
        }
        this._lines = [
          concat(tp.accent(this._builtTop)),
          concat(tp.accent(this._builtBot)),
        ];
        this._apply();
        this._charIndex++;
        if (this._charIndex >= this._word.length) {
          this._phase = "pause";
          this._schedule(800);
        } else {
          this._schedule(60);
        }
        break;
      }

      case "pause": {
        // Show version briefly on the spelled-out word
        this._lines = [
          concat(tp.accent(this._builtTop)),
          concat(tp.accent(this._builtBot), tp.muted(" v0.1.0")),
        ];
        this._apply();
        this._phase = "compact";
        this._schedule(1200);
        break;
      }

      case "compact": {
        // Switch to TM + stats — show first 4 lines of final
        this._lines = this._finalLines.slice(0, 4);
        this._apply();
        this._phase = "roster";
        this._revealIndex = 0;
        this._schedule(80);
        break;
      }

      case "roster": {
        // Reveal roster lines one at a time
        const end = this._rosterStart + this._revealIndex + 1;
        this._lines = [
          ...this._finalLines.slice(0, this._rosterStart),
          ...this._finalLines.slice(this._rosterStart, end),
        ];
        this._apply();
        this._revealIndex++;
        const rosterCount = this._commandsStart - 1 - this._rosterStart; // -1 for blank line
        if (this._revealIndex >= rosterCount) {
          this._phase = "commands";
          this._revealIndex = 0;
          this._schedule(80);
        } else {
          this._schedule(40);
        }
        break;
      }

      case "commands": {
        // Add the blank line between roster and commands, then reveal commands
        const rosterEnd = this._commandsStart; // includes the blank line
        const cmdEnd = this._commandsStart + this._revealIndex + 1;
        this._lines = [
          ...this._finalLines.slice(0, rosterEnd),
          ...this._finalLines.slice(this._commandsStart, cmdEnd),
        ];
        this._apply();
        this._revealIndex++;
        const cmdCount = this._finalLines.length - this._commandsStart;
        if (this._revealIndex >= cmdCount) {
          this._phase = "done";
        } else {
          this._schedule(30);
        }
        break;
      }
    }
  }

  private _apply(): void {
    this._inner.lines = this._lines;
    this.invalidate();
    if (this._onDirty) this._onDirty();
  }

  private _schedule(ms: number): void {
    this._timer = setTimeout(() => {
      this._timer = null;
      this._tick();
    }, ms);
  }

  /** Cancel any pending animation timer. */
  dispose(): void {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  // ── Layout delegation ───────────────────────────────────────────

  override measure(constraint: Constraint): Size {
    const size = this._inner.measure(constraint);
    this.desiredSize = size;
    return size;
  }

  override arrange(rect: Rect): void {
    this.bounds = rect;
    this._inner.arrange(rect);
  }

  override render(ctx: DrawingContext): void {
    this._inner.render(ctx);
  }
}

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

  private storeResult(result: TaskResult): void {
    this.lastResult = result;
    this.lastResults.set(result.teammate, result);
    this.conversationHistory.push({
      role: result.teammate,
      text: result.rawOutput ?? result.summary,
    });
  }

  private buildConversationContext(): string {
    if (this.conversationHistory.length === 0) return "";
    // Keep last 10 exchanges to avoid blowing up prompt size
    const recent = this.conversationHistory.slice(-10);
    const lines = ["## Conversation History\n"];
    for (const entry of recent) {
      lines.push(`**${entry.role}:** ${entry.text}\n`);
    }
    return lines.join("\n");
  }
  private adapterName: string;
  private teammatesDir!: string;
  private recallWatchProcess: ChildProcess | null = null;
  private taskQueue: QueueEntry[] = [];
  private queueActive: QueueEntry | null = null;
  private queueDraining = false;
  /** Mutex to prevent concurrent drainQueue invocations. Resolves when drain finishes. */
  private drainLock: Promise<void> | null = null;
  /** True while a task is being dispatched — prevents concurrent dispatches from pasted text. */
  private dispatching = false;
  /** Stored pasted text keyed by paste number, expanded on Enter. */
  private pastedTexts: Map<number, string> = new Map();
  private pasteCounter = 0;
  private wordwheelItems: DropdownItem[] = [];
  private wordwheelIndex = -1;        // -1 = no selection, 0+ = highlighted row
  private escPending = false;         // true after first ESC, waiting for second
  private escTimer: ReturnType<typeof setTimeout> | null = null;
  private ctrlcPending = false;      // true after first Ctrl+C, waiting for second
  private ctrlcTimer: ReturnType<typeof setTimeout> | null = null;
  private defaultFooter: StyledSpan | null = null; // cached default footer content

  // ── Animated status tracker ─────────────────────────────────────
  private activeTasks: Map<string, { teammate: string; task: string }> = new Map();
  private statusTimer: ReturnType<typeof setInterval> | null = null;
  private statusFrame = 0;
  private statusRotateIndex = 0;
  private statusRotateTimer: ReturnType<typeof setInterval> | null = null;

  private static readonly SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

  constructor(adapterName: string) {
    this.adapterName = adapterName;
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
        this.statusRotateIndex = (this.statusRotateIndex + 1) % this.activeTasks.size;
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

  /** Render one frame of the status animation. */
  private renderStatusFrame(): void {
    if (this.activeTasks.size === 0) return;

    const entries = Array.from(this.activeTasks.values());
    const idx = this.statusRotateIndex % entries.length;
    const { teammate, task } = entries[idx];

    const spinChar = TeammatesREPL.SPINNER[this.statusFrame % TeammatesREPL.SPINNER.length];
    const taskPreview = task.length > 50 ? task.slice(0, 47) + "..." : task;
    const queueInfo = this.activeTasks.size > 1
      ? ` (${idx + 1}/${this.activeTasks.size})`
      : "";

    if (this.chatView) {
      // Strip newlines and truncate task text for single-line display
      const cleanTask = task.replace(/[\r\n]+/g, " ").trim();
      const maxLen = Math.max(20, (process.stdout.columns || 80) - teammate.length - 10);
      const taskText = cleanTask.length > maxLen ? cleanTask.slice(0, maxLen - 1) + "…" : cleanTask;
      const queueTag = this.activeTasks.size > 1 ? ` (${idx + 1}/${this.activeTasks.size})` : "";

      this.chatView.setProgress(concat(
        tp.accent(`${spinChar} ${teammate}… `),
        tp.muted(taskText + queueTag),
      ));
      this.app.refresh();
    } else {
      // Mostly bright blue, periodically flicker to dark blue
      const spinColor = this.statusFrame % 8 === 0 ? chalk.blue : chalk.blueBright;
      const line =
        `  ${spinColor(spinChar)} ` +
        chalk.bold(teammate) +
        chalk.gray(`… ${taskPreview}`) +
        (queueInfo ? chalk.gray(queueInfo) : "");
      this.input.setStatus(line);
    }
  }

  /**
   * Print the user's message as an inverted block in the feed.
   * White text on dark background, right-aligned indicator.
   */
  private printUserMessage(text: string): void {
    if (this.chatView) {
      this.chatView.appendToFeed("");
      for (const line of text.split("\n")) {
        this.chatView.appendStyledToFeed(concat(tp.muted("  > "), tp.text(line)));
      }
      this.chatView.appendToFeed("");
      this.app.refresh();
      return;
    }

    const termWidth = process.stdout.columns || 100;
    const maxWidth = Math.min(termWidth - 4, 80);
    const lines = text.split("\n");

    console.log();
    for (const line of lines) {
      // Truncate long lines
      const display = line.length > maxWidth ? line.slice(0, maxWidth - 1) + "…" : line;
      const padded = display + " ".repeat(Math.max(0, maxWidth - stripAnsi(display).length));
      console.log("  " + chalk.bgGray.white(" " + padded + " "));
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
      width: width - 2,
      indent: "  ",
      theme: {
        text: { fg: t.text },
        bold: { fg: t.text, bold: true },
        italic: { fg: t.text, italic: true },
        boldItalic: { fg: t.text, bold: true, italic: true },
        code: { fg: t.warning },
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

  /** Refresh the ChatView app if active. */
  private refreshView(): void {
    if (this.app) this.app.refresh();
  }

  private queueTask(input: string): void {
    // Check for @mention
    const mentionMatch = input.match(/^@(\S+)\s+([\s\S]+)$/);
    if (mentionMatch) {
      const [, teammate, task] = mentionMatch;
      const names = this.orchestrator.listTeammates();
      if (names.includes(teammate)) {
        this.taskQueue.push({ type: "agent", teammate, task });
        this.kickDrain();
        return;
      }
    }

    // Check for inline @mention
    const inlineMention = input.match(/@(\S+)/);
    if (inlineMention) {
      const teammate = inlineMention[1];
      const names = this.orchestrator.listTeammates();
      if (names.includes(teammate)) {
        const task = input.replace(/@\S+\s*/, "").trim();
        if (task) {
          this.taskQueue.push({ type: "agent", teammate, task });
          this.kickDrain();
          return;
        }
      }
    }

    // Auto-route: resolve teammate synchronously if possible, else use default
    let match = this.orchestrator.route(input);
    if (!match) {
      // Fall back to adapter name — avoid blocking for agent routing
      match = this.adapterName;
    }
    this.feedLine(concat(tp.muted("  → "), tp.accent(match)));
    this.refreshView();
    this.taskQueue.push({ type: "agent", teammate: match, task: input });
    this.kickDrain();
  }

  /** Start draining the queue if not already running. */
  private kickDrain(): void {
    if (!this.drainLock) {
      this.drainLock = this.drainQueue().finally(() => { this.drainLock = null; });
    }
  }

  // ─── Onboarding ───────────────────────────────────────────────────

  /**
   * Interactive prompt when no .teammates/ directory is found.
   * Returns the new .teammates/ path, or null if user chose to exit.
   */
  private async promptOnboarding(adapter: AgentAdapter): Promise<string | null> {
    const cwd = process.cwd();
    const teammatesDir = join(cwd, ".teammates");
    const termWidth = process.stdout.columns || 100;

    console.log();
    this.printLogo([
      chalk.bold("Teammates") + chalk.gray(" v0.1.0"),
      chalk.yellow("No .teammates/ directory found"),
      chalk.gray(cwd),
    ]);
    console.log();
    console.log(chalk.gray("─".repeat(termWidth)));
    console.log();
    console.log(chalk.white("  Set up teammates for this project?\n"));
    console.log(
      chalk.cyan("  1") + chalk.gray(") ") +
        chalk.white("Run onboarding") +
        chalk.gray(" — analyze this codebase and create .teammates/")
    );
    console.log(
      chalk.cyan("  2") + chalk.gray(") ") +
        chalk.white("Solo mode") +
        chalk.gray(` — use ${this.adapterName} without teammates`)
    );
    console.log(
      chalk.cyan("  3") + chalk.gray(") ") +
        chalk.white("Exit")
    );
    console.log();

    const choice = await this.askChoice("Pick an option (1/2/3): ", ["1", "2", "3"]);

    if (choice === "3") {
      console.log(chalk.gray("  Goodbye."));
      return null;
    }

    if (choice === "2") {
      await mkdir(teammatesDir, { recursive: true });
      console.log();
      console.log(chalk.green("  ✔") + chalk.gray(` Created ${teammatesDir}`));
      console.log(chalk.gray(`  Running in solo mode — all tasks go to ${this.adapterName}.`));
      console.log(chalk.gray("  Run /init later to set up teammates."));
      console.log();
      return teammatesDir;
    }

    // choice === "1": Run onboarding via the agent
    await mkdir(teammatesDir, { recursive: true });
    await this.runOnboardingAgent(adapter, cwd);
    return teammatesDir;
  }

  /**
   * Run the onboarding agent to analyze the codebase and create teammates.
   * Used by both promptOnboarding (pre-orchestrator) and cmdInit (post-orchestrator).
   */
  private async runOnboardingAgent(adapter: AgentAdapter, projectDir: string): Promise<void> {
    console.log();
    console.log(
      chalk.blue("  Starting onboarding...") +
        chalk.gray(` ${this.adapterName} will analyze your codebase and create .teammates/`)
    );
    console.log();

    // Copy framework files from bundled template
    const teammatesDir = join(projectDir, ".teammates");
    const copied = await copyTemplateFiles(teammatesDir);
    if (copied.length > 0) {
      console.log(chalk.green("  ✔") + chalk.gray(` Copied template files: ${copied.join(", ")}`));
      console.log();
    }

    const onboardingPrompt = await getOnboardingPrompt(projectDir);
    const tempConfig = {
      name: this.adapterName,
      role: "Onboarding agent",
      soul: "",
      wisdom: "",
      dailyLogs: [] as { date: string; content: string }[],
      weeklyLogs: [] as { week: string; content: string }[],
      ownership: { primary: [] as string[], secondary: [] as string[] },
    };

    const sessionId = await adapter.startSession(tempConfig);
    const spinner = ora({
      text: chalk.blue(this.adapterName) + chalk.gray(" is analyzing your codebase..."),
      spinner: "dots",
    }).start();

    try {
      const result = await adapter.executeTask(sessionId, tempConfig, onboardingPrompt);
      spinner.stop();
      this.printAgentOutput(result.rawOutput);

      if (result.success) {
        console.log(chalk.green("  ✔ Onboarding complete!"));
      } else {
        console.log(chalk.yellow("  ⚠ Onboarding finished with issues: " + result.summary));
      }
    } catch (err: any) {
      spinner.fail(chalk.red("Onboarding failed: " + err.message));
    }

    if (adapter.destroySession) {
      await adapter.destroySession(sessionId);
    }

    // Verify .teammates/ now has content
    try {
      const entries = await readdir(teammatesDir);
      if (!entries.some(e => !e.startsWith("."))) {
        console.log(chalk.yellow("  ⚠ .teammates/ was created but appears empty."));
        console.log(chalk.gray("  You may need to run the onboarding agent again or set up manually."));
      }
    } catch { /* dir might not exist if onboarding failed badly */ }
    console.log();
  }

  /**
   * Simple blocking prompt — reads one line from stdin and validates.
   */
  private askChoice(prompt: string, valid: string[]): Promise<string> {
    return new Promise((resolve) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
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

  // ─── Display helpers ──────────────────────────────────────────────

  /**
   * Render the box logo with up to 4 info lines on the right side.
   */
  private printLogo(infoLines: string[]): void {
    const [top, bot] = buildTitle("teammates");
    console.log("  " + chalk.cyan(top));
    console.log("  " + chalk.cyan(bot));
    if (infoLines.length > 0) {
      console.log();
      for (const line of infoLines) {
        console.log("  " + line);
      }
    }
  }

  /**
   * Print agent raw output, stripping the trailing JSON protocol block.
   */
  private printAgentOutput(rawOutput: string | undefined): void {
    const raw = rawOutput ?? "";
    if (!raw) return;
    const cleaned = raw.replace(/```json\s*\n\s*\{[\s\S]*?\}\s*\n\s*```\s*$/, "").trim();
    if (cleaned) {
      const rendered = renderMarkdownTables(cleaned);
      this.feedLine(rendered);
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
      this.chatView.showDropdown(lines.map((l) => ({
        label: stripAnsi(l).trim(),
        description: "",
        completion: "",
      })));
      this.refreshView();
    } else {
      this.input.setDropdown(lines);
    }
  }

  /**
   * Which argument positions are teammate-name completable per command.
   * Key = command name, value = set of 0-based arg positions that take a teammate.
   */
  private static readonly TEAMMATE_ARG_POSITIONS: Record<string, Set<number>> = {
    assign:  new Set([0]),
    handoff: new Set([0, 1]),
    log:     new Set([0]),
    compact: new Set([0]),
    debug:   new Set([0]),
  };

  /** Build param-completion items for the current line, if any. */
  private getParamItems(cmdName: string, argsBefore: string, partial: string): DropdownItem[] {
    // Service-name completions for /install
    if (cmdName === "install" && !argsBefore.trim()) {
      const lower = partial.toLowerCase();
      return Object.entries(SERVICE_REGISTRY)
        .filter(([name]) => name.startsWith(lower))
        .map(([name, svc]) => ({
          label: name,
          description: svc.description,
          completion: "/install " + name + " ",
        }));
    }

    const positions = TeammatesREPL.TEAMMATE_ARG_POSITIONS[cmdName];
    if (!positions) return [];

    // Count how many complete args precede the current partial
    const completedArgs = argsBefore.trim() ? argsBefore.trim().split(/\s+/).length : 0;
    if (!positions.has(completedArgs)) return [];

    const teammates = this.orchestrator.listTeammates();
    const lower = partial.toLowerCase();
    return teammates
      .filter((n) => n.toLowerCase().startsWith(lower))
      .map((name) => {
        const t = this.orchestrator.getRegistry().get(name);
        const linePrefix = "/" + cmdName + " " + (argsBefore ? argsBefore : "");
        return {
          label: name,
          description: t?.role ?? "",
          completion: linePrefix + name + " ",
        };
      });
  }

  /**
   * Find the @mention token the cursor is currently inside, if any.
   * Returns { before, partial, atPos } or null.
   */
  private findAtMention(line: string, cursor: number): { before: string; partial: string; atPos: number } | null {
    // Walk backward from cursor to find the nearest unescaped '@'
    const left = line.slice(0, cursor);
    const atPos = left.lastIndexOf("@");
    if (atPos < 0) return null;
    // '@' must be at start of line or preceded by whitespace
    if (atPos > 0 && !/\s/.test(line[atPos - 1])) return null;
    const partial = left.slice(atPos + 1);
    // Partial must be a single token (no spaces)
    if (/\s/.test(partial)) return null;
    return { before: line.slice(0, atPos), partial, atPos };
  }

  /** Build @mention teammate completion items. */
  private getAtMentionItems(line: string, before: string, partial: string, atPos: number): DropdownItem[] {
    const teammates = this.orchestrator.listTeammates();
    const lower = partial.toLowerCase();
    const after = line.slice(atPos + 1 + partial.length);
    return teammates
      .filter((n) => n.toLowerCase().startsWith(lower))
      .map((name) => {
        const t = this.orchestrator.getRegistry().get(name);
        return {
          label: "@" + name,
          description: t?.role ?? "",
          completion: before + "@" + name + " " + after.replace(/^\s+/, ""),
        };
      });
  }

  /** Recompute matches and draw the wordwheel. */
  private updateWordwheel(): void {
    this.clearWordwheel();
    const line: string = this.chatView ? this.chatView.inputValue : this.input.line;
    const cursor: number = this.chatView ? this.chatView.inputValue.length : this.input.cursor;

    // ── @mention anywhere in the line ──────────────────────────────
    const mention = this.findAtMention(line, cursor);
    if (mention) {
      this.wordwheelItems = this.getAtMentionItems(line, mention.before, mention.partial, mention.atPos);
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
      if (!cmd) { this.wordwheelItems = []; this.wordwheelIndex = -1; return; }

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
          c.aliases.some((a) => a.startsWith(partial))
      )
      .map((c) => ({
        label: "/" + c.name,
        description: c.description,
        completion: "/" + c.name + " ",
      }));

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
        while (this.chatView.dropdownIndex < this.wordwheelIndex) this.chatView.dropdownDown();
        while (this.chatView.dropdownIndex > this.wordwheelIndex) this.chatView.dropdownUp();
      }
      this.refreshView();
    } else {
      this.writeWordwheel(
        this.wordwheelItems.map((item, i) => {
          const prefix = i === this.wordwheelIndex ? chalk.cyan("▸ ") : "  ";
          const label = item.label.padEnd(14);
          if (i === this.wordwheelIndex) {
            return prefix + chalk.cyanBright.bold(label) + " " + chalk.white(item.description);
          }
          return prefix + chalk.cyan(label) + " " + chalk.gray(item.description);
        })
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
    let teammatesDir = await findTeammatesDir();
    const adapter = resolveAdapter(this.adapterName);
    this.adapter = adapter;

    // No .teammates/ found — offer onboarding or solo mode
    if (!teammatesDir) {
      teammatesDir = await this.promptOnboarding(adapter);
      if (!teammatesDir) return; // user chose to exit
    }

    // Init orchestrator
    this.teammatesDir = teammatesDir;
    this.orchestrator = new Orchestrator({
      teammatesDir,
      adapter,
      onEvent: (e) => this.handleEvent(e),
    });
    await this.orchestrator.init();

    // Register the agent itself as a mentionable teammate
    const registry = this.orchestrator.getRegistry();
    registry.register({
      name: this.adapterName,
      role: `General-purpose coding agent (${this.adapterName})`,
      soul: "",
      wisdom: "",
      dailyLogs: [],
      weeklyLogs: [],
      ownership: { primary: [], secondary: [] },
    });
    // Add status entry (init() already ran, so we add it manually)
    this.orchestrator.getAllStatuses().set(this.adapterName, { state: "idle" });

    // Populate roster on the adapter so prompts include team info
    if ("roster" in this.adapter) {
      const registry = this.orchestrator.getRegistry();
      (this.adapter as any).roster = this.orchestrator.listTeammates().map((name) => {
        const t = registry.get(name)!;
        return { name: t.name, role: t.role, ownership: t.ownership };
      });
    }

    // Detect installed services from services.json and tell the adapter
    if ("services" in this.adapter) {
      const services: { name: string; description: string; usage: string }[] = [];
      try {
        const svcJson = JSON.parse(readFileSync(join(this.teammatesDir, "services.json"), "utf-8"));
        if (svcJson && "recall" in svcJson) {
          services.push({
            name: "recall",
            description: "Local semantic search across teammate memories and daily logs. Use this to find relevant context before starting a task.",
            usage: 'teammates-recall search "your query" --dir .teammates',
          });
        }
      } catch { /* no services.json or invalid */ }
      (this.adapter as any).services = services;
    }

    // Start recall watch mode if recall is installed
    this.startRecallWatch();

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
      colorize: (value) =>
        value
          .replace(/@\w+/g, (m) => chalk.blue(m))
          .replace(/\/\w+/g, (m) => chalk.blue(m)),
      onUpDown: (dir) => {
        if (this.wordwheelItems.length === 0) return false;
        if (dir === "up") {
          this.wordwheelIndex = Math.max(this.wordwheelIndex - 1, -1);
        } else {
          this.wordwheelIndex = Math.min(
            this.wordwheelIndex + 1,
            this.wordwheelItems.length - 1
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

    // ── Build animated banner for ChatView ─────────────────────────────

    const names = this.orchestrator.listTeammates();
    const reg = this.orchestrator.getRegistry();
    let hasRecall = false;
    try {
      const svcJson = JSON.parse(readFileSync(join(this.teammatesDir, "services.json"), "utf-8"));
      hasRecall = !!(svcJson && "recall" in svcJson);
    } catch { /* no services.json */ }

    const bannerWidget = new AnimatedBanner({
      adapterName: this.adapterName,
      teammateCount: names.length,
      cwd: process.cwd(),
      recallInstalled: hasRecall,
      teammates: names.map((name) => {
        const t = reg.get(name);
        return { name, role: t?.role ?? "" };
      }),
    });

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
        const styles: (import("@teammates/consolonia").TextStyle | null)[] = new Array(value.length).fill(null);
        const accentStyle = { fg: theme().accent };
        // Colorize /commands and @mentions
        const pattern = /(?:\/\w+|@\w+)/g;
        let m;
        while ((m = pattern.exec(value)) !== null) {
          for (let i = m.index; i < m.index + m[0].length; i++) {
            styles[i] = accentStyle;
          }
        }
        return styles;
      },
      inputDeleteSize: (value: string, cursor: number, direction: "backward" | "forward") => {
        // Delete entire paste placeholder blocks as a unit
        const placeholder = /\[Pasted text #\d+ \+\d+ lines, [\d.]+KB\]/g;
        let m;
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
      maxInputHeight: 5,
      separatorStyle: { fg: t.separator },
      progressStyle: { fg: t.progress, italic: true },
      dropdownHighlightStyle: { fg: t.accent },
      dropdownStyle: { fg: t.textMuted },
      footer: concat(tp.accent(" Teammates"), tp.dim(" v0.1.0")),
      footerStyle: { fg: t.textDim },
    });
    this.defaultFooter = concat(tp.accent(" Teammates"), tp.dim(" v0.1.0"));

    // Wire ChatView events for input handling
    this.chatView.on("submit", (rawLine: string) => {
      this.handleSubmit(rawLine).catch((err) => {
        this.feedLine(tp.error(`Unhandled error: ${err.message}`));
        this.refreshView();
      });
    });
    this.chatView.on("change", () => {
      this.wordwheelItems = [];
      this.wordwheelIndex = -1;
      this.updateWordwheel();
      // Reset ESC / Ctrl+C pending state on any text change
      if (this.escPending) {
        this.escPending = false;
        if (this.escTimer) { clearTimeout(this.escTimer); this.escTimer = null; }
        this.chatView.setFooter(this.defaultFooter!);
        this.refreshView();
      }
      if (this.ctrlcPending) {
        this.ctrlcPending = false;
        if (this.ctrlcTimer) { clearTimeout(this.ctrlcTimer); this.ctrlcTimer = null; }
        this.chatView.setFooter(this.defaultFooter!);
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
        if (this.escTimer) { clearTimeout(this.escTimer); this.escTimer = null; }
        this.chatView.inputValue = "";
        this.chatView.setFooter(this.defaultFooter!);
        this.pastedTexts.clear();
        this.refreshView();
      } else if (this.chatView.inputValue.length > 0) {
        // First ESC with text — show hint in footer, auto-expire after 2s
        this.escPending = true;
        const termW = process.stdout.columns || 80;
        const hint = "ESC again to clear";
        const pad = Math.max(0, termW - hint.length - 1);
        this.chatView.setFooter(concat(tp.dim(" ".repeat(pad)), tp.muted(hint)));
        this.refreshView();
        this.escTimer = setTimeout(() => {
          this.escTimer = null;
          if (this.escPending) {
            this.escPending = false;
            this.chatView.setFooter(this.defaultFooter!);
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
        if (this.ctrlcTimer) { clearTimeout(this.ctrlcTimer); this.ctrlcTimer = null; }
        this.chatView.setFooter(this.defaultFooter!);
        this.stopRecallWatch();
        if (this.app) this.app.stop();
        this.orchestrator.shutdown().then(() => process.exit(0));
        return;
      }
      // First Ctrl+C — show hint in footer, auto-expire after 2s
      this.ctrlcPending = true;
      const termW = process.stdout.columns || 80;
      const hint = "Ctrl+C again to exit";
      const pad = Math.max(0, termW - hint.length - 1);
      this.chatView.setFooter(concat(tp.dim(" ".repeat(pad)), tp.muted(hint)));
      this.refreshView();
      this.ctrlcTimer = setTimeout(() => {
        this.ctrlcTimer = null;
        if (this.ctrlcPending) {
          this.ctrlcPending = false;
          this.chatView.setFooter(this.defaultFooter!);
          this.refreshView();
        }
      }, 2000);
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
  private handlePaste(text: string): void {
    if (!this.chatView) return;
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
      const newVal = current.slice(0, idx) + placeholder + current.slice(idx + clean.length);
      this.chatView.inputValue = newVal;
    }
    this.refreshView();
  }

  /** Handle line submission from ChatView. */
  private async handleSubmit(rawLine: string): Promise<void> {
    this.clearWordwheel();
    this.wordwheelItems = [];
    this.wordwheelIndex = -1;

    // Expand paste placeholders with actual content
    let input = rawLine.replace(/\[Pasted text #(\d+) \+\d+ lines, [\d.]+KB\]\s*/g, (_match, num) => {
      const n = parseInt(num, 10);
      const text = this.pastedTexts.get(n);
      if (text) {
        this.pastedTexts.delete(n);
        return text + "\n";
      }
      return "";
    }).trim();

    if (!input) return;

    // Handle pending handoff menu (1/2/3)
    if (this.orchestrator.getPendingHandoff()) {
      const handled = await this.handleHandoffChoice(input);
      if (handled) {
        this.refreshView();
        return;
      }
      this.refreshView();
      return;
    }

    // Slash commands
    if (input.startsWith("/")) {
      this.dispatching = true;
      try {
        await this.dispatch(input);
      } catch (err: any) {
        this.feedLine(tp.error(`Error: ${err.message}`));
      } finally {
        this.dispatching = false;
      }
      this.refreshView();
      return;
    }

    // Everything else gets queued
    this.conversationHistory.push({ role: "user", text: input });
    this.printUserMessage(input);
    this.queueTask(input);
    this.refreshView();
  }

  private printBanner(teammates: string[]): void {
    const registry = this.orchestrator.getRegistry();
    const termWidth = process.stdout.columns || 100;

    // Detect recall from services.json
    let recallInstalled = false;
    try {
      const svcJson = JSON.parse(readFileSync(join(this.teammatesDir, "services.json"), "utf-8"));
      recallInstalled = !!(svcJson && "recall" in svcJson);
    } catch { /* no services.json or invalid */ }

    this.feedLine();
    this.feedLine(concat(tp.bold("  Teammates"), tp.muted(" v0.1.0")));
    this.feedLine(concat(tp.text("  " + this.adapterName), tp.muted(` · ${teammates.length} teammate${teammates.length === 1 ? "" : "s"}`)));
    this.feedLine(`  ${process.cwd()}`);
    this.feedLine(recallInstalled ? tp.success("  ● recall installed") : tp.warning("  ○ recall not installed"));

    // Roster
    this.feedLine();
    for (const name of teammates) {
      const t = registry.get(name);
      if (t) {
        this.feedLine(concat(tp.muted("  "), tp.accent("● @" + name.padEnd(14)), tp.muted(t.role)));
      }
    }

    this.feedLine();
    this.feedLine(tp.muted("─".repeat(termWidth)));

    // Quick reference — 3 columns
    const col1 = [
      ["@mention", "assign to teammate"],
      ["text", "auto-route task"],
      ["/queue", "view task queue"],
    ];
    const col2 = [
      ["/status", "session overview"],
      ["/debug", "raw agent output"],
      ["/log", "last task output"],
    ];
    const col3 = [
      ["/install", "add a service"],
      ["/help", "all commands"],
      ["/exit", "exit session"],
    ];

    for (let i = 0; i < col1.length; i++) {
      this.feedLine(
        concat(
          tp.accent(("  " + col1[i][0]).padEnd(12)), tp.muted(col1[i][1].padEnd(22)),
          tp.accent(col2[i][0].padEnd(12)), tp.muted(col2[i][1].padEnd(22)),
          tp.accent(col3[i][0].padEnd(12)), tp.muted(col3[i][1])
        )
      );
    }

    this.feedLine();
    this.refreshView();
  }

  private registerCommands(): void {
    const cmds: SlashCommand[] = [
      {
        name: "status",
        aliases: ["s"],
        usage: "/status",
        description: "Show teammate roster and session status",
        run: () => this.cmdStatus(),
      },
      {
        name: "teammates",
        aliases: ["team", "t"],
        usage: "/teammates",
        description: "List all teammates and their roles",
        run: () => this.cmdTeammates(),
      },
      {
        name: "log",
        aliases: ["l"],
        usage: "/log [teammate]",
        description: "Show the last task result for a teammate",
        run: (args) => this.cmdLog(args),
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
        usage: "/debug [teammate]",
        description: "Show raw agent output from the last task",
        run: (args) => this.cmdDebug(args),
      },
      {
        name: "queue",
        aliases: ["qu"],
        usage: "/queue",
        description: "Show task queue status",
        run: () => this.cmdQueue(),
      },
      {
        name: "cancel",
        aliases: [],
        usage: "/cancel <n>",
        description: "Cancel a queued task by number",
        run: (args) => this.cmdCancel(args),
      },
      {
        name: "init",
        aliases: ["onboard", "setup"],
        usage: "/init",
        description: "Run onboarding to set up teammates for this project",
        run: () => this.cmdInit(),
      },
      {
        name: "clear",
        aliases: ["cls", "reset"],
        usage: "/clear",
        description: "Clear history and reset the session",
        run: () => this.cmdClear(),
      },
      {
        name: "install",
        aliases: [],
        usage: "/install <service>",
        description: "Install a teammates service (e.g. recall)",
        run: (args) => this.cmdInstall(args),
      },
      {
        name: "compact",
        aliases: [],
        usage: "/compact [teammate]",
        description: "Compact daily logs into weekly/monthly summaries",
        run: (args) => this.cmdCompact(args),
      },
      {
        name: "theme",
        aliases: [],
        usage: "/theme",
        description: "Show current theme colors",
        run: () => this.cmdTheme(),
      },
      {
        name: "exit",
        aliases: ["q", "quit"],
        usage: "/exit",
        description: "Exit the session",
        run: async () => {
          this.feedLine(tp.muted("Shutting down..."));
          this.stopRecallWatch();
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
    switch (event.type) {
      case "task_assigned": {
        // Track this task and start the animated status bar
        const key = event.assignment.teammate;
        this.activeTasks.set(key, {
          teammate: event.assignment.teammate,
          task: event.assignment.task,
        });
        this.startStatusAnimation();
        break;
      }

      case "task_completed": {
        // Remove from active tasks
        this.activeTasks.delete(event.result.teammate);

        // Stop animation if no more active tasks
        if (this.activeTasks.size === 0) {
          this.stopStatusAnimation();
        }

        if (!this.chatView) this.input.deactivateAndErase();

        const raw = event.result.rawOutput ?? "";
        const cleaned = raw.replace(/```json\s*\n\s*\{[\s\S]*?\}\s*\n\s*```\s*$/, "").trim();
        const sizeKB = cleaned ? Buffer.byteLength(cleaned, "utf-8") / 1024 : 0;

        this.feedLine();
        if (sizeKB > 5) {
          this.feedLine(tp.muted("  " + "─".repeat(40)));
          this.feedLine(tp.warning(`  ⚠ Response is ${sizeKB.toFixed(1)}KB — use /debug ${event.result.teammate} to view full output`));
          this.feedLine(tp.muted("  " + "─".repeat(40)));
        } else if (cleaned) {
          this.feedMarkdown(cleaned);
        }

        this.feedLine();
        this.feedLine(concat(tp.success("  ✔ " + event.result.teammate), tp.muted(": "), pen(event.result.summary)));

        this.showPrompt();
        break;
      }

      case "handoff_initiated":
        if (!this.chatView) this.input.deactivateAndErase();
        this.feedLine(concat(tp.warning("  Handoff: "), tp.bold(event.envelope.from), tp.warning(" → "), tp.bold(event.envelope.to)));
        this.printHandoffDetails(event.envelope);
        this.showPrompt();
        break;

      case "handoff_completed":
        // Already handled via task_completed
        break;

      case "error":
        this.activeTasks.delete(event.teammate);
        if (this.activeTasks.size === 0) this.stopStatusAnimation();
        if (!this.chatView) this.input.deactivateAndErase();
        this.feedLine(tp.error(`  ✖ ${event.teammate}: ${event.error}`));
        this.showPrompt();
        break;
    }
  }

  private printHandoffDetails(envelope: HandoffEnvelope): void {
    const lines: string[] = [];
    lines.push("Task: " + envelope.task);
    if (envelope.changedFiles?.length) {
      lines.push("Files: " + envelope.changedFiles.join(", "));
    }
    if (envelope.context) {
      lines.push("Context: " + envelope.context);
    }
    if (envelope.acceptanceCriteria?.length) {
      lines.push("Criteria:");
      for (const c of envelope.acceptanceCriteria) {
        lines.push("  • " + c);
      }
    }
    if (envelope.openQuestions?.length) {
      lines.push("Questions:");
      for (const q of envelope.openQuestions) {
        lines.push("  ? " + q);
      }
    }

    const maxContent = Math.max(...lines.map((l) => l.length));
    const innerWidth = Math.max(maxContent + 2, 40);
    const h = "─".repeat(innerWidth);

    this.feedLine(tp.muted("  ┌" + h + "┐"));
    for (const line of lines) {
      const colonIdx = line.indexOf(": ");
      const padded = " " + line + " ".repeat(Math.max(0, innerWidth - line.length - 2)) + " ";
      if (colonIdx >= 0) {
        const label = line.slice(0, colonIdx + 2);
        const value = line.slice(colonIdx + 2);
        const trailing = " ".repeat(Math.max(0, innerWidth - line.length - 2)) + " ";
        this.feedLine(concat(tp.muted("  │ "), tp.text(label), pen(value + trailing), tp.muted("│")));
      } else {
        this.feedLine(concat(tp.muted("  │"), pen(padded), tp.muted("│")));
      }
    }
    this.feedLine(tp.muted("  └" + h + "┘"));
    this.feedLine();
    this.feedLine(concat(tp.accent("  1"), tp.muted(") Approve")));
    this.feedLine(concat(tp.accent("  2"), tp.muted(") Always approve handoffs")));
    this.feedLine(concat(tp.accent("  3"), tp.muted(") Reject")));
    this.feedLine();
    this.refreshView();
  }

  /** Handle the numbered handoff menu choice. */
  private async handleHandoffChoice(choice: string): Promise<boolean> {
    const pending = this.orchestrator.getPendingHandoff();
    if (!pending) return false;

    switch (choice) {
      case "1": {
        this.orchestrator.clearPendingHandoff(pending.from);
    
        const result = await this.orchestrator.assign({
          teammate: pending.to,
          task: pending.task,
          handoff: pending,
        });
    
        this.storeResult(result);
        return true;
      }
      case "2": {
        this.orchestrator.requireApproval = false;
        this.orchestrator.clearPendingHandoff(pending.from);
        this.feedLine(tp.muted("  Auto-approving all future handoffs."));
    
        const result = await this.orchestrator.assign({
          teammate: pending.to,
          task: pending.task,
          handoff: pending,
        });
    
        this.storeResult(result);
        return true;
      }
      case "3": {
        this.orchestrator.clearPendingHandoff(pending.from);
        this.feedLine(concat(tp.muted("  Rejected handoff from "), tp.bold(pending.from), tp.muted(" to "), tp.bold(pending.to)));
        this.refreshView();
        return true;
      }
      default:
        return false;
    }
  }

  // ─── Commands ────────────────────────────────────────────────────

  private async cmdAssign(argsStr: string): Promise<void> {
    const parts = argsStr.match(/^(\S+)\s+(.+)$/);
    if (!parts) {
      this.feedLine(tp.warning("Usage: /assign <teammate> <task...>"));
      this.refreshView();
      return;
    }

    const [, teammate, task] = parts;

    const extraContext = this.buildConversationContext();
    const result = await this.orchestrator.assign({ teammate, task, extraContext: extraContext || undefined });

    this.storeResult(result);

    if (result.handoff && this.orchestrator.requireApproval) {
      // Handoff is pending — user was already prompted
    }
    this.refreshView();
  }

  private async cmdRoute(argsStr: string): Promise<void> {
    let match = this.orchestrator.route(argsStr);

    if (!match) {
      // Keyword routing didn't find a strong match — ask the agent
      match = await this.orchestrator.agentRoute(argsStr);
    }

    match = match ?? this.adapterName;

    this.feedLine(concat(tp.muted("  Routed to: "), tp.bold(match)));

    const extraContext = this.buildConversationContext();
    const result = await this.orchestrator.assign({ teammate: match, task: argsStr, extraContext: extraContext || undefined });

    this.storeResult(result);
    this.refreshView();
  }

  private async cmdStatus(): Promise<void> {
    const statuses = this.orchestrator.getAllStatuses();
    const registry = this.orchestrator.getRegistry();

    this.feedLine();
    this.feedLine(tp.bold("  Status"));
    this.feedLine(tp.muted("  " + "─".repeat(60)));

    for (const [name, status] of statuses) {
      const teammate = registry.get(name);
      const stateLabel = status.state.padEnd(16);
      const nameLabel = name.padEnd(14);

      let detail = "—";
      if (status.lastSummary) {
        const time = status.lastTimestamp ? ` (${relativeTime(status.lastTimestamp)})` : "";
        detail = status.lastSummary.slice(0, 50) + time;
      }
      if (status.state === "pending-handoff" && status.pendingHandoff) {
        detail = `→ ${status.pendingHandoff.to}: ${status.pendingHandoff.task.slice(0, 40)}`;
      }

      const stateColor = status.state === "working" ? tp.info(stateLabel)
        : status.state === "pending-handoff" ? tp.warning(stateLabel)
        : tp.muted(stateLabel);
      this.feedLine(concat(pen("  "), tp.bold(nameLabel), pen(" "), stateColor, pen(" "), tp.text(detail)));
    }
    this.feedLine();
    this.refreshView();
  }

  private async cmdTeammates(): Promise<void> {
    const names = this.orchestrator.listTeammates();
    const registry = this.orchestrator.getRegistry();

    this.feedLine();
    for (const name of names) {
      const t = registry.get(name)!;
      this.feedLine(concat(tp.accent("  @" + name.padEnd(14)), tp.muted(t.role)));
      if (t.ownership.primary.length > 0) {
        this.feedLine(concat(tp.muted("                owns: "), tp.text(t.ownership.primary.join(", "))));
      }
    }
    this.feedLine();
    this.refreshView();
  }

  private async cmdLog(argsStr: string): Promise<void> {
    const teammate = argsStr.trim();

    if (teammate) {
      // Show specific teammate's last result
      const status = this.orchestrator.getStatus(teammate);
      if (!status) {
        this.feedLine(tp.warning(`Unknown teammate: ${teammate}`));
        this.refreshView();
        return;
      }
      this.printTeammateLog(teammate, status);
    } else if (this.lastResult) {
      // Show last result globally
      const status = this.orchestrator.getStatus(this.lastResult.teammate);
      if (status) this.printTeammateLog(this.lastResult.teammate, status);
    } else {
      this.feedLine("No task results yet.");
      this.refreshView();
    }
  }

  private printTeammateLog(
    name: string,
    status: { lastSummary?: string; lastChangedFiles?: string[]; lastTimestamp?: Date }
  ): void {
    this.feedLine();
    this.feedLine(tp.bold("  " + name));

    if (status.lastSummary) {
      this.feedLine(concat(tp.text("  Summary: "), pen(status.lastSummary)));
    }
    if (status.lastChangedFiles?.length) {
      this.feedLine(tp.text("  Changed:"));
      for (const f of status.lastChangedFiles) {
        this.feedLine(concat(tp.muted("    • "), pen(f)));
      }
    }
    if (status.lastTimestamp) {
      this.feedLine(tp.muted("  Time: " + relativeTime(status.lastTimestamp)));
    }
    if (!status.lastSummary) {
      this.feedLine("  No task results yet.");
    }
    this.feedLine();
    this.refreshView();
  }

  private async cmdDebug(argsStr: string): Promise<void> {
    const teammate = argsStr.trim();
    const result = teammate
      ? this.lastResults.get(teammate)
      : this.lastResult;

    if (!result?.rawOutput) {
      this.feedLine(tp.muted("  No raw output available." + (teammate ? "" : " Try: /debug <teammate>")));
      this.refreshView();
      return;
    }

    this.feedLine();
    this.feedLine(tp.muted("  ── raw output from " + result.teammate + " ──"));
    this.feedLine();
    this.feedLine(result.rawOutput);
    this.feedLine();
    this.feedLine(tp.muted("  ── end raw output ──"));
    this.feedLine();
    this.refreshView();
  }

  private async cmdCancel(argsStr: string): Promise<void> {
    const n = parseInt(argsStr.trim(), 10);
    if (isNaN(n) || n < 1 || n > this.taskQueue.length) {
      if (this.taskQueue.length === 0) {
        this.feedLine(tp.muted("  Queue is empty."));
      } else {
        this.feedLine(tp.warning(`  Usage: /cancel <1-${this.taskQueue.length}>`));
      }
      this.refreshView();
      return;
    }

    const removed = this.taskQueue.splice(n - 1, 1)[0];
    this.feedLine(concat(tp.muted("  Cancelled: "), tp.accent("@" + removed.teammate), tp.muted(" — "), tp.text(removed.task.slice(0, 60))));
    this.refreshView();
  }

  private async cmdQueue(): Promise<void> {
    if (this.taskQueue.length === 0 && !this.queueActive) {
      this.feedLine(tp.muted("  Queue is empty."));
      this.refreshView();
      return;
    }
    this.feedLine();
    this.feedLine(tp.bold("  Task Queue"));
    this.feedLine(tp.muted("  " + "─".repeat(50)));
    if (this.queueActive) {
      const taskText = this.queueActive.task.length > 60 ? this.queueActive.task.slice(0, 57) + "..." : this.queueActive.task;
      this.feedLine(
        concat(tp.info("  ▸ "), tp.accent("@" + this.queueActive.teammate), tp.muted(" — "), tp.text(taskText), tp.info("  (running)"))
      );
    }
    for (let i = 0; i < this.taskQueue.length; i++) {
      const entry = this.taskQueue[i];
      const taskText = entry.task.length > 60 ? entry.task.slice(0, 57) + "..." : entry.task;
      this.feedLine(
        concat(tp.muted("  " + (i + 1) + ". "), tp.accent("@" + entry.teammate), tp.muted(" — "), tp.text(taskText))
      );
    }
    if (this.taskQueue.length > 0) {
      this.feedLine(tp.muted("  /cancel <n> to remove a task"));
    }
    this.feedLine();
    this.refreshView();
  }

  /** Drain the queue in the background — REPL stays responsive. Mutex via drainLock. */
  private async drainQueue(): Promise<void> {
    this.queueDraining = true;

    try {
      while (this.taskQueue.length > 0) {
        // If a handoff is pending, pause until it's resolved
        if (this.orchestrator.getPendingHandoff()) {
          await new Promise<void>((resolve) => {
            const check = () => {
              if (!this.orchestrator.getPendingHandoff()) {
                resolve();
              } else {
                setTimeout(check, 500);
              }
            };
            setTimeout(check, 500);
          });
          continue;
        }

        const entry = this.taskQueue.shift()!;
        this.queueActive = entry;

        if (entry.type === "compact") {
          await this.runCompact(entry.teammate);
        } else {
          const extraContext = this.buildConversationContext();
          const result = await this.orchestrator.assign({
            teammate: entry.teammate,
            task: entry.task,
            extraContext: extraContext || undefined,
          });
          this.storeResult(result);
        }

        this.queueActive = null;
      }

      // Queue finished — prompt is already shown by event handler
    } finally {
      this.queueDraining = false;
    }
  }

  private async cmdInit(): Promise<void> {
    const cwd = process.cwd();
    await mkdir(join(cwd, ".teammates"), { recursive: true });
    await this.runOnboardingAgent(this.adapter, cwd);

    // Reload the registry to pick up newly created teammates
    await this.orchestrator.init();
    this.feedLine(tp.muted("  Run /teammates to see the roster."));
    this.refreshView();
  }

  private async cmdInstall(argsStr: string): Promise<void> {
    const serviceName = argsStr.trim().toLowerCase();

    if (!serviceName) {
      this.feedLine(tp.bold("\n  Available services:"));
      for (const [name, svc] of Object.entries(SERVICE_REGISTRY)) {
        this.feedLine(concat(tp.accent(name.padEnd(16)), tp.muted(svc.description)));
      }
      this.feedLine();
      this.refreshView();
      return;
    }

    const service = SERVICE_REGISTRY[serviceName];
    if (!service) {
      this.feedLine(tp.warning(`  Unknown service: ${serviceName}`));
      this.feedLine(tp.muted(`  Available: ${Object.keys(SERVICE_REGISTRY).join(", ")}`));
      this.refreshView();
      return;
    }

    // Install the package globally
    if (this.chatView) {
      this.chatView.setProgress(`Installing ${service.package}...`);
      this.refreshView();
    }
    let installSpinner: Ora | null = null;
    if (!this.chatView) {
      installSpinner = ora({
        text: chalk.blue(serviceName) + chalk.gray(` installing ${service.package}...`),
        spinner: "dots",
      }).start();
    }

    try {
      await execAsync(`npm install -g ${service.package}`, {
        timeout: 5 * 60 * 1000,
      });
      if (installSpinner) installSpinner.stop();
      if (this.chatView) this.chatView.setProgress(null);
    } catch (err: any) {
      if (installSpinner) installSpinner.fail(chalk.red(`Install failed: ${err.message}`));
      if (this.chatView) {
        this.chatView.setProgress(null);
        this.feedLine(tp.error(`  ✖ Install failed: ${err.message}`));
        this.refreshView();
      }
      return;
    }

    // Verify the binary works
    const checkCmdStr = service.checkCmd.join(" ");
    try {
      execSync(checkCmdStr, { stdio: "ignore" });
    } catch {
      this.feedLine(tp.success(`  ✔ ${serviceName} installed`));
      this.feedLine(tp.warning(`  ⚠ Restart your terminal to add ${service.checkCmd[0]} to your PATH, then run /install ${serviceName} again to build the index.`));
      this.refreshView();
      return;
    }

    this.feedLine(tp.success(`  ✔ ${serviceName} installed successfully`));

    // Register in services.json
    const svcPath = join(this.teammatesDir, "services.json");
    let svcJson: Record<string, unknown> = {};
    try { svcJson = JSON.parse(readFileSync(svcPath, "utf-8")); } catch { /* new file */ }
    if (!(serviceName in svcJson)) {
      svcJson[serviceName] = {};
      writeFileSync(svcPath, JSON.stringify(svcJson, null, 2) + "\n");
      this.feedLine(tp.muted(`  Registered in services.json`));
    }

    // Build initial index if this service supports it
    if (service.indexCmd) {
      if (this.chatView) {
        this.chatView.setProgress(`Building ${serviceName} index...`);
        this.refreshView();
      }
      let idxSpinner: Ora | null = null;
      if (!this.chatView) {
        idxSpinner = ora({
          text: chalk.blue(serviceName) + chalk.gray(` building index...`),
          spinner: "dots",
        }).start();
      }

      const indexCmdStr = service.indexCmd.join(" ");
      try {
        await execAsync(indexCmdStr, {
          cwd: resolve(this.teammatesDir, ".."),
          timeout: 5 * 60 * 1000,
        });
        if (idxSpinner) idxSpinner.succeed(chalk.blue(serviceName) + chalk.gray(" index built"));
        if (this.chatView) {
          this.chatView.setProgress(null);
          this.feedLine(tp.success(`  ✔ ${serviceName} index built`));
        }
      } catch (err: any) {
        if (idxSpinner) idxSpinner.warn(chalk.yellow(`Index build failed: ${err.message}`));
        if (this.chatView) {
          this.chatView.setProgress(null);
          this.feedLine(tp.warning(`  ⚠ Index build failed: ${err.message}`));
        }
      }
    }

    // Ask the coding agent to wire the service into the project
    if (service.wireupTask) {
      this.feedLine();
      this.feedLine(tp.muted(`  Wiring up ${serviceName}...`));
      this.refreshView();
      const result = await this.orchestrator.assign({
        teammate: this.adapterName,
        task: service.wireupTask,
      });
      this.storeResult(result);
    }
    this.refreshView();
  }

  private async cmdClear(): Promise<void> {
    this.conversationHistory.length = 0;
    this.lastResult = null;
    this.lastResults.clear();
    this.taskQueue.length = 0;
    this.queueActive = null;
    this.pastedTexts.clear();
    await this.orchestrator.reset();

    if (this.chatView) {
      this.chatView.clear();
      this.refreshView();
    } else {
      process.stdout.write(esc.clearScreen + esc.moveTo(0, 0));
      this.printBanner(this.orchestrator.listTeammates());
    }
  }

  private startRecallWatch(): void {
    // Only start if recall is installed (check services.json)
    try {
      const svcJson = JSON.parse(readFileSync(join(this.teammatesDir, "services.json"), "utf-8"));
      if (!svcJson || !("recall" in svcJson)) return;
    } catch {
      return; // No services.json — recall not installed
    }

    try {
      this.recallWatchProcess = cpSpawn("teammates-recall", ["watch", "--dir", this.teammatesDir, "--json"], {
        stdio: ["ignore", "ignore", "ignore"],
        detached: false,
      });
      this.recallWatchProcess.on("error", () => {
        // Recall binary not found — silently ignore
        this.recallWatchProcess = null;
      });
      this.recallWatchProcess.on("exit", () => {
        this.recallWatchProcess = null;
      });
    } catch {
      this.recallWatchProcess = null;
    }
  }

  private stopRecallWatch(): void {
    if (this.recallWatchProcess) {
      this.recallWatchProcess.kill("SIGTERM");
      this.recallWatchProcess = null;
    }
  }

  private async cmdCompact(argsStr: string): Promise<void> {
    const names = argsStr.trim()
      ? [argsStr.trim()]
      : this.orchestrator.listTeammates().filter((n) => n !== this.adapterName);

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
      this.taskQueue.push({ type: "compact", teammate: name, task: "compact + index update" });
    }

    this.feedLine();
    this.feedLine(
      concat(tp.muted("  Queued compaction for "), tp.accent(valid.map((n) => `@${n}`).join(", ")), tp.muted(` (${valid.length} task${valid.length === 1 ? "" : "s"})`))
    );
    this.feedLine();
    this.refreshView();

    // Start draining if not already
    if (!this.drainLock) {
      this.drainLock = this.drainQueue().finally(() => { this.drainLock = null; });
    }
  }

  /** Run compaction + recall index update for a single teammate. */
  private async runCompact(name: string): Promise<void> {
    const teammateDir = join(this.teammatesDir, name);

    if (this.chatView) {
      this.chatView.setProgress(`Compacting ${name}...`);
      this.refreshView();
    }
    let spinner: Ora | null = null;
    if (!this.chatView) {
      spinner = ora({ text: `Compacting ${name}...`, color: "cyan" }).start();
    }

    try {
      const result = await compactEpisodic(teammateDir, name);

      const parts: string[] = [];
      if (result.weekliesCreated.length > 0) {
        parts.push(`${result.weekliesCreated.length} weekly summaries created`);
      }
      if (result.monthliesCreated.length > 0) {
        parts.push(`${result.monthliesCreated.length} monthly summaries created`);
      }
      if (result.dailiesRemoved.length > 0) {
        parts.push(`${result.dailiesRemoved.length} daily logs compacted`);
      }
      if (result.weekliesRemoved.length > 0) {
        parts.push(`${result.weekliesRemoved.length} old weekly summaries archived`);
      }

      if (parts.length === 0) {
        if (spinner) spinner.info(`${name}: nothing to compact`);
        if (this.chatView) this.feedLine(tp.muted(`  ℹ ${name}: nothing to compact`));
      } else {
        if (spinner) spinner.succeed(`${name}: ${parts.join(", ")}`);
        if (this.chatView) this.feedLine(tp.success(`  ✔ ${name}: ${parts.join(", ")}`));
      }

      if (this.chatView) this.chatView.setProgress(null);

      // Trigger recall sync if installed
      try {
        const svcJson = JSON.parse(readFileSync(join(this.teammatesDir, "services.json"), "utf-8"));
        if (svcJson && "recall" in svcJson) {
          if (this.chatView) {
            this.chatView.setProgress(`Syncing ${name} index...`);
            this.refreshView();
          }
          let syncSpinner: Ora | null = null;
          if (!this.chatView) {
            syncSpinner = ora({ text: `Syncing ${name} index...`, color: "cyan" }).start();
          }
          await execAsync(`teammates-recall sync --dir "${this.teammatesDir}"`);
          if (syncSpinner) syncSpinner.succeed(`${name}: index synced`);
          if (this.chatView) {
            this.chatView.setProgress(null);
            this.feedLine(tp.success(`  ✔ ${name}: index synced`));
          }
        }
      } catch { /* recall not installed or sync failed — non-fatal */ }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (spinner) spinner.fail(`${name}: ${msg}`);
      if (this.chatView) {
        this.chatView.setProgress(null);
        this.feedLine(tp.error(`  ✖ ${name}: ${msg}`));
      }
    }
    this.refreshView();
  }

  /**
   * Background startup maintenance:
   * 1. Scan all teammates for daily logs older than a week → compact them
   * 2. Sync recall indexes if recall is installed
   */
  private async startupMaintenance(): Promise<void> {
    const teammates = this.orchestrator.listTeammates().filter((n) => n !== this.adapterName);
    if (teammates.length === 0) return;

    // Check if recall is installed
    let recallInstalled = false;
    try {
      const svcJson = JSON.parse(readFileSync(join(this.teammatesDir, "services.json"), "utf-8"));
      recallInstalled = !!(svcJson && "recall" in svcJson);
    } catch { /* no services.json */ }

    // 1. Check each teammate for stale daily logs (older than 7 days)
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const cutoff = oneWeekAgo.toISOString().slice(0, 10); // YYYY-MM-DD

    const needsCompact: string[] = [];
    for (const name of teammates) {
      const memoryDir = join(this.teammatesDir, name, "memory");
      try {
        const entries = await readdir(memoryDir);
        const hasStale = entries.some((e) => {
          if (!e.endsWith(".md")) return false;
          const stem = e.replace(".md", "");
          return /^\d{4}-\d{2}-\d{2}$/.test(stem) && stem < cutoff;
        });
        if (hasStale) needsCompact.push(name);
      } catch { /* no memory dir */ }
    }

    if (needsCompact.length > 0) {
      this.feedLine(
        concat(tp.muted("  Compacting stale logs for "), tp.accent(needsCompact.map((n) => `@${n}`).join(", ")), tp.muted("..."))
      );
      this.refreshView();
      for (const name of needsCompact) {
        await this.runCompact(name);
      }
    }

    // 2. Sync recall indexes if installed
    if (recallInstalled) {
      try {
        await execAsync(`teammates-recall sync --dir "${this.teammatesDir}"`);
      } catch { /* sync failed — non-fatal */ }
    }
  }

  private async cmdHelp(): Promise<void> {
    this.feedLine();
    this.feedLine(tp.bold("  Commands"));
    this.feedLine(tp.muted("  " + "─".repeat(50)));

    // De-duplicate (aliases map to same command)
    const seen = new Set<string>();
    for (const [, cmd] of this.commands) {
      if (seen.has(cmd.name)) continue;
      seen.add(cmd.name);

      const aliases =
        cmd.aliases.length > 0
          ? ` (${cmd.aliases.map((a) => "/" + a).join(", ")})`
          : "";
      this.feedLine(
        concat(tp.accent(("  " + cmd.usage).padEnd(36)), pen(cmd.description), tp.muted(aliases))
      );
    }
    this.feedLine();
    this.feedLine(concat(tp.muted("  Tip: "), tp.text("Type text without / to auto-route to the best teammate")));
    this.feedLine(concat(tp.muted("  Tip: "), tp.text("Press Tab to autocomplete commands and teammate names")));
    this.feedLine();
    this.refreshView();
  }

  private async cmdTheme(): Promise<void> {
    const t = theme();
    this.feedLine();
    this.feedLine(tp.bold("  Theme"));
    this.feedLine(tp.muted("  " + "─".repeat(50)));
    this.feedLine();

    // Helper: show a swatch + variable name + hex + example text
    const row = (name: string, c: Color, example: string) => {
      const hex = colorToHex(c);
      this.feedLine(concat(
        pen.fg(c)("  ██"),
        tp.text(("  " + name).padEnd(24)),
        tp.muted(hex.padEnd(12)),
        pen.fg(c)(example),
      ));
    };

    this.feedLine(tp.muted("       Variable                Hex         Example"));
    this.feedLine(tp.muted("  " + "─".repeat(50)));

    // Brand / accent
    row("accent",          t.accent,          "@beacon  /status  ● teammate");
    row("accentBright",    t.accentBright,    "▸ highlighted item");
    row("accentDim",       t.accentDim,       "┌─── border ───┐");

    this.feedLine();

    // Foreground
    row("text",            t.text,            "Primary text content");
    row("textMuted",       t.textMuted,       "Description or secondary info");
    row("textDim",         t.textDim,         "─── separator ───");

    this.feedLine();

    // Status
    row("success",         t.success,         "✔ Task completed");
    row("warning",         t.warning,         "⚠ Pending handoff");
    row("error",           t.error,           "✖ Something went wrong");
    row("info",            t.info,            "⠋ Working on task...");

    this.feedLine();

    // Interactive
    row("prompt",          t.prompt,          "> ");
    row("input",           t.input,           "user typed text");
    row("separator",       t.separator,       "────────────────");
    row("progress",        t.progress,        "analyzing codebase...");
    row("dropdown",        t.dropdown,        "/status  session overview");
    row("dropdownHighlight", t.dropdownHighlight, "▸ /help   all commands");

    this.feedLine();

    // Cursor
    this.feedLine(concat(
      pen.fg(t.cursorFg).bg(t.cursorBg)("  ██"),
      tp.text("  cursorFg/cursorBg".padEnd(24)),
      tp.muted((colorToHex(t.cursorFg) + "/" + colorToHex(t.cursorBg)).padEnd(12)),
      pen.fg(t.cursorFg).bg(t.cursorBg)(" block cursor "),
    ));

    this.feedLine();
    this.feedLine(tp.muted("  Base accent: #3A96DD"));
    this.feedLine();

    // ── Markdown preview ──────────────────────────────────────
    this.feedLine(tp.bold("  Markdown Preview"));
    this.feedLine(tp.muted("  " + "─".repeat(50)));
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
      "const greeting = \"hello\";",
      "async function main() {",
      "  await fetch(\"/api\");",
      "  return 42;",
      "}",
      "```",
      "",
      "```python",
      "def greet(name: str) -> None:",
      "    print(f\"Hello, {name}\")",
      "```",
      "",
      "```bash",
      "echo \"$HOME\" | grep --color user",
      "if [ -f .env ]; then source .env; fi",
      "```",
      "",
      "```json",
      "{",
      "  \"name\": \"teammates\",",
      "  \"version\": \"0.1.0\",",
      "  \"active\": true",
      "}",
      "```",
      "",
      "| Language   | Status  |",
      "|------------|---------|",
      "| JavaScript | ✔ Ready |",
      "| Python     | ✔ Ready |",
      "| C#         | ✔ Ready |",
      "",
      "---",
    ].join("\n");

    this.feedMarkdown(mdSample);
    this.feedLine();
    this.refreshView();
  }
}

// ─── Usage (non-interactive) ─────────────────────────────────────────

function printUsage(): void {
  console.log(`
${chalk.bold("@teammates/cli")} — Agent-agnostic teammate orchestrator

${chalk.bold("Usage:")}
  teammates <agent>          Launch session with an agent
  teammates claude           Use Claude Code
  teammates codex            Use OpenAI Codex
  teammates aider            Use Aider

${chalk.bold("Options:")}
  --model <model>            Override the agent model
  --dir <path>               Override .teammates/ location

${chalk.bold("Agents:")}
  claude     Claude Code CLI (requires 'claude' on PATH)
  codex      OpenAI Codex CLI (requires 'codex' on PATH)
  aider      Aider CLI (requires 'aider' on PATH)
  echo       Test adapter — echoes prompts (no external agent)

${chalk.bold("In-session:")}
  @teammate <task>           Assign directly via @mention
  <text>                     Auto-route to the best teammate
  /status                    Session overview
  /help                      All commands
`.trim());
}

// ─── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (showHelp) {
    printUsage();
    process.exit(0);
  }

  const repl = new TeammatesREPL(adapterName);
  await repl.start();
}

main().catch((err) => {
  console.error(chalk.red(err.message));
  process.exit(1);
});
