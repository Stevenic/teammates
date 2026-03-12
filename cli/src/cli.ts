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
import { resolve, join } from "node:path";
import { stat } from "node:fs/promises";
import chalk from "chalk";
import ora, { type Ora } from "ora";
import { Orchestrator } from "./orchestrator.js";
import type { AgentAdapter } from "./adapter.js";
import type { OrchestratorEvent, HandoffEnvelope, TaskResult } from "./types.js";
import { EchoAdapter } from "./adapters/echo.js";
import { CliProxyAdapter, PRESETS } from "./adapters/cli-proxy.js";

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

async function findTeammatesDir(): Promise<string> {
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
  console.error(chalk.red("No .teammates/ directory found. Are you in a teammates project?"));
  process.exit(1);
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
  private rl!: ReadlineInterface;
  private spinner: Ora | null = null;
  private commands: Map<string, SlashCommand> = new Map();
  private lastResult: TaskResult | null = null;
  private adapterName: string;
  private wordwheelRendered = 0;      // lines currently drawn below prompt
  private wordwheelItems: WordwheelItem[] = [];
  private wordwheelIndex = -1;        // -1 = no selection, 0+ = highlighted row

  constructor(adapterName: string) {
    this.adapterName = adapterName;
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

  /** Column position of the cursor on the prompt line (1-based). */
  private getInputColumn(): number {
    const promptVisible = ((this.rl as any)._prompt ?? "")
      .replace(/\x1b\[[0-9;]*m/g, "").length;
    const cursor: number = (this.rl as any).cursor ?? 0;
    return promptVisible + cursor + 1;
  }

  private clearWordwheel(): void {
    if (this.wordwheelRendered === 0) return;
    const out = process.stdout;
    for (let i = 0; i < this.wordwheelRendered; i++) {
      out.write("\x1b[1B\x1b[2K");
    }
    out.write(`\x1b[${this.wordwheelRendered}A\x1b[${this.getInputColumn()}G`);
    this.wordwheelRendered = 0;
  }

  private writeWordwheel(lines: string[]): void {
    if (lines.length === 0) return;
    const out = process.stdout;
    for (const line of lines) {
      out.write("\n\x1b[2K" + line);
    }
    out.write(`\x1b[${lines.length}A\x1b[${this.getInputColumn()}G`);
    this.wordwheelRendered = lines.length;
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
    // Init orchestrator
    const teammatesDir = await findTeammatesDir();
    const adapter = resolveAdapter(this.adapterName);
    this.orchestrator = new Orchestrator({
      teammatesDir,
      adapter,
      onEvent: (e) => this.handleEvent(e),
    });
    await this.orchestrator.init();

    // Register commands
    this.registerCommands();

    // Create readline (no completer — wordwheel handles it)
    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.cyan("teammates") + chalk.gray("> "),
      terminal: true,
    });

    // Intercept all keypress via _ttyWrite so we can capture
    // arrow-down / arrow-up / Tab for wordwheel navigation.
    const origTtyWrite = (this.rl as any)._ttyWrite.bind(this.rl);
    (this.rl as any)._ttyWrite = (s: string, key: any) => {
      const hasWheel = this.wordwheelItems.length > 0;

      if (hasWheel && key) {
        if (key.name === "down") {
          this.wordwheelIndex = Math.min(
            this.wordwheelIndex + 1,
            this.wordwheelItems.length - 1
          );
          this.updateWordwheel();
          return;
        }
        if (key.name === "up") {
          this.wordwheelIndex = Math.max(this.wordwheelIndex - 1, -1);
          this.updateWordwheel();
          return;
        }
        if (key.name === "tab" && this.wordwheelIndex >= 0) {
          this.acceptWordwheelSelection();
          return;
        }
      }

      // Any other key — clear, let readline handle it, then refresh
      this.clearWordwheel();
      this.wordwheelItems = [];
      this.wordwheelIndex = -1;
      origTtyWrite(s, key);
      this.updateWordwheel();
    };

    // Banner
    this.printBanner(this.orchestrator.listTeammates());

    // REPL loop
    this.rl.prompt();

    this.rl.on("line", async (line: string) => {
      this.clearWordwheel();

      const trimmed = line.trim();
      if (!trimmed) {
        this.rl.prompt();
        return;
      }

      try {
        await this.dispatch(trimmed);
      } catch (err: any) {
        console.log(chalk.red(`Error: ${err.message}`));
      }

      this.rl.prompt();
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

    // Logo + info block
    console.log();
    console.log(
      chalk.cyan(" ▐▛▀▀▀▜▌   ") +
        chalk.bold("Teammates") +
        chalk.gray(" v0.1.0")
    );
    console.log(
      chalk.cyan(" ▐▌") +
        chalk.yellow(" ϟ ") +
        chalk.cyan("▐▌   ") +
        chalk.white(`${this.adapterName}`) +
        chalk.gray(` · ${teammates.length} teammate${teammates.length === 1 ? "" : "s"}`)
    );
    console.log(
      chalk.cyan(" ▐▙▄▄▄▟▌   ") +
        chalk.gray(process.cwd())
    );

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
      ["/assign", "assign to teammate"],
      ["/route", "auto-route task"],
      ["/handoff", "manual handoff"],
      ["bare text", "auto-route shortcut"],
    ];
    const col2 = [
      ["/approve", "accept handoff"],
      ["/reject", "decline handoff"],
      ["/status", "session overview"],
      ["/log", "last task output"],
    ];
    const col3 = [
      ["/teammates", "list roster"],
      ["/help", "all commands"],
      ["Tab", "autocomplete"],
      ["/exit", "exit session"],
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
        name: "assign",
        aliases: ["a"],
        usage: "/assign <teammate> <task...>",
        description: "Assign a task to a specific teammate",
        run: (args) => this.cmdAssign(args),
      },
      {
        name: "route",
        aliases: ["r"],
        usage: "/route <task...>",
        description: "Auto-route a task to the best teammate",
        run: (args) => this.cmdRoute(args),
      },
      {
        name: "approve",
        aliases: ["y", "yes"],
        usage: "/approve",
        description: "Approve a pending handoff",
        run: () => this.cmdApprove(),
      },
      {
        name: "reject",
        aliases: ["n", "no"],
        usage: "/reject",
        description: "Reject a pending handoff",
        run: () => this.cmdReject(),
      },
      {
        name: "handoff",
        aliases: ["ho"],
        usage: "/handoff <from> <to> <task...>",
        description: "Manually hand off a task between teammates",
        run: (args) => this.cmdHandoff(args),
      },
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
    switch (event.type) {
      case "task_assigned":
        this.spinner = ora({
          text: chalk.blue(`${event.assignment.teammate}`) +
            chalk.gray(` is working on: ${event.assignment.task.slice(0, 60)}...`),
          spinner: "dots",
        }).start();
        break;

      case "task_completed":
        if (this.spinner) {
          this.spinner.succeed(
            chalk.green(event.result.teammate) +
              chalk.gray(": ") +
              event.result.summary
          );
          this.spinner = null;
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
    console.log(
      chalk.yellow("  Type ") +
        chalk.bold("/approve") +
        chalk.yellow(" to proceed or ") +
        chalk.bold("/reject") +
        chalk.yellow(" to cancel")
    );
  }

  // ─── Commands ────────────────────────────────────────────────────

  private async cmdAssign(argsStr: string): Promise<void> {
    const parts = argsStr.match(/^(\S+)\s+(.+)$/);
    if (!parts) {
      console.log(chalk.yellow("Usage: /assign <teammate> <task...>"));
      return;
    }

    const [, teammate, task] = parts;
    const result = await this.orchestrator.assign({ teammate, task });
    this.lastResult = result;

    if (result.handoff && this.orchestrator.requireApproval) {
      // Handoff is pending — user was already prompted
    }
  }

  private async cmdRoute(argsStr: string): Promise<void> {
    if (!argsStr) {
      console.log(chalk.yellow("Usage: /route <task...>"));
      return;
    }

    const match = this.orchestrator.route(argsStr);
    if (!match) {
      console.log(chalk.yellow("Could not determine a teammate for this task."));
      console.log(chalk.gray("Use /assign <teammate> <task> to assign directly."));
      return;
    }

    console.log(chalk.gray(`  Routed to: ${chalk.bold(match)}`));
    const result = await this.orchestrator.assign({ teammate: match, task: argsStr });
    this.lastResult = result;
  }

  private async cmdApprove(): Promise<void> {
    const pending = this.orchestrator.getPendingHandoff();
    if (!pending) {
      console.log(chalk.gray("No pending handoff to approve."));
      return;
    }

    // Clear the pending state and execute
    this.orchestrator.clearPendingHandoff(pending.from);

    const result = await this.orchestrator.assign({
      teammate: pending.to,
      task: pending.task,
      handoff: pending,
    });
    this.lastResult = result;
  }

  private async cmdReject(): Promise<void> {
    const pending = this.orchestrator.getPendingHandoff();
    if (!pending) {
      console.log(chalk.gray("No pending handoff to reject."));
      return;
    }

    this.orchestrator.clearPendingHandoff(pending.from);
    console.log(
      chalk.gray(`  Rejected handoff from `) +
        chalk.bold(pending.from) +
        chalk.gray(" to ") +
        chalk.bold(pending.to)
    );
  }

  private async cmdHandoff(argsStr: string): Promise<void> {
    const parts = argsStr.match(/^(\S+)\s+(\S+)\s+(.+)$/);
    if (!parts) {
      console.log(chalk.yellow("Usage: /handoff <from> <to> <task...>"));
      return;
    }

    const [, from, to, task] = parts;
    const envelope: HandoffEnvelope = { from, to, task };

    const result = await this.orchestrator.assign({
      teammate: to,
      task,
      handoff: envelope,
    });
    this.lastResult = result;
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
  /assign <teammate> <task>  Assign a task to a teammate
  /route <task>              Auto-route to the best teammate
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
