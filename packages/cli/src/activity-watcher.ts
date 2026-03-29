/**
 * Activity watcher — monitors an agent's activity in real-time
 * and emits parsed activity events (tool calls, errors) as they appear.
 *
 * Two data sources:
 *   1. **Activity hook log** — a PostToolUse hook writes tool name + input
 *      details (file path, command, pattern) to a per-agent log file.
 *      This provides rich detail for every tool call.
 *   2. **Debug log** — Claude's built-in debug log provides tool errors.
 *      Used as a fallback for error detection.
 *
 * Currently supports Claude debug logs. Codex support can be added later
 * by parsing JSONL stdout events.
 */

import { readFileSync, statSync, unwatchFile, watchFile } from "node:fs";
import type { ActivityEvent } from "./types.js";

// ── Activity hook log parsing ───────────────────────────────────────

/**
 * Activity hook log format (one line per tool call):
 *   `2026-03-29T22:15:00.000Z Read WISDOM.md`
 *   `2026-03-29T22:15:05.000Z Bash npm run build`
 *   `2026-03-29T22:15:10.000Z Grep /pattern/`
 */
const ACTIVITY_LINE_RE = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s+(\w+)\s*(.*)/;

/** Tools that represent actual agent work (not internal plumbing). */
const WORK_TOOLS = new Set([
  "Read",
  "Write",
  "Edit",
  "Bash",
  "Grep",
  "Glob",
  "Search",
  "Agent",
  "WebFetch",
  "WebSearch",
  "NotebookEdit",
  "TodoWrite",
]);

/**
 * Parse activity events from the hook log file content.
 */
export function parseActivityLog(
  content: string,
  taskStartTime: number,
): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  for (const line of content.split("\n")) {
    const m = ACTIVITY_LINE_RE.exec(line);
    if (!m) continue;
    const tool = m[2];
    if (!WORK_TOOLS.has(tool)) continue;
    const ts = new Date(m[1]).getTime();
    const detail = m[3].trim() || undefined;
    events.push({ elapsedMs: ts - taskStartTime, tool, detail });
  }
  return events;
}

// ── Debug log parsing (errors only) ─────────────────────────────────

/**
 * Lines we care about in a Claude debug log:
 *   - Tool error:  `2026-03-28T19:45:36.245Z [DEBUG] Read tool error (282ms): ...`
 */

const TOOL_ERROR_RE =
  /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s+\[DEBUG\]\s+(\w+)\s+tool error\s+\([^)]+\):\s+(.*)/;

/**
 * Parse error events from a Claude debug log.
 * Only extracts tool errors — tool use events are handled by the hook log.
 */
export function parseDebugLogErrors(
  content: string,
  taskStartTime: number,
): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  for (const line of content.split("\n")) {
    const m = TOOL_ERROR_RE.exec(line);
    if (!m) continue;
    const tool = m[2];
    const detail = m[3].slice(0, 120);
    const ts = new Date(m[1]).getTime();
    events.push({ elapsedMs: ts - taskStartTime, tool, detail, isError: true });
  }
  return events;
}

// ── Legacy parser (kept for backward compat) ────────────────────────

const TOOL_USE_RE =
  /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s+\[DEBUG\]\s+Getting matching hook commands for PostToolUse with query:\s+(\w+)/;

const FILE_WRITTEN_RE =
  /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s+\[DEBUG\]\s+File\s+(.+?)\s+written atomically/;

const RENAMING_RE =
  /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s+\[DEBUG\]\s+Renaming\s+\S+\s+to\s+(.+)/;

/**
 * Parse activity events from a Claude debug log (legacy — no hook).
 * Falls back to this when no activity hook log is available.
 */
export function parseClaudeActivity(
  content: string,
  taskStartTime: number,
): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  let pendingFilename: string | undefined;

  for (const line of content.split("\n")) {
    let m = TOOL_ERROR_RE.exec(line);
    if (m) {
      const tool = m[2];
      const detail = m[3].slice(0, 120);
      const ts = new Date(m[1]).getTime();
      events.push({
        elapsedMs: ts - taskStartTime,
        tool,
        detail,
        isError: true,
      });
      continue;
    }

    m = RENAMING_RE.exec(line);
    if (m) {
      const fullPath = m[2].trim();
      const segments = fullPath.replace(/\\/g, "/").split("/");
      pendingFilename = segments[segments.length - 1];
      continue;
    }

    m = FILE_WRITTEN_RE.exec(line);
    if (m) {
      const fullPath = m[2];
      const segments = fullPath.replace(/\\/g, "/").split("/");
      pendingFilename = segments[segments.length - 1];
      continue;
    }

    m = TOOL_USE_RE.exec(line);
    if (m) {
      const tool = m[2];
      if (!WORK_TOOLS.has(tool)) continue;
      const ts = new Date(m[1]).getTime();
      let detail: string | undefined;
      if ((tool === "Write" || tool === "Edit") && pendingFilename) {
        detail = pendingFilename;
        pendingFilename = undefined;
      }
      events.push({ elapsedMs: ts - taskStartTime, tool, detail });
    }
  }
  return events;
}

// ── Watcher ─────────────────────────────────────────────────────────

export type ActivityCallback = (events: ActivityEvent[]) => void;

/**
 * Watch a file for new content and parse it into activity events.
 * Uses polling (fs.watchFile) for Windows reliability.
 * Returns a stop function to clean up.
 */
function watchFile_(
  filePath: string,
  taskStartTime: number,
  parser: (content: string, startTime: number) => ActivityEvent[],
  callback: ActivityCallback,
  pollIntervalMs: number,
): () => void {
  let lastSize = 0;
  let stopped = false;

  try {
    const s = statSync(filePath);
    lastSize = s.size;
  } catch {
    // File may not exist yet
  }

  const checkForNew = () => {
    if (stopped) return;
    try {
      const s = statSync(filePath);
      if (s.size <= lastSize) return;
      const fd = readFileSync(filePath, "utf-8");
      const newContent = fd.slice(lastSize);
      lastSize = s.size;
      const events = parser(newContent, taskStartTime);
      if (events.length > 0) callback(events);
    } catch {
      // File not ready yet or read error
    }
  };

  watchFile(filePath, { interval: pollIntervalMs }, () => checkForNew());
  checkForNew();

  return () => {
    stopped = true;
    unwatchFile(filePath);
  };
}

/**
 * Watch an activity hook log file for tool call events with details.
 */
export function watchActivityLog(
  activityFilePath: string,
  taskStartTime: number,
  callback: ActivityCallback,
  pollIntervalMs = 1000,
): () => void {
  return watchFile_(
    activityFilePath,
    taskStartTime,
    parseActivityLog,
    callback,
    pollIntervalMs,
  );
}

/**
 * Watch a Claude debug log for tool errors only.
 * Use alongside watchActivityLog for complete coverage.
 */
export function watchDebugLogErrors(
  debugFilePath: string,
  taskStartTime: number,
  callback: ActivityCallback,
  pollIntervalMs = 1000,
): () => void {
  return watchFile_(
    debugFilePath,
    taskStartTime,
    parseDebugLogErrors,
    callback,
    pollIntervalMs,
  );
}

/**
 * Watch a Claude debug log file for activity events (legacy — no hook).
 * Used when no activity hook is installed.
 */
export function watchDebugLog(
  debugFilePath: string,
  taskStartTime: number,
  callback: ActivityCallback,
  pollIntervalMs = 1000,
): () => void {
  return watchFile_(
    debugFilePath,
    taskStartTime,
    parseClaudeActivity,
    callback,
    pollIntervalMs,
  );
}

// ── Formatting ──────────────────────────────────────────────────────

/**
 * Format an elapsed time in milliseconds as MM:SS.
 */
export function formatActivityTime(elapsedMs: number): string {
  const totalSecs = Math.max(0, Math.floor(elapsedMs / 1000));
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}
