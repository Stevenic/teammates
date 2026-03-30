import { createInterface } from "node:readline";
import { PKG_VERSION, resolveAdapter } from "./cli-args.js";
import { Orchestrator, type OrchestratorConfig } from "./orchestrator.js";
import type {
  FeedItemDto,
  PingPayload,
  SendInputPayload,
  ShellCommandEnvelope,
  ShellCommandName,
  ShellErrorEnvelope,
  ShellEventEnvelope,
  ShellResponseEnvelope,
  ShellStateSnapshotDto,
  TabStateDto,
} from "./shell-types.js";
import {
  isShellCommandEnvelope,
  SHELL_TRANSPORT_LABEL,
  SHELL_TRANSPORT_VERSION,
} from "./shell-types.js";
import type { OrchestratorEvent, TaskResult, TeammateConfig } from "./types.js";

interface BridgeTaskInfo {
  id: string;
  teammate: string;
  targetId: string;
  text: string;
  author: string;
  queuedAt: string;
}

export interface ShellBridgeControllerOptions {
  orchestrator: Orchestrator;
  emitEvent?: (event: ShellEventEnvelope) => void;
  now?: () => Date;
}

export class ShellBridgeController {
  private orchestrator: Orchestrator;
  private emitEvent: (event: ShellEventEnvelope) => void;
  private now: () => Date;
  private activeTabId = "team";
  private feedItems: FeedItemDto[] = [];
  private taskSequence = 0;
  private feedSequence = 0;
  private activeTasks = new Map<string, BridgeTaskInfo>();

  constructor(options: ShellBridgeControllerOptions) {
    this.orchestrator = options.orchestrator;
    this.emitEvent = options.emitEvent ?? (() => {});
    this.now = options.now ?? (() => new Date());
  }

  async initialize(): Promise<void> {
    await this.orchestrator.init();
  }

  async handleCommand(
    envelope: ShellCommandEnvelope,
  ): Promise<ShellResponseEnvelope | ShellErrorEnvelope> {
    try {
      switch (envelope.command) {
        case "initialize_shell":
          this.emitInitializationEvents();
          return this.ok(envelope.id, {
            engine: "@teammates/cli",
            engineVersion: PKG_VERSION,
            transportVersion: SHELL_TRANSPORT_LABEL,
            capabilities: {
              commands: [
                "initialize_shell",
                "get_shell_state",
                "send_input",
                "ping",
              ],
              events: [
                "engine_ready",
                "capabilities_reported",
                "shell_state_snapshot",
                "task_queued",
                "task_started",
                "task_progress",
                "task_completed",
                "task_failed",
                "queue_updated",
                "teammate_status_changed",
                "feed_item_added",
              ],
            },
          });
        case "get_shell_state": {
          const snapshot = this.createSnapshot();
          this.emit("shell_state_snapshot", snapshot);
          return this.ok(envelope.id, snapshot);
        }
        case "send_input":
          return this.handleSendInput(
            envelope.id,
            envelope.payload as SendInputPayload,
          );
        case "ping":
          return this.ok(envelope.id, {
            nonce: (envelope.payload as PingPayload).nonce ?? null,
            pong: true,
          });
        default:
          return this.unsupported(envelope.id, envelope.command);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown bridge error";
      return this.error(envelope.id, "bridge_error", message, true);
    }
  }

  emitInitializationEvents(): void {
    this.emit("engine_ready", {
      engine: "@teammates/cli",
      engineVersion: PKG_VERSION,
      transportVersion: SHELL_TRANSPORT_LABEL,
    });
    this.emit("capabilities_reported", {
      commands: ["initialize_shell", "get_shell_state", "send_input", "ping"],
    });
    this.emit("shell_state_snapshot", this.createSnapshot());
  }

  handleOrchestratorEvent(event: OrchestratorEvent): void {
    if (event.type !== "error") return;
    this.emit("engine_error", {
      teammate: event.teammate,
      message: event.error,
    });
  }

  createSnapshot(): ShellStateSnapshotDto {
    return {
      activeTabId: this.activeTabId,
      connectionState: "Connected",
      transportVersion: SHELL_TRANSPORT_LABEL,
      tabs: this.buildTabs(),
      feedItems: [...this.feedItems],
    };
  }

  private buildTabs(): TabStateDto[] {
    const registry = this.orchestrator.getRegistry();
    const statuses = this.orchestrator.getAllStatuses();
    const tabs: TabStateDto[] = [
      {
        id: "team",
        targetKind: "team",
        displayName: "TEAM",
        activityState: this.activeTasks.size > 0 ? "active" : "idle",
        composerEnabled: true,
        unreadCount: 0,
      },
    ];

    const teammates = Array.from(registry.all().values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const teammate of teammates) {
      const status = statuses.get(teammate.name);
      const isHuman = teammate.type === "human";
      tabs.push({
        id: this.agentTargetId(teammate.name),
        targetKind: "agent",
        displayName: `@${teammate.name}`,
        activityState: this.toActivityState(teammate, status?.state),
        composerEnabled: !isHuman,
        composerDisabledReason: isHuman
          ? "Human teammates are not directly controlled by the bridge."
          : undefined,
        unreadCount: 0,
      });
    }
    return tabs;
  }

  private toActivityState(
    teammate: TeammateConfig,
    state: "idle" | "working" | undefined,
  ): string {
    if (teammate.type === "human") return "offline";
    if (state === "working") return "running";
    return "idle";
  }

  private async handleSendInput(
    commandId: string,
    payload: { targetId: string; text: string; author?: string },
  ): Promise<ShellResponseEnvelope | ShellErrorEnvelope> {
    const author = payload.author?.trim() || "user";
    const trimmedText = payload.text.trim();
    if (!trimmedText) {
      return this.error(
        commandId,
        "invalid_payload",
        "send_input requires non-empty text.",
        false,
      );
    }

    let resolution: { targetId: string; teammate: string };
    try {
      resolution = await this.resolveTarget(payload.targetId, trimmedText);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to resolve target.";
      return this.error(commandId, "invalid_target", message, false);
    }
    this.activeTabId = resolution.targetId;

    const task: BridgeTaskInfo = {
      id: `task_${++this.taskSequence}`,
      teammate: resolution.teammate,
      targetId: resolution.targetId,
      text: trimmedText,
      author,
      queuedAt: this.timestamp(),
    };
    this.activeTasks.set(task.id, task);

    this.pushFeedItem(
      resolution.targetId,
      this.titleFromText(trimmedText),
      trimmedText,
      author,
      "sent",
      true,
    );
    this.emit("task_queued", {
      taskId: task.id,
      teammate: task.teammate,
      targetId: task.targetId,
      queuedAt: task.queuedAt,
    });
    this.emit("task_started", {
      taskId: task.id,
      teammate: task.teammate,
      targetId: task.targetId,
      startedAt: this.timestamp(),
    });
    this.emit("task_progress", {
      taskId: task.id,
      teammate: task.teammate,
      status: "running",
      message: `@${task.teammate} is working`,
    });
    this.emit("queue_updated", this.queueState());
    this.emitTeammateStatusChanged(task.teammate);

    const result = await this.orchestrator.assign({
      teammate: task.teammate,
      task: trimmedText,
    });

    this.activeTasks.delete(task.id);
    this.pushResultFeed(task, result);
    this.emit(result.success ? "task_completed" : "task_failed", {
      taskId: task.id,
      teammate: task.teammate,
      targetId: task.targetId,
      completedAt: this.timestamp(),
      success: result.success,
      summary: result.summary,
      changedFiles: result.changedFiles,
    });
    this.emit("queue_updated", this.queueState());
    this.emitTeammateStatusChanged(task.teammate);

    return this.ok(commandId, {
      taskId: task.id,
      routedTargetId: task.targetId,
      teammate: task.teammate,
      success: result.success,
      summary: result.summary,
    });
  }

  private async resolveTarget(
    requestedTargetId: string,
    text: string,
  ): Promise<{ targetId: string; teammate: string }> {
    if (requestedTargetId === "team") {
      const teammate =
        this.orchestrator.route(text) ??
        (await this.orchestrator.agentRoute(text)) ??
        this.defaultTeammate();
      if (!teammate) {
        throw new Error("No AI teammates are available for TEAM routing.");
      }
      return { targetId: this.agentTargetId(teammate), teammate };
    }

    if (!requestedTargetId.startsWith("agent:")) {
      throw new Error(`Unknown targetId: ${requestedTargetId}`);
    }

    const teammate = requestedTargetId.slice("agent:".length);
    const config = this.orchestrator.getRegistry().get(teammate);
    if (!config) {
      throw new Error(`Unknown teammate target: ${requestedTargetId}`);
    }
    if (config.type === "human") {
      throw new Error(`Target ${requestedTargetId} is not agent-controlled.`);
    }
    return { targetId: requestedTargetId, teammate };
  }

  private defaultTeammate(): string | null {
    const aiTeammates = Array.from(
      this.orchestrator.getRegistry().all().values(),
    )
      .filter((t) => t.type === "ai")
      .map((t) => t.name)
      .sort((a, b) => a.localeCompare(b));
    return aiTeammates[0] ?? null;
  }

  private pushResultFeed(task: BridgeTaskInfo, result: TaskResult): void {
    const title = result.success
      ? `@${task.teammate} completed`
      : `@${task.teammate} failed`;
    const body = result.rawOutput?.trim() || result.summary;
    const status = result.success ? "completed" : "failed";
    this.pushFeedItem(
      task.targetId,
      title,
      body,
      `@${task.teammate}`,
      status,
      true,
    );
  }

  private pushFeedItem(
    targetId: string,
    title: string,
    body: string,
    author?: string,
    status?: string,
    mirrorToTeam = false,
  ): void {
    const timestamp = this.timestamp();
    const item: FeedItemDto = {
      id: this.nextFeedId(),
      targetId,
      title,
      body,
      timestamp,
      author,
      status,
    };
    this.feedItems.push(item);
    this.emit("feed_item_added", item);

    if (mirrorToTeam && targetId !== "team") {
      const teamItem: FeedItemDto = {
        ...item,
        id: this.nextFeedId(),
        targetId: "team",
      };
      this.feedItems.push(teamItem);
      this.emit("feed_item_added", teamItem);
    }
  }

  private emitTeammateStatusChanged(teammate: string): void {
    const config = this.orchestrator.getRegistry().get(teammate);
    const status = this.orchestrator.getStatus(teammate);
    if (!config || !status) return;
    this.emit("teammate_status_changed", {
      teammate,
      targetId: this.agentTargetId(teammate),
      activityState: this.toActivityState(config, status.state),
      summary: status.lastSummary ?? null,
    });
  }

  private queueState() {
    return {
      active: Array.from(this.activeTasks.values()).map((task) => ({
        taskId: task.id,
        teammate: task.teammate,
        targetId: task.targetId,
        text: task.text,
      })),
    };
  }

  private titleFromText(text: string): string {
    const singleLine = text.replace(/\s+/g, " ").trim();
    if (singleLine.length <= 48) return singleLine;
    return `${singleLine.slice(0, 45)}...`;
  }

  private agentTargetId(teammate: string): string {
    return `agent:${teammate}`;
  }

  private nextFeedId(): string {
    this.feedSequence += 1;
    return `feed_${this.feedSequence.toString().padStart(4, "0")}`;
  }

  private timestamp(): string {
    return this.now().toISOString();
  }

  private emit<TPayload>(
    event: ShellEventEnvelope<TPayload>["event"],
    payload: TPayload,
  ): void {
    this.emitEvent({
      kind: "event",
      version: SHELL_TRANSPORT_VERSION,
      event,
      timestamp: this.timestamp(),
      payload,
    });
  }

  private ok<TPayload>(
    id: string,
    payload: TPayload,
  ): ShellResponseEnvelope<TPayload> {
    return {
      kind: "response",
      version: SHELL_TRANSPORT_VERSION,
      id,
      success: true,
      timestamp: this.timestamp(),
      payload,
    };
  }

  private error(
    id: string | undefined,
    code: string,
    message: string,
    retryable: boolean,
  ): ShellErrorEnvelope {
    return {
      kind: "error",
      version: SHELL_TRANSPORT_VERSION,
      id,
      code,
      message,
      retryable,
      timestamp: this.timestamp(),
    };
  }

  private unsupported(
    id: string,
    command: ShellCommandName,
  ): ShellErrorEnvelope {
    return this.error(
      id,
      "unsupported_command",
      `Command '${command}' is not implemented in bridge transport v1.`,
      false,
    );
  }
}

export interface ShellBridgeRuntimeOptions {
  adapterName: string;
  teammatesDir: string;
  modelOverride?: string;
  agentPassthrough?: string[];
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

export async function runShellBridge(
  options: ShellBridgeRuntimeOptions,
): Promise<void> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const stdin = options.stdin ?? process.stdin;
  const write = (value: unknown) => {
    stdout.write(`${JSON.stringify(value)}\n`);
  };

  const adapter = await resolveAdapter(options.adapterName, {
    modelOverride: options.modelOverride,
    agentPassthrough: options.agentPassthrough,
  });

  let controller: ShellBridgeController | null = null;
  const orchestrator = new Orchestrator({
    teammatesDir: options.teammatesDir,
    adapter,
    onEvent: (event) => controller?.handleOrchestratorEvent(event),
  } satisfies OrchestratorConfig);
  controller = new ShellBridgeController({
    orchestrator,
    emitEvent: (event) => write(event),
  });
  await controller.initialize();

  const rl = createInterface({ input: stdin, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid JSON";
      const invalidJson: ShellErrorEnvelope = {
        kind: "error",
        version: SHELL_TRANSPORT_VERSION,
        code: "invalid_json",
        message,
        retryable: false,
        timestamp: new Date().toISOString(),
      };
      write(invalidJson);
      continue;
    }

    if (!isShellCommandEnvelope(parsed)) {
      const invalidEnvelope: ShellErrorEnvelope = {
        kind: "error",
        version: SHELL_TRANSPORT_VERSION,
        code: "invalid_envelope",
        message: "Expected a command envelope with version 1.",
        retryable: false,
        timestamp: new Date().toISOString(),
      };
      write(invalidEnvelope);
      continue;
    }

    const response = await controller.handleCommand(parsed);
    write(response);
  }

  await orchestrator.shutdown().catch((error) => {
    const message =
      error instanceof Error ? error.message : "Bridge shutdown failed";
    stderr.write(`${message}\n`);
  });
}
