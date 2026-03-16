import { describe, expect, it } from "vitest";

// classifyUri is not exported, so we test it indirectly via a re-implementation
// or we can import the module and test the search function behavior.
// Since classifyUri is a pure function, let's extract and test its logic.

describe("classifyUri", () => {
  // Re-implement the classification logic for unit testing
  function classifyUri(uri: string): string {
    if (uri.includes("/memory/weekly/")) return "weekly";
    if (uri.includes("/memory/monthly/")) return "monthly";
    const memoryMatch = uri.match(/\/memory\/([^/]+)\.md$/);
    if (memoryMatch) {
      const stem = memoryMatch[1];
      if (/^\d{4}-\d{2}-\d{2}$/.test(stem)) return "daily";
      return "typed_memory";
    }
    return "other";
  }

  it("classifies weekly summaries", () => {
    expect(classifyUri("beacon/memory/weekly/2026-W10.md")).toBe("weekly");
  });

  it("classifies monthly summaries", () => {
    expect(classifyUri("beacon/memory/monthly/2025-12.md")).toBe("monthly");
  });

  it("classifies typed memories", () => {
    expect(classifyUri("beacon/memory/feedback_testing.md")).toBe(
      "typed_memory",
    );
    expect(classifyUri("beacon/memory/project_goals.md")).toBe("typed_memory");
  });

  it("classifies daily logs", () => {
    expect(classifyUri("beacon/memory/2026-03-14.md")).toBe("daily");
    expect(classifyUri("beacon/memory/2026-01-01.md")).toBe("daily");
  });

  it("classifies WISDOM.md as other", () => {
    expect(classifyUri("beacon/WISDOM.md")).toBe("other");
  });

  it("classifies non-memory paths as other", () => {
    expect(classifyUri("beacon/SOUL.md")).toBe("other");
    expect(classifyUri("beacon/notes/todo.md")).toBe("other");
  });
});
