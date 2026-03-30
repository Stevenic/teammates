export const SHELL_TRANSPORT_VERSION = 1 as const;
export const SHELL_TRANSPORT_LABEL = "v1";

export type ShellEnvelopeKind = "command" | "response" | "event" | "error";
export type ShellTargetKind = "team" | "agent";

export interface FeedItemDto {
  id: string;
  targetId: string;
  title: string;
  body: string;
  timestamp: string;
  author?: string;
  status?: string;
}

export interface TabStateDto {
  id: string;
  targetKind: ShellTargetKind;
  displayName: string;
  activityState: string;
  composerEnabled: boolean;
  composerDisabledReason?: string;
  unreadCount: number;
}

export interface ShellStateSnapshotDto {
  activeTabId: string;
  connectionState: string;
  transportVersion: string;
  tabs: TabStateDto[];
  feedItems: FeedItemDto[];
}

export interface InitializeShellPayload {
  shellName?: string;
  shellVersion?: string;
}

export type GetShellStatePayload = Record<string, never>;

export interface SendInputPayload {
  targetId: string;
  text: string;
  author?: string;
}

export interface PingPayload {
  nonce?: string;
}

export interface CreateTaskPayload {
  teammate: string;
  task: string;
}

export interface InterruptTaskPayload {
  taskId: string;
  message?: string;
}

export interface ApprovalDecisionPayload {
  approvalId: string;
}

export interface OpenTerminalSessionPayload {
  targetId: string;
}

export interface CloseTerminalSessionPayload {
  sessionId: string;
}

export interface FocusTaskPayload {
  taskId: string;
}

export interface UpdateShellPreferencesPayload {
  preferences: Record<string, unknown>;
}

export interface RunCommandPayload {
  commandText: string;
}

export interface ShellCommandPayloadMap {
  initialize_shell: InitializeShellPayload;
  get_shell_state: GetShellStatePayload;
  send_input: SendInputPayload;
  run_command: RunCommandPayload;
  create_task: CreateTaskPayload;
  interrupt_task: InterruptTaskPayload;
  approve_handoff: ApprovalDecisionPayload;
  reject_handoff: ApprovalDecisionPayload;
  open_terminal_session: OpenTerminalSessionPayload;
  close_terminal_session: CloseTerminalSessionPayload;
  focus_task: FocusTaskPayload;
  update_shell_preferences: UpdateShellPreferencesPayload;
  ping: PingPayload;
}

export type ShellCommandName = keyof ShellCommandPayloadMap;

export interface ShellCommandEnvelope<
  T extends ShellCommandName = ShellCommandName,
> {
  kind: "command";
  version: typeof SHELL_TRANSPORT_VERSION;
  id: string;
  command: T;
  timestamp: string;
  payload: ShellCommandPayloadMap[T];
}

export interface ShellResponseEnvelope<TPayload = unknown> {
  kind: "response";
  version: typeof SHELL_TRANSPORT_VERSION;
  id: string;
  success: boolean;
  timestamp: string;
  payload: TPayload;
}

export type ShellEventName =
  | "engine_ready"
  | "engine_warning"
  | "engine_error"
  | "service_status_changed"
  | "capabilities_reported"
  | "shell_state_snapshot"
  | "task_queued"
  | "task_started"
  | "task_progress"
  | "task_output"
  | "task_completed"
  | "task_failed"
  | "task_cancelled"
  | "task_interrupted"
  | "queue_updated"
  | "roster_updated"
  | "teammate_status_changed"
  | "handoff_requested"
  | "approval_requested"
  | "approval_resolved"
  | "feed_item_added"
  | "feed_item_updated"
  | "terminal_session_opened"
  | "terminal_session_output"
  | "terminal_session_closed"
  | "terminal_session_failed";

export interface ShellEventEnvelope<TPayload = unknown> {
  kind: "event";
  version: typeof SHELL_TRANSPORT_VERSION;
  event: ShellEventName;
  timestamp: string;
  payload: TPayload;
}

export interface ShellErrorEnvelope {
  kind: "error";
  version: typeof SHELL_TRANSPORT_VERSION;
  id?: string;
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
  timestamp: string;
}

export function isShellCommandEnvelope(
  value: unknown,
): value is ShellCommandEnvelope {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.kind === "command" &&
    candidate.version === SHELL_TRANSPORT_VERSION &&
    typeof candidate.id === "string" &&
    typeof candidate.command === "string" &&
    typeof candidate.timestamp === "string" &&
    "payload" in candidate
  );
}
