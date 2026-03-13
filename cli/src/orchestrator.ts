/**
 * Orchestrator — the core of @teammates/cli.
 *
 * Routes tasks to teammates, manages handoff chains,
 * and delegates execution to the plugged-in agent adapter.
 */

import type {
  TaskAssignment,
  TaskResult,
  HandoffEnvelope,
  OrchestratorEvent,
} from "./types.js";
import type { AgentAdapter } from "./adapter.js";
import { formatHandoffContext } from "./adapter.js";
import { Registry } from "./registry.js";

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
  state: "idle" | "working" | "pending-handoff";
  lastSummary?: string;
  lastChangedFiles?: string[];
  lastTimestamp?: Date;
  pendingHandoff?: HandoffEnvelope;
}

export class Orchestrator {
  private registry: Registry;
  private adapter: AgentAdapter;
  private sessions: Map<string, string> = new Map(); // teammate -> sessionId
  private statuses: Map<string, TeammateStatus> = new Map();
  private maxHandoffDepth: number;
  private onEvent: (event: OrchestratorEvent) => void;
  /** When true, handoffs require explicit /approve */
  public requireApproval = true;

  constructor(config: OrchestratorConfig) {
    this.registry = new Registry(config.teammatesDir);
    this.adapter = config.adapter;
    this.maxHandoffDepth = config.maxHandoffDepth ?? 5;
    this.onEvent = config.onEvent ?? (() => {});
  }

  /** Initialize: load all teammates from disk */
  async init(): Promise<void> {
    await this.registry.loadAll();
    for (const name of this.registry.list()) {
      this.statuses.set(name, { state: "idle" });
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

  /** Get the pending handoff if any teammate has one */
  getPendingHandoff(): HandoffEnvelope | null {
    for (const [, status] of this.statuses) {
      if (status.state === "pending-handoff" && status.pendingHandoff) {
        return status.pendingHandoff;
      }
    }
    return null;
  }

  /** Clear a pending handoff (on reject) */
  clearPendingHandoff(teammate: string): void {
    const status = this.statuses.get(teammate);
    if (status && status.state === "pending-handoff") {
      status.state = "idle";
      status.pendingHandoff = undefined;
    }
  }

  /** List available teammates */
  listTeammates(): string[] {
    return this.registry.list();
  }

  /** Get the registry for direct access */
  getRegistry(): Registry {
    return this.registry;
  }

  /**
   * Assign a task to a specific teammate and execute it.
   * If the result contains a handoff, follows the chain automatically.
   */
  async assign(assignment: TaskAssignment, depth = 0, visited?: Set<string>): Promise<TaskResult> {
    // Normalize: strip leading @ from teammate names (agents may use @mentions)
    assignment.teammate = assignment.teammate.replace(/^@/, "");
    if (assignment.handoff) {
      assignment.handoff.to = assignment.handoff.to.replace(/^@/, "");
      assignment.handoff.from = assignment.handoff.from.replace(/^@/, "");
    }
    const teammate = this.registry.get(assignment.teammate);
    if (!teammate) {
      const error = `Unknown teammate: ${assignment.teammate}`;
      this.onEvent({ type: "error", teammate: assignment.teammate, error });
      return {
        teammate: assignment.teammate,
        success: false,
        summary: error,
        changedFiles: [],
      };
    }

    // ── Handoff cycle detection ──────────────────────────────────
    const chain = visited ?? new Set<string>();
    if (chain.has(assignment.teammate)) {
      const cycle = [...chain, assignment.teammate].join(" → ");
      const error = `Handoff cycle detected: ${cycle}`;
      this.onEvent({ type: "error", teammate: assignment.teammate, error });
      return {
        teammate: assignment.teammate,
        success: false,
        summary: error,
        changedFiles: [],
      };
    }
    chain.add(assignment.teammate);

    this.onEvent({ type: "task_assigned", assignment });

    // Update status
    this.statuses.set(assignment.teammate, { state: "working" });

    // Get or create session
    let sessionId = this.sessions.get(assignment.teammate);
    if (!sessionId) {
      sessionId = await this.adapter.startSession(teammate);
      this.sessions.set(assignment.teammate, sessionId);
    }

    // Build prompt with handoff context if present
    let prompt = assignment.task;
    if (assignment.handoff) {
      const handoffCtx = formatHandoffContext(assignment.handoff);
      prompt = `${handoffCtx}\n\n---\n\n${prompt}`;
    }
    if (assignment.extraContext) {
      prompt = `${assignment.extraContext}\n\n---\n\n${prompt}`;
    }

    // Execute
    const result = await this.adapter.executeTask(sessionId, teammate, prompt);
    this.onEvent({ type: "task_completed", result });

    // Update status with result
    const newStatus: TeammateStatus = {
      state: "idle",
      lastSummary: result.summary,
      lastChangedFiles: result.changedFiles,
      lastTimestamp: new Date(),
    };

    // Handle handoff
    if (result.handoff && depth < this.maxHandoffDepth) {
      this.onEvent({ type: "handoff_initiated", envelope: result.handoff });

      if (this.requireApproval) {
        // Park the handoff — user must /approve
        newStatus.state = "pending-handoff";
        newStatus.pendingHandoff = result.handoff;
        this.statuses.set(assignment.teammate, newStatus);
        return result;
      }

      // Auto-follow handoff
      this.statuses.set(assignment.teammate, newStatus);

      const nextAssignment: TaskAssignment = {
        teammate: result.handoff.to,
        task: result.handoff.task,
        handoff: result.handoff,
      };

      const handoffResult = await this.assign(nextAssignment, depth + 1, chain);
      this.onEvent({
        type: "handoff_completed",
        envelope: result.handoff,
        result: handoffResult,
      });

      return handoffResult;
    }

    this.statuses.set(assignment.teammate, newStatus);
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

      // Check ownership patterns against task text
      for (const pattern of [
        ...config.ownership.primary,
        ...config.ownership.secondary,
      ]) {
        // Extract meaningful keywords from glob patterns
        const keywords = pattern
          .replace(/[*\/{}]/g, " ")
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

    return bestMatch;
  }

  /** Destroy all sessions */
  async shutdown(): Promise<void> {
    for (const [name, sessionId] of this.sessions) {
      if (this.adapter.destroySession) {
        await this.adapter.destroySession(sessionId);
      }
    }
    this.sessions.clear();
  }
}
