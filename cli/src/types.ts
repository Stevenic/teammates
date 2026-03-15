/**
 * Core types for @teammates/cli.
 */

/** Sandbox level controlling what a teammate can do */
export type SandboxLevel =
  | "read-only"
  | "workspace-write"
  | "danger-full-access";

/** A teammate's loaded configuration */
export interface TeammateConfig {
  /** Teammate name (folder name under .teammates/) */
  name: string;
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
}

/** Task assignment to a teammate */
export interface TaskAssignment {
  /** Target teammate name */
  teammate: string;
  /** Task description / prompt */
  task: string;
  /** Extra context to include in the prompt */
  extraContext?: string;
}

/** Orchestrator event for logging/hooks */
export type OrchestratorEvent =
  | { type: "task_assigned"; assignment: TaskAssignment }
  | { type: "task_completed"; result: TaskResult }
  | { type: "error"; teammate: string; error: string };
