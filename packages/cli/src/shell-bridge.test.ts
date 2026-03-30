import { describe, expect, it, vi } from "vitest";
import type { AgentAdapter } from "./adapter.js";
import { Orchestrator } from "./orchestrator.js";
import { ShellBridgeController } from "./shell-bridge.js";
import type { ShellEventEnvelope } from "./shell-types.js";
import type { TaskResult, TeammateConfig } from "./types.js";

function makeTeammate(
  name: string,
  type: "ai" | "human" = "ai",
): TeammateConfig {
  return {
    name,
    type,
    role: `${name} role.`,
    soul: `# ${name}\n\n${name} role.`,
    wisdom: "",
    dailyLogs: [],
    weeklyLogs: [],
    ownership: { primary: [], secondary: [] },
    routingKeywords: [],
  };
}

function makeAdapter(results?: Map<string, TaskResult>): AgentAdapter {
  let sessionCounter = 0;
  return {
    name: "mock",
    startSession: vi.fn(async (teammate: TeammateConfig) => {
      sessionCounter += 1;
      return `mock-${teammate.name}-${sessionCounter}`;
    }),
    executeTask: vi.fn(
      async (_sid: string, teammate: TeammateConfig, prompt: string) => {
        return (
          results?.get(teammate.name) ?? {
            teammate: teammate.name,
            success: true,
            summary: `${teammate.name} handled ${prompt}`,
            changedFiles: [],
            handoffs: [],
            rawOutput: `Handled: ${prompt}`,
          }
        );
      },
    ),
    destroySession: vi.fn(async () => {}),
  };
}

function createController(results?: Map<string, TaskResult>) {
  const events: ShellEventEnvelope[] = [];
  const orchestrator = new Orchestrator({
    teammatesDir: "/fake/.teammates",
    adapter: makeAdapter(results),
  });
  const registry = orchestrator.getRegistry();
  registry.register(makeTeammate("beacon"));
  registry.register(makeTeammate("scribe"));
  registry.register(makeTeammate("stevenic", "human"));
  orchestrator
    .getAllStatuses()
    .set("beacon", { state: "idle", presence: "online" });
  orchestrator
    .getAllStatuses()
    .set("scribe", { state: "idle", presence: "online" });
  orchestrator
    .getAllStatuses()
    .set("stevenic", { state: "idle", presence: "offline" });

  const controller = new ShellBridgeController({
    orchestrator,
    emitEvent: (event) => events.push(event),
    now: () => new Date("2026-03-30T21:00:00.000Z"),
  });

  return { controller, orchestrator, events };
}

describe("ShellBridgeController snapshots", () => {
  it("builds TEAM plus agent tabs with transport metadata", () => {
    const { controller } = createController();

    const snapshot = controller.createSnapshot();

    expect(snapshot.transportVersion).toBe("v1");
    expect(snapshot.activeTabId).toBe("team");
    expect(snapshot.tabs.map((tab) => tab.id)).toEqual([
      "team",
      "agent:beacon",
      "agent:scribe",
      "agent:stevenic",
    ]);
    expect(snapshot.tabs[3]).toMatchObject({
      composerEnabled: false,
      activityState: "offline",
    });
  });
});

describe("ShellBridgeController send_input", () => {
  it("routes TEAM input to an AI teammate and emits task/feed events", async () => {
    const { controller, events } = createController();

    const response = await controller.handleCommand({
      kind: "command",
      version: 1,
      id: "cmd-1",
      command: "send_input",
      timestamp: "2026-03-30T21:00:00.000Z",
      payload: {
        targetId: "team",
        text: "investigate the search regression",
        author: "tomlm",
      },
    });

    expect(response.kind).toBe("response");
    if (response.kind !== "response") {
      throw new Error(`Expected response, got ${response.kind}`);
    }
    expect(response.success).toBe(true);
    expect(response.payload).toMatchObject({
      routedTargetId: "agent:beacon",
      teammate: "beacon",
    });
    expect(events.map((event) => event.event)).toContain("task_started");
    expect(events.map((event) => event.event)).toContain("task_completed");

    const snapshot = controller.createSnapshot();
    expect(snapshot.feedItems.some((item) => item.targetId === "team")).toBe(
      true,
    );
    expect(
      snapshot.feedItems.some((item) => item.targetId === "agent:beacon"),
    ).toBe(true);
  });

  it("returns an error for human-controlled targets", async () => {
    const { controller } = createController();

    const response = await controller.handleCommand({
      kind: "command",
      version: 1,
      id: "cmd-2",
      command: "send_input",
      timestamp: "2026-03-30T21:00:00.000Z",
      payload: {
        targetId: "agent:stevenic",
        text: "hello",
      },
    });

    expect(response.kind).toBe("error");
    if (response.kind !== "error") {
      throw new Error(`Expected error, got ${response.kind}`);
    }
    expect(response.code).toBe("invalid_target");
    expect(response.message).toContain("not agent-controlled");
  });
});
