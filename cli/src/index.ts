// Public API for @teammates/cli

export type {
  TeammateConfig,
  DailyLog,
  OwnershipRules,
  SandboxLevel,
  HandoffEnvelope,
  TaskResult,
  TaskAssignment,
  OrchestratorEvent,
} from "./types.js";

export type { AgentAdapter, RosterEntry, InstalledService } from "./adapter.js";
export { buildTeammatePrompt, formatHandoffContext } from "./adapter.js";
export { Registry } from "./registry.js";
export {
  Orchestrator,
  type OrchestratorConfig,
  type TeammateStatus,
} from "./orchestrator.js";
export { EchoAdapter } from "./adapters/echo.js";
export {
  CliProxyAdapter,
  PRESETS,
  type AgentPreset,
  type CliProxyOptions,
} from "./adapters/cli-proxy.js";
