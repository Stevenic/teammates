import { describe, expect, it } from "vitest";
import {
  buildConversationLog,
  formatLogTimeline,
  parseClaudeDebugLog,
  parseCodexOutput,
  parseRawOutput,
} from "./log-parser.js";

describe("parseRawOutput", () => {
  it("extracts file write patterns from stdout", () => {
    const output = [
      "Created file: `src/foo.ts`",
      "Modified bar.js",
      "Some other output",
      "Wrote `packages/cli/src/index.ts`",
    ].join("\n");

    const entries = parseRawOutput(output);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual({ action: "Write", summary: "src/foo.ts" });
    expect(entries[1]).toEqual({ action: "Write", summary: "bar.js" });
    expect(entries[2]).toEqual({
      action: "Write",
      summary: "packages/cli/src/index.ts",
    });
  });

  it("returns empty array for output with no file patterns", () => {
    const entries = parseRawOutput("Just some plain text output");
    expect(entries).toHaveLength(0);
  });
});

describe("parseCodexOutput", () => {
  it("extracts tool calls from JSONL events", () => {
    const output = [
      JSON.stringify({
        type: "item.completed",
        item: {
          type: "tool_call",
          name: "write_file",
          arguments: { path: "src/foo.ts" },
        },
      }),
      JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", text: "Done with the task" },
      }),
    ].join("\n");

    const entries = parseCodexOutput(output);
    expect(entries).toHaveLength(2);
    expect(entries[0].action).toBe("write_file");
    expect(entries[1]).toEqual({
      action: "text",
      summary: "Done with the task",
    });
  });

  it("skips non-JSON lines", () => {
    const output = "not json\n{invalid\n";
    const entries = parseCodexOutput(output);
    expect(entries).toHaveLength(0);
  });
});

describe("formatLogTimeline", () => {
  it("formats individual entries with numbered steps", () => {
    const entries = [
      { action: "Read", summary: "src/foo.ts" },
      { action: "Write", summary: "src/bar.ts" },
    ];
    const result = formatLogTimeline(entries);
    expect(result).toBe("1. Read src/foo.ts\n2. Write src/bar.ts");
  });

  it("groups consecutive same-action entries when > 3", () => {
    const entries = [
      { action: "Write", summary: "a.ts" },
      { action: "Write", summary: "b.ts" },
      { action: "Write", summary: "c.ts" },
      { action: "Write", summary: "d.ts" },
      { action: "Write", summary: "e.ts" },
    ];
    const result = formatLogTimeline(entries);
    expect(result).toContain("Write 5 items");
    expect(result).toContain("a.ts, b.ts, c.ts");
    expect(result).toContain("(+2 more)");
  });

  it("does not group when 3 or fewer consecutive entries", () => {
    const entries = [
      { action: "Write", summary: "a.ts" },
      { action: "Write", summary: "b.ts" },
      { action: "Write", summary: "c.ts" },
    ];
    const result = formatLogTimeline(entries);
    expect(result).toBe(
      "1. Write a.ts\n2. Write b.ts\n3. Write c.ts",
    );
  });

  it("returns fallback for empty entries", () => {
    expect(formatLogTimeline([])).toBe("(no tool calls captured)");
  });
});

describe("buildConversationLog", () => {
  it("uses raw output parser for unknown presets", () => {
    const stdout = "Created file: `test.ts`\nDone";
    const result = buildConversationLog(undefined, stdout, "aider");
    expect(result.filesChanged).toContain("test.ts");
    expect(result.toolCallCount).toBe(1);
    expect(result.log).toContain("Write");
  });

  it("groups large batch writes into a compact summary", () => {
    // 200 file writes should be grouped, not listed individually
    const entries = Array.from(
      { length: 200 },
      (_, i) => `Created file: \`file${i}.ts\``,
    ).join("\n");
    const result = buildConversationLog(undefined, entries, "generic");
    expect(result.toolCallCount).toBe(200);
    expect(result.log).toContain("Write 200 items");
    // The grouped output should be compact (single line)
    expect(result.log.split("\n")).toHaveLength(1);
  });

  it("handles empty output gracefully", () => {
    const result = buildConversationLog(undefined, "", "claude");
    expect(result.toolCallCount).toBe(0);
    expect(result.filesChanged).toHaveLength(0);
    expect(result.log).toBe("(no tool calls captured)");
  });
});
