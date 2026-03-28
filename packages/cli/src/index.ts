// Public API for @teammates/cli

export type {
  AgentAdapter,
  InstalledService,
  RecallContext,
  RosterEntry,
} from "./adapter.js";
export {
  buildTeammatePrompt,
  DAILY_LOG_BUDGET_TOKENS,
  formatHandoffContext,
  queryRecallContext,
  syncRecallIndex,
} from "./adapter.js";
export {
  type AgentPreset,
  CliProxyAdapter,
  type CliProxyOptions,
  PRESETS,
} from "./adapters/cli-proxy.js";
export { EchoAdapter } from "./adapters/echo.js";
export type { BannerInfo, ServiceInfo, ServiceStatus } from "./banner.js";
export { AnimatedBanner } from "./banner.js";
export type { CliArgs } from "./cli-args.js";
export { findTeammatesDir, PKG_VERSION, parseCliArgs } from "./cli-args.js";
export {
  autoCompactForBudget,
  buildDailyCompressionPrompt,
  buildMigrationCompressionPrompt,
  findUncompressedDailies,
} from "./compact.js";
export type { LogEntry } from "./log-parser.js";
export {
  buildConversationLog,
  formatLogTimeline,
  parseClaudeDebugLog,
  parseCodexOutput,
  parseRawOutput,
} from "./log-parser.js";
export {
  Orchestrator,
  type OrchestratorConfig,
  type TeammateStatus,
} from "./orchestrator.js";
export type { Persona } from "./personas.js";
export { loadPersonas, scaffoldFromPersona } from "./personas.js";
export { Registry } from "./registry.js";
export { tp } from "./theme.js";
export type {
  DailyLog,
  HandoffEnvelope,
  InterruptState,
  OrchestratorEvent,
  OwnershipRules,
  PresenceState,
  QueueEntry,
  SandboxLevel,
  SlashCommand,
  TaskAssignment,
  TaskResult,
  TeammateConfig,
  TeammateType,
} from "./types.js";
