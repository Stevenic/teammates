/**
 * CLI argument parsing, version, and startup helpers for @teammates/cli.
 */

import { readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import chalk from "chalk";
import type { AgentAdapter } from "./adapter.js";
import { ClaudeAdapter } from "./adapters/claude.js";
import { PRESETS } from "./adapters/cli-proxy.js";
import { CodexAdapter } from "./adapters/codex.js";
import { CopilotAdapter } from "./adapters/copilot.js";
import { EchoAdapter } from "./adapters/echo.js";

// ─── Version ─────────────────────────────────────────────────────────

export const PKG_VERSION: string = (() => {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
    );
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

// ─── Argument parsing ────────────────────────────────────────────────

export interface CliArgs {
  showHelp: boolean;
  modelOverride: string | undefined;
  dirOverride: string | undefined;
  adapterName: string;
  agentPassthrough: string[];
}

export function parseCliArgs(argv: string[] = process.argv.slice(2)): CliArgs {
  const args = [...argv];

  function getFlag(name: string): boolean {
    const idx = args.indexOf(`--${name}`);
    if (idx >= 0) {
      args.splice(idx, 1);
      return true;
    }
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
  const adapterName = args.shift() ?? "echo";
  const agentPassthrough = [...args];

  return {
    showHelp,
    modelOverride,
    dirOverride,
    adapterName,
    agentPassthrough,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────

export async function findTeammatesDir(
  dirOverride: string | undefined,
): Promise<string | null> {
  if (dirOverride) return resolve(dirOverride);
  let dir = process.cwd();
  while (true) {
    const candidate = join(dir, ".teammates");
    try {
      const s = await stat(candidate);
      if (s.isDirectory()) return candidate;
    } catch {
      /* keep looking */
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export async function resolveAdapter(
  name: string,
  opts: { modelOverride?: string; agentPassthrough?: string[] } = {},
): Promise<AgentAdapter> {
  if (name === "echo") return new EchoAdapter();

  // Agent-specific adapters
  if (name === "copilot") {
    return new CopilotAdapter({
      model: opts.modelOverride,
      extraFlags: opts.agentPassthrough,
    });
  }

  if (name === "claude") {
    return new ClaudeAdapter({
      model: opts.modelOverride,
      extraFlags: opts.agentPassthrough,
    });
  }

  if (name === "codex") {
    return new CodexAdapter({
      model: opts.modelOverride,
      extraFlags: opts.agentPassthrough,
    });
  }

  // Fallback for other CLI-proxy presets (e.g. aider)
  if (PRESETS[name]) {
    const { CliProxyAdapter } = await import("./adapters/cli-proxy.js");
    return new CliProxyAdapter({
      preset: name,
      model: opts.modelOverride,
      extraFlags: opts.agentPassthrough,
    });
  }

  const available = ["echo", ...Object.keys(PRESETS)].join(", ");
  console.error(chalk.red(`Unknown adapter: ${name}`));
  console.error(`Available adapters: ${available}`);
  process.exit(1);
}

// ─── Usage ───────────────────────────────────────────────────────────

export function printUsage(): void {
  console.log(
    `
${chalk.bold("@teammates/cli")} — Agent-agnostic teammate orchestrator

${chalk.bold("Usage:")}
  teammates <agent>          Launch session with an agent
  teammates codex            Use OpenAI Codex
  teammates aider            Use Aider
  teammates codex --search   Pass additional flags to the agent CLI

${chalk.bold("Options:")}
  --model <model>            Override the agent model
  --dir <path>               Override .teammates/ location
  <agent args...>            Passed through to the selected agent CLI

${chalk.bold("Agents:")}
  claude     Claude Code CLI (requires 'claude' on PATH)
  codex      OpenAI Codex CLI (requires 'codex' on PATH)
  copilot    GitHub Copilot CLI (requires 'copilot' on PATH)
  aider      Aider CLI (requires 'aider' on PATH)
  echo       Test adapter — echoes prompts (no external agent)

${chalk.bold("In-session:")}
  @teammate <task>           Assign directly via @mention
  <text>                     Auto-route to the best teammate
  /status                    Session overview
  /help                      All commands
`.trim(),
  );
}
