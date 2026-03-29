/**
 * GitHub Copilot adapter — wraps CliProxyAdapter with Copilot-specific preset.
 *
 * Spawns `copilot -p - --allow-all -s` and pipes the prompt via stdin.
 * Uses --allow-all for full permissions and -s for clean text output.
 */

import type { CliProxyOptions } from "./cli-proxy.js";
import { CliProxyAdapter } from "./cli-proxy.js";
import { COPILOT_PRESET } from "./presets.js";

export { COPILOT_PRESET } from "./presets.js";

export interface CopilotAdapterOptions {
  model?: string;
  extraFlags?: string[];
  commandPath?: string;
}

export class CopilotAdapter extends CliProxyAdapter {
  constructor(opts: CopilotAdapterOptions = {}) {
    super({
      preset: COPILOT_PRESET,
      model: opts.model,
      extraFlags: opts.extraFlags,
      commandPath: opts.commandPath,
    } satisfies CliProxyOptions);
  }
}
