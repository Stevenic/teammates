/**
 * Agent log parser — extracts condensed conversation timelines from agent
 * debug logs and stdout for the interrupt-and-resume system.
 *
 * Each agent type has a different log format:
 * - Claude: structured --debug-file with tool calls and results
 * - Codex: JSONL with item.completed events
 * - Others: raw stdout (truncated)
 */

import { readFileSync } from "node:fs";

/** A single action extracted from an agent's conversation log. */
export interface LogEntry {
  /** Tool name or action type (e.g. "Write", "Read", "Search", "text") */
  action: string;
  /** Key parameters — file paths, search queries (NOT full file contents) */
  summary: string;
}

/**
 * Parse a Claude --debug-file into condensed log entries.
 *
 * The debug file contains the full conversation log including tool calls
 * and their results. We extract tool names and key parameters (file paths,
 * search queries) but NOT full file contents to keep the resume prompt compact.
 */
export function parseClaudeDebugLog(debugFilePath: string): LogEntry[] {
  let content: string;
  try {
    content = readFileSync(debugFilePath, "utf-8");
  } catch {
    return [];
  }

  const entries: LogEntry[] = [];

  // Claude debug logs contain tool_use and tool_result blocks
  // Extract tool calls with their key parameters
  const toolUsePattern =
    /Tool call:\s*(\w+)\s*\{([^}]*)\}|"type":\s*"tool_use".*?"name":\s*"(\w+)".*?"input":\s*\{([^}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = toolUsePattern.exec(content)) !== null) {
    const toolName = match[1] || match[3];
    const params = match[2] || match[4];
    if (!toolName) continue;

    const summary = extractKeyParams(toolName, params);
    entries.push({ action: toolName, summary });
  }

  // If structured parsing found nothing, try line-by-line patterns
  if (entries.length === 0) {
    for (const line of content.split("\n")) {
      // Look for common Claude debug log patterns
      const writeMatch = line.match(
        /(?:Write|Edit|Create)\s+(?:file:?\s*)?[`"]?([^\s`"]+\.\w+)/i,
      );
      if (writeMatch) {
        entries.push({ action: "Write", summary: writeMatch[1] });
        continue;
      }

      const readMatch = line.match(
        /(?:Read)\s+(?:file:?\s*)?[`"]?([^\s`"]+\.\w+)/i,
      );
      if (readMatch) {
        entries.push({ action: "Read", summary: readMatch[1] });
        continue;
      }

      const searchMatch = line.match(
        /(?:Search|Grep|Glob)\s+.*?["']([^"']+)["']/i,
      );
      if (searchMatch) {
        entries.push({ action: "Search", summary: searchMatch[1] });
        continue;
      }

      const bashMatch = line.match(
        /(?:Bash|Shell|Execute)\s+.*?["'`]([^"'`]+)["'`]/i,
      );
      if (bashMatch) {
        entries.push({
          action: "Bash",
          summary: bashMatch[1].slice(0, 80),
        });
      }
    }
  }

  return entries;
}

/**
 * Parse Codex JSONL output into condensed log entries.
 */
export function parseCodexOutput(stdout: string): LogEntry[] {
  const entries: LogEntry[] = [];

  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === "item.completed") {
        if (event.item?.type === "tool_call") {
          const toolName = event.item.name ?? "tool";
          const summary = event.item.arguments
            ? extractKeyParams(toolName, JSON.stringify(event.item.arguments))
            : "";
          entries.push({ action: toolName, summary });
        } else if (event.item?.type === "agent_message" && event.item.text) {
          entries.push({
            action: "text",
            summary: event.item.text.slice(0, 100),
          });
        }
      }
    } catch {
      /* skip non-JSON lines */
    }
  }

  return entries;
}

/**
 * Parse raw stdout into condensed log entries (fallback for unknown agents).
 */
export function parseRawOutput(output: string): LogEntry[] {
  const entries: LogEntry[] = [];

  for (const line of output.split("\n")) {
    const writeMatch = line.match(
      /(?:Created|Modified|Updated|Wrote|Edited)\s+(?:file:?\s*)?[`"]?([^\s`"]+\.\w+)/i,
    );
    if (writeMatch) {
      entries.push({ action: "Write", summary: writeMatch[1] });
    }
  }

  return entries;
}

/**
 * Format log entries into a condensed markdown timeline for the resume prompt.
 *
 * Keeps the output compact — file paths and search queries only, no content.
 * Groups consecutive same-action entries (e.g., "Wrote 15 files: ...").
 */
export function formatLogTimeline(entries: LogEntry[]): string {
  if (entries.length === 0) return "(no tool calls captured)";

  const lines: string[] = [];
  let i = 0;

  while (i < entries.length) {
    const entry = entries[i];

    // Group consecutive same-action entries
    let groupEnd = i + 1;
    while (
      groupEnd < entries.length &&
      entries[groupEnd].action === entry.action
    ) {
      groupEnd++;
    }

    const groupSize = groupEnd - i;
    if (groupSize > 3 && entry.action !== "text") {
      // Collapse large groups
      const summaries = entries
        .slice(i, groupEnd)
        .map((e) => e.summary)
        .filter(Boolean);
      const preview = summaries.slice(0, 3).join(", ");
      const more =
        summaries.length > 3 ? ` (+${summaries.length - 3} more)` : "";
      lines.push(
        `${lines.length + 1}. ${entry.action} ${groupSize} items: ${preview}${more}`,
      );
      i = groupEnd;
    } else {
      // Individual entries
      for (let j = i; j < groupEnd; j++) {
        const e = entries[j];
        const desc = e.summary ? ` ${e.summary}` : "";
        lines.push(`${lines.length + 1}. ${e.action}${desc}`);
      }
      i = groupEnd;
    }
  }

  return lines.join("\n");
}

/**
 * Extract key parameters from a tool call — file paths and search queries,
 * NOT full file contents. Keeps the resume prompt compact.
 */
function extractKeyParams(toolName: string, paramsStr: string): string {
  const lower = toolName.toLowerCase();

  // Extract file_path parameter
  const filePathMatch = paramsStr.match(
    /file_path["']?\s*[:=]\s*["']([^"']+)["']/,
  );
  if (filePathMatch) return filePathMatch[1];

  // Extract path parameter
  const pathMatch = paramsStr.match(/["']?path["']?\s*[:=]\s*["']([^"']+)["']/);
  if (pathMatch) return pathMatch[1];

  // Extract command for bash/shell tools
  if (lower === "bash" || lower === "shell" || lower === "execute") {
    const cmdMatch = paramsStr.match(
      /["']?command["']?\s*[:=]\s*["']([^"']+)["']/,
    );
    if (cmdMatch) return cmdMatch[1].slice(0, 80);
  }

  // Extract query/pattern for search tools
  if (lower === "search" || lower === "grep" || lower === "glob") {
    const queryMatch = paramsStr.match(
      /["']?(?:query|pattern)["']?\s*[:=]\s*["']([^"']+)["']/,
    );
    if (queryMatch) return queryMatch[1];
  }

  return "";
}

/**
 * Estimate the token count of a string (rough: 1 token ≈ 4 chars).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Build a condensed conversation log from the available sources.
 * Tries Claude debug file first, then Codex JSONL, then raw stdout.
 * Truncates to the token budget if needed.
 */
export function buildConversationLog(
  debugFile: string | undefined,
  stdout: string,
  presetName: string,
  tokenBudget = 8_000,
): { log: string; toolCallCount: number; filesChanged: string[] } {
  let entries: LogEntry[];

  if (debugFile && presetName === "claude") {
    entries = parseClaudeDebugLog(debugFile);
  } else if (presetName === "codex") {
    entries = parseCodexOutput(stdout);
  } else {
    entries = parseRawOutput(stdout);
  }

  // Extract files changed
  const filesChanged = entries
    .filter((e) =>
      ["Write", "Edit", "Create", "write", "edit", "create"].includes(e.action),
    )
    .map((e) => e.summary)
    .filter(Boolean);

  const toolCallCount = entries.filter((e) => e.action !== "text").length;

  let log = formatLogTimeline(entries);

  // Truncate if over budget
  if (estimateTokens(log) > tokenBudget) {
    // Keep first and last entries, summarize the middle
    const lines = log.split("\n");
    const keepFirst = Math.floor(lines.length * 0.3);
    const keepLast = Math.floor(lines.length * 0.2);
    const omitted = lines.length - keepFirst - keepLast;
    log = [
      ...lines.slice(0, keepFirst),
      `... (${omitted} steps omitted for brevity) ...`,
      ...lines.slice(lines.length - keepLast),
    ].join("\n");
  }

  return { log, toolCallCount, filesChanged };
}
