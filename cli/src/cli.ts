#!/usr/bin/env node

/**
 * @teammates/cli — Interactive teammate orchestrator.
 *
 * Start a session:
 *   teammates                     Launch interactive REPL
 *   teammates --adapter codex     Use a specific agent adapter
 *   teammates --dir <path>        Override .teammates/ location
 */

import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import { Writable } from "node:stream";
import { resolve, join } from "node:path";
import { stat, mkdir, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import chalk from "chalk";
import ora, { type Ora } from "ora";
import { Orchestrator } from "./orchestrator.js";
import type { AgentAdapter } from "./adapter.js";
import type { OrchestratorEvent, HandoffEnvelope, TaskResult } from "./types.js";
import { EchoAdapter } from "./adapters/echo.js";
import { CliProxyAdapter, PRESETS } from "./adapters/cli-proxy.js";
import { Dropdown } from "./dropdown.js";
import { getOnboardingPrompt } from "./onboard.js";

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

// ─── Slash commands ──────────────────────────────────────────────────

interface SlashCommand {
  name: string;
  aliases: string[];
  usage: string;
  description: string;
  run: (args: string) => Promise<void>;
}

interface WordwheelItem {
  label: string;        // left column display text
  description: string;  // right column display text
  completion: string;   // full line content when accepted
}

// ─── REPL ────────────────────────────────────────────────────────────

class TeammatesREPL {
  private orchestrator!: Orchestrator;
  private adapter!: AgentAdapter;
  private rl!: ReadlineInterface;
  private spinner: Ora | null = null;
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
  private taskQueue: { teammate: string; task: string }[] = [];
  private queueActive: { teammate: string; task: string } | null = null;
  private queueDraining = false;
  /** Mutex to prevent concurrent drainQueue invocations. Resolves when drain finishes. */
  private drainLock: Promise<void> | null = null;
  /** True while a task is being dispatched — prevents concurrent dispatches from pasted text. */
  private dispatching = false;
  /** Stored pasted text keyed by paste number, expanded on Enter. */
  private pastedTexts: Map<number, string> = new Map();
  private dropdown!: Dropdown;
  private wordwheelItems: WordwheelItem[] = [];
  private wordwheelIndex = -1;        // -1 = no selection, 0+ = highlighted row

  constructor(adapterName: string) {
    this.adapterName = adapterName;
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

    const onboardingPrompt = await getOnboardingPrompt(projectDir);
    const tempConfig = {
      name: this.adapterName,
      role: "Onboarding agent",
      soul: "",
      memories: "",
      dailyLogs: [] as { date: string; content: string }[],
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
    const teammatesDir = join(projectDir, ".teammates");
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
    const pad = (i: number) => infoLines[i] ? "   " + infoLines[i] : "";
    console.log(chalk.cyan(" ▐▛▀▀▀▀▀▀▜▌") + pad(0));
    console.log(chalk.cyan(" ▐▌") + "      " + chalk.cyan("▐▌") + pad(1));
    console.log(chalk.cyan(" ▐▌") + "  🧬  " + chalk.cyan("▐▌") + pad(2));
    console.log(chalk.cyan(" ▐▌") + "      " + chalk.cyan("▐▌") + pad(3));
    console.log(chalk.cyan(" ▐▙▄▄▄▄▄▄▟▌"));
  }

  /**
   * Print agent raw output, stripping the trailing JSON protocol block.
   */
  private printAgentOutput(rawOutput: string | undefined): void {
    const raw = rawOutput ?? "";
    if (!raw) return;
    const cleaned = raw.replace(/```json\s*\n\s*\{[\s\S]*?\}\s*\n\s*```\s*$/, "").trim();
    if (cleaned) {
      console.log(cleaned);
    }
    console.log();
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
    this.dropdown.clear();
  }

  private writeWordwheel(lines: string[]): void {
    this.dropdown.render(lines);
  }

  /**
   * Which argument positions are teammate-name completable per command.
   * Key = command name, value = set of 0-based arg positions that take a teammate.
   */
  private static readonly TEAMMATE_ARG_POSITIONS: Record<string, Set<number>> = {
    assign:  new Set([0]),
    handoff: new Set([0, 1]),
    log:     new Set([0]),
  };

  /** Build param-completion items for the current line, if any. */
  private getParamItems(cmdName: string, argsBefore: string, partial: string): WordwheelItem[] {
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
  private getAtMentionItems(line: string, before: string, partial: string, atPos: number): WordwheelItem[] {
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
    const line: string = (this.rl as any).line ?? "";
    const cursor: number = (this.rl as any).cursor ?? line.length;

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
        // No param completions — show static usage hint
        this.wordwheelIndex = -1;
        this.writeWordwheel([
          `  ${chalk.cyan(cmd.usage)}`,
          `  ${chalk.gray(cmd.description)}`,
        ]);
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

  /** Accept the currently highlighted item into the input line. */
  private acceptWordwheelSelection(): void {
    const item = this.wordwheelItems[this.wordwheelIndex];
    if (!item) return;
    this.clearWordwheel();
    (this.rl as any).line = item.completion;
    (this.rl as any).cursor = item.completion.length;
    (this.rl as any)._refreshLine();
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
      memories: "",
      dailyLogs: [],
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

    // Register commands
    this.registerCommands();

    // Create readline with a mutable output stream so we can mute
    // echo during paste detection.
    let outputMuted = false;
    const mutableOutput = new Writable({
      write(chunk, _encoding, callback) {
        if (!outputMuted) process.stdout.write(chunk);
        callback();
      },
    });
    // Trick readline into thinking it's a real TTY
    (mutableOutput as any).columns = process.stdout.columns;
    (mutableOutput as any).rows = process.stdout.rows;
    (mutableOutput as any).isTTY = true;
    (mutableOutput as any).cursorTo = process.stdout.cursorTo?.bind(process.stdout);
    (mutableOutput as any).clearLine = process.stdout.clearLine?.bind(process.stdout);
    (mutableOutput as any).moveCursor = process.stdout.moveCursor?.bind(process.stdout);
    (mutableOutput as any).getWindowSize = () => [process.stdout.columns ?? 80, process.stdout.rows ?? 24];
    process.stdout.on("resize", () => {
      (mutableOutput as any).columns = process.stdout.columns;
      (mutableOutput as any).rows = process.stdout.rows;
      mutableOutput.emit("resize");
    });

    this.rl = createInterface({
      input: process.stdin,
      output: mutableOutput,
      prompt: chalk.cyan("teammates") + chalk.gray("> "),
      terminal: true,
    });
    this.dropdown = new Dropdown(this.rl);

    // Pre-mute: if stdin delivers a chunk with multiple newlines (paste),
    // mute output immediately BEFORE readline echoes anything.
    process.stdin.prependListener("data", (chunk: Buffer) => {
      const str = chunk.toString();
      if (str.includes("\n") && str.indexOf("\n") < str.length - 1) {
        // Multiple lines in one chunk — it's a paste, mute now
        outputMuted = true;
      }
    });

    // Intercept all keypress via _ttyWrite so we can capture
    // arrow-down / arrow-up / Tab for wordwheel navigation.
    // Also used for paste prefix detection via timing heuristic.
    let lastKeystrokeTime = 0;
    const origTtyWrite = (this.rl as any)._ttyWrite.bind(this.rl);
    (this.rl as any)._ttyWrite = (s: string, key: any) => {
      // Timing-based paste prefix detection: if >50ms since last keystroke,
      // this is a new input burst. Snapshot rl.line BEFORE readline processes
      // this character — during a paste burst, characters arrive <5ms apart
      // so the snapshot stays at the pre-paste value.
      const now = Date.now();
      if (now - lastKeystrokeTime > 50) {
        prePastePrefix = (this.rl as any).line ?? "";
      }
      lastKeystrokeTime = now;

      const hasWheel = this.wordwheelItems.length > 0;

      if (hasWheel && key) {
        if (key.name === "down") {
          this.wordwheelIndex = Math.min(
            this.wordwheelIndex + 1,
            this.wordwheelItems.length - 1
          );
          this.renderItems(); // calls dropdown.render() → _refreshLine()
          return;
        }
        if (key.name === "up") {
          this.wordwheelIndex = Math.max(this.wordwheelIndex - 1, -1);
          this.renderItems(); // calls dropdown.render() → _refreshLine()
          return;
        }
        if (key.name === "tab" && this.wordwheelIndex >= 0) {
          this.acceptWordwheelSelection();
          return;
        }
      }

      // Enter/return — if a wordwheel item is highlighted, accept it into the
      // input line first.  For no-arg commands this means a single Enter both
      // populates and executes (e.g. arrow-down to /exit → Enter → exits).
      if (key && key.name === "return") {
        if (hasWheel && this.wordwheelIndex >= 0) {
          const item = this.wordwheelItems[this.wordwheelIndex];
          if (item) {
            (this.rl as any).line = item.completion;
            (this.rl as any).cursor = item.completion.length;
          }
        }
        this.dropdown.clear();
        this.wordwheelItems = [];
        this.wordwheelIndex = -1;
        // Force a refresh to erase dropdown, then let readline process Enter
        (this.rl as any)._refreshLine();
        origTtyWrite(s, key);
        return;
      }

      // Any other key — clear dropdown, let readline handle keystroke,
      // then recompute and render the new dropdown.
      this.dropdown.clear();
      this.wordwheelItems = [];
      this.wordwheelIndex = -1;
      origTtyWrite(s, key);
      // origTtyWrite called _refreshLine which cleared old dropdown.
      // Now compute new items and render (calls _refreshLine again with new suffix).
      this.updateWordwheel();
    };

    // Banner
    this.printBanner(this.orchestrator.listTeammates());

    // REPL loop
    this.rl.prompt();

    // ── Paste detection ──────────────────────────────────────────────
    // Strategy: the first `line` event echoes normally. We immediately
    // mute output so subsequent pasted lines are invisible. After 30ms
    // of quiet, we check: if only 1 line arrived it was normal typing
    // (already echoed, good). If multiple lines arrived, we erase the
    // one echoed line and show a placeholder instead.
    let pasteBuffer: string[] = [];
    let pasteTimer: ReturnType<typeof setTimeout> | null = null;
    let pasteCount = 0;
    let prePastePrefix = ""; // text user typed before paste started

    const processPaste = async () => {
      pasteTimer = null;
      outputMuted = false;
      const lines = pasteBuffer;
      pasteBuffer = [];

      if (lines.length === 0) return;

      if (lines.length > 1) {
        // Multi-line paste — the first line was echoed, the rest were muted.
        // Erase the first echoed line (move up 1, clear).
        process.stdout.write("\x1b[A\x1b[2K");

        pasteCount++;
        const combined = lines.join("\n");
        const sizeKB = Buffer.byteLength(combined, "utf-8") / 1024;
        const tag = `[Pasted text #${pasteCount} +${lines.length} lines, ${sizeKB.toFixed(1)}KB] `;

        // Store the pasted text — expanded when the user presses Enter.
        this.pastedTexts.set(pasteCount, combined);

        // Restore what the user typed before the paste, plus the placeholder.
        const newLine = prePastePrefix + tag;
        prePastePrefix = ""; // reset for next paste
        (this.rl as any).line = newLine;
        (this.rl as any).cursor = newLine.length;
        this.rl.prompt(true);
        return;
      }

      // Expand paste placeholders with actual content
      const rawLine = lines[0];
      const hasPaste = /\[Pasted text #\d+/.test(rawLine);

      let input = rawLine.replace(/\[Pasted text #(\d+) \+\d+ lines, [\d.]+KB\]\s*/g, (_match, num) => {
        const n = parseInt(num, 10);
        const text = this.pastedTexts.get(n);
        if (text) {
          this.pastedTexts.delete(n);
          return text + "\n";
        }
        return "";
      }).trim();

      // Show the expanded pasted content on Enter
      if (hasPaste && input) {
        const sizeKB = Buffer.byteLength(input, "utf-8") / 1024;
        const lineCount = input.split("\n").length;
        console.log();
        console.log(chalk.gray(`  ┌ Expanded paste (${lineCount} lines, ${sizeKB.toFixed(1)}KB)`));
        // Show first few lines as preview
        const previewLines = input.split("\n").slice(0, 5);
        for (const l of previewLines) {
          console.log(chalk.gray(`  │ `) + l.slice(0, 120));
        }
        if (lineCount > 5) {
          console.log(chalk.gray(`  │ ... ${lineCount - 5} more lines`));
        }
        console.log(chalk.gray(`  └`));
      }

      if (!input || this.dispatching) {
        this.rl.prompt();
        return;
      }

      if (!input.startsWith("/")) {
        this.conversationHistory.push({ role: "user", text: input });
      }

      this.dispatching = true;
      try {
        await this.dispatch(input);
      } catch (err: any) {
        console.log(chalk.red(`Error: ${err.message}`));
      } finally {
        this.dispatching = false;
      }

      this.rl.prompt();
    };

    this.rl.on("line", (line: string) => {
      this.dropdown.clear();
      this.wordwheelItems = [];
      this.wordwheelIndex = -1;

      pasteBuffer.push(line);

      // After the first line, mute readline output so subsequent
      // pasted lines don't echo to the terminal.
      if (pasteBuffer.length === 1) {
        outputMuted = true;
      }

      if (pasteTimer) clearTimeout(pasteTimer);
      pasteTimer = setTimeout(processPaste, 30);
    });

    this.rl.on("close", async () => {
      this.clearWordwheel();
      console.log(chalk.gray("\nShutting down..."));
      await this.orchestrator.shutdown();
      process.exit(0);
    });
  }

  private printBanner(teammates: string[]): void {
    const registry = this.orchestrator.getRegistry();
    const termWidth = process.stdout.columns || 100;
    const divider = chalk.gray("─".repeat(termWidth));

    // Detect recall system
    let recallInstalled = false;
    try {
      execFileSync("teammates-recall", ["--help"], { stdio: "ignore" });
      recallInstalled = true;
    } catch { /* not found */ }

    console.log();
    this.printLogo([
      chalk.bold("Teammates") + chalk.gray(" v0.1.0"),
      chalk.white(this.adapterName) +
        chalk.gray(` · ${teammates.length} teammate${teammates.length === 1 ? "" : "s"}`),
      chalk.gray(process.cwd()),
      recallInstalled
        ? chalk.green("● recall") + chalk.gray(" installed")
        : chalk.yellow("○ recall") + chalk.gray(" not installed"),
    ]);

    // Roster
    console.log();
    for (const name of teammates) {
      const t = registry.get(name);
      if (t) {
        console.log(
          chalk.gray(" ") +
            chalk.cyan("●") +
            chalk.cyan(` @${name}`.padEnd(14)) +
            chalk.gray(t.role)
        );
      }
    }

    console.log();
    console.log(divider);

    // Quick reference — 3 columns
    const col1 = [
      ["@mention", "assign to teammate"],
      ["text", "auto-route task"],
      ["/queue", "queue tasks"],
    ];
    const col2 = [
      ["/status", "session overview"],
      ["/debug", "raw agent output"],
      ["/log", "last task output"],
    ];
    const col3 = [
      ["/help", "all commands"],
      ["/exit", "exit session"],
      ["Tab", "autocomplete"],
    ];

    for (let i = 0; i < col1.length; i++) {
      const c1 = chalk.cyan(col1[i][0].padEnd(12)) + chalk.gray(col1[i][1].padEnd(22));
      const c2 = chalk.cyan(col2[i][0].padEnd(12)) + chalk.gray(col2[i][1].padEnd(22));
      const c3 = chalk.cyan(col3[i][0].padEnd(12)) + chalk.gray(col3[i][1]);
      console.log(`  ${c1}${c2}${c3}`);
    }

    console.log();
    console.log(divider);
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
        usage: "/queue [@teammate] [task]",
        description: "Add to queue, or show queue if no args",
        run: (args) => this.cmdQueue(args),
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
        name: "exit",
        aliases: ["q", "quit"],
        usage: "/exit",
        description: "Exit the session",
        run: async () => {
          console.log(chalk.gray("Shutting down..."));
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
    // Handle pending handoff menu (1/2/3)
    if (this.orchestrator.getPendingHandoff()) {
      const handled = await this.handleHandoffChoice(input);
      if (handled) return;
    }

    if (input.startsWith("/")) {
      const spaceIdx = input.indexOf(" ");
      const cmdName = spaceIdx > 0 ? input.slice(1, spaceIdx) : input.slice(1);
      const cmdArgs = spaceIdx > 0 ? input.slice(spaceIdx + 1).trim() : "";

      const cmd = this.commands.get(cmdName);
      if (cmd) {
        await cmd.run(cmdArgs);
      } else {
        console.log(chalk.yellow(`Unknown command: /${cmdName}`));
        console.log(chalk.gray("Type /help for available commands"));
      }
    } else {
      // Check for @mention — extract teammate and treat rest as task
      const mentionMatch = input.match(/^@(\S+)\s+([\s\S]+)$/);
      if (mentionMatch) {
        const [, teammate, task] = mentionMatch;
        const names = this.orchestrator.listTeammates();
        if (names.includes(teammate)) {
          await this.cmdAssign(`${teammate} ${task}`);
          return;
        }
      }

      // Also handle @mentions inline: strip @names and route to them
      const inlineMention = input.match(/@(\S+)/);
      if (inlineMention) {
        const teammate = inlineMention[1];
        const names = this.orchestrator.listTeammates();
        if (names.includes(teammate)) {
          const task = input.replace(/@\S+\s*/, "").trim();
          if (task) {
            await this.cmdAssign(`${teammate} ${task}`);
            return;
          }
        }
      }

      // Bare text — auto-route
      await this.cmdRoute(input);
    }
  }

  // ─── Event handler ───────────────────────────────────────────────

  private handleEvent(event: OrchestratorEvent): void {
    // When queue is draining in background, never use spinner — it blocks the prompt
    const useSpinner = !this.queueDraining;

    switch (event.type) {
      case "task_assigned":
        if (useSpinner) {
          this.spinner = ora({
            text: chalk.blue(`${event.assignment.teammate}`) +
              chalk.gray(` is working on: ${event.assignment.task.slice(0, 60)}...`),
            spinner: "dots",
          }).start();
        } else if (!this.queueDraining) {
          console.log(
            chalk.blue(`  ${event.assignment.teammate}`) +
              chalk.gray(` is working on: ${event.assignment.task.slice(0, 60)}...`)
          );
        }
        break;

      case "task_completed": {
        if (this.spinner) {
          this.spinner.stop();
          this.spinner = null;
        }

        const raw = event.result.rawOutput ?? "";
        const cleaned = raw.replace(/```json\s*\n\s*\{[\s\S]*?\}\s*\n\s*```\s*$/, "").trim();
        const sizeKB = cleaned ? Buffer.byteLength(cleaned, "utf-8") / 1024 : 0;

        console.log();
        if (sizeKB > 5) {
          console.log(chalk.gray("  ─".repeat(40)));
          console.log(
            chalk.yellow(`  ⚠ Response is ${sizeKB.toFixed(1)}KB — use /debug ${event.result.teammate} to view full output`)
          );
          console.log(chalk.gray("  ─".repeat(40)));
        } else if (cleaned) {
          console.log(cleaned);
        }

        console.log();
        console.log(
          chalk.green(`  ✔ ${event.result.teammate}`) +
            chalk.gray(": ") +
            event.result.summary
        );
      }
        break;

      case "handoff_initiated":
        if (this.spinner) {
          this.spinner.info(
            chalk.yellow("Handoff: ") +
              chalk.bold(event.envelope.from) +
              chalk.yellow(" → ") +
              chalk.bold(event.envelope.to)
          );
          this.spinner = null;
        }
        this.printHandoffDetails(event.envelope);
        break;

      case "handoff_completed":
        // Already handled via task_completed
        break;

      case "error":
        if (this.spinner) {
          this.spinner.fail(
            chalk.red(event.teammate) + chalk.gray(": ") + event.error
          );
          this.spinner = null;
        } else {
          console.log(chalk.red(`  ${event.teammate}: ${event.error}`));
        }
        break;
    }
  }

  private printHandoffDetails(envelope: HandoffEnvelope): void {
    console.log(chalk.gray("  ┌─────────────────────────────────────"));
    console.log(
      chalk.gray("  │ ") +
        chalk.white("Task: ") +
        envelope.task
    );
    if (envelope.changedFiles?.length) {
      console.log(
        chalk.gray("  │ ") +
          chalk.white("Files: ") +
          envelope.changedFiles.join(", ")
      );
    }
    if (envelope.acceptanceCriteria?.length) {
      console.log(chalk.gray("  │ ") + chalk.white("Criteria:"));
      for (const c of envelope.acceptanceCriteria) {
        console.log(chalk.gray("  │   ") + chalk.gray("• ") + c);
      }
    }
    if (envelope.openQuestions?.length) {
      console.log(chalk.gray("  │ ") + chalk.white("Questions:"));
      for (const q of envelope.openQuestions) {
        console.log(chalk.gray("  │   ") + chalk.gray("? ") + q);
      }
    }
    console.log(chalk.gray("  └─────────────────────────────────────"));
    console.log();
    console.log(
      chalk.cyan("  1") + chalk.gray(") Approve")
    );
    console.log(
      chalk.cyan("  2") + chalk.gray(") Always approve handoffs")
    );
    console.log(
      chalk.cyan("  3") + chalk.gray(") Reject")
    );
    console.log();
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
        console.log(chalk.gray("  Auto-approving all future handoffs."));
    
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
        console.log(
          chalk.gray(`  Rejected handoff from `) +
            chalk.bold(pending.from) +
            chalk.gray(" to ") +
            chalk.bold(pending.to)
        );
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
      console.log(chalk.yellow("Usage: /assign <teammate> <task...>"));
      return;
    }

    const [, teammate, task] = parts;

    // Pause readline so streamed agent output isn't garbled by the prompt

    const extraContext = this.buildConversationContext();
    const result = await this.orchestrator.assign({ teammate, task, extraContext: extraContext || undefined });

    this.storeResult(result);

    if (result.handoff && this.orchestrator.requireApproval) {
      // Handoff is pending — user was already prompted
    }
  }

  private async cmdRoute(argsStr: string): Promise<void> {
    const match = this.orchestrator.route(argsStr) ?? this.adapterName;

    console.log(chalk.gray(`  Routed to: ${chalk.bold(match)}`));

    const extraContext = this.buildConversationContext();
    const result = await this.orchestrator.assign({ teammate: match, task: argsStr, extraContext: extraContext || undefined });

    this.storeResult(result);
  }

  private async cmdStatus(): Promise<void> {
    const statuses = this.orchestrator.getAllStatuses();
    const registry = this.orchestrator.getRegistry();

    console.log();
    console.log(chalk.bold("  Status"));
    console.log(chalk.gray("  " + "─".repeat(60)));

    for (const [name, status] of statuses) {
      const teammate = registry.get(name);
      const stateColor =
        status.state === "idle"
          ? chalk.gray
          : status.state === "working"
            ? chalk.blue
            : chalk.yellow;

      const stateLabel = stateColor(status.state.padEnd(16));
      const nameLabel = chalk.bold(name.padEnd(14));

      let detail = chalk.gray("—");
      if (status.lastSummary) {
        const time = status.lastTimestamp ? chalk.gray(` (${relativeTime(status.lastTimestamp)})`) : "";
        detail = chalk.white(status.lastSummary.slice(0, 50)) + time;
      }
      if (status.state === "pending-handoff" && status.pendingHandoff) {
        detail = chalk.yellow(`→ ${status.pendingHandoff.to}: ${status.pendingHandoff.task.slice(0, 40)}`);
      }

      console.log(`  ${nameLabel} ${stateLabel} ${detail}`);
    }
    console.log();
  }

  private async cmdTeammates(): Promise<void> {
    const names = this.orchestrator.listTeammates();
    const registry = this.orchestrator.getRegistry();

    console.log();
    for (const name of names) {
      const t = registry.get(name)!;
      console.log(
        chalk.cyan(`  @${name}`.padEnd(16)) +
          chalk.gray(t.role)
      );
      if (t.ownership.primary.length > 0) {
        console.log(
          chalk.gray("                ") +
            chalk.gray("owns: ") +
            chalk.white(t.ownership.primary.join(", "))
        );
      }
    }
    console.log();
  }

  private async cmdLog(argsStr: string): Promise<void> {
    const teammate = argsStr.trim();

    if (teammate) {
      // Show specific teammate's last result
      const status = this.orchestrator.getStatus(teammate);
      if (!status) {
        console.log(chalk.yellow(`Unknown teammate: ${teammate}`));
        return;
      }
      this.printTeammateLog(teammate, status);
    } else if (this.lastResult) {
      // Show last result globally
      const status = this.orchestrator.getStatus(this.lastResult.teammate);
      if (status) this.printTeammateLog(this.lastResult.teammate, status);
    } else {
      console.log(chalk.gray("No task results yet."));
    }
  }

  private printTeammateLog(
    name: string,
    status: { lastSummary?: string; lastChangedFiles?: string[]; lastTimestamp?: Date }
  ): void {
    console.log();
    console.log(chalk.bold(`  ${name}`));

    if (status.lastSummary) {
      console.log(chalk.white(`  Summary: `) + status.lastSummary);
    }
    if (status.lastChangedFiles?.length) {
      console.log(chalk.white(`  Changed:`));
      for (const f of status.lastChangedFiles) {
        console.log(chalk.gray(`    • `) + f);
      }
    }
    if (status.lastTimestamp) {
      console.log(chalk.gray(`  Time: ${relativeTime(status.lastTimestamp)}`));
    }
    if (!status.lastSummary) {
      console.log(chalk.gray("  No task results yet."));
    }
    console.log();
  }

  private async cmdDebug(argsStr: string): Promise<void> {
    const teammate = argsStr.trim();
    const result = teammate
      ? this.lastResults.get(teammate)
      : this.lastResult;

    if (!result?.rawOutput) {
      console.log(chalk.gray("  No raw output available." + (teammate ? "" : " Try: /debug <teammate>")));
      return;
    }

    console.log();
    console.log(chalk.gray(`  ── raw output from ${result.teammate} ──`));
    console.log();
    console.log(result.rawOutput);
    console.log();
    console.log(chalk.gray(`  ── end raw output ──`));
    console.log();
  }

  private async cmdCancel(argsStr: string): Promise<void> {
    const n = parseInt(argsStr.trim(), 10);
    if (isNaN(n) || n < 1 || n > this.taskQueue.length) {
      if (this.taskQueue.length === 0) {
        console.log(chalk.gray("  Queue is empty."));
      } else {
        console.log(chalk.yellow(`  Usage: /cancel <1-${this.taskQueue.length}>`));
      }
      return;
    }

    const removed = this.taskQueue.splice(n - 1, 1)[0];
    console.log(
      chalk.gray("  Cancelled: ") +
        chalk.cyan(`@${removed.teammate}`) +
        chalk.gray(" — ") +
        chalk.white(removed.task.slice(0, 60))
    );
  }

  private async cmdQueue(argsStr: string): Promise<void> {
    if (!argsStr) {
      // Show queue
      if (this.taskQueue.length === 0 && !this.queueDraining) {
        console.log(chalk.gray("  Queue is empty."));
        return;
      }
      console.log();
      console.log(
        chalk.bold("  Task Queue") +
          (this.queueDraining ? chalk.blue("  (draining)") : "")
      );
      console.log(chalk.gray("  " + "─".repeat(50)));
      if (this.queueActive) {
        console.log(
          chalk.blue("  ▸ ") +
            chalk.cyan(`@${this.queueActive.teammate}`) +
            chalk.gray(" — ") +
            chalk.white(this.queueActive.task.length > 60 ? this.queueActive.task.slice(0, 57) + "..." : this.queueActive.task) +
            chalk.blue("  (running)")
        );
      }
      for (let i = 0; i < this.taskQueue.length; i++) {
        const entry = this.taskQueue[i];
        console.log(
          chalk.gray(`  ${i + 1}. `) +
            chalk.cyan(`@${entry.teammate}`) +
            chalk.gray(" — ") +
            chalk.white(entry.task.length > 60 ? entry.task.slice(0, 57) + "..." : entry.task)
        );
      }
      if (this.taskQueue.length > 0) {
        console.log(chalk.gray("  /cancel <n> to remove a task"));
      }
      console.log();
      return;
    }

    // Parse: @teammate task or teammate task
    const match = argsStr.match(/^@?(\S+)(?:\s+([\s\S]+))?$/);
    if (!match) {
      console.log(chalk.yellow("  Usage: /queue @teammate <task...>"));
      return;
    }

    const [, teammate, task] = match;
    const names = this.orchestrator.listTeammates();
    if (!names.includes(teammate)) {
      console.log(chalk.yellow(`  Unknown teammate: ${teammate}`));
      return;
    }

    if (!task?.trim()) {
      console.log(chalk.yellow(`  Missing task. Usage: /queue @${teammate} <task...>`));
      return;
    }

    this.taskQueue.push({ teammate, task: task.trim() });
    console.log();
    console.log(
      chalk.gray("  Queued: ") +
        chalk.cyan(`@${teammate}`) +
        chalk.gray(" — ") +
        chalk.white(task.trim().slice(0, 60)) +
        chalk.gray(` (${this.taskQueue.length} in queue)`)
    );
    console.log(
      chalk.blue(`  ${teammate}`) +
        chalk.gray(` is working on: ${task.trim().slice(0, 60)}...`)
    );
    console.log();

    // Start draining if not already (mutex-protected)
    if (!this.drainLock) {
      this.drainLock = this.drainQueue().finally(() => { this.drainLock = null; });
    }
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

        const extraContext = this.buildConversationContext();
        const result = await this.orchestrator.assign({
          teammate: entry.teammate,
          task: entry.task,
          extraContext: extraContext || undefined,
        });

        this.queueActive = null;
        this.storeResult(result);
      }

      console.log(chalk.green("  ✔ Queue complete."));
      this.rl.prompt();
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
    console.log(chalk.gray("  Run /teammates to see the roster."));
  }

  private async cmdClear(): Promise<void> {
    // Reset all session state
    this.conversationHistory.length = 0;
    this.lastResult = null;
    this.lastResults.clear();
    this.taskQueue.length = 0;
    this.queueActive = null;
    this.pastedTexts.clear();
    await this.orchestrator.reset();

    // Clear terminal and reprint banner
    process.stdout.write("\x1b[2J\x1b[H");
    this.printBanner(this.orchestrator.listTeammates());
  }

  private async cmdHelp(): Promise<void> {
    console.log();
    console.log(chalk.bold("  Commands"));
    console.log(chalk.gray("  " + "─".repeat(50)));

    // De-duplicate (aliases map to same command)
    const seen = new Set<string>();
    for (const [, cmd] of this.commands) {
      if (seen.has(cmd.name)) continue;
      seen.add(cmd.name);

      const aliases =
        cmd.aliases.length > 0
          ? chalk.gray(` (${cmd.aliases.map((a) => "/" + a).join(", ")})`)
          : "";
      console.log(
        `  ${chalk.cyan(cmd.usage.padEnd(36))}${cmd.description}${aliases}`
      );
    }
    console.log();
    console.log(
      chalk.gray("  Tip: ") +
        chalk.white("Type text without / to auto-route to the best teammate")
    );
    console.log(
      chalk.gray("  Tip: ") +
        chalk.white("Press Tab to autocomplete commands and teammate names")
    );
    console.log();
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
