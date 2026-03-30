/**
 * Activity watcher — monitors an agent's activity in real-time
 * and emits parsed activity events (tool calls, errors) as they appear.
 *
 * Data sources:
 *   - **Claude debug log** — tool names + errors, written by Claude via --debug-file.
 *   - **Codex JSONL debug log** — tailed from the paired `.tmp/debug/*.md` file.
 *   - **Copilot JSONL debug log** — tailed from paired `.tmp/debug/*.md` file;
 *     parses `tool.execution_start` / `tool.execution_complete` events.
 */

import { readFileSync, statSync, unwatchFile, watchFile } from "node:fs";
import { basename } from "node:path";
import type { ActivityEvent } from "./types.js";

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
]);

/** Read-only / research tools — collapsed into "Exploring" summaries. */
const RESEARCH_TOOLS = new Set(["Read", "Grep", "Glob", "Search", "Agent"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function getString(
  record: Record<string, unknown> | null,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

function getObjectOrParsedJson(
  record: Record<string, unknown> | null,
  key: string,
): Record<string, unknown> | null {
  const value = record?.[key];
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function getNestedObject(
  record: Record<string, unknown> | null,
  ...keys: string[]
): Record<string, unknown> | null {
  for (const key of keys) {
    const nested = getObjectOrParsedJson(record, key);
    if (nested) return nested;
  }
  return null;
}

function unwrapShellWrapper(command: string): string {
  const trimmed = command.trim();
  const idx = trimmed.search(/\s-Command\s+/i);
  if (idx < 0) return trimmed;
  let inner = trimmed
    .slice(idx)
    .replace(/^\s-Command\s+/i, "")
    .trim();
  if (inner.length >= 2) {
    const first = inner[0];
    const last = inner[inner.length - 1];
    if ((first === '"' || first === "'") && first === last) {
      inner = inner.slice(1, -1).trim();
    }
  }
  return inner || trimmed;
}

function summarizeCommand(command: string, max = 80): string {
  const singleLine = unwrapShellWrapper(command).replace(/\s+/g, " ").trim();
  return singleLine.length > max
    ? `${singleLine.slice(0, max - 3)}...`
    : singleLine;
}

function extractQuotedValue(command: string): string | undefined {
  const match = unwrapShellWrapper(command).match(/["'`]([^"'`]+)["'`]/);
  return match?.[1];
}

function extractFileFromCommand(command: string): string | undefined {
  const normalized = unwrapShellWrapper(command);
  const quoted = extractQuotedValue(normalized);
  if (quoted) return basename(quoted);

  const tokens = normalized.trim().split(/\s+/);
  const last = tokens[tokens.length - 1];
  if (!last || last.startsWith("-")) return undefined;
  return basename(last.replace(/^['"`]|['"`]$/g, ""));
}

function extractPatternFromCommand(command: string): string | undefined {
  const normalized = unwrapShellWrapper(command);
  const selectString = normalized.match(/-Pattern\s+["'`]([^"'`]+)["'`]/i);
  if (selectString) return selectString[1];

  const rg = normalized.match(
    /\brg\b(?:\s+[^\s-][^\s]*)*\s+["'`]([^"'`]+)["'`]/i,
  );
  if (rg) return rg[1];

  return extractQuotedValue(normalized);
}

function summarizePatchTarget(patch: string): string | undefined {
  const matches = Array.from(
    patch.matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm),
  );
  if (matches.length === 0) return undefined;
  const first = basename(matches[0][1].trim());
  return matches.length > 1 ? `${first} (+${matches.length - 1} files)` : first;
}

function summarizeCodexPatchEvent(
  event: Record<string, unknown> | null,
): string | undefined {
  const changes = getObjectOrParsedJson(event, "changes");
  const explicitPath =
    getString(changes, "path") ??
    getString(event, "path") ??
    getString(event, "file_path");
  if (explicitPath) return basename(explicitPath);

  const patchText =
    getString(changes, "patch") ??
    getString(event, "patch") ??
    getString(event, "diff");
  if (patchText) return summarizePatchTarget(patchText);

  const countValue =
    (changes?.change_count as number | undefined) ??
    (event?.change_count as number | undefined);
  if (typeof countValue === "number" && Number.isFinite(countValue)) {
    return `${countValue} files`;
  }

  return undefined;
}

function getCodexToolArgs(
  record: Record<string, unknown> | null,
): Record<string, unknown> | null {
  return (
    getNestedObject(
      record,
      "arguments",
      "input",
      "tool_input",
      "parameters",
      "payload",
      "data",
      "details",
    ) ?? asRecord(record?.args)
  );
}

function getCodexToolName(record: Record<string, unknown> | null): string {
  return (
    getString(record, "name") ??
    getString(record, "tool_name") ??
    getString(record, "call_name") ??
    getString(getNestedObject(record, "tool"), "name") ??
    ""
  );
}

function getCodexToolCallItem(
  event: Record<string, unknown> | null,
): Record<string, unknown> | null {
  const item =
    getNestedObject(event, "item", "output_item") ??
    getNestedObject(getNestedObject(event, "delta"), "item");
  if (!item) return null;

  const itemType = getString(item, "type");
  if (
    itemType === "tool_call" ||
    itemType === "custom_tool_call" ||
    itemType === "function_call"
  ) {
    return item;
  }

  return null;
}

function getCodexCommandExecutionItem(
  event: Record<string, unknown> | null,
): Record<string, unknown> | null {
  const item =
    getNestedObject(event, "item", "output_item") ??
    getNestedObject(getNestedObject(event, "delta"), "item");
  if (!item) return null;
  return getString(item, "type") === "command_execution" ? item : null;
}

function getCodexFileChangeItem(
  event: Record<string, unknown> | null,
): Record<string, unknown> | null {
  const item =
    getNestedObject(event, "item", "output_item") ??
    getNestedObject(getNestedObject(event, "delta"), "item");
  if (!item) return null;
  return getString(item, "type") === "file_change" ? item : null;
}

function getChangeList(
  item: Record<string, unknown> | null,
): Array<Record<string, unknown>> {
  const raw = item?.changes;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null);
}

function summarizeChangedFiles(
  changes: Array<Record<string, unknown>>,
): string | undefined {
  if (changes.length === 0) return undefined;
  const firstPath = getString(changes[0], "path");
  if (!firstPath)
    return changes.length > 1 ? `${changes.length} files` : undefined;
  const first = basename(firstPath);
  return changes.length > 1 ? `${first} (+${changes.length - 1} files)` : first;
}

function summarizeCopilotPath(path: string): string | undefined {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalized) return undefined;
  const parts = normalized.split("/");
  return parts[parts.length - 1] || normalized;
}

function mapCodexFileChangeKind(kind: string): ActivityEvent["tool"] {
  switch (kind) {
    case "add":
      return "Write";
    default:
      return "Edit";
  }
}

function mapCodexFileChangeEvents(
  item: Record<string, unknown> | null,
  elapsedMs: number,
  includeCompleted = false,
): ActivityEvent[] {
  const changes = getChangeList(item);
  if (changes.length === 0) return [];

  const status = getString(item, "status");
  const isFailed = status === "failed";
  const grouped = new Map<string, Array<Record<string, unknown>>>();

  for (const change of changes) {
    const kind = getString(change, "kind") ?? "update";
    const existing = grouped.get(kind);
    if (existing) {
      existing.push(change);
    } else {
      grouped.set(kind, [change]);
    }
  }

  const events: ActivityEvent[] = [];
  for (const [kind, entries] of grouped) {
    if (!includeCompleted && !isFailed) continue;
    const tool = mapCodexFileChangeKind(kind);
    const detail = summarizeChangedFiles(entries);
    events.push({
      elapsedMs,
      tool,
      detail,
      isError: isFailed,
    });
  }
  return events;
}

function mapCodexToolCall(
  name: string,
  args: Record<string, unknown> | null,
): ActivityEvent | null {
  switch (name) {
    case "shell_command": {
      const command = getString(args, "command");
      if (!command) return { elapsedMs: 0, tool: "Bash" };
      const normalized = unwrapShellWrapper(command);
      if (/^\s*(Get-Content|cat|type)\b/i.test(normalized)) {
        return {
          elapsedMs: 0,
          tool: "Read",
          detail: extractFileFromCommand(normalized),
        };
      }
      if (/\b(rg|Select-String|findstr)\b/i.test(normalized)) {
        return {
          elapsedMs: 0,
          tool: "Grep",
          detail:
            extractPatternFromCommand(normalized) ??
            summarizeCommand(normalized),
        };
      }
      if (/\b(Get-ChildItem|ls|dir)\b/i.test(normalized)) {
        return {
          elapsedMs: 0,
          tool: "Glob",
          detail: summarizeCommand(normalized),
        };
      }
      return {
        elapsedMs: 0,
        tool: "Bash",
        detail: summarizeCommand(normalized),
      };
    }
    case "apply_patch":
      return {
        elapsedMs: 0,
        tool: "Edit",
        detail: summarizePatchTarget(getString(args, "patch") ?? ""),
      };
    case "view_image":
      return {
        elapsedMs: 0,
        tool: "Read",
        detail: basename(
          getString(args, "path") ?? getString(args, "image_path") ?? "image",
        ),
      };
    case "read_mcp_resource":
      return {
        elapsedMs: 0,
        tool: "Read",
        detail: getString(args, "uri"),
      };
    case "list_mcp_resources":
    case "list_mcp_resource_templates":
      return {
        elapsedMs: 0,
        tool: "Search",
        detail: getString(args, "server"),
      };
    default:
      return null;
  }
}

/**
 * Parse one Codex JSONL event line into zero or more activity events.
 * Uses wall-clock arrival time because the JSONL stream doesn't expose
 * a stable per-tool timestamp we can rely on here.
 */
export function parseCodexJsonlLine(
  line: string,
  taskStartTime: number,
  receivedAt = Date.now(),
): ActivityEvent[] {
  const trimmed = line.trim();
  if (!trimmed) return [];

  let event: Record<string, unknown> | null = null;
  try {
    event = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return [];
  }

  const elapsedMs = Math.max(0, receivedAt - taskStartTime);
  const eventType = getString(event, "type");
  if (!eventType) return [];

  if (eventType === "error") {
    return [
      {
        elapsedMs,
        tool: "Codex",
        detail: getString(event, "message")?.slice(0, 120),
        isError: true,
      },
    ];
  }

  if (eventType === "exec_command_begin") {
    const mapped = mapCodexToolCall("shell_command", {
      command: getString(event, "command") ?? "",
    });
    return mapped ? [{ ...mapped, elapsedMs }] : [];
  }

  if (eventType === "patch_apply_begin") {
    return [
      {
        elapsedMs,
        tool: "Edit",
        detail: summarizeCodexPatchEvent(event),
      },
    ];
  }

  if (eventType === "mcp_tool_call_begin") {
    const mapped = mapCodexToolCall(
      getCodexToolName(event),
      getCodexToolArgs(event),
    );
    return mapped ? [{ ...mapped, elapsedMs }] : [];
  }

  if (eventType === "web_search_begin") {
    return [
      {
        elapsedMs,
        tool: "Search",
        detail:
          getString(event, "query") ??
          getString(asRecord(event.payload), "query") ??
          getString(asRecord(event.input), "query"),
      },
    ];
  }

  if (eventType === "item.started") {
    const commandItem = getCodexCommandExecutionItem(event);
    if (commandItem) {
      const mapped = mapCodexToolCall("shell_command", {
        command: getString(commandItem, "command") ?? "",
      });
      return mapped ? [{ ...mapped, elapsedMs }] : [];
    }

    const fileChangeItem = getCodexFileChangeItem(event);
    if (fileChangeItem) {
      return mapCodexFileChangeEvents(fileChangeItem, elapsedMs, true);
    }
  }

  if (
    eventType !== "item.completed" &&
    eventType !== "item.started" &&
    eventType !== "response.output_item.added" &&
    eventType !== "response.output_item.done"
  ) {
    return [];
  }

  if (eventType === "item.completed") {
    const fileChangeItem = getCodexFileChangeItem(event);
    if (fileChangeItem) {
      return mapCodexFileChangeEvents(fileChangeItem, elapsedMs);
    }
  }

  const item = getCodexToolCallItem(event);
  if (!item) return [];

  const mapped = mapCodexToolCall(
    getCodexToolName(item),
    getCodexToolArgs(item),
  );
  if (!mapped) return [];
  return [{ ...mapped, elapsedMs }];
}

/** Tool names that are internal plumbing — silently dropped from activity. */
const COPILOT_PLUMBING = new Set([
  "report_intent",
  "store_memory",
  "fetch_copilot_cli_documentation",
  "list_powershell",
  "list_agents",
  "read_powershell",
  "write_powershell",
  "stop_powershell",
  "sql",
]);

function mapCopilotToolCall(
  name: string,
  args: Record<string, unknown> | null,
): ActivityEvent | null {
  // Skip known plumbing tools
  if (COPILOT_PLUMBING.has(name)) return null;

  switch (name) {
    case "view": {
      const path = getString(args, "path");
      if (!path) return { elapsedMs: 0, tool: "Read" };
      const summary = summarizeCopilotPath(path);
      const normalized = path.replace(/\\/g, "/");
      const lastSegment = normalized.split("/").pop() ?? normalized;
      const looksFile = lastSegment.includes(".");
      return {
        elapsedMs: 0,
        tool: looksFile ? "Read" : "Glob",
        detail: summary,
      };
    }
    case "edit":
    case "str_replace":
    case "replace_in_file":
      return {
        elapsedMs: 0,
        tool: "Edit",
        detail: summarizeCopilotPath(
          getString(args, "path") ?? getString(args, "file_path") ?? "",
        ),
      };
    case "write":
    case "create":
      return {
        elapsedMs: 0,
        tool: "Write",
        detail: summarizeCopilotPath(
          getString(args, "path") ?? getString(args, "file_path") ?? "",
        ),
      };
    case "grep":
    case "search":
      return {
        elapsedMs: 0,
        tool: "Grep",
        detail:
          getString(args, "pattern") ??
          getString(args, "query") ??
          summarizeCopilotPath(getString(args, "path") ?? ""),
      };
    case "glob":
      return {
        elapsedMs: 0,
        tool: "Glob",
        detail:
          getString(args, "pattern") ??
          summarizeCopilotPath(getString(args, "path") ?? ""),
      };
    case "run_in_terminal":
    case "shell":
    case "bash":
    case "powershell": {
      const command =
        getString(args, "command") ??
        getString(args, "cmd") ??
        getString(args, "input");
      if (!command) return { elapsedMs: 0, tool: "Bash" };
      const normalized = unwrapShellWrapper(command);
      if (/^\s*(Get-Content|cat|type)\b/i.test(normalized)) {
        return {
          elapsedMs: 0,
          tool: "Read",
          detail: extractFileFromCommand(normalized),
        };
      }
      if (/\b(rg|Select-String|findstr)\b/i.test(normalized)) {
        return {
          elapsedMs: 0,
          tool: "Grep",
          detail:
            extractPatternFromCommand(normalized) ??
            summarizeCommand(normalized),
        };
      }
      if (/\b(Get-ChildItem|ls|dir)\b/i.test(normalized)) {
        return {
          elapsedMs: 0,
          tool: "Glob",
          detail: summarizeCommand(normalized),
        };
      }
      return {
        elapsedMs: 0,
        tool: "Bash",
        detail: summarizeCommand(normalized),
      };
    }
    case "task":
      return {
        elapsedMs: 0,
        tool: "Agent",
        detail:
          getString(args, "description") ??
          getString(args, "name") ??
          getString(args, "agent_type"),
      };
    case "read_agent":
    case "write_agent":
      return { elapsedMs: 0, tool: "Agent" };
    case "web_search":
      return {
        elapsedMs: 0,
        tool: "WebSearch",
        detail: getString(args, "query"),
      };
    case "web_fetch":
      return {
        elapsedMs: 0,
        tool: "WebFetch",
        detail: getString(args, "url"),
      };
    default:
      break;
  }

  // GitHub MCP server tools: github-mcp-server-<method>
  if (name.startsWith("github-mcp-server-")) {
    const method = name.slice("github-mcp-server-".length);
    if (method.startsWith("search_")) {
      return {
        elapsedMs: 0,
        tool: "Search",
        detail: getString(args, "query") ?? method,
      };
    }
    if (
      method.startsWith("get_") ||
      method.startsWith("issue_read") ||
      method.startsWith("pull_request_read") ||
      method.startsWith("list_")
    ) {
      return {
        elapsedMs: 0,
        tool: "Read",
        detail: getString(args, "repo")
          ? `${getString(args, "owner") ?? ""}/${getString(args, "repo") ?? ""}`
          : method,
      };
    }
    // Fallback for any other MCP tool
    return { elapsedMs: 0, tool: "Search", detail: method };
  }

  return null;
}

export function parseCopilotJsonlLine(
  line: string,
  taskStartTime: number,
  receivedAt = Date.now(),
): ActivityEvent[] {
  const trimmed = line.trim();
  if (!trimmed) return [];

  let event: Record<string, unknown> | null = null;
  try {
    event = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return [];
  }

  // Prefer the event's own timestamp for accurate elapsed time
  const ts = getString(event, "timestamp");
  const eventTime = ts ? new Date(ts).getTime() : NaN;
  const elapsedMs = Math.max(
    0,
    Number.isNaN(eventTime)
      ? receivedAt - taskStartTime
      : eventTime - taskStartTime,
  );
  const eventType = getString(event, "type");
  if (!eventType) return [];

  if (eventType === "tool.execution_start") {
    const data = getNestedObject(event, "data");
    const mapped = mapCopilotToolCall(
      getString(data, "toolName") ?? "",
      getNestedObject(data, "arguments"),
    );
    return mapped ? [{ ...mapped, elapsedMs }] : [];
  }

  if (eventType === "tool.execution_complete") {
    const data = getNestedObject(event, "data");
    if (!data || data.success !== false) return [];
    return [
      {
        elapsedMs,
        tool: getString(data, "toolName") ?? "Copilot",
        detail:
          getString(getNestedObject(data, "result"), "content") ??
          getString(getNestedObject(data, "result"), "detailedContent") ??
          "tool failed",
        isError: true,
      },
    ];
  }

  return [];
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

// ── Claude debug log parser ──────────────────────────────────────────

const TOOL_USE_RE =
  /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s+\[DEBUG\]\s+Getting matching hook commands for PostToolUse with query:\s+(\w+)/;

const FILE_WRITTEN_RE =
  /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s+\[DEBUG\]\s+File\s+(.+?)\s+written atomically/;

const RENAMING_RE =
  /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s+\[DEBUG\]\s+Renaming\s+\S+\s+to\s+(.+)/;

/**
 * Parse activity events from a Claude debug log.
 * Extracts tool names from PostToolUse hook lines, file paths from
 * write/rename events, and errors from tool error lines.
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
 * Watch a Claude debug log for tool errors only.
 * Use alongside watchDebugLog for complete coverage.
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
 * Watch a Claude debug log file for activity events.
 * Parses tool names, file paths, and errors from the debug log.
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

/**
 * Watch a Codex JSONL debug log and emit live activity as new lines arrive.
 * Uses polling (fs.watchFile) for Windows reliability and preserves a trailing
 * partial line between reads so incomplete JSONL writes are not dropped.
 */
export function watchCodexDebugLog(
  debugFilePath: string,
  taskStartTime: number,
  callback: ActivityCallback,
  pollIntervalMs = 1000,
): () => void {
  let lastSize = 0;
  let stopped = false;
  let trailing = "";

  const checkForNew = () => {
    if (stopped) return;
    try {
      const s = statSync(debugFilePath);
      if (s.size <= lastSize) return;
      const fd = readFileSync(debugFilePath, "utf-8");
      const newContent = fd.slice(lastSize);
      lastSize = s.size;

      const chunk = trailing + newContent;
      const lines = chunk.split(/\r?\n/);
      trailing = lines.pop() ?? "";

      const now = Date.now();
      const events = lines.flatMap((line) =>
        parseCodexJsonlLine(line, taskStartTime, now),
      );
      if (events.length > 0) callback(events);
    } catch {
      // File not ready yet or read error.
    }
  };

  watchFile(debugFilePath, { interval: pollIntervalMs }, () => checkForNew());
  checkForNew();

  return () => {
    stopped = true;
    unwatchFile(debugFilePath);
    if (!trailing.trim()) return;
    const events = parseCodexJsonlLine(trailing, taskStartTime, Date.now());
    if (events.length > 0) callback(events);
  };
}

/**
 * Watch a Copilot JSONL debug log and emit live activity from tool events.
 */
export function watchCopilotDebugLog(
  debugFilePath: string,
  taskStartTime: number,
  callback: ActivityCallback,
  pollIntervalMs = 1000,
): () => void {
  let lastSize = 0;
  let stopped = false;
  let trailing = "";

  const checkForNew = () => {
    if (stopped) return;
    try {
      const s = statSync(debugFilePath);
      if (s.size <= lastSize) return;
      const fd = readFileSync(debugFilePath, "utf-8");
      const newContent = fd.slice(lastSize);
      lastSize = s.size;

      const chunk = trailing + newContent;
      const lines = chunk.split(/\r?\n/);
      trailing = lines.pop() ?? "";

      const now = Date.now();
      const events = lines.flatMap((line) =>
        parseCopilotJsonlLine(line, taskStartTime, now),
      );
      if (events.length > 0) callback(events);
    } catch {
      // File not ready yet or read error.
    }
  };

  watchFile(debugFilePath, { interval: pollIntervalMs }, () => checkForNew());
  checkForNew();

  return () => {
    stopped = true;
    unwatchFile(debugFilePath);
    if (!trailing.trim()) return;
    const events = parseCopilotJsonlLine(trailing, taskStartTime, Date.now());
    if (events.length > 0) callback(events);
  };
}

// ── Collapsing ──────────────────────────────────────────────────────

/**
 * Collapse raw activity events into a compact display-friendly list.
 *
 * Rules:
 * - Consecutive research tools (Read, Grep, Glob, Search, Agent) are
 *   collapsed into a single "Exploring" entry with tool counts.
 * - Consecutive Edit/Write calls to the same file are collapsed into
 *   one entry with a count (e.g. "chat-view.ts ×7").
 * - Bash events with detail are shown individually.
 * - Errors are never collapsed.
 * - TodoWrite and ToolSearch are filtered out entirely.
 */
export function collapseActivityEvents(
  events: ActivityEvent[],
): ActivityEvent[] {
  if (events.length === 0) return [];

  const result: ActivityEvent[] = [];

  // Accumulator for research phase
  let researchStart = -1;
  const researchCounts = new Map<string, number>();
  const researchEvents: ActivityEvent[] = [];

  const flushResearch = () => {
    if (researchStart < 0) return;
    if (researchEvents.length === 1) {
      result.push(researchEvents[0]);
      researchStart = -1;
      researchCounts.clear();
      researchEvents.length = 0;
      return;
    }
    const parts: string[] = [];
    for (const [tool, count] of researchCounts) {
      parts.push(`${count}× ${tool}`);
    }
    result.push({
      elapsedMs: researchStart,
      tool: "Exploring",
      detail: parts.join(", "),
    });
    researchStart = -1;
    researchCounts.clear();
    researchEvents.length = 0;
  };

  // Accumulator for consecutive edits to the same file
  let editFile: string | undefined;
  let editStart = -1;
  let editCount = 0;
  let editTool = "Edit";

  const flushEdits = () => {
    if (editCount === 0) return;
    const detail =
      editCount > 1
        ? `${editFile ?? "file"} (×${editCount})`
        : (editFile ?? "file");
    result.push({ elapsedMs: editStart, tool: editTool, detail });
    editFile = undefined;
    editStart = -1;
    editCount = 0;
  };

  for (const ev of events) {
    // Skip internal plumbing tools
    if (ev.tool === "TodoWrite" || ev.tool === "ToolSearch") continue;

    // Errors always shown individually
    if (ev.isError) {
      flushResearch();
      flushEdits();
      result.push(ev);
      continue;
    }

    // Research tools → accumulate into a phase
    if (RESEARCH_TOOLS.has(ev.tool)) {
      flushEdits();
      if (researchStart < 0) researchStart = ev.elapsedMs;
      researchCounts.set(ev.tool, (researchCounts.get(ev.tool) ?? 0) + 1);
      researchEvents.push(ev);
      continue;
    }

    // Bash without meaningful detail → treat as research
    if (ev.tool === "Bash" && !ev.detail) {
      flushEdits();
      if (researchStart < 0) researchStart = ev.elapsedMs;
      researchCounts.set("Bash", (researchCounts.get("Bash") ?? 0) + 1);
      researchEvents.push(ev);
      continue;
    }

    // Write/Edit — collapse consecutive same-file edits
    if (ev.tool === "Edit" || ev.tool === "Write") {
      flushResearch();
      const file = ev.detail ?? "file";
      if (ev.tool === editTool && file === editFile) {
        editCount++;
      } else {
        flushEdits();
        editFile = file;
        editStart = ev.elapsedMs;
        editCount = 1;
        editTool = ev.tool;
      }
      continue;
    }

    // Everything else (Bash with detail, WebFetch, etc.) — individual line
    flushResearch();
    flushEdits();
    result.push(ev);
  }

  flushResearch();
  flushEdits();
  return result;
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
