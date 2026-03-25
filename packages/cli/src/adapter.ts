/**
 * Agent adapter interface.
 *
 * Implement this to plug any coding agent into the teammates CLI.
 * Each adapter wraps a specific agent backend (Codex, Claude Code, Cursor, etc.)
 * and translates between the orchestrator's protocol and the agent's native API.
 */

import { platform } from "node:os";
import {
  buildQueryVariations,
  Indexer,
  matchMemoryCatalog,
  multiSearch,
  type SearchResult,
} from "@teammates/recall";
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
    options?: { raw?: boolean },
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
 *
 * Uses a multi-query strategy (Pass 1 from the recall query architecture):
 * 1. Keyword extraction — generates focused queries from the task prompt
 * 2. Conversation-aware queries — extracts recent topic from conversation history
 * 3. Memory index scanning — text-matches frontmatter against the task prompt
 * 4. Multi-query fusion — fires 2-3 queries and deduplicates by URI
 *
 * Skips auto-sync (sync happens after tasks, not before — keeps pre-task fast).
 */
export async function queryRecallContext(
  teammatesDir: string,
  teammateName: string,
  taskPrompt: string,
  conversationContext?: string,
): Promise<RecallContext> {
  try {
    // Build query variations: original + keywords + conversation topic
    // If no separate conversation context provided, use the task prompt itself
    // (which may contain prepended conversation history from the orchestrator)
    const queries = buildQueryVariations(
      taskPrompt,
      conversationContext ?? taskPrompt,
    );
    const primaryQuery = queries[0];
    const additionalQueries = queries.slice(1);

    // Scan memory frontmatter for text-matched results (no embeddings needed)
    const catalogMatches = await matchMemoryCatalog(
      teammatesDir,
      teammateName,
      taskPrompt,
    );

    // Fire multi-query search with deduplication
    const results = await multiSearch(primaryQuery, {
      teammatesDir,
      teammate: teammateName,
      maxResults: 5,
      maxChunks: 3,
      maxTokens: 500,
      skipSync: true,
      additionalQueries,
      catalogMatches,
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

/** Approximate chars per token for budget estimation. */
const CHARS_PER_TOKEN = 4;

/**
 * Context budget allocation:
 * - Days 2-7 get up to DAILY_LOG_BUDGET tokens (whole entries)
 * - Recall gets at least RECALL_MIN_BUDGET, plus whatever daily logs didn't use
 * - Last recall entry can push total up to budget + RECALL_OVERFLOW (4k grace)
 * - Weekly summaries are excluded (already indexed by recall)
 */
export const DAILY_LOG_BUDGET_TOKENS = 24_000;
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
    /** Contents of USER.md — injected just before the task. */
    userProfile?: string;
    /** Token budget for the prompt wrapper (default 64k). Task is excluded. */
    tokenBudget?: number;
  },
): string {
  const parts: string[] = [];

  // ── Top edge (high attention) ─────────────────────────────────────

  // <IDENTITY> — anchors persona
  parts.push(`<IDENTITY>\n# You are ${teammate.name}\n\n${teammate.soul}\n`);

  // <WISDOM> — stable knowledge
  if (teammate.wisdom.trim()) {
    parts.push(`<WISDOM>\n${teammate.wisdom}\n`);
  }

  // ── Reference data (middle — acceptable for "lost in the middle") ──

  // <TEAM> — roster for handoffs
  if (options?.roster && options.roster.length > 0) {
    const lines = [
      "<TEAM>",
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
    parts.push(`${lines.join("\n")}\n`);
  }

  // <SERVICES> — installed services
  if (options?.services && options.services.length > 0) {
    const lines = [
      "<SERVICES>",
      "These services are installed and available for you to use:\n",
    ];
    for (const svc of options.services) {
      lines.push(`### ${svc.name}\n`);
      lines.push(svc.description);
      lines.push(`\n**Usage:** \`${svc.usage}\`\n`);
    }
    parts.push(`${lines.join("\n")}\n`);
  }

  // <RECALL_TOOL> — Pass 2: agent-driven search
  parts.push(
    `<RECALL_TOOL>\nYou can search your own memories mid-task for additional context. This is useful when the pre-loaded memories don't cover what you need.\n\n**Usage:** Run this command via your shell/terminal tool:\n\`\`\`\nteammates-recall search "<your query>" --dir .teammates --teammate ${teammate.name} --no-sync --json\n\`\`\`\n\n**Tips:**\n- Use specific, descriptive queries ("hooks lifecycle event naming decision" not "hooks")\n- Search iteratively: query → read result → refine query\n- The \`--json\` flag returns structured results for easier parsing\n- Results include a \`score\` field (0-1) — higher is more relevant\n- You can omit \`--teammate\` to search across all teammates' memories\n`,
  );

  // <ENVIRONMENT> — date/time + platform
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const os = platform();
  const osLabel =
    os === "win32" ? "Windows" : os === "darwin" ? "macOS" : "Linux";
  const slashNote =
    os === "win32"
      ? "Use backslashes (`\\`) in file paths."
      : "Use forward slashes (`/`) in file paths.";

  // Extract timezone from USER.md if available
  const tzMatch = options?.userProfile?.match(
    /\*\*Primary Timezone:\*\*\s*(.+)/,
  );
  const userTimezone = tzMatch?.[1]?.trim();
  const tzLine = userTimezone ? `\n**Timezone:** ${userTimezone}` : "";

  parts.push(
    `<ENVIRONMENT>\n**Current date:** ${now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} (${today})\n**Current time:** ${now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}${tzLine}\n**Environment:** ${osLabel} — ${slashNote}\n`,
  );

  // ── Session context (middle-to-lower) ─────────────────────────────

  // <DAILY_LOGS> — today's log (never trimmed) + days 2-7 (budget-allocated)
  const todayLog = teammate.dailyLogs.slice(0, 1);
  const pastLogs = teammate.dailyLogs.slice(1, 7); // days 2-7
  let dailyBudget = DAILY_LOG_BUDGET_TOKENS;

  if (todayLog.length > 0 || pastLogs.length > 0) {
    const logLines = ["<DAILY_LOGS>"];

    // Current daily log (today) — never trimmed, always included
    for (const log of todayLog) {
      logLines.push(`### ${log.date}\n${log.content}`);
    }

    // Days 2-7 — whole entries, up to 24k tokens
    for (const log of pastLogs) {
      const entry = `### ${log.date}\n${log.content}`;
      const cost = estimateTokens(entry);
      if (cost > dailyBudget) break;
      logLines.push(entry);
      dailyBudget -= cost;
    }

    parts.push(`${logLines.join("\n")}\n`);
  }

  // <USER_PROFILE> — always included when present
  if (options?.userProfile?.trim()) {
    parts.push(`<USER_PROFILE>\n${options.userProfile.trim()}\n`);
  }

  // ── Task-adjacent context (close to task for maximum relevance) ───

  // <RECALL_RESULTS> — budget-allocated, adjacent to task
  const recallBudget = Math.max(
    RECALL_MIN_BUDGET_TOKENS,
    RECALL_MIN_BUDGET_TOKENS + dailyBudget,
  );
  const recallResults = options?.recallResults ?? [];
  if (recallResults.length > 0) {
    const lines = [
      "<RECALL_RESULTS>",
      "These memories were retrieved based on relevance to the current task:\n",
    ];
    const headerCost = estimateTokens(lines.join("\n"));
    let recallUsed = headerCost;
    for (const r of recallResults) {
      const label = r.contentType ? `[${r.contentType}] ${r.uri}` : r.uri;
      const entry = `### ${label}\n${r.text}`;
      const cost = estimateTokens(entry);
      if (recallUsed + cost > recallBudget + RECALL_OVERFLOW_TOKENS) break;
      lines.push(entry);
      recallUsed += cost;
      // Stop cleanly at budget — but allow the current entry (overflow grace)
      if (recallUsed >= recallBudget) break;
    }
    if (lines.length > 2) {
      parts.push(`${lines.join("\n")}\n`);
    }
  }

  // <HANDOFF_CONTEXT> — directly task-relevant when present
  if (options?.handoffContext) {
    parts.push(`<HANDOFF_CONTEXT>\n${options.handoffContext}\n`);
  }

  // ── The question ──────────────────────────────────────────────────

  // <TASK> — always included, excluded from budget
  parts.push(`<TASK>\n${taskPrompt}\n`);

  // ── Bottom edge (high attention) — all instructions merged ────────

  // <INSTRUCTIONS> — output protocol, handoffs, session state, memory updates
  const instrLines = [
    "<INSTRUCTIONS>",
    "",
    "### Output Protocol (CRITICAL)",
    "",
    "**Your #1 job is to produce a visible text response.** Session updates and memory writes are secondary — they support continuity but are not the deliverable. The user sees ONLY your text output. If you update files but return no text, the user sees an empty message and your work is invisible.",
    "",
    "Format your response as:",
    "",
    "```",
    "TO: user",
    "# <Subject line>",
    "",
    "<Body — full markdown response>",
    "```",
    "",
    "**Rules:**",
    "- **You MUST end your turn with visible text output.** A turn that ends with only tool calls and no text is a failed turn.",
    "- The `# Subject` line is REQUIRED — it becomes the message title.",
    "- Always write a substantive body. Never return just the subject.",
    "- Use markdown: headings, lists, code blocks, bold, etc.",
    "",
    "### Handoffs",
    "",
    "To delegate work to a teammate, you MUST include a fenced code block with the language tag `handoff` in your text output. **This is the ONLY way to trigger a handoff.** Mentioning a handoff in plain English does NOT work — the system parses the fenced block, not your prose.",
    "",
    "Exact format (include the triple backticks exactly as shown):",
    "",
    "    ```handoff",
    "    @<teammate-name>",
    "    <task description with full context>",
    "    ```",
    "",
    "Rules:",
    `- Only hand off to teammates listed in \`<TEAM>\`.`,
    "- Do as much work as you can BEFORE handing off.",
    '- Do NOT just say "I\'ll hand this off" in prose — that does nothing. You MUST use the fenced block.',
  ];

  // Session state (conditional)
  if (options?.sessionFile) {
    instrLines.push(
      "",
      "### Session State",
      "",
      `Your session file is at: \`${options.sessionFile}\``,
      "",
      "**After completing the task**, append a brief entry to this file with:",
      "- What you did",
      "- Key decisions made",
      "- Files changed",
      "- Anything the next task should know",
      "",
      "This is how you maintain continuity across tasks. Always read it, always update it.",
    );
  }

  // Cross-folder write boundary (AI teammates only)
  if (teammate.type === "ai") {
    instrLines.push(
      "",
      "### Folder Boundaries (ENFORCED)",
      "",
      `**You MUST NOT create, edit, or delete files inside another teammate's folder (\`.teammates/<other>/\`).** Your folder is \`.teammates/${teammate.name}/\` — you may only write inside it. Shared folders (\`.teammates/_*/\`) and ephemeral folders (\`.teammates/.*/\`) are also writable.`,
      "",
      "If your task requires changes to another teammate's files, you MUST hand off that work using the handoff block format above. Violation of this rule will cause your changes to be flagged and potentially reverted.",
    );
  }

  // Memory updates
  instrLines.push(
    "",
    "### Memory Updates",
    "",
    "**After completing the task**, update your memory files:",
    "",
    `1. **Daily log** — Read \`.teammates/${teammate.name}/memory/${today}.md\` first (it may have entries from earlier tasks today), then write it back with your entry added. Create the file if it doesn't exist.`,
    "   - What you did",
    "   - Key decisions made",
    "   - Files changed",
    "   - Anything the next task should know",
    "",
    `2. **Typed memories** — If you learned something durable (a decision, pattern, feedback, or reference), create a typed memory file at \`.teammates/${teammate.name}/memory/<type>_<topic>.md\` with frontmatter (\`name\`, \`description\`, \`type\`). Update existing memory files if the topic already has one.`,
    "",
    "3. **WISDOM.md** — Do not edit directly. Wisdom entries are distilled from typed memories during compaction.",
    "",
    "These files are your persistent memory. Without them, your next session starts from scratch.",
  );

  // Section Reinforcement — back-references from high-attention bottom edge to each section tag
  instrLines.push("", "### Section Reinforcement", "");
  instrLines.push(
    "- Stay in character as defined in `<IDENTITY>` — never break persona or speak as a generic assistant.",
  );
  if (teammate.wisdom.trim()) {
    instrLines.push(
      "- Apply lessons from `<WISDOM>` before proposing solutions — do not repeat past mistakes.",
    );
  }
  if (options?.roster && options.roster.length > 0) {
    instrLines.push(
      "- Only hand off to teammates listed in `<TEAM>` using the handoff block format above.",
    );
  }
  if (options?.services && options.services.length > 0) {
    instrLines.push(
      "- Use tools and services from `<SERVICES>` when they fit the task — do not reinvent what is already available.",
    );
  }
  instrLines.push(
    "- If pre-loaded context is insufficient, use `<RECALL_TOOL>` to search for additional memories before giving up.",
    "- Respect platform, date, and path conventions from `<ENVIRONMENT>`.",
  );
  if (todayLog.length > 0 || pastLogs.length > 0) {
    instrLines.push(
      "- Check `<DAILY_LOGS>` for prior work on this topic before starting — avoid duplicating what was already done today.",
    );
  }
  if (options?.userProfile?.trim()) {
    instrLines.push(
      "- Honor the user's role, preferences, and communication style from `<USER_PROFILE>`.",
    );
  }
  if (recallResults.length > 0) {
    instrLines.push(
      "- Incorporate relevant context from `<RECALL_RESULTS>` into your response — these memories were retrieved for a reason.",
    );
  }
  if (options?.handoffContext) {
    instrLines.push(
      "- When `<HANDOFF_CONTEXT>` is present, address its requirements and open questions directly.",
    );
  }
  instrLines.push(
    "- Your response must answer `<TASK>` — everything else is supporting context.",
    "",
    "**REMINDER: You MUST end your turn with visible text output. A turn with only file edits and no text is a failed turn.**",
  );

  parts.push(instrLines.join("\n"));

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
