import { describe, expect, it } from "vitest";
import { buildTeammatePrompt, formatHandoffContext } from "./adapter.js";
import type { TeammateConfig } from "./types.js";

function makeConfig(overrides?: Partial<TeammateConfig>): TeammateConfig {
  return {
    name: "beacon",
    type: "ai" as const,
    role: "Platform engineer.",
    soul: "# Beacon\n\nBeacon owns the recall package.",
    goals: "",
    wisdom: "",
    dailyLogs: [],
    weeklyLogs: [],
    ownership: { primary: ["recall/src/**"], secondary: [] },
    routingKeywords: [],
    ...overrides,
  };
}

describe("buildTeammatePrompt", () => {
  it("includes identity header", () => {
    const prompt = buildTeammatePrompt(makeConfig(), "do the thing");
    expect(prompt).toContain("# You are beacon");
  });

  it("includes soul content", () => {
    const prompt = buildTeammatePrompt(makeConfig(), "do the thing");
    expect(prompt).toContain("Beacon owns the recall package");
  });

  it("includes the task", () => {
    const prompt = buildTeammatePrompt(makeConfig(), "fix the bug");
    expect(prompt).toContain("<TASK>");
    expect(prompt).toContain("fix the bug");
  });

  it("includes output protocol", () => {
    const prompt = buildTeammatePrompt(makeConfig(), "task");
    expect(prompt).toContain("<INSTRUCTIONS>");
    expect(prompt).toContain("Output Protocol");
    expect(prompt).toContain("TO: user");
    expect(prompt).toContain("```handoff");
  });

  it("includes memory updates section", () => {
    const prompt = buildTeammatePrompt(makeConfig(), "task");
    expect(prompt).toContain("### Memory Updates");
    expect(prompt).toContain(".teammates/beacon/memory/");
  });

  it("suppresses memory update instructions for ephemeral tasks", () => {
    const prompt = buildTeammatePrompt(makeConfig(), "task", {
      skipMemoryUpdates: true,
    });
    expect(prompt).toContain("### Memory Updates");
    expect(prompt).toContain("ephemeral side task");
    expect(prompt).not.toContain(".teammates/beacon/memory/");
  });

  it("skips wisdom section when empty", () => {
    const prompt = buildTeammatePrompt(makeConfig({ wisdom: "" }), "task");
    expect(prompt).not.toContain("<WISDOM>");
  });

  it("includes wisdom when present", () => {
    const prompt = buildTeammatePrompt(
      makeConfig({ wisdom: "Some important wisdom" }),
      "task",
    );
    expect(prompt).toContain("<WISDOM>");
    expect(prompt).toContain("Some important wisdom");
  });

  it("includes daily logs (up to 7)", () => {
    const logs = [
      { date: "2026-03-13", content: "Day 1" },
      { date: "2026-03-12", content: "Day 2" },
      { date: "2026-03-11", content: "Day 3" },
      { date: "2026-03-10", content: "Day 4" },
      { date: "2026-03-09", content: "Day 5" },
      { date: "2026-03-08", content: "Day 6" },
      { date: "2026-03-07", content: "Day 7" },
      { date: "2026-03-06", content: "Should be excluded" },
    ];
    const prompt = buildTeammatePrompt(makeConfig({ dailyLogs: logs }), "task");
    expect(prompt).toContain("<DAILY_LOGS>");
    expect(prompt).toContain("2026-03-13");
    expect(prompt).toContain("2026-03-07");
    expect(prompt).not.toContain("2026-03-06");
    expect(prompt).not.toContain("Should be excluded");
  });

  it("includes roster excluding self", () => {
    const roster = [
      {
        name: "beacon",
        role: "Platform engineer.",
        ownership: { primary: [], secondary: [] },
      },
      {
        name: "scribe",
        role: "Documentation writer.",
        ownership: { primary: ["docs/**"], secondary: [] },
      },
    ];
    const prompt = buildTeammatePrompt(makeConfig(), "task", { roster });
    expect(prompt).toContain("<TEAM>");
    expect(prompt).toContain("@scribe");
    expect(prompt).toContain("Documentation writer.");
    // Should not list self in roster
    expect(prompt).not.toContain("@beacon");
  });

  it("includes handoff context when provided", () => {
    const prompt = buildTeammatePrompt(makeConfig(), "task", {
      handoffContext: "Handed off from scribe with files changed",
    });
    expect(prompt).toContain("<HANDOFF_CONTEXT>");
    expect(prompt).toContain("Handed off from scribe");
  });

  it("drops daily logs that exceed the 12k daily budget", () => {
    // Each log is ~50k chars = ~12.5k tokens. First one exceeds 12k budget, dropped.
    const bigContent = "D".repeat(50_000);
    const config = makeConfig({
      dailyLogs: [
        { date: "2026-03-18", content: "Today's log — never trimmed" },
        { date: "2026-03-17", content: bigContent }, // day 2 — exceeds 12k, dropped
      ],
    });
    const prompt = buildTeammatePrompt(config, "task");
    // Today's log is always fully present (never trimmed)
    expect(prompt).toContain("Today's log — never trimmed");
    // Day 2 doesn't fit (12.5k > 12k)
    expect(prompt).not.toContain("2026-03-17");
  });

  it("recall gets at least 8k tokens even when daily logs use full 12k", () => {
    // Daily logs fill their 12k budget. Recall still gets its guaranteed 8k minimum.
    const dailyContent = "D".repeat(40_000); // ~10k tokens — fits in 12k
    const config = makeConfig({
      dailyLogs: [
        { date: "2026-03-18", content: "today" },
        { date: "2026-03-17", content: dailyContent },
      ],
    });
    const recallText = "R".repeat(20_000); // ~5k tokens — fits in 8k min
    const prompt = buildTeammatePrompt(config, "task", {
      recallResults: [
        {
          teammate: "beacon",
          uri: "memory/decision_foo.md",
          text: recallText,
          score: 0.9,
          contentType: "typed_memory",
        },
      ],
    });
    expect(prompt).toContain("2026-03-17");
    expect(prompt).toContain("<RECALL_RESULTS>");
  });

  it("recall gets unused daily log budget", () => {
    // Small daily logs leave most of 12k unused — recall gets the surplus.
    const config = makeConfig({
      dailyLogs: [
        { date: "2026-03-18", content: "today" },
        { date: "2026-03-17", content: "short day 2" }, // ~3 tokens
      ],
    });
    // Large recall result — should fit because daily logs barely used any budget
    const recallText = "R".repeat(80_000); // ~20k tokens — fits in (8k + ~12k unused)
    const prompt = buildTeammatePrompt(config, "task", {
      recallResults: [
        {
          teammate: "beacon",
          uri: "memory/big.md",
          text: recallText,
          score: 0.9,
          contentType: "typed_memory",
        },
      ],
    });
    expect(prompt).toContain("<RECALL_RESULTS>");
    expect(prompt).toContain("memory/big.md");
  });

  it("weekly summaries are excluded (indexed by recall)", () => {
    const config = makeConfig({
      dailyLogs: [{ date: "2026-03-13", content: "short log" }],
      weeklyLogs: [{ week: "2026-W11", content: "short summary" }],
    });
    const prompt = buildTeammatePrompt(config, "task");
    expect(prompt).toContain("<DAILY_LOGS>");
    expect(prompt).not.toContain("Weekly Summaries");
  });

  it("excludes task prompt from budget calculation", () => {
    // Large task prompt should not trigger trimming of wrapper sections
    const bigTask = "x".repeat(100_000);
    const config = makeConfig({
      dailyLogs: [{ date: "2026-03-13", content: "small log" }],
    });
    const prompt = buildTeammatePrompt(config, bigTask);
    // Daily logs should still be included despite the huge task
    expect(prompt).toContain("<DAILY_LOGS>");
    expect(prompt).toContain("small log");
  });
});

describe("formatHandoffContext", () => {
  it("formats basic handoff", () => {
    const result = formatHandoffContext({
      from: "beacon",
      task: "update the docs",
    });
    expect(result).toContain("**Handed off from:** beacon");
    expect(result).toContain("**Task:** update the docs");
  });

  it("includes changed files", () => {
    const result = formatHandoffContext({
      from: "beacon",
      task: "review",
      changedFiles: ["src/foo.ts", "src/bar.ts"],
    });
    expect(result).toContain("**Changed files:**");
    expect(result).toContain("- src/foo.ts");
    expect(result).toContain("- src/bar.ts");
  });

  it("includes acceptance criteria", () => {
    const result = formatHandoffContext({
      from: "beacon",
      task: "review",
      acceptanceCriteria: ["Tests pass", "No lint errors"],
    });
    expect(result).toContain("**Acceptance criteria:**");
    expect(result).toContain("- Tests pass");
    expect(result).toContain("- No lint errors");
  });

  it("includes open questions", () => {
    const result = formatHandoffContext({
      from: "beacon",
      task: "review",
      openQuestions: ["Should we rename?"],
    });
    expect(result).toContain("**Open questions:**");
    expect(result).toContain("- Should we rename?");
  });

  it("includes additional context", () => {
    const result = formatHandoffContext({
      from: "beacon",
      task: "review",
      context: "This is urgent",
    });
    expect(result).toContain("**Additional context:**");
    expect(result).toContain("This is urgent");
  });

  it("omits sections with empty arrays", () => {
    const result = formatHandoffContext({
      from: "beacon",
      task: "review",
      changedFiles: [],
    });
    expect(result).not.toContain("**Changed files:**");
  });
});
