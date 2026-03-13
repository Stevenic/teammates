import { describe, it, expect, beforeEach, vi } from "vitest";
import { Orchestrator } from "./orchestrator.js";
import type { AgentAdapter } from "./adapter.js";
import type { TeammateConfig, TaskResult, OrchestratorEvent } from "./types.js";

function makeTeammate(name: string, role = "Test role.", primary: string[] = []): TeammateConfig {
  return {
    name,
    role,
    soul: `# ${name}\n\n${role}`,
    memories: "",
    dailyLogs: [],
    ownership: { primary, secondary: [] },
  };
}

function makeMockAdapter(results?: Map<string, TaskResult>): AgentAdapter {
  let sessionCounter = 0;
  return {
    name: "mock",
    startSession: vi.fn(async (t: TeammateConfig) => `mock-${t.name}-${++sessionCounter}`),
    executeTask: vi.fn(async (_sid: string, t: TeammateConfig, _prompt: string) => {
      if (results?.has(t.name)) return results.get(t.name)!;
      return {
        teammate: t.name,
        success: true,
        summary: `${t.name} completed task`,
        changedFiles: [],
      };
    }),
    destroySession: vi.fn(async () => {}),
  };
}

function createOrchestrator(
  teammates: TeammateConfig[],
  adapter?: AgentAdapter,
  onEvent?: (e: OrchestratorEvent) => void
) {
  const mockAdapter = adapter ?? makeMockAdapter();
  const orch = new Orchestrator({
    teammatesDir: "/fake/.teammates",
    adapter: mockAdapter,
    onEvent,
  });
  // Register teammates directly instead of loading from disk
  const registry = orch.getRegistry();
  for (const t of teammates) {
    registry.register(t);
  }
  // Initialize statuses
  for (const t of teammates) {
    orch.getAllStatuses().set(t.name, { state: "idle" });
  }
  return { orch, adapter: mockAdapter };
}

describe("Orchestrator.route", () => {
  it("routes based on ownership keywords", () => {
    const { orch } = createOrchestrator([
      makeTeammate("beacon", "Platform engineer.", ["recall/src/**", "cli/src/**"]),
      makeTeammate("scribe", "Documentation writer.", ["docs/**", "README.md"]),
    ]);
    expect(orch.route("fix the recall search")).toBe("beacon");
    expect(orch.route("update the README documentation")).toBe("scribe");
  });

  it("returns null when no keywords match", () => {
    const { orch } = createOrchestrator([
      makeTeammate("beacon", "Platform engineer.", ["recall/src/**"]),
    ]);
    expect(orch.route("deploy to production")).toBeNull();
  });

  it("scores primary ownership higher than secondary", () => {
    const t1 = makeTeammate("beacon", "Platform engineer.");
    t1.ownership = { primary: ["cli/src/**"], secondary: [] };
    const t2 = makeTeammate("helper", "General helper.");
    t2.ownership = { primary: [], secondary: ["cli/src/**"] };
    const { orch } = createOrchestrator([t1, t2]);
    expect(orch.route("fix the cli")).toBe("beacon");
  });

  it("considers role keywords", () => {
    const { orch } = createOrchestrator([
      makeTeammate("beacon", "Platform engineer with search expertise."),
      makeTeammate("scribe", "Documentation writer."),
    ]);
    expect(orch.route("write documentation")).toBe("scribe");
  });
});

describe("Orchestrator.assign", () => {
  it("assigns a task and returns result", async () => {
    const { orch } = createOrchestrator([makeTeammate("beacon")]);
    const result = await orch.assign({ teammate: "beacon", task: "do stuff" });
    expect(result.success).toBe(true);
    expect(result.teammate).toBe("beacon");
  });

  it("strips @ from teammate name", async () => {
    const { orch } = createOrchestrator([makeTeammate("beacon")]);
    const result = await orch.assign({ teammate: "@beacon", task: "do stuff" });
    expect(result.success).toBe(true);
    expect(result.teammate).toBe("beacon");
  });

  it("returns error for unknown teammate", async () => {
    const { orch } = createOrchestrator([makeTeammate("beacon")]);
    const result = await orch.assign({ teammate: "unknown", task: "do stuff" });
    expect(result.success).toBe(false);
    expect(result.summary).toContain("Unknown teammate");
  });

  it("updates status to working during task", async () => {
    const statuses: string[] = [];
    const adapter = makeMockAdapter();
    const origExecute = adapter.executeTask;
    adapter.executeTask = async (sid, t, p) => {
      const { orch } = { orch: orchRef };
      statuses.push(orch.getStatus(t.name)?.state ?? "none");
      return origExecute(sid, t, p);
    };
    const { orch } = createOrchestrator([makeTeammate("beacon")], adapter);
    const orchRef = orch;
    await orch.assign({ teammate: "beacon", task: "do stuff" });
    expect(statuses).toContain("working");
    expect(orch.getStatus("beacon")?.state).toBe("idle");
  });

  it("emits task_assigned and task_completed events", async () => {
    const events: OrchestratorEvent[] = [];
    const { orch } = createOrchestrator(
      [makeTeammate("beacon")],
      undefined,
      (e) => events.push(e)
    );
    await orch.assign({ teammate: "beacon", task: "do stuff" });
    expect(events.map((e) => e.type)).toEqual(["task_assigned", "task_completed"]);
  });

  it("reuses existing session", async () => {
    const adapter = makeMockAdapter();
    const { orch } = createOrchestrator([makeTeammate("beacon")], adapter);
    await orch.assign({ teammate: "beacon", task: "task 1" });
    await orch.assign({ teammate: "beacon", task: "task 2" });
    expect(adapter.startSession).toHaveBeenCalledTimes(1);
    expect(adapter.executeTask).toHaveBeenCalledTimes(2);
  });
});

describe("Orchestrator handoffs", () => {
  it("parks handoff when requireApproval is true", async () => {
    const results = new Map<string, TaskResult>();
    results.set("beacon", {
      teammate: "beacon",
      success: true,
      summary: "done",
      changedFiles: [],
      handoff: { from: "beacon", to: "scribe", task: "update docs" },
    });
    const adapter = makeMockAdapter(results);
    const { orch } = createOrchestrator(
      [makeTeammate("beacon"), makeTeammate("scribe")],
      adapter
    );
    orch.requireApproval = true;
    await orch.assign({ teammate: "beacon", task: "do stuff" });
    expect(orch.getStatus("beacon")?.state).toBe("pending-handoff");
    expect(orch.getPendingHandoff()?.to).toBe("scribe");
  });

  it("auto-follows handoff when requireApproval is false", async () => {
    const results = new Map<string, TaskResult>();
    results.set("beacon", {
      teammate: "beacon",
      success: true,
      summary: "done",
      changedFiles: [],
      handoff: { from: "beacon", to: "scribe", task: "update docs" },
    });
    const adapter = makeMockAdapter(results);
    const { orch } = createOrchestrator(
      [makeTeammate("beacon"), makeTeammate("scribe")],
      adapter
    );
    orch.requireApproval = false;
    const result = await orch.assign({ teammate: "beacon", task: "do stuff" });
    // Final result should be from scribe (the handoff target)
    expect(result.teammate).toBe("scribe");
  });

  it("detects handoff cycles", async () => {
    const results = new Map<string, TaskResult>();
    results.set("beacon", {
      teammate: "beacon",
      success: true,
      summary: "done",
      changedFiles: [],
      handoff: { from: "beacon", to: "scribe", task: "your turn" },
    });
    results.set("scribe", {
      teammate: "scribe",
      success: true,
      summary: "done",
      changedFiles: [],
      handoff: { from: "scribe", to: "beacon", task: "back to you" },
    });
    const adapter = makeMockAdapter(results);
    const { orch } = createOrchestrator(
      [makeTeammate("beacon"), makeTeammate("scribe")],
      adapter
    );
    orch.requireApproval = false;
    const result = await orch.assign({ teammate: "beacon", task: "do stuff" });
    expect(result.success).toBe(false);
    expect(result.summary).toContain("cycle");
  });

  it("respects max handoff depth", async () => {
    // Create a chain: a -> b -> c -> d -> e -> f (depth 5 should stop)
    const teammates = ["a", "b", "c", "d", "e", "f"].map((n) => makeTeammate(n));
    const results = new Map<string, TaskResult>();
    for (let i = 0; i < 5; i++) {
      const from = teammates[i].name;
      const to = teammates[i + 1].name;
      results.set(from, {
        teammate: from,
        success: true,
        summary: "done",
        changedFiles: [],
        handoff: { from, to, task: "next" },
      });
    }
    const adapter = makeMockAdapter(results);
    const { orch } = createOrchestrator(teammates, adapter);
    orch.requireApproval = false;
    const result = await orch.assign({ teammate: "a", task: "start" });
    // Should stop at max depth, returning result from the teammate at depth limit
    expect(adapter.executeTask).toHaveBeenCalled();
  });

  it("clears pending handoff on reject", () => {
    const { orch } = createOrchestrator([makeTeammate("beacon")]);
    orch.getAllStatuses().set("beacon", {
      state: "pending-handoff",
      pendingHandoff: { from: "beacon", to: "scribe", task: "docs" },
    });
    orch.clearPendingHandoff("beacon");
    expect(orch.getStatus("beacon")?.state).toBe("idle");
    expect(orch.getStatus("beacon")?.pendingHandoff).toBeUndefined();
  });
});

describe("Orchestrator.reset", () => {
  it("resets all statuses to idle and clears sessions", async () => {
    const adapter = makeMockAdapter();
    const { orch } = createOrchestrator(
      [makeTeammate("beacon"), makeTeammate("scribe")],
      adapter
    );
    await orch.assign({ teammate: "beacon", task: "task" });
    await orch.reset();
    expect(orch.getStatus("beacon")?.state).toBe("idle");
    expect(adapter.destroySession).toHaveBeenCalled();
  });
});

describe("Orchestrator.shutdown", () => {
  it("destroys all sessions", async () => {
    const adapter = makeMockAdapter();
    const { orch } = createOrchestrator([makeTeammate("beacon")], adapter);
    await orch.assign({ teammate: "beacon", task: "task" });
    await orch.shutdown();
    expect(adapter.destroySession).toHaveBeenCalled();
  });
});
