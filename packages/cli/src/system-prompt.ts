/**
 * System prompt generator — builds and writes SYSTEM-PROMPT.md files
 * for each teammate. These static files contain the stable prompt
 * sections (identity, wisdom, instructions) that rarely change.
 *
 * Generated at startup and regenerated when source files change.
 * Claude uses these via --append-system-prompt-file; other agents
 * prepend the content to their stdin blob.
 */

import { readFile, writeFile } from "node:fs/promises";
import { platform } from "node:os";
import { join } from "node:path";

import type { InstalledService, RosterEntry } from "./adapter.js";
import type { TeammateConfig } from "./types.js";

/**
 * Generate the static system prompt content for a teammate.
 *
 * Includes all sections that are stable across task dispatches:
 * - IDENTITY (SOUL.md)
 * - GOALS (GOALS.md)
 * - WISDOM (WISDOM.md)
 * - TEAM (roster)
 * - SERVICES (installed services)
 * - RECALL_TOOL (search instructions)
 * - ENVIRONMENT (platform — date is approximate, refreshed each startup)
 * - USER_PROFILE (USER.md)
 * - INSTRUCTIONS (output protocol, handoffs, folder boundaries, memory updates)
 */
export function generateSystemPrompt(
  teammate: TeammateConfig,
  options?: {
    roster?: RosterEntry[];
    services?: InstalledService[];
    userProfile?: string;
  },
): string {
  const parts: string[] = [];

  // ── Top edge (high attention) ─────────────────────────────────────

  // <IDENTITY> — anchors persona
  parts.push(`<IDENTITY>\n# You are ${teammate.name}\n\n${teammate.soul}\n`);

  // <GOALS> — active objectives and priorities
  if (teammate.goals.trim()) {
    parts.push(`<GOALS>\n${teammate.goals}\n`);
  }

  // <WISDOM> — stable knowledge
  if (teammate.wisdom.trim()) {
    parts.push(`<WISDOM>\n${teammate.wisdom}\n`);
  }

  // ── Reference data ────────────────────────────────────────────────

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

  // <ENVIRONMENT> — platform (date/time updated each session start)
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
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

  // <USER_PROFILE> — always included when present
  if (options?.userProfile?.trim()) {
    parts.push(`<USER_PROFILE>\n${options.userProfile.trim()}\n`);
  }

  // ── Bottom edge (high attention) — instructions ───────────────────

  const instrLines = buildInstructionLines(teammate, options);
  parts.push(instrLines.join("\n"));

  return parts.join("\n");
}

/**
 * Build the <INSTRUCTIONS> block for the system prompt.
 */
function buildInstructionLines(
  teammate: TeammateConfig,
  options?: {
    roster?: RosterEntry[];
    services?: InstalledService[];
    userProfile?: string;
  },
): string[] {
  const today = new Date().toISOString().slice(0, 10);
  const instrLines = [
    "<INSTRUCTIONS>",
    "",
    "**Your FIRST priority is answering the user's request in `<TASK>`. Session updates, memory writes, and continuity housekeeping are SECONDARY — do them AFTER producing your text response, not before.**",
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
    '- "Task completed", "already logged", or "no updates needed" is NOT a valid body. Describe what you actually did or deliver the actual content.',
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
    "- Only hand off to teammates listed in `<TEAM>`.",
    "- Do as much work as you can BEFORE handing off.",
    '- Do NOT just say "I\'ll hand this off" in prose — that does nothing. You MUST use the fenced block.',
  ];

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
    `1. **Daily log** — Read \`.teammates/${teammate.name}/memory/${today}.md\` first (it may have entries from earlier tasks today), then write it back with your entry added. Create the file if it doesn't exist. Always include YAML frontmatter with \`type: daily\`.`,
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
    "",
    "**IMPORTANT:** Only log work you actually performed in THIS turn. Never log assumed, planned, or prior-turn work. If you didn't do it, don't log it.",
  );

  // Section Reinforcement
  instrLines.push("", "### Section Reinforcement", "");
  instrLines.push(
    "- Stay in character as defined in `<IDENTITY>` — never break persona or speak as a generic assistant.",
  );
  if (teammate.goals.trim()) {
    instrLines.push(
      "- Keep `<GOALS>` in mind — prioritize work that advances your active objectives.",
    );
  }
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
    "- Honor the user's role, preferences, and communication style from `<USER_PROFILE>`.",
    "- Your response must answer `<TASK>` — everything else is supporting context.",
    "",
    "**REMINDER: You MUST end your turn with visible text output. A turn with only file edits and no text is a failed turn.**",
  );

  return instrLines;
}

/**
 * Write SYSTEM-PROMPT.md for a single teammate.
 * Returns the absolute path to the written file.
 */
export async function writeSystemPrompt(
  teammatesDir: string,
  teammate: TeammateConfig,
  options?: {
    roster?: RosterEntry[];
    services?: InstalledService[];
    userProfile?: string;
  },
): Promise<string> {
  const content = generateSystemPrompt(teammate, options);
  const filePath = join(teammatesDir, teammate.name, "SYSTEM-PROMPT.md");
  await writeFile(filePath, content, "utf-8");
  return filePath;
}

/**
 * Write SYSTEM-PROMPT.md for all teammates in the registry.
 * Called at startup to ensure all system prompts are fresh.
 */
export async function writeAllSystemPrompts(
  teammatesDir: string,
  teammates: TeammateConfig[],
  options?: {
    roster?: RosterEntry[];
    services?: InstalledService[];
    userProfile?: string;
  },
): Promise<Map<string, string>> {
  const results = new Map<string, string>();

  // Read USER.md once for all teammates
  let userProfile = options?.userProfile;
  if (userProfile === undefined) {
    try {
      userProfile = await readFile(join(teammatesDir, "USER.md"), "utf-8");
    } catch {
      // USER.md may not exist
    }
  }

  for (const teammate of teammates) {
    const filePath = await writeSystemPrompt(teammatesDir, teammate, {
      ...options,
      userProfile,
    });
    results.set(teammate.name, filePath);
  }

  return results;
}

/**
 * Get the path to a teammate's SYSTEM-PROMPT.md file.
 */
export function systemPromptPath(
  teammatesDir: string,
  teammateName: string,
): string {
  return join(teammatesDir, teammateName, "SYSTEM-PROMPT.md");
}
