/**
 * PostToolUse hook installer — ensures Claude Code logs tool activity
 * to the debug file so the activity watcher can parse it.
 *
 * The hook itself is a no-op (`node -e ""`). Its mere presence causes
 * Claude Code to write `Hook PostToolUse:<Tool>` lines to --debug-file,
 * which parseClaudeActivity() already knows how to parse.
 *
 * Installation is idempotent and happens on first use of any Claude-based
 * teammate. The hook is project-scoped via .claude/settings.local.json.
 * Per-teammate separation is handled by each teammate having its own
 * --debug-file, not by separate hook entries.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

/** Marker comment embedded in the hook command so we can detect our own hook. */
const HOOK_MARKER = "teammates-activity";

/** The no-op hook command. Runs fast, does nothing — just triggers logging. */
const HOOK_COMMAND = `node -e "" /* ${HOOK_MARKER} */`;

/** Whether the hook has already been verified this process. */
let _installed = false;

/**
 * Ensure a PostToolUse hook is installed in .claude/settings.local.json.
 *
 * Called once per process on first Claude-based teammate dispatch.
 * Safe to call multiple times — skips if already installed.
 *
 * @param projectRoot Root of the project (where .claude/ lives)
 */
export function ensurePostToolUseHook(projectRoot: string): void {
  if (_installed) return;

  const settingsPath = join(projectRoot, ".claude", "settings.local.json");
  let settings: Record<string, any>;

  try {
    settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
  } catch {
    // File doesn't exist or is invalid — create fresh
    settings = {};
  }

  // Navigate to hooks.PostToolUse, creating the structure if needed
  if (!settings.hooks) settings.hooks = {};
  if (!Array.isArray(settings.hooks.PostToolUse)) {
    settings.hooks.PostToolUse = [];
  }

  // Check if our hook is already installed (search for our marker)
  const alreadyInstalled = settings.hooks.PostToolUse.some(
    (entry: any) =>
      Array.isArray(entry?.hooks) &&
      entry.hooks.some(
        (h: any) =>
          typeof h?.command === "string" && h.command.includes(HOOK_MARKER),
      ),
  );

  if (!alreadyInstalled) {
    // Find an existing catch-all matcher (matcher: "") or create one
    let catchAll = settings.hooks.PostToolUse.find(
      (entry: any) => entry?.matcher === "" || entry?.matcher === undefined,
    );

    if (!catchAll) {
      catchAll = { matcher: "", hooks: [] };
      settings.hooks.PostToolUse.push(catchAll);
    }

    if (!Array.isArray(catchAll.hooks)) {
      catchAll.hooks = [];
    }

    catchAll.hooks.push({
      type: "command",
      command: HOOK_COMMAND,
    });

    // Ensure directory exists
    try {
      mkdirSync(dirname(settingsPath), { recursive: true });
    } catch {
      /* already exists */
    }

    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");
  }

  _installed = true;
}

/**
 * Reset the installation flag (for testing).
 */
export function _resetHookInstallerState(): void {
  _installed = false;
}
