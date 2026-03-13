/**
 * Agent adapter interface.
 *
 * Implement this to plug any coding agent into the teammates CLI.
 * Each adapter wraps a specific agent backend (Codex, Claude Code, Cursor, etc.)
 * and translates between the orchestrator's protocol and the agent's native API.
 */

import type { TeammateConfig, TaskResult } from "./types.js";

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
    prompt: string
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

/**
 * Build the full prompt for a teammate session.
 * Includes identity, memory, roster, output protocol, and the task.
 */
export function buildTeammatePrompt(
  teammate: TeammateConfig,
  taskPrompt: string,
  options?: {
    handoffContext?: string;
    roster?: RosterEntry[];
    services?: InstalledService[];
    sessionFile?: string;
  }
): string {
  const parts: string[] = [];

  // ── Identity ──────────────────────────────────────────────────────
  parts.push(`# You are ${teammate.name}\n`);
  parts.push(teammate.soul);
  parts.push("\n---\n");

  // ── Memories ──────────────────────────────────────────────────────
  if (teammate.memories.trim()) {
    parts.push("## Your Memories\n");
    parts.push(teammate.memories);
    parts.push("\n---\n");
  }

  if (teammate.dailyLogs.length > 0) {
    parts.push("## Recent Daily Logs\n");
    for (const log of teammate.dailyLogs.slice(0, 3)) {
      parts.push(`### ${log.date}\n${log.content}\n`);
    }
    parts.push("\n---\n");
  }

  // ── Team roster ───────────────────────────────────────────────────
  if (options?.roster && options.roster.length > 0) {
    parts.push("## Your Team\n");
    parts.push("These are the other teammates you can hand off work to:\n");
    for (const t of options.roster) {
      if (t.name === teammate.name) continue;
      const owns = t.ownership.primary.length > 0
        ? ` — owns: ${t.ownership.primary.join(", ")}`
        : "";
      parts.push(`- **@${t.name}**: ${t.role}${owns}`);
    }
    parts.push("\n---\n");
  }

  // ── Installed services ──────────────────────────────────────────────
  if (options?.services && options.services.length > 0) {
    parts.push("## Available Services\n");
    parts.push("These services are installed and available for you to use:\n");
    for (const svc of options.services) {
      parts.push(`### ${svc.name}\n`);
      parts.push(svc.description);
      parts.push(`\n**Usage:** \`${svc.usage}\`\n`);
    }
    parts.push("\n---\n");
  }

  // ── Handoff context (if this task came from another teammate) ─────
  if (options?.handoffContext) {
    parts.push("## Handoff Context\n");
    parts.push(options.handoffContext);
    parts.push("\n---\n");
  }

  // ── Session state ────────────────────────────────────────────────
  if (options?.sessionFile) {
    parts.push("## Session State\n");
    parts.push(`Your session file is at: \`${options.sessionFile}\`

**Read this file first** — it contains context from your prior tasks in this session.

**Before returning your result**, append a brief entry to this file with:
- What you did
- Key decisions made
- Files changed
- Anything the next task should know

This is how you maintain continuity across tasks. Always read it, always update it.
`);
    parts.push("\n---\n");
  }

  // ── Memory updates ─────────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  parts.push("## Memory Updates\n");
  parts.push(`**Before returning your result**, update your memory files:

1. **Daily log** — Read \`.teammates/${teammate.name}/memory/${today}.md\` first (it may have entries from earlier tasks today), then write it back with your entry added. Create the file if it doesn't exist.
   - What you did
   - Key decisions made
   - Files changed
   - Anything the next task should know

2. **MEMORIES.md** — If you learned something durable (a decision, pattern, gotcha, or bug), read \`.teammates/${teammate.name}/MEMORIES.md\`, then write it back with your entry added.

These files are your persistent memory. Without them, your next session starts from scratch.
`);
  parts.push("\n---\n");

  // ── Output protocol ───────────────────────────────────────────────
  parts.push("## Output Protocol\n");
  parts.push(`When you finish, you MUST end your response with exactly one of these two blocks:

### Option 1: Direct response

If you can complete the task yourself, do the work and then end with:

\`\`\`json
{ "result": { "summary": "<one-line summary of what you did>", "changedFiles": ["<file>", ...] } }
\`\`\`

### Option 2: Handoff

If the task (or part of it) belongs to another teammate, end with:

\`\`\`json
{ "handoff": { "to": "<teammate>", "task": "<specific request for them>", "changedFiles": ["<files you changed, if any>"], "context": "<any context they need>" } }
\`\`\`

You may also write a task file (e.g. \`.teammates/tasks/<name>.md\`) with detailed instructions and reference it in the handoff:

\`\`\`json
{ "handoff": { "to": "<teammate>", "task": "See .teammates/tasks/<name>.md", "changedFiles": [".teammates/tasks/<name>.md"] } }
\`\`\`

Rules:
- Always include exactly one JSON block at the end — either \`result\` or \`handoff\`.
- Only hand off to teammates listed in "Your Team" above.
- Do as much of the work as you can before handing off.
- If the task is outside everyone's ownership, do your best and return a result.
`);
  parts.push("\n---\n");

  // ── Task ──────────────────────────────────────────────────────────
  parts.push("## Task\n");
  parts.push(taskPrompt);

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
