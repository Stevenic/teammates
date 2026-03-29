/**
 * Agent preset definitions — separated from cli-proxy.ts to avoid
 * circular imports (adapter files extend CliProxyAdapter).
 */

import type { AgentPreset } from "./cli-proxy.js";

export const CLAUDE_PRESET: AgentPreset = {
  name: "claude",
  command: "claude",
  buildArgs(ctx, _teammate, options) {
    const args = ["-p", "--verbose", "--dangerously-skip-permissions"];
    if (options.model) args.push("--model", options.model);
    if (ctx.debugFile) args.push("--debug-file", ctx.debugFile);
    return args;
  },
  env: { FORCE_COLOR: "1", CLAUDECODE: "" },
  stdinPrompt: true,
  supportsDebugFile: true,
};

export const CODEX_PRESET: AgentPreset = {
  name: "codex",
  command: "codex",
  buildArgs(_ctx, teammate, options) {
    const args = ["exec", "-"];
    if (teammate.cwd) args.push("-C", teammate.cwd);
    const sandbox =
      teammate.sandbox ?? options.defaultSandbox ?? "danger-full-access";
    args.push("-s", sandbox);
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
};

export const AIDER_PRESET: AgentPreset = {
  name: "aider",
  command: "aider",
  buildArgs({ promptFile }, _teammate, options) {
    const args = ["--message-file", promptFile, "--yes", "--no-git"];
    if (options.model) args.push("--model", options.model);
    return args;
  },
  env: { FORCE_COLOR: "1" },
};

export const COPILOT_PRESET: AgentPreset = {
  name: "copilot",
  command: "copilot",
  buildArgs(_ctx, _teammate, options) {
    const args = ["-p", "-", "--allow-all", "-s"];
    if (options.model) args.push("--model", options.model);
    return args;
  },
  env: { NO_COLOR: "1" },
  stdinPrompt: true,
};

/** All built-in presets, keyed by name. */
export const PRESETS: Record<string, AgentPreset> = {
  claude: CLAUDE_PRESET,
  codex: CODEX_PRESET,
  copilot: COPILOT_PRESET,
  aider: AIDER_PRESET,
};
