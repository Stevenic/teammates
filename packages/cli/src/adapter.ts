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
  classifyUri,
  extractPeriod,
  Indexer,
  isChunkUri,
  matchMemoryCatalog,
  multiSearch,
  type SearchResult,
  uriToRelativePath,
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
    options?: {
      raw?: boolean;
      system?: boolean;
      skipMemoryUpdates?: boolean;
      onActivity?: (events: import("./types.js").ActivityEvent[]) => void;
      /** Abort signal — when aborted, the adapter should kill/disconnect the running agent. */
      signal?: AbortSignal;
    },
  ): Promise<TaskResult>;

  /**
   * Resume an existing session (for agents that support continuity).
   * Falls back to startSession if not implemented.
   */
  resumeSession?(teammate: TeammateConfig, sessionId: string): Promise<string>;

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
 * Context budget allocation (v2):
 * - User message is unbounded (always included)
 * - Conversation history, daily log snapshot, and recalled memories share
 *   a 20k token budget, with priority: conversation > daily log > recall
 * - As conversation grows, it pushes out recall and daily logs
 *
 * Legacy constants kept for autoCompactForBudget compatibility.
 */
export const DAILY_LOG_BUDGET_TOKENS = 12_000;

/** Total token budget shared by conversation history, daily log, and recall. */
export const USER_MESSAGE_BUDGET_TOKENS = 20_000;

/** Estimate tokens from character count. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Format recall results in the MEMORY: block format.
 *
 * ```
 * MEMORY:
 * file: <relative path>
 * type: <daily/weekly/monthly/typed_memory>
 * period: <time period>
 * partial: <true/false>
 * <recalled contents>
 * ```
 */
export function formatRecallResult(result: SearchResult): string {
  const contentType = result.contentType ?? classifyUri(result.uri);
  const period = result.period ?? extractPeriod(result.uri, contentType) ?? "";
  const partial = result.partial ?? isChunkUri(result.uri);
  const filePath = uriToRelativePath(result.uri);

  const lines = ["MEMORY:", `file: ${filePath}`, `type: ${contentType}`];
  if (period) lines.push(`period: ${period}`);
  lines.push(`partial: ${partial}`);
  lines.push(result.text);

  return lines.join("\n");
}

/**
 * Build the user message (stdin content) for a task dispatch.
 *
 * Priority order with 20k token budget for items 2-4:
 * 1. User's message (unbounded, always included)
 * 2. Conversation history (highest budget priority)
 * 3. Daily log snapshot (from before conversation started)
 * 4. Recalled memories in MEMORY: format (lowest priority)
 *
 * As conversation history grows, it naturally pushes out recall
 * and daily logs — which is fine because the conversation itself
 * contains the relevant working context.
 */
export function buildUserMessage(
  taskPrompt: string,
  options?: {
    conversationHistory?: string;
    dailyLogSnapshot?: string;
    recallResults?: SearchResult[];
    handoffContext?: string;
    /** System task — suppress daily log and recall. */
    system?: boolean;
    /** Ephemeral task — suppress recall. */
    skipMemoryUpdates?: boolean;
    tokenBudget?: number;
  },
): string {
  const budget = options?.tokenBudget ?? USER_MESSAGE_BUDGET_TOKENS;
  const parts: string[] = [];

  // ── Handoff context (if present, unbounded like user message) ──
  if (options?.handoffContext) {
    parts.push(`<HANDOFF_CONTEXT>\n${options.handoffContext}\n`);
  }

  // ── User's message (always first, unbounded) ──
  parts.push(taskPrompt);

  // For system/maintenance tasks, skip context injection
  if (options?.system) {
    return parts.join("\n\n---\n\n");
  }

  // ── Budget-allocated sections (conversation > daily log > recall) ──
  let remainingTokens = budget;

  // 2. Conversation history (highest priority)
  if (options?.conversationHistory?.trim()) {
    const convTokens = estimateTokens(options.conversationHistory);
    if (convTokens <= remainingTokens) {
      parts.push(`## Conversation History\n${options.conversationHistory}`);
      remainingTokens -= convTokens;
    } else {
      // Conversation exceeds budget — include as much as possible (truncated)
      const charBudget = remainingTokens * CHARS_PER_TOKEN;
      const truncated = options.conversationHistory.slice(-charBudget);
      parts.push(
        `## Conversation History\n(earlier entries trimmed)\n${truncated}`,
      );
      remainingTokens = 0;
    }
  }

  // 3. Daily log snapshot (medium priority)
  if (remainingTokens > 0 && options?.dailyLogSnapshot?.trim()) {
    const logTokens = estimateTokens(options.dailyLogSnapshot);
    if (logTokens <= remainingTokens) {
      parts.push(`## Daily Log\n${options.dailyLogSnapshot}`);
      remainingTokens -= logTokens;
    }
    // If daily log doesn't fit, skip it entirely (don't truncate)
  }

  // 4. Recalled memories (lowest priority)
  if (
    remainingTokens > 0 &&
    !options?.skipMemoryUpdates &&
    options?.recallResults &&
    options.recallResults.length > 0
  ) {
    const memoryBlocks: string[] = [];
    for (const result of options.recallResults) {
      const block = formatRecallResult(result);
      const blockTokens = estimateTokens(block);
      if (blockTokens > remainingTokens) break;
      memoryBlocks.push(block);
      remainingTokens -= blockTokens;
    }
    if (memoryBlocks.length > 0) {
      parts.push(`## Recalled Memories\n\n${memoryBlocks.join("\n\n")}`);
    }
  }

  return parts.join("\n\n---\n\n");
}

/** Structured prompt parts for agents that support system/user split. */
export interface PromptParts {
  /** Full combined prompt (backward compat — system + user as one string). */
  fullPrompt: string;
  /** System context: identity, wisdom, instructions, etc. (from SYSTEM-PROMPT.md). */
  systemPrompt: string;
  /** User message: task + conversation + daily log + recalled memories. */
  userMessage: string;
  /**
   * Path to the pre-built SYSTEM-PROMPT.md file (if available).
   * When set, agents that support --append-system-prompt-file use this
   * instead of writing a temp file.
   */
  systemPromptFile?: string;
}

/**
 * Build the full prompt for a teammate session.
 *
 * **v2 architecture:** The system prompt is now pre-built as SYSTEM-PROMPT.md
 * (generated at startup by `system-prompt.ts`). This function builds only the
 * user message with the new budget system, then assembles the full prompt
 * by combining system prompt + user message for backward compatibility.
 *
 * User message budget (20k tokens shared by items 2-4):
 * 1. User's message (unbounded)
 * 2. Conversation history (highest budget priority)
 * 3. Daily log snapshot (medium priority)
 * 4. Recalled memories in MEMORY: format (lowest priority)
 *
 * For agents that support --append-system-prompt-file (Claude):
 *   - System prompt → file on disk (SYSTEM-PROMPT.md)
 *   - User message → stdin
 *
 * For other agents:
 *   - fullPrompt (system + user) → stdin
 */
export function buildTeammatePrompt(
  teammate: TeammateConfig,
  taskPrompt: string,
  options?: {
    handoffContext?: string;
    roster?: RosterEntry[];
    services?: InstalledService[];
    recallResults?: SearchResult[];
    /** Contents of USER.md — injected into system prompt. */
    userProfile?: string;
    /** Conversation history text (pre-formatted). */
    conversationHistory?: string;
    /** Daily log snapshot from before the conversation started. */
    dailyLogSnapshot?: string;
    /** Pre-built system prompt content (from SYSTEM-PROMPT.md). */
    systemPromptContent?: string;
    /** Path to SYSTEM-PROMPT.md on disk. */
    systemPromptFile?: string;
    /** System task — skip daily log / memory update instructions. */
    system?: boolean;
    /** Ephemeral task — suppress memory update instructions. */
    skipMemoryUpdates?: boolean;
  },
): PromptParts {
  // ── System prompt ──────────────────────────────────────────────────
  // Prefer pre-built SYSTEM-PROMPT.md content if available.
  // Fall back to generating inline (for tests and agents without the file).
  let systemPrompt: string;
  if (options?.systemPromptContent) {
    systemPrompt = options.systemPromptContent;
  } else {
    // Import generateSystemPrompt inline to avoid circular deps
    // (system-prompt.ts imports types from here)
    systemPrompt = generateSystemPromptInline(teammate, options);
  }

  // ── Daily log snapshot ─────────────────────────────────────────────
  // Use the provided snapshot, or fall back to today's log from config.
  let dailyLogSnapshot = options?.dailyLogSnapshot;
  if (!dailyLogSnapshot && teammate.dailyLogs.length > 0) {
    const todayLog = teammate.dailyLogs[0];
    if (todayLog) {
      dailyLogSnapshot = `### ${todayLog.date}\n${todayLog.content}`;
    }
  }

  // ── User message (budget-allocated) ────────────────────────────────
  const userMessage = buildUserMessage(taskPrompt, {
    conversationHistory: options?.conversationHistory,
    dailyLogSnapshot,
    recallResults: options?.recallResults,
    handoffContext: options?.handoffContext,
    system: options?.system,
    skipMemoryUpdates: options?.skipMemoryUpdates,
  });

  return {
    fullPrompt: `${systemPrompt}\n\n${userMessage}`,
    systemPrompt,
    userMessage,
    systemPromptFile: options?.systemPromptFile,
  };
}

/**
 * Inline system prompt generation — used as fallback when SYSTEM-PROMPT.md
 * is not available (tests, first run before startup completes, etc.).
 *
 * This duplicates the logic from system-prompt.ts but avoids a circular import.
 */
function generateSystemPromptInline(
  teammate: TeammateConfig,
  options?: {
    roster?: RosterEntry[];
    services?: InstalledService[];
    userProfile?: string;
    system?: boolean;
    skipMemoryUpdates?: boolean;
  },
): string {
  const parts: string[] = [];
  const today = new Date().toISOString().slice(0, 10);

  // <IDENTITY>
  parts.push(`<IDENTITY>\n# You are ${teammate.name}\n\n${teammate.soul}\n`);

  // <GOALS>
  if (teammate.goals.trim()) {
    parts.push(`<GOALS>\n${teammate.goals}\n`);
  }

  // <WISDOM>
  if (teammate.wisdom.trim()) {
    parts.push(`<WISDOM>\n${teammate.wisdom}\n`);
  }

  // <TEAM>
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

  // <SERVICES>
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

  // <RECALL_TOOL>
  parts.push(
    `<RECALL_TOOL>\nYou can search your own memories mid-task for additional context. This is useful when the pre-loaded memories don't cover what you need.\n\n**Usage:** Run this command via your shell/terminal tool:\n\`\`\`\nteammates-recall search "<your query>" --dir .teammates --teammate ${teammate.name} --no-sync --json\n\`\`\`\n\n**Tips:**\n- Use specific, descriptive queries ("hooks lifecycle event naming decision" not "hooks")\n- Search iteratively: query → read result → refine query\n- The \`--json\` flag returns structured results for easier parsing\n- Results include a \`score\` field (0-1) — higher is more relevant\n- You can omit \`--teammate\` to search across all teammates' memories\n`,
  );

  // <ENVIRONMENT>
  const now = new Date();
  const os = platform();
  const osLabel =
    os === "win32" ? "Windows" : os === "darwin" ? "macOS" : "Linux";
  const slashNote =
    os === "win32"
      ? "Use backslashes (`\\`) in file paths."
      : "Use forward slashes (`/`) in file paths.";
  const tzMatch = options?.userProfile?.match(
    /\*\*Primary Timezone:\*\*\s*(.+)/,
  );
  const userTimezone = tzMatch?.[1]?.trim();
  const tzLine = userTimezone ? `\n**Timezone:** ${userTimezone}` : "";
  parts.push(
    `<ENVIRONMENT>\n**Current date:** ${now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} (${today})\n**Current time:** ${now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}${tzLine}\n**Environment:** ${osLabel} — ${slashNote}\n`,
  );

  // <USER_PROFILE>
  if (options?.userProfile?.trim()) {
    parts.push(`<USER_PROFILE>\n${options.userProfile.trim()}\n`);
  }

  // <INSTRUCTIONS>
  const instrLines = [
    "<INSTRUCTIONS>",
    "",
    "**Your FIRST priority is answering the user's request. Session updates, memory writes, and continuity housekeeping are SECONDARY.**",
    "",
    "### Output Protocol (CRITICAL)",
    "",
    "**THE USER CANNOT SEE YOUR DAILY LOGS, MEMORY FILES, OR ANYTHING YOU WRITE TO DISK.** Daily logs are PRIVATE — they exist only for your future self. The user sees ONLY the text you return in this turn. Returning a meta-status body like `Logged in memory` means the user sees NOTHING. **You must tell the user directly, in your text response, what you did and what the answer is — even if you also wrote it into your daily log.**",
    "",
    "**EACH `<TASK>` IS A FRESH REQUEST. The Daily Log section at the bottom is HISTORICAL CONTEXT — NOT proof the current `<TASK>` is already done.** If your daily log says you delivered something earlier (e.g. `Delivered one-line intro`), that was a PRIOR turn — the user is asking AGAIN now, and your prior delivery is invisible to them. **Reproduce the deliverable in full in this turn's response.** Do not say `Already delivered`, `See above`, or `Posted earlier`. Reproduce it. Every. Time.",
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
    "- **You MUST end your turn with visible text output.**",
    "- The `# Subject` MUST preview the deliverable (NOT `Task completed`, `Done`, `Acknowledged`, or similar zero-info phrases).",
    "- The body MUST contain the actual deliverable, NOT meta-status like `Posted above`, `Intro delivered above`, `Logged in memory`, `Already delivered earlier today`, or `See daily log`.",
    "- Even if other teammates already responded in conversation history, YOUR task is not done until YOU deliver. `@everyone` means each teammate delivers in their own voice.",
    "- Use markdown: headings, lists, code blocks, bold, etc.",
    "",
    "### Handoffs",
    "",
    "To hand off work, use a fenced `handoff` block:",
    "",
    "    ```handoff",
    "    @<teammate-name>",
    "    <task description>",
    "    ```",
  ];

  if (teammate.type === "ai") {
    instrLines.push(
      "",
      "### Folder Boundaries (ENFORCED)",
      "",
      `Your folder is \`.teammates/${teammate.name}/\`. Do NOT write to other teammate folders.`,
    );
  }

  // Memory updates
  if (options?.system) {
    instrLines.push(
      "",
      "### Memory Updates",
      "",
      "**System task.** Do NOT update daily logs or memories.",
    );
  } else if (options?.skipMemoryUpdates) {
    instrLines.push(
      "",
      "### Memory Updates",
      "",
      "**Ephemeral task.** Do NOT update daily logs or memories.",
    );
  } else {
    instrLines.push(
      "",
      "### Memory Updates",
      "",
      `After completing the task, update \`.teammates/${teammate.name}/memory/${today}.md\` with what you did, key decisions, and files changed.`,
    );
  }

  instrLines.push(
    "",
    "**REMINDER: You MUST end your turn with visible text output.**",
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
