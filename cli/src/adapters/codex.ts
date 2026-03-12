/**
 * Codex adapter — runs each teammate as a `codex exec` subprocess.
 *
 * Uses the OpenAI Codex CLI in non-interactive mode:
 *   codex exec "<prompt>" --full-auto -C <cwd> -s <sandbox> -m <model>
 *
 * Each execution is stateless (no thread continuity). The teammate's full
 * identity, memory, and handoff context are injected into the prompt every time.
 *
 * Requirements:
 *   - `codex` CLI installed and on PATH
 *   - OPENAI_API_KEY or CODEX_API_KEY set in environment
 */

import { spawn } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentAdapter } from "../adapter.js";
import { buildTeammatePrompt } from "../adapter.js";
import type { TeammateConfig, TaskResult, HandoffEnvelope, SandboxLevel } from "../types.js";

export interface CodexAdapterOptions {
  /** Codex model override (e.g. "o4-mini", "o3") */
  model?: string;
  /** Default sandbox level if teammate doesn't specify one */
  defaultSandbox?: SandboxLevel;
  /** Use --full-auto mode (default: true) */
  fullAuto?: boolean;
  /** Use --ephemeral to skip persisting session files (default: true) */
  ephemeral?: boolean;
  /** Additional CLI flags to pass to codex exec */
  extraFlags?: string[];
  /** Timeout in ms for codex exec (default: 300000 = 5 min) */
  timeout?: number;
  /** Path to codex binary (default: "codex") */
  codexPath?: string;
}

let nextId = 1;

export class CodexAdapter implements AgentAdapter {
  readonly name = "codex";
  private options: Required<CodexAdapterOptions>;

  constructor(options: CodexAdapterOptions = {}) {
    this.options = {
      model: options.model ?? "",
      defaultSandbox: options.defaultSandbox ?? "workspace-write",
      fullAuto: options.fullAuto ?? true,
      ephemeral: options.ephemeral ?? true,
      extraFlags: options.extraFlags ?? [],
      timeout: options.timeout ?? 300_000,
      codexPath: options.codexPath ?? "codex",
    };
  }

  async startSession(teammate: TeammateConfig): Promise<string> {
    // Codex exec is stateless — sessions are just logical IDs
    return `codex-${teammate.name}-${nextId++}`;
  }

  async executeTask(
    sessionId: string,
    teammate: TeammateConfig,
    prompt: string
  ): Promise<TaskResult> {
    const fullPrompt = buildTeammatePrompt(teammate, prompt);

    // Write prompt to a temp file to avoid shell escaping issues with long prompts
    const promptFile = join(tmpdir(), `teammates-codex-${randomUUID()}.md`);
    await writeFile(promptFile, fullPrompt, "utf-8");

    try {
      const output = await this.runCodex(teammate, promptFile);
      return this.parseResult(teammate.name, output);
    } finally {
      // Clean up temp file
      await unlink(promptFile).catch(() => {});
    }
  }

  /**
   * Spawn `codex exec` and capture its output.
   * Prompt is passed via a temp file read with shell substitution.
   */
  private runCodex(teammate: TeammateConfig, promptFile: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = this.buildArgs(teammate, promptFile);

      const child = spawn(this.options.codexPath, args, {
        cwd: teammate.cwd ?? process.cwd(),
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
        timeout: this.options.timeout,
        shell: true,
      });

      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];

      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => {
        stderr.push(chunk);
        // Stream stderr to parent stderr for real-time progress
        process.stderr.write(chunk);
      });

      child.on("close", (code) => {
        const out = Buffer.concat(stdout).toString("utf-8");
        const err = Buffer.concat(stderr).toString("utf-8");

        if (code === 0) {
          resolve(out);
        } else {
          reject(
            new Error(
              `codex exec exited with code ${code}\nstderr: ${err}\nstdout: ${out}`
            )
          );
        }
      });

      child.on("error", (err) => {
        reject(new Error(`Failed to spawn codex: ${err.message}`));
      });
    });
  }

  /** Build the argument list for codex exec */
  private buildArgs(teammate: TeammateConfig, promptFile: string): string[] {
    const args: string[] = ["exec"];

    // Read prompt from file — avoids shell escaping issues
    // Use shell substitution: $(cat <file>)
    args.push(`"$(cat '${promptFile}')"`);

    // Working directory
    if (teammate.cwd) {
      args.push("-C", teammate.cwd);
    }

    // Sandbox
    const sandbox = teammate.sandbox ?? this.options.defaultSandbox;
    args.push("-s", sandbox);

    // Full auto
    if (this.options.fullAuto) {
      args.push("--full-auto");
    }

    // Ephemeral
    if (this.options.ephemeral) {
      args.push("--ephemeral");
    }

    // Model
    if (this.options.model) {
      args.push("-m", this.options.model);
    }

    // Extra flags
    args.push(...this.options.extraFlags);

    return args;
  }

  /**
   * Parse codex output into a TaskResult.
   * Looks for changed files and handoff envelopes in the output.
   */
  private parseResult(teammateName: string, output: string): TaskResult {
    const changedFiles = parseChangedFiles(output);
    const handoff = parseHandoffEnvelope(output);
    const summary = extractSummary(output);

    return {
      teammate: teammateName,
      success: true,
      summary,
      changedFiles,
      handoff: handoff ?? undefined,
      rawOutput: output,
    };
  }
}

/**
 * Extract file paths from codex output.
 * Looks for common patterns like "Created file: ...", "Modified: ...",
 * or git-style diff headers.
 */
function parseChangedFiles(output: string): string[] {
  const files = new Set<string>();

  // Match diff headers: diff --git a/path b/path
  for (const match of output.matchAll(/diff --git a\/(.+?) b\//g)) {
    files.add(match[1]);
  }

  // Match "Created/Modified/Updated <path>" patterns
  for (const match of output.matchAll(
    /(?:Created|Modified|Updated|Wrote|Edited)\s+(?:file:\s*)?[`"]?([^\s`"]+\.\w+)[`"]?/gi
  )) {
    files.add(match[1]);
  }

  return Array.from(files);
}

/**
 * Look for a JSON handoff envelope in the output.
 * Teammates can request handoffs by including a fenced JSON block
 * with a "handoff" key:
 *
 * ```json
 * { "handoff": { "to": "tester", "task": "...", ... } }
 * ```
 */
function parseHandoffEnvelope(output: string): HandoffEnvelope | null {
  // Look for ```json blocks containing "handoff"
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
 * Extract the first meaningful paragraph as a summary.
 * Falls back to the first 200 chars if no clear summary is found.
 */
function extractSummary(output: string): string {
  // Look for a "## Summary" or "Summary:" section
  const summaryMatch = output.match(
    /(?:##?\s*Summary|Summary:)\s*\n([\s\S]*?)(?:\n##|\n---|\n```|$)/i
  );
  if (summaryMatch) {
    const summary = summaryMatch[1].trim();
    if (summary.length > 0) return summary.slice(0, 500);
  }

  // Fall back to last non-empty paragraph (codex prints final message last)
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
