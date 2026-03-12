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
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentAdapter } from "../adapter.js";
import { buildTeammatePrompt } from "../adapter.js";
import type { TeammateConfig, TaskResult, HandoffEnvelope, SandboxLevel } from "../types.js";

// ─── Agent presets ──────────────────────────────────────────────────

export interface AgentPreset {
  /** Display name */
  name: string;
  /** Binary / command to spawn */
  command: string;
  /** Build CLI args. `promptFile` contains the full prompt text. */
  buildArgs(promptFile: string, teammate: TeammateConfig, options: CliProxyOptions): string[];
  /** Extra env vars to set (e.g. FORCE_COLOR) */
  env?: Record<string, string>;
  /** Whether to pass prompt via stdin instead of a file arg */
  stdinPrompt?: boolean;
  /** Whether the command needs shell: true to run */
  shell?: boolean;
}

export const PRESETS: Record<string, AgentPreset> = {
  claude: {
    name: "claude",
    command: "claude",
    buildArgs(promptFile, teammate, options) {
      const args = ["-p", "--verbose"];
      if (options.model) args.push("--model", options.model);
      return args;
    },
    env: { FORCE_COLOR: "1" },
    stdinPrompt: true,
  },

  codex: {
    name: "codex",
    command: "codex",
    buildArgs(promptFile, teammate, options) {
      const args = ["exec"];
      // Codex reads prompt via shell substitution
      args.push(`"$(cat '${promptFile}')"`);
      if (teammate.cwd) args.push("-C", teammate.cwd);
      const sandbox = teammate.sandbox ?? options.defaultSandbox ?? "workspace-write";
      args.push("-s", sandbox);
      args.push("--full-auto");
      if (options.model) args.push("-m", options.model);
      return args;
    },
    env: { FORCE_COLOR: "1" },
    shell: true,
  },

  aider: {
    name: "aider",
    command: "aider",
    buildArgs(promptFile, teammate, options) {
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
  private preset: AgentPreset;
  private options: CliProxyOptions;

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
    return `${this.name}-${teammate.name}-${nextId++}`;
  }

  async executeTask(
    sessionId: string,
    teammate: TeammateConfig,
    prompt: string
  ): Promise<TaskResult> {
    const fullPrompt = buildTeammatePrompt(teammate, prompt);

    // Write prompt to temp file to avoid shell escaping issues
    const promptFile = join(tmpdir(), `teammates-${this.name}-${randomUUID()}.md`);
    await writeFile(promptFile, fullPrompt, "utf-8");

    try {
      const output = await this.spawnAndProxy(teammate, promptFile, fullPrompt);
      return parseResult(teammate.name, output);
    } finally {
      await unlink(promptFile).catch(() => {});
    }
  }

  /**
   * Spawn the agent, stream its output live, and capture it.
   */
  private spawnAndProxy(teammate: TeammateConfig, promptFile: string, fullPrompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = [
        ...this.preset.buildArgs(promptFile, teammate, this.options),
        ...(this.options.extraFlags ?? []),
      ];

      const useStdin = this.preset.stdinPrompt ?? false;
      const command = this.options.commandPath ?? this.preset.command;
      const env = { ...process.env, ...this.preset.env };
      const timeout = this.options.timeout ?? 600_000;

      const child: ChildProcess = spawn(command, args, {
        cwd: teammate.cwd ?? process.cwd(),
        env,
        stdio: [useStdin ? "pipe" : "ignore", "pipe", "pipe"],
        timeout,
        shell: this.preset.shell ?? false,
      });

      // Pipe prompt via stdin if the agent reads from it
      if (useStdin && child.stdin) {
        child.stdin.write(fullPrompt);
        child.stdin.end();
      }

      const captured: Buffer[] = [];

      // Tee stdout: live to terminal + capture
      child.stdout?.on("data", (chunk: Buffer) => {
        captured.push(chunk);
        process.stdout.write(chunk);
      });

      // Tee stderr: live to terminal + capture
      child.stderr?.on("data", (chunk: Buffer) => {
        captured.push(chunk);
        process.stderr.write(chunk);
      });

      child.on("close", (code) => {
        const output = Buffer.concat(captured).toString("utf-8");
        if (code === 0 || code === null) {
          resolve(output);
        } else {
          // Still resolve with output — agent may have done partial work
          resolve(output);
        }
      });

      child.on("error", (err) => {
        reject(new Error(`Failed to spawn ${command}: ${err.message}`));
      });
    });
  }
}

// ─── Output parsing (shared across all agents) ─────────────────────

function parseResult(teammateName: string, output: string): TaskResult {
  return {
    teammate: teammateName,
    success: true,
    summary: extractSummary(output),
    changedFiles: parseChangedFiles(output),
    handoff: parseHandoffEnvelope(output) ?? undefined,
    rawOutput: output,
  };
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
