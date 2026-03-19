/**
 * Agent adapter interface.
 *
 * Implement this to plug any coding agent into the teammates CLI.
 * Each adapter wraps a specific agent backend (Codex, Claude Code, Cursor, etc.)
 * and translates between the orchestrator's protocol and the agent's native API.
 */

import { Indexer, search, type SearchResult } from "@teammates/recall";
import type { TaskResult, TeammateConfig } from "./types.js";

export interface AgentAdapter {
  /** Human-readable name of the agent backend (e.g. "codex", "claude-code") */
  readonly name: string;

  /**
   * Start a new session for a teammate.
   * Returns a session/thread ID for continuity.
   */
  startSession(teammate: TeammateConfig): Promise<string>;

  /**
   * Send a task prompt to a teammate's session.
   * The adapter hydrates the prompt with identity, memory, and handoff context.
   */
  executeTask(
    sessionId: string,
    teammate: TeammateConfig,
    prompt: string,
  ): Promise<TaskResult>;

  /**
   * Resume an existing session (for agents that support continuity).
   * Falls back to startSession if not implemented.
   */
  resumeSession?(teammate: TeammateConfig, sessionId: string): Promise<string>;

  /** Get the session file path for a teammate (if session is active). */
  getSessionFile?(teammateName: string): string | undefined;

  /** Clean up a session. */
  destroySession?(sessionId: string): Promise<void>;

  /**
   * Quick routing call — ask the agent which teammate should handle a task.
   * Returns a teammate name. The agent can return its own name if it should handle it.
   */
  routeTask?(task: string, roster: RosterEntry[]): Promise<string | null>;
}

/** Minimal teammate info for the roster section of a prompt. */
export interface RosterEntry {
  name: string;
  role: string;
  ownership: { primary: string[]; secondary: string[] };
}

/** A service that's been installed and is available to teammates. */
export interface InstalledService {
  name: string;
  description: string;
  usage: string;
}

/** Recall search results formatted for prompt injection. */
export interface RecallContext {
  results: SearchResult[];
  /** Whether the query succeeded (false = index missing or search errored) */
  ok: boolean;
}

/**
 * Query the recall index for context relevant to the task prompt.
 * Returns search results that should be injected into the teammate prompt.
 * Skips auto-sync (sync happens after tasks, not before — keeps pre-task fast).
 */
export async function queryRecallContext(
  teammatesDir: string,
  teammateName: string,
  taskPrompt: string,
): Promise<RecallContext> {
  try {
    const results = await search(taskPrompt, {
      teammatesDir,
      teammate: teammateName,
      maxResults: 5,
      maxChunks: 3,
      maxTokens: 500,
      skipSync: true,
    });
    return { results, ok: true };
  } catch {
    return { results: [], ok: false };
  }
}

/**
 * Sync the recall index for a teammate (or all teammates).
 * Wrapper around the recall library's Indexer.
 */
export async function syncRecallIndex(
  teammatesDir: string,
  teammate?: string,
): Promise<void> {
  const indexer = new Indexer({ teammatesDir });
  if (teammate) {
    await indexer.syncTeammate(teammate);
  } else {
    await indexer.syncAll();
  }
}

/**
 * Default token budget for the prompt wrapper (everything except the task).
 * ~64k tokens ≈ 256k chars at ~4 chars/token.
 * The task prompt itself is excluded from this budget — if a user pastes
 * a large input, that's intentional and we don't trim it.
 */
const DEFAULT_TOKEN_BUDGET = 64_000;
const CHARS_PER_TOKEN = 4;

/**
 * Context budget allocation:
 * - Days 2-7 get up to DAILY_LOG_BUDGET tokens (whole entries)
 * - Recall gets at least RECALL_MIN_BUDGET, plus whatever daily logs didn't use
 * - Last recall entry can push total up to CONTEXT_BUDGET + RECALL_OVERFLOW (36k)
 * - Weekly summaries are excluded (already indexed by recall)
 */
const CONTEXT_BUDGET_TOKENS = 32_000;
const DAILY_LOG_BUDGET_TOKENS = 24_000;
const RECALL_MIN_BUDGET_TOKENS = 8_000;
const RECALL_OVERFLOW_TOKENS = 4_000;

/** Estimate tokens from character count. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Build the full prompt for a teammate session.
 * Includes identity, memory, roster, output protocol, and the task.
 *
 * Context budget (32k tokens):
 * - Current daily log (today): always included, outside budget
 * - Days 2-7: up to 24k tokens (whole entries)
 * - Recall results: at least 8k tokens + unused daily log budget
 *   (last entry may overflow by up to 4k tokens)
 * - Weekly summaries: excluded (already indexed by recall)
 *
 * Identity, wisdom, roster, and protocol are never trimmed.
 * The task prompt is never trimmed.
 */
export function buildTeammatePrompt(
  teammate: TeammateConfig,
  taskPrompt: string,
  options?: {
    handoffContext?: string;
    roster?: RosterEntry[];
    services?: InstalledService[];
    sessionFile?: string;
    recallResults?: SearchResult[];
    /** Token budget for the prompt wrapper (default 64k). Task is excluded. */
    tokenBudget?: number;
  },
): string {
  const parts: string[] = [];

  // ── Identity (required) ─────────────────────────────────────────
  parts.push(`# You are ${teammate.name}\n\n${teammate.soul}\n\n---\n`);

  // ── Wisdom (required) ───────────────────────────────────────────
  if (teammate.wisdom.trim()) {
    parts.push(`## Your Wisdom\n\n${teammate.wisdom}\n\n---\n`);
  }

  // ── Budget-allocated context (daily logs → recall) ──────────────
  // Today's log: always included, outside budget
  // Days 2-7: up to 24k tokens (whole entries)
  // Recall: at least 8k + unused daily budget, last entry may overflow by 4k
  const todayLog = teammate.dailyLogs.slice(0, 1);
  const pastLogs = teammate.dailyLogs.slice(1, 7); // days 2-7
  let dailyBudget = DAILY_LOG_BUDGET_TOKENS;

  // Current daily log (today) — never trimmed, always included
  if (todayLog.length > 0) {
    const todayLines = ["## Recent Daily Logs\n"];
    for (const log of todayLog) {
      todayLines.push(`### ${log.date}\n${log.content}\n`);
    }
    parts.push(todayLines.join("\n"));
  }

  // Days 2-7 — whole entries, up to 24k tokens
  if (pastLogs.length > 0) {
    const lines: string[] = [];
    for (const log of pastLogs) {
      const entry = `### ${log.date}\n${log.content}\n`;
      const cost = estimateTokens(entry);
      if (cost > dailyBudget) break;
      lines.push(entry);
      dailyBudget -= cost;
    }
    if (lines.length > 0) parts.push(lines.join("\n"));
  }

  // Recall results — gets at least 8k tokens, plus unused daily budget
  // Last entry may overflow by up to 4k tokens
  const recallBudget = Math.max(RECALL_MIN_BUDGET_TOKENS, RECALL_MIN_BUDGET_TOKENS + dailyBudget);
  const recallResults = options?.recallResults ?? [];
  if (recallResults.length > 0) {
    const lines = [
      "## Relevant Memories (from recall search)\n",
      "These memories were retrieved based on relevance to the current task:\n",
    ];
    const headerCost = estimateTokens(lines.join("\n"));
    let recallUsed = headerCost;
    for (const r of recallResults) {
      const label = r.contentType
        ? `[${r.contentType}] ${r.uri}`
        : r.uri;
      const entry = `### ${label}\n${r.text}\n`;
      const cost = estimateTokens(entry);
      if (recallUsed + cost > recallBudget + RECALL_OVERFLOW_TOKENS) break;
      lines.push(entry);
      recallUsed += cost;
      // Stop cleanly at budget — but allow the current entry (overflow grace)
      if (recallUsed >= recallBudget) break;
    }
    if (lines.length > 2) {
      lines.push("\n---\n");
      parts.push(lines.join("\n"));
    }
  }

  // Close context section with separator if needed
  if (todayLog.length > 0 || pastLogs.length > 0) {
    const lastPart = parts[parts.length - 1];
    if (!lastPart.endsWith("---\n")) {
      parts.push("\n---\n");
    }
  }

  // ── Team roster (required, small) ───────────────────────────────
  if (options?.roster && options.roster.length > 0) {
    const lines = [
      "## Your Team\n",
      "These are the other teammates you can hand off work to:\n",
    ];
    for (const t of options.roster) {
      if (t.name === teammate.name) continue;
      const owns =
        t.ownership.primary.length > 0
          ? ` — owns: ${t.ownership.primary.join(", ")}`
          : "";
      lines.push(`- **@${t.name}**: ${t.role}${owns}`);
    }
    lines.push("\n---\n");
    parts.push(lines.join("\n"));
  }

  // ── Installed services (required, small) ────────────────────────
  if (options?.services && options.services.length > 0) {
    const lines = [
      "## Available Services\n",
      "These services are installed and available for you to use:\n",
    ];
    for (const svc of options.services) {
      lines.push(`### ${svc.name}\n`);
      lines.push(svc.description);
      lines.push(`\n**Usage:** \`${svc.usage}\`\n`);
    }
    lines.push("\n---\n");
    parts.push(lines.join("\n"));
  }

  // ── Handoff context (required when present) ─────────────────────
  if (options?.handoffContext) {
    parts.push(`## Handoff Context\n\n${options.handoffContext}\n\n---\n`);
  }

  // ── Session state (required) ────────────────────────────────────
  if (options?.sessionFile) {
    parts.push(`## Session State\n\nYour session file is at: \`${options.sessionFile}\`\n\n**Before returning your result**, append a brief entry to this file with:\n- What you did\n- Key decisions made\n- Files changed\n- Anything the next task should know\n\nThis is how you maintain continuity across tasks. Always read it, always update it.\n\n---\n`);
  }

  // ── Memory updates (required) ───────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  parts.push(`## Memory Updates\n\n**Before returning your result**, update your memory files:\n\n1. **Daily log** — Read \`.teammates/${teammate.name}/memory/${today}.md\` first (it may have entries from earlier tasks today), then write it back with your entry added. Create the file if it doesn't exist.\n   - What you did\n   - Key decisions made\n   - Files changed\n   - Anything the next task should know\n\n2. **Typed memories** — If you learned something durable (a decision, pattern, feedback, or reference), create a typed memory file at \`.teammates/${teammate.name}/memory/<type>_<topic>.md\` with frontmatter (\`name\`, \`description\`, \`type\`). Update existing memory files if the topic already has one.\n\n3. **WISDOM.md** — Do not edit directly. Wisdom entries are distilled from typed memories during compaction.\n\nThese files are your persistent memory. Without them, your next session starts from scratch.\n\n---\n`);

  // ── Output protocol (required) ──────────────────────────────────
  parts.push(`## Output Protocol (CRITICAL)\n\n**Your #1 job is to produce a visible text response.** Session updates and memory writes are secondary — they support continuity but are not the deliverable. The user sees ONLY your text output. If you update files but return no text, the user sees an empty message and your work is invisible.\n\nFormat your response as:\n\n\`\`\`\nTO: user\n# <Subject line>\n\n<Body — full markdown response>\n\`\`\`\n\n**Handoffs:** To hand off work to a teammate, include a fenced handoff block anywhere in your response:\n\n\`\`\`\n\`\`\`handoff\n@<teammate>\n<task description — what you need them to do, with full context>\n\`\`\`\n\`\`\`\n\n**Rules:**\n- **You MUST end your turn with visible text output.** A turn that ends with only tool calls and no text is a failed turn.\n- The \`# Subject\` line is REQUIRED — it becomes the message title.\n- Always write a substantive body. Never return just the subject.\n- Use markdown: headings, lists, code blocks, bold, etc.\n- Do as much work as you can before handing off.\n- Only hand off to teammates listed in "Your Team" above.\n- The handoff block can appear anywhere in your response — it will be detected automatically.\n\n---\n`);

  // ── Current date/time (required, small) ─────────────────────────
  const now = new Date();
  parts.push(`**Current date:** ${now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} (${today})\n**Current time:** ${now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}\n\n---\n`);

  // ── Task (always included, excluded from budget) ────────────────
  parts.push(`## Task\n\n${taskPrompt}\n\n---\n\n**REMINDER: After completing the task and updating session/memory files, you MUST produce a text response starting with \`TO: user\`. An empty response is a bug.**`);

  return parts.join("\n");
}

/**
 * Format a handoff envelope into a human-readable context string.
 */
export function formatHandoffContext(envelope: {
  from: string;
  task: string;
  changedFiles?: string[];
  acceptanceCriteria?: string[];
  openQuestions?: string[];
  context?: string;
}): string {
  const lines: string[] = [];
  lines.push(`**Handed off from:** ${envelope.from}`);
  lines.push(`**Task:** ${envelope.task}`);

  if (envelope.changedFiles?.length) {
    lines.push("\n**Changed files:**");
    for (const f of envelope.changedFiles) lines.push(`- ${f}`);
  }

  if (envelope.acceptanceCriteria?.length) {
    lines.push("\n**Acceptance criteria:**");
    for (const c of envelope.acceptanceCriteria) lines.push(`- ${c}`);
  }

  if (envelope.openQuestions?.length) {
    lines.push("\n**Open questions:**");
    for (const q of envelope.openQuestions) lines.push(`- ${q}`);
  }

  if (envelope.context) {
    lines.push(`\n**Additional context:**\n${envelope.context}`);
  }

  return lines.join("\n");
}
