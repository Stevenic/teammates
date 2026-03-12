/**
 * Echo adapter — a no-op adapter for testing and development.
 *
 * Echoes back the prompt it receives without calling any external agent.
 * Useful for verifying orchestrator wiring, handoff logic, and CLI behavior.
 */

import type { AgentAdapter } from "../adapter.js";
import type { TeammateConfig, TaskResult } from "../types.js";
import { buildTeammatePrompt } from "../adapter.js";

let nextId = 1;

export class EchoAdapter implements AgentAdapter {
  readonly name = "echo";

  async startSession(teammate: TeammateConfig): Promise<string> {
    return `echo-${teammate.name}-${nextId++}`;
  }

  async executeTask(
    sessionId: string,
    teammate: TeammateConfig,
    prompt: string
  ): Promise<TaskResult> {
    const fullPrompt = buildTeammatePrompt(teammate, prompt);

    return {
      teammate: teammate.name,
      success: true,
      summary: `[echo] ${teammate.name} received task (${prompt.length} chars)`,
      changedFiles: [],
      rawOutput: fullPrompt,
    };
  }
}
