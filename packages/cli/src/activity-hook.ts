/**
 * Activity hook installer — ensures the PostToolUse hook that captures
 * tool input details is registered in the project's Claude settings.
 *
 * The hook script (scripts/activity-hook.mjs) writes tool name + detail
 * to a file specified by TEAMMATES_ACTIVITY_LOG env var. The activity
 * watcher reads this file for real-time activity display.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The hook command to install — runs the activity-hook.mjs script via node. */
function getHookCommand(): string {
  // Resolve the hook script path relative to this module.
  // In the built package, this is at dist/activity-hook.ts → scripts/activity-hook.mjs
  // We use the scripts/ path relative to the package root.
  const scriptPath = fileURLToPath(
    new URL("../scripts/activity-hook.mjs", import.meta.url),
  );
  // Normalize to forward slashes for cross-platform shell compatibility
  const normalized = scriptPath.replace(/\\/g, "/");
  return `node "${normalized}"`;
}

/** Marker to identify our hook in settings. */
const HOOK_MARKER = "activity-hook.mjs";

/**
 * Ensure the activity tracking PostToolUse hook is registered in the
 * project's `.claude/settings.local.json`. Idempotent — checks before adding.
 * Uses the local (gitignored) settings so the hook doesn't get checked in.
 *
 * @param projectDir - Root directory of the project (where .claude/ lives)
 */
export function ensureActivityHook(projectDir: string): void {
  const settingsDir = join(projectDir, ".claude");
  const settingsPath = join(settingsDir, "settings.local.json");

  // Read existing settings or start fresh
  let settings: Record<string, unknown> = {};
  try {
    if (existsSync(settingsPath)) {
      settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    }
  } catch {
    // Corrupt or unreadable — start fresh
    settings = {};
  }

  // Check if hook is already installed
  const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;
  const postToolUse = (hooks.PostToolUse ?? []) as Array<{
    matcher?: string;
    command?: string;
  }>;

  const alreadyInstalled = postToolUse.some((h) =>
    h.command?.includes(HOOK_MARKER),
  );
  if (alreadyInstalled) return;

  // Install the hook
  const hookEntry = {
    matcher: "",
    command: getHookCommand(),
  };

  hooks.PostToolUse = [...postToolUse, hookEntry];
  settings.hooks = hooks;

  // Write back
  try {
    if (!existsSync(settingsDir)) {
      mkdirSync(settingsDir, { recursive: true });
    }
    writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  } catch {
    // Best effort — don't crash if settings can't be written
  }
}
