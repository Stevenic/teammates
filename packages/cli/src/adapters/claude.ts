/**
 * Claude Code adapter — wraps CliProxyAdapter with Claude-specific preset.
 *
 * Spawns `claude -p --verbose --dangerously-skip-permissions` and streams
 * output live. Supports debug files for activity tracking.
 */

import type { CliProxyOptions } from "./cli-proxy.js";
import { CliProxyAdapter } from "./cli-proxy.js";
import { CLAUDE_PRESET } from "./presets.js";

export { CLAUDE_PRESET } from "./presets.js";

export interface ClaudeAdapterOptions {
  model?: string;
  extraFlags?: string[];
  commandPath?: string;
}

export class ClaudeAdapter extends CliProxyAdapter {
  constructor(opts: ClaudeAdapterOptions = {}) {
    super({
      preset: CLAUDE_PRESET,
      model: opts.model,
      extraFlags: opts.extraFlags,
      commandPath: opts.commandPath,
    } satisfies CliProxyOptions);
  }
}
