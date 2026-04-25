// Public API for @teammates/cli

export type { ActivityManagerDeps } from "./activity-manager.js";
export { ActivityManager } from "./activity-manager.js";
export {
  collapseActivityEvents,
  formatActivityTime,
  parseClaudeActivity,
  parseCopilotJsonlLine,
  watchCodexDebugLog,
  watchCopilotDebugLog,
  watchDebugLog,
  watchDebugLogErrors,
} from "./activity-watcher.js";
export type {
  AgentAdapter,
  InstalledService,
  PromptParts,
  RecallContext,
  RosterEntry,
} from "./adapter.js";
export {
  buildTeammatePrompt,
  buildUserMessage,
  DAILY_LOG_BUDGET_TOKENS,
  formatHandoffContext,
  formatRecallResult,
  queryRecallContext,
  syncRecallIndex,
  USER_MESSAGE_BUDGET_TOKENS,
} from "./adapter.js";
export { ClaudeAdapter, type ClaudeAdapterOptions } from "./adapters/claude.js";
export {
  type AgentPreset,
  CliProxyAdapter,
  type CliProxyOptions,
  PRESETS,
} from "./adapters/cli-proxy.js";
export { CodexAdapter, type CodexAdapterOptions } from "./adapters/codex.js";
export {
  CopilotAdapter,
  type CopilotAdapterOptions,
} from "./adapters/copilot.js";
export { EchoAdapter } from "./adapters/echo.js";
export type { BannerInfo, ServiceInfo, ServiceStatus } from "./banner.js";
export { AnimatedBanner } from "./banner.js";
export type { CliArgs } from "./cli-args.js";
export { findTeammatesDir, PKG_VERSION, parseCliArgs } from "./cli-args.js";
export type { ThreadContextEntry } from "./cli-utils.js";
export { buildThreadContext } from "./cli-utils.js";
export type { CommandsDeps } from "./commands.js";
export { CommandManager } from "./commands.js";
export {
  autoCompactForBudget,
  buildDailyCompressionPrompt,
  buildMigrationCompressionPrompt,
  findUncompressedDailies,
} from "./compact.js";
export type { ConversationManagerDeps } from "./conversation.js";
export { ConversationManager } from "./conversation.js";
export { FeedAdapter } from "./feed-adapter.js";
export type { FeedRendererDeps } from "./feed-renderer.js";
export { FeedRenderer } from "./feed-renderer.js";
export { HandoffManager } from "./handoff-manager.js";
export { ensurePostToolUseHook } from "./hook-installer.js";
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
export {
  loadPersonas,
  scaffoldFromPersona,
  updateFromPersona,
} from "./personas.js";
export { Registry } from "./registry.js";
export { RetroManager } from "./retro-manager.js";
export { detectServices } from "./service-config.js";
export type { StartupManagerDeps } from "./startup-manager.js";
export { StartupManager } from "./startup-manager.js";
export { StatusTracker } from "./status-tracker.js";
export {
  generateSystemPrompt,
  systemPromptPath,
  writeAllSystemPrompts,
  writeSystemPrompt,
} from "./system-prompt.js";
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
