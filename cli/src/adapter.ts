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
}

/**
 * Build the system prompt for a teammate session.
 * Adapters use this to construct a consistent identity prompt.
 */
export function buildTeammatePrompt(
  teammate: TeammateConfig,
  taskPrompt: string,
  handoffContext?: string
): string {
  const parts: string[] = [];

  parts.push(`# You are ${teammate.name}\n`);
  parts.push(teammate.soul);
  parts.push("\n---\n");

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

  if (handoffContext) {
    parts.push("## Handoff Context\n");
    parts.push(handoffContext);
    parts.push("\n---\n");
  }

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
