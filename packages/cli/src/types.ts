/**
 * Core types for @teammates/cli.
 */

/** Sandbox level controlling what a teammate can do */
export type SandboxLevel =
  | "read-only"
  | "workspace-write"
  | "danger-full-access";

/** Whether this teammate is a human avatar or an AI agent */
export type TeammateType = "human" | "ai";

/** Presence state for /status display */
export type PresenceState = "online" | "offline" | "reachable";

/** A teammate's loaded configuration */
export interface TeammateConfig {
  /** Teammate name (folder name under .teammates/) */
  name: string;
  /** Whether this is a human avatar or AI teammate */
  type: TeammateType;
  /** Role description from SOUL.md */
  role: string;
  /** Full SOUL.md content */
  soul: string;
  /** Full WISDOM.md content */
  wisdom: string;
  /** Daily log entries (most recent first) */
  dailyLogs: DailyLog[];
  /** Weekly summary entries (most recent first) */
  weeklyLogs: WeeklyLog[];
  /** File ownership patterns from SOUL.md */
  ownership: OwnershipRules;
  /** Explicit routing keywords from SOUL.md ### Routing section */
  routingKeywords: string[];
  /** Working directory scope (defaults to repo root) */
  cwd?: string;
  /** Sandbox level (defaults to workspace-write) */
  sandbox?: SandboxLevel;
}

export interface DailyLog {
  date: string;
  content: string;
}

export interface WeeklyLog {
  /** ISO week string, e.g. "2026-W11" */
  week: string;
  content: string;
}

export interface MonthlyLog {
  /** Month string, e.g. "2026-03" */
  month: string;
  content: string;
}

export interface OwnershipRules {
  primary: string[];
  secondary: string[];
}

/** Structured handoff envelope passed between teammates */
export interface HandoffEnvelope {
  from: string;
  to: string;
  task: string;
  changedFiles?: string[];
  acceptanceCriteria?: string[];
  openQuestions?: string[];
  context?: string;
}

/** Result from an agent completing a task */
export interface TaskResult {
  /** The teammate that executed the task */
  teammate: string;
  /** Whether this was a system-initiated task */
  system?: boolean;
  /** Whether the task completed successfully */
  success: boolean;
  /** Summary of what was done */
  summary: string;
  /** Files that were changed */
  changedFiles: string[];
  /** Handoff requests to other teammates */
  handoffs: HandoffEnvelope[];
  /** Raw output from the agent */
  rawOutput?: string;
  /** The full prompt sent to the agent (for debug logging) */
  fullPrompt?: string;
  /** Process diagnostics for debugging empty/failed responses */
  diagnostics?: {
    /** Process exit code (null if killed by signal) */
    exitCode: number | null;
    /** Signal that killed the process (null if exited normally) */
    signal: string | null;
    /** stderr output (separate from stdout) */
    stderr: string;
    /** Whether the process was killed by timeout */
    timedOut: boolean;
    /** Path to the agent's debug log file, if written */
    debugFile?: string;
  };
}

/** Task assignment to a teammate */
export interface TaskAssignment {
  /** Target teammate name */
  teammate: string;
  /** Task description / prompt */
  task: string;
  /** Extra context to include in the prompt */
  extraContext?: string;
  /** When true, skip identity/memory prompt wrapping — send task as-is */
  raw?: boolean;
  /** When true, this is a system-initiated task — suppress progress bar */
  system?: boolean;
}

/** Orchestrator event for logging/hooks */
export type OrchestratorEvent =
  | { type: "task_assigned"; assignment: TaskAssignment }
  | { type: "task_completed"; result: TaskResult }
  | { type: "error"; teammate: string; error: string };

/** A task queue entry — either an agent task or an internal operation. */
export type QueueEntry =
  | {
      type: "agent";
      teammate: string;
      task: string;
      system?: boolean;
      migration?: boolean;
      /** Thread ID this task belongs to (if any). */
      threadId?: number;
      /** Frozen conversation snapshot taken at queue time (used by @everyone). */
      contextSnapshot?: {
        history: { role: string; text: string }[];
        summary: string;
      };
    }
  | { type: "compact"; teammate: string; task: string; threadId?: number }
  | { type: "retro"; teammate: string; task: string; threadId?: number }
  | { type: "btw"; teammate: string; task: string; threadId?: number }
  | { type: "debug"; teammate: string; task: string; threadId?: number }
  | { type: "script"; teammate: string; task: string; threadId?: number }
  | { type: "summarize"; teammate: string; task: string; threadId?: number };

/** State captured when an agent is interrupted mid-task. */
export interface InterruptState {
  /** The teammate that was interrupted */
  teammate: string;
  /** The original task prompt (user-facing, not the full wrapped prompt) */
  originalTask: string;
  /** The full prompt sent to the agent (identity + memory + task) */
  originalFullPrompt: string;
  /** Condensed conversation log from the interrupted session */
  conversationLog: string;
  /** How long the agent ran before interruption (ms) */
  elapsedMs: number;
  /** Number of tool calls made before interruption */
  toolCallCount: number;
  /** Files written/modified before interruption */
  filesChanged: string[];
}

/** A threaded task view — groups related messages under a single task ID. */
export interface TaskThread {
  /** Short numeric ID displayed as #1, #2, etc. */
  id: number;
  /** The user's original input that created this thread. */
  originMessage: string;
  /** When the thread was created. */
  originTimestamp: number;
  /** Flat append-only list of replies. */
  entries: ThreadEntry[];
  /** Teammates currently working on tasks in this thread. */
  pendingAgents: Set<string>;
  /** Whether the whole thread is collapsed in the feed. */
  collapsed: boolean;
  /** Indices of individually collapsed replies. */
  collapsedEntries: Set<number>;
  /** Timestamp when this thread was last focused. */
  focusedAt?: number;
}

/** A single entry within a TaskThread. */
export interface ThreadEntry {
  /** What produced this entry. */
  type: "user" | "agent" | "handoff" | "system";
  /** Which teammate produced this entry (undefined for user entries). */
  teammate?: string;
  /** The message content (raw markdown body). */
  content: string;
  /** Subject line for agent responses. */
  subject?: string;
  /** When this entry was created. */
  timestamp: number;
}

/** A registered slash command. */
export interface SlashCommand {
  name: string;
  aliases: string[];
  usage: string;
  description: string;
  run: (args: string) => Promise<void>;
}
