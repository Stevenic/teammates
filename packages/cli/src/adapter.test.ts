import { describe, expect, it } from "vitest";
import {
  buildTeammatePrompt,
  buildUserMessage,
  formatHandoffContext,
  formatRecallResult,
} from "./adapter.js";
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
  it("includes identity in system prompt", () => {
    const { systemPrompt } = buildTeammatePrompt(makeConfig(), "do the thing");
    expect(systemPrompt).toContain("# You are beacon");
  });

  it("includes soul content", () => {
    const { systemPrompt } = buildTeammatePrompt(makeConfig(), "do the thing");
    expect(systemPrompt).toContain("Beacon owns the recall package");
  });

  it("includes the task in user message", () => {
    const { userMessage } = buildTeammatePrompt(makeConfig(), "fix the bug");
    expect(userMessage).toContain("fix the bug");
  });

  it("includes instructions in system prompt", () => {
    const { systemPrompt } = buildTeammatePrompt(makeConfig(), "task");
    expect(systemPrompt).toContain("<INSTRUCTIONS>");
    expect(systemPrompt).toContain("Output Protocol");
  });

  it("skips wisdom section when empty", () => {
    const { systemPrompt } = buildTeammatePrompt(
      makeConfig({ wisdom: "" }),
      "task",
    );
    expect(systemPrompt).not.toContain("<WISDOM>");
  });

  it("includes wisdom when present", () => {
    const { systemPrompt } = buildTeammatePrompt(
      makeConfig({ wisdom: "Some important wisdom" }),
      "task",
    );
    expect(systemPrompt).toContain("<WISDOM>");
    expect(systemPrompt).toContain("Some important wisdom");
  });

  it("includes roster excluding self in system prompt", () => {
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
    const { systemPrompt } = buildTeammatePrompt(makeConfig(), "task", {
      roster,
    });
    expect(systemPrompt).toContain("<TEAM>");
    expect(systemPrompt).toContain("@scribe");
    expect(systemPrompt).not.toContain("@beacon");
  });

  it("includes handoff context in user message", () => {
    const { userMessage } = buildTeammatePrompt(makeConfig(), "task", {
      handoffContext: "Handed off from scribe with files changed",
    });
    expect(userMessage).toContain("<HANDOFF_CONTEXT>");
    expect(userMessage).toContain("Handed off from scribe");
  });

  it("uses pre-built system prompt content when provided", () => {
    const customSystem = "# Custom System Prompt\nThis is pre-built.";
    const { systemPrompt, fullPrompt } = buildTeammatePrompt(
      makeConfig(),
      "task",
      { systemPromptContent: customSystem },
    );
    expect(systemPrompt).toBe(customSystem);
    expect(fullPrompt).toContain(customSystem);
  });

  it("passes systemPromptFile through to PromptParts", () => {
    const parts = buildTeammatePrompt(makeConfig(), "task", {
      systemPromptFile: "/path/to/SYSTEM-PROMPT.md",
      systemPromptContent: "system content",
    });
    expect(parts.systemPromptFile).toBe("/path/to/SYSTEM-PROMPT.md");
  });

  it("fullPrompt combines system and user message", () => {
    const parts = buildTeammatePrompt(makeConfig(), "do the thing");
    expect(parts.fullPrompt).toContain("# You are beacon");
    expect(parts.fullPrompt).toContain("do the thing");
    expect(parts.fullPrompt).toBe(
      `${parts.systemPrompt}\n\n${parts.userMessage}`,
    );
  });
});

describe("buildUserMessage", () => {
  it("always includes the task prompt", () => {
    const result = buildUserMessage("fix the bug");
    expect(result).toContain("fix the bug");
  });

  it("includes conversation history within budget", () => {
    const result = buildUserMessage("task", {
      conversationHistory: "**user:** hello\n**beacon:** hi there",
    });
    expect(result).toContain("## Conversation History");
    expect(result).toContain("**user:** hello");
  });

  it("includes daily log snapshot within budget", () => {
    const result = buildUserMessage("task", {
      dailyLogSnapshot: "### 2026-04-02\nDid some work today.",
    });
    expect(result).toContain("## Daily Log");
    expect(result).toContain("Did some work today");
  });

  it("includes recalled memories in MEMORY: format", () => {
    const result = buildUserMessage("task", {
      recallResults: [
        {
          teammate: "beacon",
          uri: "beacon/memory/decision_foo.md",
          text: "Some recalled content",
          score: 0.9,
          contentType: "typed_memory",
        },
      ],
    });
    expect(result).toContain("## Recalled Memories");
    expect(result).toContain("MEMORY:");
    expect(result).toContain("file: memory/decision_foo.md");
    expect(result).toContain("type: typed_memory");
    expect(result).toContain("Some recalled content");
  });

  it("respects budget priority: conversation > daily log > recall", () => {
    // Fill conversation to 20k+ tokens (80k+ chars) to exceed the budget
    const bigConversation = "C".repeat(81_000);
    const result = buildUserMessage("task", {
      conversationHistory: bigConversation,
      dailyLogSnapshot: "### 2026-04-02\nShould be excluded",
      recallResults: [
        {
          teammate: "beacon",
          uri: "beacon/memory/test.md",
          text: "Should also be excluded",
          score: 0.9,
        },
      ],
    });
    // Conversation fills most of the budget
    expect(result).toContain("## Conversation History");
    // Daily log and recall pushed out
    expect(result).not.toContain("## Daily Log");
    expect(result).not.toContain("## Recalled Memories");
  });

  it("truncates conversation when it exceeds budget", () => {
    const bigConversation = "C".repeat(100_000); // ~25k tokens > 20k budget
    const result = buildUserMessage("task", {
      conversationHistory: bigConversation,
    });
    expect(result).toContain("(earlier entries trimmed)");
  });

  it("skips recall for ephemeral tasks", () => {
    const result = buildUserMessage("task", {
      skipMemoryUpdates: true,
      recallResults: [
        {
          teammate: "beacon",
          uri: "beacon/memory/test.md",
          text: "Should be skipped",
          score: 0.9,
        },
      ],
    });
    expect(result).not.toContain("## Recalled Memories");
  });

  it("skips context sections for system tasks", () => {
    const result = buildUserMessage("do maintenance", {
      system: true,
      conversationHistory: "should be skipped",
      dailyLogSnapshot: "should be skipped",
      recallResults: [
        {
          teammate: "beacon",
          uri: "beacon/memory/test.md",
          text: "skipped",
          score: 0.9,
        },
      ],
    });
    expect(result).toContain("do maintenance");
    expect(result).not.toContain("## Conversation History");
    expect(result).not.toContain("## Daily Log");
    expect(result).not.toContain("## Recalled Memories");
  });

  it("includes handoff context when present", () => {
    const result = buildUserMessage("task", {
      handoffContext: "From scribe: update docs",
    });
    expect(result).toContain("<HANDOFF_CONTEXT>");
    expect(result).toContain("From scribe: update docs");
  });
});

describe("formatRecallResult", () => {
  it("formats a typed memory result", () => {
    const result = formatRecallResult({
      teammate: "beacon",
      uri: "beacon/memory/decision_foo.md",
      text: "Decided to use approach X.",
      score: 0.9,
      contentType: "typed_memory",
    });
    expect(result).toContain("MEMORY:");
    expect(result).toContain("file: memory/decision_foo.md");
    expect(result).toContain("type: typed_memory");
    expect(result).toContain("partial: false");
    expect(result).toContain("Decided to use approach X.");
  });

  it("formats a partial daily chunk", () => {
    const result = formatRecallResult({
      teammate: "beacon",
      uri: "beacon/memory/2026-03-30.md#1",
      text: "Second chunk of the daily log.",
      score: 0.8,
      contentType: "daily",
      partial: true,
      period: "2026-03-30",
    });
    expect(result).toContain("file: memory/2026-03-30.md");
    expect(result).toContain("type: daily");
    expect(result).toContain("period: 2026-03-30");
    expect(result).toContain("partial: true");
  });

  it("formats a weekly summary", () => {
    const result = formatRecallResult({
      teammate: "beacon",
      uri: "beacon/memory/weekly/2026-W13.md",
      text: "Weekly summary content.",
      score: 0.9,
      contentType: "weekly",
      period: "2026-W13",
    });
    expect(result).toContain("type: weekly");
    expect(result).toContain("period: 2026-W13");
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
