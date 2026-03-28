/**
 * Orchestrator — the core of @teammates/cli.
 *
 * Routes tasks to teammates, manages handoff chains,
 * and delegates execution to the plugged-in agent adapter.
 */

import type { AgentAdapter } from "./adapter.js";
import { Registry } from "./registry.js";
import type { OrchestratorEvent, TaskAssignment, TaskResult } from "./types.js";

export interface OrchestratorConfig {
  /** Path to .teammates/ directory */
  teammatesDir: string;
  /** The agent adapter to use for execution */
  adapter: AgentAdapter;
  /** Max handoff chain depth before stopping (default: 5) */
  maxHandoffDepth?: number;
  /** Event listener for logging/UI */
  onEvent?: (event: OrchestratorEvent) => void;
}

export interface TeammateStatus {
  state: "idle" | "working";
  /** Presence for display: online (green), offline (red), reachable (yellow) */
  presence: import("./types.js").PresenceState;
  lastSummary?: string;
  lastChangedFiles?: string[];
  lastTimestamp?: Date;
}

export class Orchestrator {
  private registry: Registry;
  private adapter: AgentAdapter;
  private sessions: Map<string, string> = new Map();
  private statuses: Map<string, TeammateStatus> = new Map();
  private onEvent: (event: OrchestratorEvent) => void;

  constructor(config: OrchestratorConfig) {
    this.registry = new Registry(config.teammatesDir);
    this.adapter = config.adapter;
    this.onEvent = config.onEvent ?? (() => {});
  }

  /** Initialize: load all teammates from disk */
  async init(): Promise<void> {
    await this.registry.loadAll();
    for (const name of this.registry.list()) {
      const config = this.registry.get(name);
      // AI teammates are always online; humans start as offline
      const presence = config?.type === "human" ? "offline" : "online";
      this.statuses.set(name, { state: "idle", presence });
    }
  }

  /** Get status for a teammate */
  getStatus(name: string): TeammateStatus | undefined {
    return this.statuses.get(name);
  }

  /** Get all statuses */
  getAllStatuses(): Map<string, TeammateStatus> {
    return this.statuses;
  }

  /** List available teammates */
  listTeammates(): string[] {
    return this.registry.list();
  }

  /** Get the registry for direct access */
  getRegistry(): Registry {
    return this.registry;
  }

  /** Get the adapter for direct access (used by /interrupt) */
  getAdapter(): AgentAdapter {
    return this.adapter;
  }

  /**
   * Assign a task to a specific teammate and execute it.
   * If the result contains a handoff, follows the chain automatically.
   */
  async assign(assignment: TaskAssignment): Promise<TaskResult> {
    // Normalize: strip leading @ from teammate names
    assignment.teammate = assignment.teammate.replace(/^@/, "");
    const teammate = this.registry.get(assignment.teammate);
    if (!teammate) {
      const error = `Unknown teammate: ${assignment.teammate}`;
      this.onEvent({ type: "error", teammate: assignment.teammate, error });
      return {
        teammate: assignment.teammate,
        success: false,
        summary: error,
        changedFiles: [],
        handoffs: [],
      };
    }

    this.onEvent({ type: "task_assigned", assignment });
    const prevPresence =
      this.statuses.get(assignment.teammate)?.presence ?? "online";
    this.statuses.set(assignment.teammate, {
      state: "working",
      presence: prevPresence,
    });

    // Get or create session
    let sessionId = this.sessions.get(assignment.teammate);
    if (!sessionId) {
      sessionId = await this.adapter.startSession(teammate);
      this.sessions.set(assignment.teammate, sessionId);
    }

    // Build prompt
    let prompt = assignment.task;
    if (assignment.extraContext) {
      prompt = `${assignment.extraContext}\n\n---\n\n${prompt}`;
    }

    // Execute
    const result = await this.adapter.executeTask(sessionId, teammate, prompt, {
      raw: assignment.raw,
    });
    // Propagate system flag so event handlers can distinguish system vs user tasks
    if (assignment.system) result.system = true;
    this.onEvent({ type: "task_completed", result });

    // Update status (preserve presence)
    const postPresence =
      this.statuses.get(assignment.teammate)?.presence ?? "online";
    this.statuses.set(assignment.teammate, {
      state: "idle",
      presence: postPresence,
      lastSummary: result.summary,
      lastChangedFiles: result.changedFiles,
      lastTimestamp: new Date(),
    });

    return result;
  }

  /**
   * Route a task to the best teammate based on keyword matching.
   * Uses the routing guide from .teammates/README.md ownership patterns.
   */
  route(task: string): string | null {
    const taskLower = task.toLowerCase();
    let bestMatch: string | null = null;
    let bestScore = 0;

    for (const [name, config] of this.registry.all()) {
      let score = 0;

      // Check explicit routing keywords (highest priority, same weight as primary)
      for (const kw of config.routingKeywords) {
        if (taskLower.includes(kw.toLowerCase())) {
          score += 2;
        }
      }

      // Check ownership patterns against task text
      for (const pattern of [
        ...config.ownership.primary,
        ...config.ownership.secondary,
      ]) {
        // Extract meaningful keywords from glob patterns
        const keywords = pattern
          .replace(/[*/{}]/g, " ")
          .split(/\s+/)
          .filter((w) => w.length > 2);

        for (const kw of keywords) {
          if (taskLower.includes(kw.toLowerCase())) {
            score += config.ownership.primary.includes(pattern) ? 2 : 1;
          }
        }
      }

      // Check role keywords
      const roleWords = config.role.toLowerCase().split(/\s+/);
      for (const word of roleWords) {
        if (word.length > 3 && taskLower.includes(word)) {
          score++;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = name;
      }
    }

    // Require a meaningful match — weak/ambiguous scores fall through
    // so the caller can default to the user's agent
    if (bestScore < 2) return null;

    return bestMatch;
  }

  /**
   * Ask the agent to pick the best teammate for a task.
   * Used as a fallback when keyword routing doesn't find a strong match.
   */
  async agentRoute(task: string): Promise<string | null> {
    if (!this.adapter.routeTask) return null;

    const roster: Array<{
      name: string;
      role: string;
      ownership: { primary: string[]; secondary: string[] };
    }> = [];
    for (const [name, config] of this.registry.all()) {
      roster.push({ name, role: config.role, ownership: config.ownership });
    }

    return this.adapter.routeTask(task, roster);
  }

  /**
   * Reload the registry from disk and detect new teammates.
   * Returns the names of any newly discovered teammates.
   */
  async refresh(): Promise<string[]> {
    const before = new Set(this.registry.list());
    await this.registry.loadAll();
    const added: string[] = [];
    for (const name of this.registry.list()) {
      if (!before.has(name)) {
        const config = this.registry.get(name);
        const presence = config?.type === "human" ? "offline" : "online";
        this.statuses.set(name, { state: "idle", presence });
        added.push(name);
      }
    }
    return added;
  }

  /** Reset all teammate statuses to idle and clear sessions */
  async reset(): Promise<void> {
    for (const [_name, sessionId] of this.sessions) {
      if (this.adapter.destroySession) {
        await this.adapter.destroySession(sessionId);
      }
    }
    this.sessions.clear();
    for (const name of this.registry.list()) {
      const prevPresence = this.statuses.get(name)?.presence ?? "online";
      this.statuses.set(name, { state: "idle", presence: prevPresence });
    }
  }

  /** Destroy all sessions */
  async shutdown(): Promise<void> {
    for (const [_name, sessionId] of this.sessions) {
      if (this.adapter.destroySession) {
        await this.adapter.destroySession(sessionId);
      }
    }
    this.sessions.clear();
  }
}
