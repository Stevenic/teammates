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
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentAdapter,
  InstalledService,
  RosterEntry,
} from "../adapter.js";
import { buildTeammatePrompt } from "../adapter.js";
import type {
  HandoffEnvelope,
  SandboxLevel,
  TaskResult,
  TeammateConfig,
} from "../types.js";

// ─── Agent presets ──────────────────────────────────────────────────

export interface AgentPreset {
  /** Display name */
  name: string;
  /** Binary / command to spawn */
  command: string;
  /** Build CLI args. `promptFile` is a temp file path, `prompt` is the raw text. */
  buildArgs(
    ctx: { promptFile: string; prompt: string },
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
  /** Optional output parser — transforms raw stdout into clean agent output */
  parseOutput?(raw: string): string;
}

export const PRESETS: Record<string, AgentPreset> = {
  claude: {
    name: "claude",
    command: "claude",
    buildArgs(_ctx, _teammate, options) {
      const args = ["-p", "--verbose", "--dangerously-skip-permissions"];
      if (options.model) args.push("--model", options.model);
      return args;
    },
    env: { FORCE_COLOR: "1", CLAUDECODE: "" },
    stdinPrompt: true,
  },

  codex: {
    name: "codex",
    command: "codex",
    buildArgs(_ctx, teammate, options) {
      const args = ["exec", "-"];
      if (teammate.cwd) args.push("-C", teammate.cwd);
      const sandbox =
        teammate.sandbox ?? options.defaultSandbox ?? "workspace-write";
      args.push("-s", sandbox);
      args.push("--full-auto");
      args.push("--ephemeral");
      args.push("--json");
      if (options.model) args.push("-m", options.model);
      return args;
    },
    env: { NO_COLOR: "1" },
    stdinPrompt: true,
    /** Parse JSONL output from codex exec --json, returning only the last agent message */
    parseOutput(raw: string): string {
      let lastMessage = "";
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (
            event.type === "item.completed" &&
            event.item?.type === "agent_message"
          ) {
            lastMessage = event.item.text;
          }
        } catch {
          /* skip non-JSON lines */
        }
      }
      return lastMessage || raw;
    },
  },

  aider: {
    name: "aider",
    command: "aider",
    buildArgs({ promptFile }, _teammate, options) {
      const args = ["--message-file", promptFile, "--yes", "--no-git"];
      if (options.model) args.push("--model", options.model);
      return args;
    },
    env: { FORCE_COLOR: "1" },
  },
};

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
  /** Session files per teammate — persists state across task invocations. */
  private sessionFiles: Map<string, string> = new Map();
  /** Base directory for session files. */
  private sessionsDir = "";
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

    // Create session file inside .teammates/.tmp so sandboxed agents can access it
    if (!this.sessionsDir) {
      const tmpBase = join(teammate.cwd ?? process.cwd(), ".teammates", ".tmp");
      this.sessionsDir = join(tmpBase, "sessions");
      await mkdir(this.sessionsDir, { recursive: true });
      // Ensure .tmp is gitignored
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
    const sessionFile = join(this.sessionsDir, `${teammate.name}.md`);
    await writeFile(sessionFile, `# Session — ${teammate.name}\n\n`, "utf-8");
    this.sessionFiles.set(teammate.name, sessionFile);

    return id;
  }

  async executeTask(
    _sessionId: string,
    teammate: TeammateConfig,
    prompt: string,
  ): Promise<TaskResult> {
    // If the teammate has no soul (e.g. the raw agent), skip identity/memory
    // wrapping but include handoff instructions so it can delegate to teammates
    const sessionFile = this.sessionFiles.get(teammate.name);
    let fullPrompt: string;
    if (teammate.soul) {
      fullPrompt = buildTeammatePrompt(teammate, prompt, {
        roster: this.roster,
        services: this.services,
        sessionFile,
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

    // Write prompt to temp file to avoid shell escaping issues
    const promptFile = join(
      tmpdir(),
      `teammates-${this.name}-${randomUUID()}.md`,
    );
    await writeFile(promptFile, fullPrompt, "utf-8");
    this.pendingTempFiles.add(promptFile);

    try {
      const rawOutput = await this.spawnAndProxy(
        teammate,
        promptFile,
        fullPrompt,
      );
      const output = this.preset.parseOutput
        ? this.preset.parseOutput(rawOutput)
        : rawOutput;
      const teammateNames = this.roster.map((r) => r.name);
      return parseResult(teammate.name, output, teammateNames, prompt);
    } finally {
      this.pendingTempFiles.delete(promptFile);
      await unlink(promptFile).catch(() => {});
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
          role: "",
          soul: "",
          wisdom: "",
          dailyLogs: [],
          weeklyLogs: [],
          ownership: { primary: [], secondary: [] },
        },
        { ...this.options, model: this.options.model ?? "haiku" },
      );
      const env = { ...process.env, ...this.preset.env };

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

    // Clean up session files
    for (const [, file] of this.sessionFiles) {
      await unlink(file).catch(() => {});
    }
    this.sessionFiles.clear();
  }

  /**
   * Spawn the agent, stream its output live, and capture it.
   */
  private spawnAndProxy(
    teammate: TeammateConfig,
    promptFile: string,
    fullPrompt: string,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = [
        ...this.preset.buildArgs(
          { promptFile, prompt: fullPrompt },
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

      // Pipe prompt via stdin if the preset requires it
      if (useStdin && child.stdin) {
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
        onUserInput = (chunk: Buffer) => {
          child.stdin?.write(chunk);
        };
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
        }
        process.stdin.resume();
        process.stdin.on("data", onUserInput);
      }

      const captured: Buffer[] = [];

      child.stdout?.on("data", (chunk: Buffer) => {
        captured.push(chunk);
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        captured.push(chunk);
      });

      const cleanup = () => {
        clearTimeout(timeoutTimer);
        if (killTimer) clearTimeout(killTimer);
        if (onUserInput) {
          process.stdin.removeListener("data", onUserInput);
        }
      };

      child.on("close", (_code) => {
        cleanup();
        const output = Buffer.concat(captured).toString("utf-8");
        if (killed) {
          resolve(
            `${output}\n\n[TIMEOUT] Agent process killed after ${timeout}ms`,
          );
        } else {
          resolve(output);
        }
      });

      child.on("error", (err) => {
        cleanup();
        reject(new Error(`Failed to spawn ${command}: ${err.message}`));
      });
    });
  }
}

// ─── Output parsing (shared across all agents) ─────────────────────

function parseResult(
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

  // Find all ```handoff blocks
  const handoffBlocks = findHandoffBlocks(output);
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

/** Extract file paths from agent output. */
function parseChangedFiles(output: string): string[] {
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
