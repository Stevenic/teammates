// Public API for @teammates/cli

export { ensureActivityHook } from "./activity-hook.js";
export {
  formatActivityTime,
  parseActivityLog,
  parseClaudeActivity,
  watchActivityLog,
  watchDebugLog,
  watchDebugLogErrors,
} from "./activity-watcher.js";
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
export type { ThreadContextEntry } from "./cli-utils.js";
export { buildThreadContext } from "./cli-utils.js";
export {
  autoCompactForBudget,
  buildDailyCompressionPrompt,
  buildMigrationCompressionPrompt,
  findUncompressedDailies,
} from "./compact.js";
export { HandoffManager } from "./handoff-manager.js";
export type { LogEntry } from "./log-parser.js";
export {
  buildConversationLog,
  formatLogTimeline,
  parseClaudeDebugLog,
  parseCodexOutput,
  parseRawOutput,
} from "./log-parser.js";
export { buildMigrationPrompt, semverLessThan } from "./migrations.js";
export type { OnboardView } from "./onboard-flow.js";
export { OnboardFlow } from "./onboard-flow.js";
export {
  Orchestrator,
  type OrchestratorConfig,
  type TeammateStatus,
} from "./orchestrator.js";
export type { Persona } from "./personas.js";
export { loadPersonas, scaffoldFromPersona } from "./personas.js";
export { Registry } from "./registry.js";
export { RetroManager } from "./retro-manager.js";
export { detectServices } from "./service-config.js";
export { StatusTracker } from "./status-tracker.js";
export { tp } from "./theme.js";
export type {
  ShiftCallback,
  ThreadFeedView,
  ThreadItemEntry,
} from "./thread-container.js";
export { ThreadContainer } from "./thread-container.js";
export type { ThreadManagerView } from "./thread-manager.js";
export { ThreadManager } from "./thread-manager.js";
export type {
  ActivityEvent,
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
  TaskThread,
  TeammateConfig,
  TeammateType,
  ThreadEntry,
} from "./types.js";
export { Wordwheel } from "./wordwheel.js";
