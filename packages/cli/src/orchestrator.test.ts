import { describe, expect, it, vi } from "vitest";
import type { AgentAdapter } from "./adapter.js";
import { Orchestrator } from "./orchestrator.js";
import type { OrchestratorEvent, TaskResult, TeammateConfig } from "./types.js";

function makeTeammate(
  name: string,
  role = "Test role.",
  primary: string[] = [],
): TeammateConfig {
  return {
    name,
    role,
    soul: `# ${name}\n\n${role}`,
    wisdom: "",
    dailyLogs: [],
    weeklyLogs: [],
    ownership: { primary, secondary: [] },
    routingKeywords: [],
  };
}

function makeMockAdapter(results?: Map<string, TaskResult>): AgentAdapter {
  let sessionCounter = 0;
  return {
    name: "mock",
    startSession: vi.fn(
      async (t: TeammateConfig) => `mock-${t.name}-${++sessionCounter}`,
    ),
    executeTask: vi.fn(
      async (_sid: string, t: TeammateConfig, _prompt: string) => {
        if (results?.has(t.name)) return results.get(t.name)!;
        return {
          teammate: t.name,
          success: true,
          summary: `${t.name} completed task`,
          changedFiles: [],
          handoffs: [],
        };
      },
    ),
    destroySession: vi.fn(async () => {}),
  };
}

function createOrchestrator(
  teammates: TeammateConfig[],
  adapter?: AgentAdapter,
  onEvent?: (e: OrchestratorEvent) => void,
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
      makeTeammate("beacon", "Platform engineer.", [
        "recall/src/**",
        "cli/src/**",
      ]),
      makeTeammate("scribe", "Documentation writer.", ["docs/**", "README.md"]),
    ]);
    expect(orch.route("fix the recall search")).toBe("beacon");
    expect(orch.route("update the docs README")).toBe("scribe");
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
      makeTeammate("scribe", "Documentation writer.", ["docs/**"]),
    ]);
    // "write documentation" matches role word "documentation" (1pt) + ownership keyword "docs" (2pt)
    expect(orch.route("write docs and documentation")).toBe("scribe");
  });

  it("routes based on explicit routing keywords", () => {
    const t1 = makeTeammate("beacon", "Platform engineer.");
    t1.routingKeywords = ["search", "embeddings", "vector"];
    const t2 = makeTeammate("scribe", "Documentation writer.");
    t2.routingKeywords = ["template", "onboarding"];
    const { orch } = createOrchestrator([t1, t2]);
    expect(orch.route("fix the search feature")).toBe("beacon");
    expect(orch.route("update the onboarding flow")).toBe("scribe");
  });

  it("routing keywords beat role-only matches", () => {
    const t1 = makeTeammate("beacon", "Platform engineer.");
    t1.routingKeywords = ["search"];
    const t2 = makeTeammate("finder", "Search specialist.");
    const { orch } = createOrchestrator([t1, t2]);
    // "search" matches beacon's routing keyword (2pt) and finder's role (1pt)
    expect(orch.route("improve search results")).toBe("beacon");
  });

  it("returns null for weak matches (score < 2)", () => {
    const { orch } = createOrchestrator([
      makeTeammate("beacon", "Platform engineer."),
      makeTeammate("scribe", "Documentation writer."),
    ]);
    // "documentation" only matches a role word (1pt) — too weak to route confidently
    expect(orch.route("write documentation")).toBeNull();
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
      (e) => events.push(e),
    );
    await orch.assign({ teammate: "beacon", task: "do stuff" });
    expect(events.map((e) => e.type)).toEqual([
      "task_assigned",
      "task_completed",
    ]);
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
  it("returns handoffs in the result for CLI to handle", async () => {
    const results = new Map<string, TaskResult>();
    results.set("beacon", {
      teammate: "beacon",
      success: true,
      summary: "done",
      changedFiles: [],
      handoffs: [{ from: "beacon", to: "scribe", task: "update docs" }],
    });
    const adapter = makeMockAdapter(results);
    const { orch } = createOrchestrator(
      [makeTeammate("beacon"), makeTeammate("scribe")],
      adapter,
    );
    const result = await orch.assign({ teammate: "beacon", task: "do stuff" });
    expect(result.handoffs).toHaveLength(1);
    expect(result.handoffs[0].to).toBe("scribe");
    // Orchestrator doesn't auto-follow — status goes to idle
    expect(orch.getStatus("beacon")?.state).toBe("idle");
  });
});

describe("Orchestrator.reset", () => {
  it("resets all statuses to idle and clears sessions", async () => {
    const adapter = makeMockAdapter();
    const { orch } = createOrchestrator(
      [makeTeammate("beacon"), makeTeammate("scribe")],
      adapter,
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

describe("Orchestrator.refresh", () => {
  it("detects new teammates added to registry after init", async () => {
    const { orch } = createOrchestrator([makeTeammate("beacon")]);
    expect(orch.listTeammates()).toEqual(["beacon"]);

    // Mock loadAll to simulate a new teammate appearing on disk
    const registry = orch.getRegistry();
    vi.spyOn(registry, "loadAll").mockImplementation(async () => {
      registry.register(makeTeammate("pipeline", "DevOps engineer."));
      return registry.all();
    });

    const added = await orch.refresh();
    expect(added).toEqual(["pipeline"]);
    expect(orch.listTeammates()).toContain("pipeline");
    expect(orch.getStatus("pipeline")?.state).toBe("idle");
  });

  it("returns empty array when no new teammates", async () => {
    const { orch } = createOrchestrator([makeTeammate("beacon")]);

    // Mock loadAll to return existing teammates only
    const registry = orch.getRegistry();
    vi.spyOn(registry, "loadAll").mockImplementation(async () =>
      registry.all(),
    );

    const added = await orch.refresh();
    expect(added).toEqual([]);
  });
});
