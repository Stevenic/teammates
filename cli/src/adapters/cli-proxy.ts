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

import { spawn, type ChildProcess } from "node:child_process";
import { writeFile, unlink, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentAdapter, RosterEntry, InstalledService } from "../adapter.js";
import { buildTeammatePrompt } from "../adapter.js";
import type { TeammateConfig, TaskResult, HandoffEnvelope, SandboxLevel } from "../types.js";

// ─── Agent presets ──────────────────────────────────────────────────

export interface AgentPreset {
  /** Display name */
  name: string;
  /** Binary / command to spawn */
  command: string;
  /** Build CLI args. `promptFile` is a temp file path, `prompt` is the raw text. */
  buildArgs(ctx: { promptFile: string; prompt: string }, teammate: TeammateConfig, options: CliProxyOptions): string[];
  /** Extra env vars to set (e.g. FORCE_COLOR) */
  env?: Record<string, string>;
  /** Whether the agent may prompt the user for input (connects stdin) */
  interactive?: boolean;
  /** Whether the command needs shell: true to run */
  shell?: boolean;
  /** Whether to pipe the prompt via stdin instead of as a CLI argument */
  stdinPrompt?: boolean;
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
    buildArgs({ prompt }, teammate, options) {
      const args = ["exec", prompt];
      if (teammate.cwd) args.push("-C", teammate.cwd);
      const sandbox = teammate.sandbox ?? options.defaultSandbox ?? "workspace-write";
      args.push("-s", sandbox);
      args.push("--full-auto");
      if (options.model) args.push("-m", options.model);
      return args;
    },
    env: { FORCE_COLOR: "1" },
  },

  aider: {
    name: "aider",
    command: "aider",
    buildArgs({ promptFile }, teammate, options) {
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
        `Unknown agent preset: ${options.preset}. Available: ${Object.keys(PRESETS).join(", ")}`
      );
    }
    this.name = this.preset.name;
  }

  async startSession(teammate: TeammateConfig): Promise<string> {
    const id = `${this.name}-${teammate.name}-${nextId++}`;

    // Create session file for this teammate
    if (!this.sessionsDir) {
      this.sessionsDir = join(tmpdir(), `teammates-sessions-${randomUUID()}`);
      await mkdir(this.sessionsDir, { recursive: true });
    }
    const sessionFile = join(this.sessionsDir, `${teammate.name}.md`);
    await writeFile(sessionFile, `# Session — ${teammate.name}\n\n`, "utf-8");
    this.sessionFiles.set(teammate.name, sessionFile);

    return id;
  }

  async executeTask(
    sessionId: string,
    teammate: TeammateConfig,
    prompt: string
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
        parts.push("If part of this task belongs to a specialist, you can hand it off.");
        parts.push("Your teammates:");
        for (const t of others) {
          const owns = t.ownership.primary.length > 0
            ? ` — owns: ${t.ownership.primary.join(", ")}`
            : "";
          parts.push(`- @${t.name}: ${t.role}${owns}`);
        }
        parts.push("\nTo hand off, end your response with:");
        parts.push("```json");
        parts.push('{ "handoff": { "to": "<teammate>", "task": "<what you need them to do>", "context": "<any context>" } }');
        parts.push("```");
      }
      fullPrompt = parts.join("\n");
    }

    // Write prompt to temp file to avoid shell escaping issues
    const promptFile = join(tmpdir(), `teammates-${this.name}-${randomUUID()}.md`);
    await writeFile(promptFile, fullPrompt, "utf-8");
    this.pendingTempFiles.add(promptFile);

    try {
      const output = await this.spawnAndProxy(teammate, promptFile, fullPrompt);
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
      const owns = t.ownership.primary.length > 0
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
        { name: "_router", role: "", soul: "", wisdom: "", dailyLogs: [], weeklyLogs: [], ownership: { primary: [], secondary: [] } },
        { ...this.options, model: this.options.model ?? "haiku" }
      );
      const env = { ...process.env, ...this.preset.env };

      const output = await new Promise<string>((resolve, reject) => {
        const routeStdin = this.preset.stdinPrompt ?? false;
        const child = spawn(command, args, {
          cwd: process.cwd(),
          env,
          stdio: [routeStdin ? "pipe" : "ignore", "pipe", "pipe"],
          shell: this.preset.shell ?? false,
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
        if (trimmed === name.toLowerCase() || trimmed.endsWith(name.toLowerCase())) {
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

  async destroySession(sessionId: string): Promise<void> {
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
  private spawnAndProxy(teammate: TeammateConfig, promptFile: string, fullPrompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = [
        ...this.preset.buildArgs({ promptFile, prompt: fullPrompt }, teammate, this.options),
        ...(this.options.extraFlags ?? []),
      ];

      const command = this.options.commandPath ?? this.preset.command;
      const env = { ...process.env, ...this.preset.env };
      const timeout = this.options.timeout ?? 600_000;
      const interactive = this.preset.interactive ?? false;
      const useStdin = this.preset.stdinPrompt ?? false;

      const child: ChildProcess = spawn(command, args, {
        cwd: teammate.cwd ?? process.cwd(),
        env,
        stdio: [(interactive || useStdin) ? "pipe" : "ignore", "pipe", "pipe"],
        shell: this.preset.shell ?? false,
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

      child.on("close", (code) => {
        cleanup();
        const output = Buffer.concat(captured).toString("utf-8");
        if (killed) {
          resolve(output + `\n\n[TIMEOUT] Agent process killed after ${timeout}ms`);
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

function parseResult(teammateName: string, output: string, teammateNames: string[] = [], originalTask?: string): TaskResult {
  // Try to parse the structured JSON block the agent was asked to produce
  const structured = parseStructuredOutput(output);
  if (structured) {
    return { ...structured, teammate: teammateName, rawOutput: output };
  }

  // Fallback: scrape what we can from freeform output
  return {
    teammate: teammateName,
    success: true,
    summary: extractSummary(output),
    changedFiles: parseChangedFiles(output),
    handoff: parseHandoffEnvelope(output) ?? parseHandoffFromMention(teammateName, output, teammateNames, originalTask) ?? undefined,
    rawOutput: output,
  };
}

/**
 * Parse the structured JSON block from the output protocol.
 * Looks for either { "result": ... } or { "handoff": ... }.
 */
function parseStructuredOutput(output: string): Omit<TaskResult, "teammate" | "rawOutput"> | null {
  const jsonBlocks = [...output.matchAll(/```json\s*\n([\s\S]*?)```/g)];
  // Take the last JSON block — that's the protocol output
  for (let i = jsonBlocks.length - 1; i >= 0; i--) {
    const block = jsonBlocks[i][1].trim();
    try {
      const parsed = JSON.parse(block);

      if (parsed.result) {
        return {
          success: true,
          summary: parsed.result.subject ?? parsed.result.summary ?? "",
          changedFiles: parsed.result.changedFiles ?? parsed.result.changed_files ?? [],
        };
      }

      if (parsed.handoff && parsed.handoff.to && parsed.handoff.task) {
        const h = parsed.handoff;
        return {
          success: true,
          summary: h.context ?? h.task,
          changedFiles: h.changedFiles ?? h.changed_files ?? [],
          handoff: {
            from: h.from ?? "",
            to: h.to,
            task: h.task,
            changedFiles: h.changedFiles ?? h.changed_files,
            acceptanceCriteria: h.acceptanceCriteria ?? h.acceptance_criteria,
            openQuestions: h.openQuestions ?? h.open_questions,
            context: h.context,
          },
        };
      }
    } catch {
      // Not valid JSON
    }
  }
  return null;
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
    /(?:Created|Modified|Updated|Wrote|Edited)\s+(?:file:\s*)?[`"]?([^\s`"]+\.\w+)[`"]?/gi
  )) {
    files.add(match[1]);
  }

  return Array.from(files);
}

/**
 * Look for a JSON handoff envelope in the output.
 * Agents request handoffs by including a fenced JSON block:
 *
 * ```json
 * { "handoff": { "to": "tester", "task": "...", ... } }
 * ```
 */
function parseHandoffEnvelope(output: string): HandoffEnvelope | null {
  const jsonBlocks = output.matchAll(/```json\s*\n([\s\S]*?)```/g);

  for (const match of jsonBlocks) {
    const block = match[1].trim();
    if (!block.includes('"handoff"') && !block.includes('"to"')) continue;

    try {
      const parsed = JSON.parse(block);
      const envelope = parsed.handoff ?? parsed;

      if (envelope.to && envelope.task) {
        return {
          from: envelope.from ?? "",
          to: envelope.to,
          task: envelope.task,
          changedFiles: envelope.changedFiles ?? envelope.changed_files,
          acceptanceCriteria:
            envelope.acceptanceCriteria ?? envelope.acceptance_criteria,
          openQuestions: envelope.openQuestions ?? envelope.open_questions,
          context: envelope.context,
        };
      }
    } catch {
      // Not valid JSON, skip
    }
  }

  return null;
}

/**
 * Detect handoff intent from plain-text @mentions in the agent's response.
 * Catches cases like "This is in @beacon's domain. Let me hand it off."
 * where the agent didn't produce the structured JSON block.
 */
/**
 * Detect handoff intent from plain-text @mentions in the agent's response.
 * Catches cases like "This is in @beacon's domain. Let me hand it off."
 * where the agent didn't produce the structured JSON block.
 */
function parseHandoffFromMention(
  fromTeammate: string,
  output: string,
  teammateNames: string[],
  originalTask?: string
): HandoffEnvelope | null {
  if (teammateNames.length === 0) return null;

  // Look for @teammate mentions (excluding the agent's own name)
  const others = teammateNames.filter((n) => n !== fromTeammate);
  if (others.length === 0) return null;

  // Match @name patterns — require handoff-like language nearby
  const handoffPatterns = /\bhand(?:ing)?\s*(?:it\s+)?off\b|\bdelegate\b|\broute\b|\bpass(?:ing)?\s+(?:it\s+)?(?:to|along)\b|\bbelong(?:s)?\s+to\b|\b(?:is\s+in)\s+@\w+'?s?\s+domain\b/i;

  for (const name of others) {
    const mentionPattern = new RegExp(`@${name}\\b`, "i");
    if (mentionPattern.test(output) && handoffPatterns.test(output)) {
      return {
        from: fromTeammate,
        to: name,
        task: originalTask || output.slice(0, 200).trim(),
        context: output.replace(/```json[\s\S]*?```/g, "").trim().slice(0, 500),
      };
    }
  }

  return null;
}

/** Extract a summary from agent output. */
function extractSummary(output: string): string {
  // Look for a "## Summary" or "Summary:" section
  const summaryMatch = output.match(
    /(?:##?\s*Summary|Summary:)\s*\n([\s\S]*?)(?:\n##|\n---|\n```|$)/i
  );
  if (summaryMatch) {
    const summary = summaryMatch[1].trim();
    if (summary.length > 0) return summary.slice(0, 500);
  }

  // Fall back to last non-empty paragraph
  const paragraphs = output
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !p.startsWith("```"));

  if (paragraphs.length > 0) {
    const last = paragraphs[paragraphs.length - 1];
    return last.length > 500 ? last.slice(0, 497) + "..." : last;
  }

  return output.slice(0, 200).trim();
}
