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
import { esc, stripAnsi } from "@teammates/consolonia";
import { PromptInput } from "./console/prompt-input.js";
import { renderMarkdownTables } from "./console/markdown-table.js";
import { playStartup, buildTitle } from "./console/startup.js";
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

interface WordwheelItem {
  label: string;        // left column display text
  description: string;  // right column display text
  completion: string;   // full line content when accepted
}

// ─── REPL ────────────────────────────────────────────────────────────

class TeammatesREPL {
  private orchestrator!: Orchestrator;
  private adapter!: AgentAdapter;
  private input!: PromptInput;
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
  private wordwheelItems: WordwheelItem[] = [];
  private wordwheelIndex = -1;        // -1 = no selection, 0+ = highlighted row

  constructor(adapterName: string) {
    this.adapterName = adapterName;
  }

  /** Show the prompt with the fenced border. */
  private showPrompt(): void {
    this.input.activate();
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
      console.log(renderMarkdownTables(cleaned));
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
    this.input.clearDropdown();
  }

  private writeWordwheel(lines: string[]): void {
    this.input.setDropdown(lines);
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
  private getParamItems(cmdName: string, argsBefore: string, partial: string): WordwheelItem[] {
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
    const line: string = this.input.line;
    const cursor: number = this.input.cursor;

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
    this.input.setLine(item.completion);
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
        // If a wordwheel item is highlighted, accept it into the line
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

    this.input.on("tab", () => {
      if (this.wordwheelItems.length > 0) {
        // If no item is highlighted, select the first one
        if (this.wordwheelIndex < 0) this.wordwheelIndex = 0;
        this.acceptWordwheelSelection();
      }
    });

    this.input.on("change", () => {
      // Clear old wordwheel, recompute from new input
      this.wordwheelItems = [];
      this.wordwheelIndex = -1;
      this.updateWordwheel();
    });

    // ── Line submission ──────────────────────────────────────────────

    this.input.on("line", async (rawLine: string) => {
      this.clearWordwheel();
      this.wordwheelItems = [];
      this.wordwheelIndex = -1;

      // Deactivate prompt so agent output doesn't garble it
      this.input.deactivate();

      // Expand paste placeholders with actual content
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

      // Show the expanded pasted content
      if (hasPaste && input) {
        const sizeKB = Buffer.byteLength(input, "utf-8") / 1024;
        const lineCount = input.split("\n").length;
        console.log();
        console.log(chalk.gray(`  ┌ Expanded paste (${lineCount} lines, ${sizeKB.toFixed(1)}KB)`));
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
        this.showPrompt();
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

      this.showPrompt();
    });

    // ── Paste handling (bracketed paste from consolonia) ──────────────

    let pasteCount = 0;

    this.input.on("paste", (text: string) => {
      const lines = text.split("\n");

      if (lines.length > 1) {
        // Multi-line paste — collapse into a placeholder tag
        pasteCount++;
        const combined = text;
        const sizeKB = Buffer.byteLength(combined, "utf-8") / 1024;
        const tag = `[Pasted text #${pasteCount} +${lines.length} lines, ${sizeKB.toFixed(1)}KB] `;

        this.pastedTexts.set(pasteCount, combined);

        // Append the placeholder tag to the current line
        const current = this.input.line;
        this.input.setLine(current + tag);
      } else {
        // Single line paste — insert directly
        const current = this.input.line;
        const cursor = this.input.cursor;
        this.input.setLine(
          current.slice(0, cursor) + text + current.slice(cursor)
        );
      }
    });

    // ── Close handler ────────────────────────────────────────────────

    this.input.on("close", async () => {
      this.clearWordwheel();
      console.log(chalk.gray("\nShutting down..."));
      await this.orchestrator.shutdown();
      process.exit(0);
    });

    // Animated startup
    {
      const names = this.orchestrator.listTeammates();
      const reg = this.orchestrator.getRegistry();
      let hasRecall = false;
      try {
        const svcJson = JSON.parse(readFileSync(join(this.teammatesDir, "services.json"), "utf-8"));
        hasRecall = !!(svcJson && "recall" in svcJson);
      } catch { /* no services.json */ }

      await playStartup({
        version: "0.1.0",
        adapterName: this.adapterName,
        teammateCount: names.length,
        cwd: process.cwd(),
        recallInstalled: hasRecall,
        teammates: names.map((name) => {
          const t = reg.get(name);
          return { name, role: t?.role ?? "" };
        }),
      });
    }

    // REPL loop
    this.showPrompt();
  }

  private printBanner(teammates: string[]): void {
    const registry = this.orchestrator.getRegistry();
    const termWidth = process.stdout.columns || 100;
    const divider = chalk.gray("─".repeat(termWidth));

    // Detect recall from services.json
    let recallInstalled = false;
    try {
      const svcJson = JSON.parse(readFileSync(join(this.teammatesDir, "services.json"), "utf-8"));
      recallInstalled = !!(svcJson && "recall" in svcJson);
    } catch { /* no services.json or invalid */ }

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
      ["/install", "add a service"],
      ["/help", "all commands"],
      ["/exit", "exit session"],
    ];

    for (let i = 0; i < col1.length; i++) {
      const c1 = chalk.cyan(col1[i][0].padEnd(12)) + chalk.gray(col1[i][1].padEnd(22));
      const c2 = chalk.cyan(col2[i][0].padEnd(12)) + chalk.gray(col2[i][1].padEnd(22));
      const c3 = chalk.cyan(col3[i][0].padEnd(12)) + chalk.gray(col3[i][1]);
      console.log(`  ${c1}${c2}${c3}`);
    }

    console.log();
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
        name: "exit",
        aliases: ["q", "quit"],
        usage: "/exit",
        description: "Exit the session",
        run: async () => {
          console.log(chalk.gray("Shutting down..."));
          this.stopRecallWatch();
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
          console.log(renderMarkdownTables(cleaned));
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
    // Collect content lines: [label, value] pairs and indented sub-items
    const lines: string[] = [];
    lines.push(chalk.white("Task: ") + envelope.task);
    if (envelope.changedFiles?.length) {
      lines.push(chalk.white("Files: ") + envelope.changedFiles.join(", "));
    }
    if (envelope.context) {
      lines.push(chalk.white("Context: ") + envelope.context);
    }
    if (envelope.acceptanceCriteria?.length) {
      lines.push(chalk.white("Criteria:"));
      for (const c of envelope.acceptanceCriteria) {
        lines.push("  " + chalk.gray("•") + " " + c);
      }
    }
    if (envelope.openQuestions?.length) {
      lines.push(chalk.white("Questions:"));
      for (const q of envelope.openQuestions) {
        lines.push("  " + chalk.gray("?") + " " + q);
      }
    }

    // Calculate box width from visible content
    const maxContent = Math.max(...lines.map((l) => stripAnsi(l).length));
    const innerWidth = Math.max(maxContent + 2, 40); // 1 padding each side, min 40

    const h = "─".repeat(innerWidth);
    const pad = (line: string) => {
      const vis = stripAnsi(line).length;
      return " " + line + " ".repeat(Math.max(0, innerWidth - vis - 2)) + " ";
    };

    console.log(chalk.gray("  ┌" + h + "┐"));
    for (const line of lines) {
      console.log(chalk.gray("  │") + pad(line) + chalk.gray("│"));
    }
    console.log(chalk.gray("  └" + h + "┘"));
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

    const extraContext = this.buildConversationContext();
    const result = await this.orchestrator.assign({ teammate, task, extraContext: extraContext || undefined });

    this.storeResult(result);

    if (result.handoff && this.orchestrator.requireApproval) {
      // Handoff is pending — user was already prompted
    }
  }

  private async cmdRoute(argsStr: string): Promise<void> {
    let match = this.orchestrator.route(argsStr);

    if (!match) {
      // Keyword routing didn't find a strong match — ask the agent
      match = await this.orchestrator.agentRoute(argsStr);
    }

    match = match ?? this.adapterName;

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

    this.taskQueue.push({ type: "agent", teammate, task: task.trim() });
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

      console.log(chalk.green("  ✔ Queue complete."));
      this.showPrompt();
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

  private async cmdInstall(argsStr: string): Promise<void> {
    const serviceName = argsStr.trim().toLowerCase();

    if (!serviceName) {
      console.log(chalk.bold("\n  Available services:"));
      for (const [name, svc] of Object.entries(SERVICE_REGISTRY)) {
        console.log(`  ${chalk.cyan(name.padEnd(16))}${chalk.gray(svc.description)}`);
      }
      console.log();
      return;
    }

    const service = SERVICE_REGISTRY[serviceName];
    if (!service) {
      console.log(chalk.red(`  Unknown service: ${serviceName}`));
      console.log(chalk.gray(`  Available: ${Object.keys(SERVICE_REGISTRY).join(", ")}`));
      return;
    }

    // Install the package globally
    const spinner = ora({
      text: chalk.blue(serviceName) + chalk.gray(` installing ${service.package}...`),
      spinner: "dots",
    }).start();

    try {
      await execAsync(`npm install -g ${service.package}`, {
        timeout: 5 * 60 * 1000,
      });
      spinner.stop();
    } catch (err: any) {
      spinner.fail(chalk.red(`Install failed: ${err.message}`));
      return;
    }

    // Verify the binary works
    const checkCmdStr = service.checkCmd.join(" ");
    try {
      execSync(checkCmdStr, { stdio: "ignore" });
    } catch {
      console.log(chalk.green(`  ✔ ${serviceName}`) + chalk.gray(" installed"));
      console.log(chalk.yellow(`  ⚠ Restart your terminal to add ${service.checkCmd[0]} to your PATH, then run /install ${serviceName} again to build the index.`));
      return;
    }

    console.log(chalk.green(`  ✔ ${serviceName}`) + chalk.gray(" installed successfully"));

    // Register in services.json
    const svcPath = join(this.teammatesDir, "services.json");
    let svcJson: Record<string, unknown> = {};
    try { svcJson = JSON.parse(readFileSync(svcPath, "utf-8")); } catch { /* new file */ }
    if (!(serviceName in svcJson)) {
      svcJson[serviceName] = {};
      writeFileSync(svcPath, JSON.stringify(svcJson, null, 2) + "\n");
      console.log(chalk.gray(`  Registered in services.json`));
    }

    // Build initial index if this service supports it
    if (service.indexCmd) {
      const indexSpinner = ora({
        text: chalk.blue(serviceName) + chalk.gray(` building index...`),
        spinner: "dots",
      }).start();

      const indexCmdStr = service.indexCmd.join(" ");
      try {
        await execAsync(indexCmdStr, {
          cwd: resolve(this.teammatesDir, ".."),
          timeout: 5 * 60 * 1000,
        });
        indexSpinner.succeed(chalk.blue(serviceName) + chalk.gray(" index built"));
      } catch (err: any) {
        indexSpinner.warn(chalk.yellow(`Index build failed: ${err.message}`));
      }
    }

    // Ask the coding agent to wire the service into the project
    if (service.wireupTask) {
      console.log();
      console.log(chalk.gray(`  Wiring up ${serviceName}...`));
      const result = await this.orchestrator.assign({
        teammate: this.adapterName,
        task: service.wireupTask,
      });
      this.storeResult(result);
    }
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
    process.stdout.write(esc.clearScreen + esc.moveTo(0, 0));
    this.printBanner(this.orchestrator.listTeammates());
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
          console.log(chalk.yellow(`  ${name}: not a directory, skipping`));
          continue;
        }
        valid.push(name);
      } catch {
        console.log(chalk.yellow(`  ${name}: no directory found, skipping`));
      }
    }

    if (valid.length === 0) return;

    // Queue a compact task for each teammate
    for (const name of valid) {
      this.taskQueue.push({ type: "compact", teammate: name, task: "compact + index update" });
    }

    console.log();
    console.log(
      chalk.gray("  Queued compaction for ") +
        chalk.cyan(valid.map((n) => `@${n}`).join(", ")) +
        chalk.gray(` (${valid.length} task${valid.length === 1 ? "" : "s"})`)
    );
    console.log();

    // Start draining if not already
    if (!this.drainLock) {
      this.drainLock = this.drainQueue().finally(() => { this.drainLock = null; });
    }
  }

  /** Run compaction + recall index update for a single teammate. */
  private async runCompact(name: string): Promise<void> {
    const teammateDir = join(this.teammatesDir, name);
    const spinner = ora({ text: `Compacting ${name}...`, color: "cyan" }).start();
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
        spinner.info(`${name}: nothing to compact`);
      } else {
        spinner.succeed(`${name}: ${parts.join(", ")}`);
      }

      // Trigger recall sync if installed
      try {
        const svcJson = JSON.parse(readFileSync(join(this.teammatesDir, "services.json"), "utf-8"));
        if (svcJson && "recall" in svcJson) {
          const syncSpinner = ora({ text: `Syncing ${name} index...`, color: "cyan" }).start();
          await execAsync(`teammates-recall sync --dir "${this.teammatesDir}"`);
          syncSpinner.succeed(`${name}: index synced`);
        }
      } catch { /* recall not installed or sync failed — non-fatal */ }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      spinner.fail(`${name}: ${msg}`);
    }
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
      console.log(
        chalk.gray("  Compacting stale logs for ") +
          chalk.cyan(needsCompact.map((n) => `@${n}`).join(", ")) +
          chalk.gray("...")
      );
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
