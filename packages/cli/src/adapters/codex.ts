/**
 * OpenAI Codex adapter — wraps CliProxyAdapter with Codex-specific preset.
 *
 * Spawns `codex exec - --full-auto --ephemeral --json` and parses JSONL output
 * to extract the final agent message.
 */

import type { SandboxLevel } from "../types.js";
import type { CliProxyOptions } from "./cli-proxy.js";
import { CliProxyAdapter } from "./cli-proxy.js";
import { CODEX_PRESET } from "./presets.js";

export { CODEX_PRESET } from "./presets.js";

export interface CodexAdapterOptions {
  model?: string;
  defaultSandbox?: SandboxLevel;
  extraFlags?: string[];
  commandPath?: string;
}

export class CodexAdapter extends CliProxyAdapter {
  constructor(opts: CodexAdapterOptions = {}) {
    super({
      preset: CODEX_PRESET,
      model: opts.model,
      defaultSandbox: opts.defaultSandbox,
      extraFlags: opts.extraFlags,
      commandPath: opts.commandPath,
    } satisfies CliProxyOptions);
  }
}
