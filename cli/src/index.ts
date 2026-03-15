// Public API for @teammates/cli

export type { AgentAdapter, InstalledService, RosterEntry } from "./adapter.js";
export { buildTeammatePrompt, formatHandoffContext } from "./adapter.js";
export {
  type AgentPreset,
  CliProxyAdapter,
  type CliProxyOptions,
  PRESETS,
} from "./adapters/cli-proxy.js";
export { EchoAdapter } from "./adapters/echo.js";
export {
  Orchestrator,
  type OrchestratorConfig,
  type TeammateStatus,
} from "./orchestrator.js";
export { Registry } from "./registry.js";
export type {
  DailyLog,
  HandoffEnvelope,
  OrchestratorEvent,
  OwnershipRules,
  SandboxLevel,
  TaskAssignment,
  TaskResult,
  TeammateConfig,
} from "./types.js";
