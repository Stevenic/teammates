import { describe, it, expect } from "vitest";
import { buildTeammatePrompt, formatHandoffContext } from "./adapter.js";
import type { TeammateConfig } from "./types.js";

function makeConfig(overrides?: Partial<TeammateConfig>): TeammateConfig {
  return {
    name: "beacon",
    role: "Platform engineer.",
    soul: "# Beacon\n\nBeacon owns the recall package.",
    memories: "",
    dailyLogs: [],
    ownership: { primary: ["recall/src/**"], secondary: [] },
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
    expect(prompt).toContain("## Task");
    expect(prompt).toContain("fix the bug");
  });

  it("includes output protocol", () => {
    const prompt = buildTeammatePrompt(makeConfig(), "task");
    expect(prompt).toContain("## Output Protocol");
    expect(prompt).toContain('"result"');
    expect(prompt).toContain('"handoff"');
  });

  it("includes memory updates section", () => {
    const prompt = buildTeammatePrompt(makeConfig(), "task");
    expect(prompt).toContain("## Memory Updates");
    expect(prompt).toContain(".teammates/beacon/memory/");
  });

  it("skips memories section when empty", () => {
    const prompt = buildTeammatePrompt(makeConfig({ memories: "" }), "task");
    expect(prompt).not.toContain("## Your Memories");
  });

  it("includes memories when present", () => {
    const prompt = buildTeammatePrompt(
      makeConfig({ memories: "Some important memory" }),
      "task"
    );
    expect(prompt).toContain("## Your Memories");
    expect(prompt).toContain("Some important memory");
  });

  it("includes daily logs (up to 3)", () => {
    const logs = [
      { date: "2026-03-13", content: "Did stuff today" },
      { date: "2026-03-12", content: "Did stuff yesterday" },
      { date: "2026-03-11", content: "Day before" },
      { date: "2026-03-10", content: "Should be excluded" },
    ];
    const prompt = buildTeammatePrompt(makeConfig({ dailyLogs: logs }), "task");
    expect(prompt).toContain("## Recent Daily Logs");
    expect(prompt).toContain("2026-03-13");
    expect(prompt).toContain("2026-03-12");
    expect(prompt).toContain("2026-03-11");
    expect(prompt).not.toContain("2026-03-10");
    expect(prompt).not.toContain("Should be excluded");
  });

  it("includes roster excluding self", () => {
    const roster = [
      { name: "beacon", role: "Platform engineer.", ownership: { primary: [], secondary: [] } },
      { name: "scribe", role: "Documentation writer.", ownership: { primary: ["docs/**"], secondary: [] } },
    ];
    const prompt = buildTeammatePrompt(makeConfig(), "task", { roster });
    expect(prompt).toContain("## Your Team");
    expect(prompt).toContain("@scribe");
    expect(prompt).toContain("Documentation writer.");
    // Should not list self in roster
    expect(prompt).not.toContain("@beacon");
  });

  it("includes handoff context when provided", () => {
    const prompt = buildTeammatePrompt(makeConfig(), "task", {
      handoffContext: "Handed off from scribe with files changed",
    });
    expect(prompt).toContain("## Handoff Context");
    expect(prompt).toContain("Handed off from scribe");
  });

  it("includes session file when provided", () => {
    const prompt = buildTeammatePrompt(makeConfig(), "task", {
      sessionFile: "/tmp/beacon-session.md",
    });
    expect(prompt).toContain("## Session State");
    expect(prompt).toContain("/tmp/beacon-session.md");
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
