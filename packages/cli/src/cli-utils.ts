/**
 * Pure utility functions extracted from cli.ts for testability.
 */

/** Convert a Date to a human-readable relative time string. */
export function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

/** Word-wrap text to maxWidth, returning an array of lines. */
export function wrapLine(text: string, maxWidth: number): string[] {
  if (text.length <= maxWidth) return [text];
  const lines: string[] = [];
  let remaining = text;
  while (remaining.length > maxWidth) {
    let breakAt = remaining.lastIndexOf(" ", maxWidth);
    if (breakAt <= 0) breakAt = maxWidth;
    lines.push(remaining.slice(0, breakAt));
    remaining = remaining.slice(breakAt + (remaining[breakAt] === " " ? 1 : 0));
  }
  if (remaining) lines.push(remaining);
  return lines;
}

/**
 * Find an @mention at the given cursor position in a line.
 * Returns the partial text after '@', the position of '@', and the text before it,
 * or null if no valid @mention is found.
 */
export function findAtMention(
  line: string,
  cursor: number,
): { before: string; partial: string; atPos: number } | null {
  // Walk backward from cursor to find the nearest unescaped '@'
  const left = line.slice(0, cursor);
  const atPos = left.lastIndexOf("@");
  if (atPos < 0) return null;
  // '@' must be at start of line or preceded by whitespace
  if (atPos > 0 && !/\s/.test(line[atPos - 1])) return null;
  const partial = left.slice(atPos + 1);
  // Partial must be a single token (no spaces)
  if (/\s/.test(partial)) return null;
  return { before: line.slice(0, atPos), partial, atPos };
}

/** Set of recognized image file extensions. */
export const IMAGE_EXTS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".webp",
  ".svg",
  ".ico",
]);

// ─── Conversation history helpers ────────────────────────────────────

/** A single entry in the conversation history. */
export interface ConversationEntry {
  role: string;
  text: string;
}

/**
 * Strip protocol artifacts (TO: header, handoff blocks, trailing JSON) from
 * an agent's raw output, returning just the message body.
 */
export function cleanResponseBody(rawOutput: string): string {
  return rawOutput
    .replace(/^TO:\s*\S+\s*\n/im, "")
    .replace(/```handoff\s*\n@\w+\s*\n[\s\S]*?```/g, "")
    .replace(/```json\s*\n\s*\{[\s\S]*?\}\s*\n\s*```\s*$/g, "")
    .trim();
}

/**
 * Format a conversation entry for inclusion in a prompt.
 * Single-line text stays inline; multi-line text gets the body on the next line.
 */
export function formatConversationEntry(role: string, text: string): string {
  return text.includes("\n")
    ? `**${role}:**\n${text}\n`
    : `**${role}:** ${text}\n`;
}

/**
 * Build the conversation context section for a teammate prompt.
 * Works backwards from newest entries, including whole entries up to the budget.
 *
 * Returns the entries (and optional summary) WITHOUT the "## Conversation History"
 * section header — the consumer (buildUserMessage) owns that header so we don't
 * duplicate it when this string is passed through the orchestrator → adapter chain.
 */
export function buildConversationContext(
  history: ConversationEntry[],
  summary: string,
  budget: number,
): string {
  if (history.length === 0 && !summary) return "";

  const parts: string[] = [];

  if (summary) {
    parts.push(`### Previous Conversation Summary\n\n${summary}\n`);
  }

  const entries: string[] = [];
  let used = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = formatConversationEntry(history[i].role, history[i].text);
    if (used + entry.length > budget && entries.length > 0) break;
    entries.unshift(entry);
    used += entry.length;
  }
  if (entries.length > 0) parts.push(entries.join("\n"));

  return parts.join("\n");
}

/**
 * Find the split index where older conversation entries should be summarized.
 * Returns 0 if everything fits within the budget (nothing to summarize).
 */
export function findSummarizationSplit(
  history: ConversationEntry[],
  budget: number,
): number {
  let recentChars = 0;
  let splitIdx = history.length;
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = formatConversationEntry(history[i].role, history[i].text);
    if (recentChars + entry.length > budget) break;
    recentChars += entry.length;
    splitIdx = i;
  }
  return splitIdx === history.length ? 0 : splitIdx;
}

/**
 * Build the summarization prompt text from entries being pushed out of the budget.
 */
export function buildSummarizationPrompt(
  entries: ConversationEntry[],
  existingSummary: string,
): string {
  const entriesText = entries
    .map((e) =>
      e.text.includes("\n")
        ? `**${e.role}:**\n${e.text}`
        : `**${e.role}:** ${e.text}`,
    )
    .join("\n\n");

  const instructions = `## Instructions\n\nReturn ONLY the ${existingSummary ? "updated " : ""}summary — no preamble, no explanation. The summary should:\n- Be a concise bulleted list of key topics discussed, decisions made, and work completed\n- Preserve important context that future messages might reference\n- Drop trivial or redundant details\n- Stay under 2000 characters\n- Do NOT include any output protocol (no TO:, no # Subject, no handoff blocks)`;

  return existingSummary
    ? `You are maintaining a running summary of an ongoing conversation between a user and their AI teammates. Update the existing summary to incorporate the new conversation entries below.\n\n## Current Summary\n\n${existingSummary}\n\n## New Entries to Incorporate\n\n${entriesText}\n\n${instructions}`
    : `You are maintaining a running summary of an ongoing conversation between a user and their AI teammates. Summarize the conversation entries below.\n\n## Entries to Summarize\n\n${entriesText}\n\n${instructions}`;
}

/**
 * Mechanically compress conversation entries into a condensed bullet summary.
 * Used for fast pre-dispatch compression when history exceeds the token budget.
 * Each entry becomes a one-line bullet with truncated text.
 */
export function compressConversationEntries(
  entries: ConversationEntry[],
  existingSummary: string,
): string {
  const bullets = entries.map((e) => {
    const firstLine = e.text.split("\n")[0].slice(0, 150);
    const ellipsis = e.text.length > 150 || e.text.includes("\n") ? "…" : "";
    return `- **${e.role}:** ${firstLine}${ellipsis}`;
  });

  const compressed = bullets.join("\n");
  if (existingSummary) {
    return `${existingSummary}\n\n### Compressed\n${compressed}`;
  }
  return compressed;
}

// ─── Thread-local conversation context ──────────────────────────────

/** Minimal thread entry shape needed by buildThreadContext. */
export interface ThreadContextEntry {
  type: "user" | "agent" | "handoff" | "system";
  teammate?: string;
  content: string;
  subject?: string;
}

/**
 * Build conversation context from a thread's entries rather than the global
 * conversation history. Each entry maps to a ConversationEntry-style line.
 * The budget limits total characters included (newest entries first).
 */
export function buildThreadContext(
  entries: ThreadContextEntry[],
  userName: string,
  budget: number,
): string {
  if (entries.length === 0) return "";

  // Map thread entries → conversation-style lines
  const mapped: ConversationEntry[] = [];
  for (const e of entries) {
    const role =
      e.type === "user"
        ? userName
        : e.type === "handoff"
          ? `${e.teammate ?? "system"} (handoff)`
          : (e.teammate ?? "system");
    // Use subject + abbreviated content for agent entries, full content for user
    const text =
      e.type === "agent" && e.subject
        ? `${e.subject}\n${e.content}`
        : e.content;
    mapped.push({ role, text });
  }

  return buildConversationContext(mapped, "", budget);
}

/** Check if a string looks like an image file path. */
export function isImagePath(text: string): boolean {
  // Must look like a file path (contains slash or backslash, or starts with drive letter)
  if (!/[/\\]/.test(text) && !/^[a-zA-Z]:/.test(text)) return false;
  // Must not contain newlines
  if (/\n/.test(text)) return false;
  const ext = text.slice(text.lastIndexOf(".")).toLowerCase();
  return IMAGE_EXTS.has(ext);
}
