import { describe, expect, it } from "vitest";
import {
  collapseActivityEvents,
  parseCodexJsonlLine,
  parseCopilotJsonlLine,
} from "./activity-watcher.js";

describe("parseCodexJsonlLine", () => {
  const start = Date.parse("2026-03-29T12:00:00.000Z");
  const receivedAt = start + 4_000;

  it("maps Get-Content shell commands to Read activity", () => {
    const line = JSON.stringify({
      type: "item.completed",
      item: {
        type: "tool_call",
        name: "shell_command",
        arguments: { command: "Get-Content -Raw packages\\cli\\src\\cli.ts" },
      },
    });

    expect(parseCodexJsonlLine(line, start, receivedAt)).toEqual([
      { elapsedMs: 4_000, tool: "Read", detail: "cli.ts" },
    ]);
  });

  it("maps rg shell commands to Grep activity", () => {
    const line = JSON.stringify({
      type: "item.completed",
      item: {
        type: "tool_call",
        name: "shell_command",
        arguments: { command: 'rg -n "watchDebugLog" packages/cli/src' },
      },
    });

    expect(parseCodexJsonlLine(line, start, receivedAt)).toEqual([
      { elapsedMs: 4_000, tool: "Grep", detail: "watchDebugLog" },
    ]);
  });

  it("maps apply_patch to Edit activity with the target file", () => {
    const line = JSON.stringify({
      type: "item.completed",
      item: {
        type: "tool_call",
        name: "apply_patch",
        arguments: {
          patch: [
            "*** Begin Patch",
            "*** Update File: packages/cli/src/status-tracker.ts",
            "@@",
            "-old",
            "+new",
            "*** End Patch",
          ].join("\n"),
        },
      },
    });

    expect(parseCodexJsonlLine(line, start, receivedAt)).toEqual([
      { elapsedMs: 4_000, tool: "Edit", detail: "status-tracker.ts" },
    ]);
  });

  it("maps exec_command_begin events to live shell activity", () => {
    const line = JSON.stringify({
      type: "exec_command_begin",
      command: "Get-Content -Raw packages\\cli\\src\\cli.ts",
    });

    expect(parseCodexJsonlLine(line, start, receivedAt)).toEqual([
      { elapsedMs: 4_000, tool: "Read", detail: "cli.ts" },
    ]);
  });

  it("maps command_execution item.started events from the JSONL debug log", () => {
    const line = JSON.stringify({
      type: "item.started",
      item: {
        type: "command_execution",
        command:
          '"C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command "Get-Content .teammates\\beacon\\SOUL.md"',
      },
    });

    expect(parseCodexJsonlLine(line, start, receivedAt)).toEqual([
      { elapsedMs: 4_000, tool: "Read", detail: "SOUL.md" },
    ]);
  });

  it("maps patch_apply_begin events to live edit activity", () => {
    const line = JSON.stringify({
      type: "patch_apply_begin",
      changes: {
        path: "packages/cli/src/activity-watcher.ts",
      },
    });

    expect(parseCodexJsonlLine(line, start, receivedAt)).toEqual([
      { elapsedMs: 4_000, tool: "Edit", detail: "activity-watcher.ts" },
    ]);
  });

  it("maps file_change item.started events into write and edit activity", () => {
    const line = JSON.stringify({
      type: "item.started",
      item: {
        type: "file_change",
        status: "in_progress",
        changes: [
          { path: "packages/cli/src/personas.ts", kind: "update" },
          { path: "packages/cli/src/personas.test.ts", kind: "update" },
          { path: "packages/cli/personas/beacon/WISDOM.md", kind: "add" },
        ],
      },
    });

    expect(parseCodexJsonlLine(line, start, receivedAt)).toEqual([
      {
        elapsedMs: 4_000,
        tool: "Edit",
        detail: "personas.ts (+1 files)",
        isError: false,
      },
      { elapsedMs: 4_000, tool: "Write", detail: "WISDOM.md", isError: false },
    ]);
  });

  it("maps failed file_change item.completed events into error activity", () => {
    const line = JSON.stringify({
      type: "item.completed",
      item: {
        type: "file_change",
        status: "failed",
        changes: [
          { path: "packages/cli/personas/architect.md", kind: "delete" },
        ],
      },
    });

    expect(parseCodexJsonlLine(line, start, receivedAt)).toEqual([
      {
        elapsedMs: 4_000,
        tool: "Edit",
        detail: "architect.md",
        isError: true,
      },
    ]);
  });

  it("accepts stringified tool arguments", () => {
    const line = JSON.stringify({
      type: "item.completed",
      item: {
        type: "tool_call",
        name: "shell_command",
        arguments: JSON.stringify({
          command: 'rg -n "parseCodexJsonlLine" packages/cli/src',
        }),
      },
    });

    expect(parseCodexJsonlLine(line, start, receivedAt)).toEqual([
      { elapsedMs: 4_000, tool: "Grep", detail: "parseCodexJsonlLine" },
    ]);
  });

  it("accepts custom_tool_call items with input payloads", () => {
    const line = JSON.stringify({
      type: "response.output_item.done",
      item: {
        type: "custom_tool_call",
        name: "shell_command",
        input: {
          command: "Get-Content -Raw packages\\cli\\src\\activity-watcher.ts",
        },
      },
    });

    expect(parseCodexJsonlLine(line, start, receivedAt)).toEqual([
      { elapsedMs: 4_000, tool: "Read", detail: "activity-watcher.ts" },
    ]);
  });

  it("accepts function_call items with stringified input", () => {
    const line = JSON.stringify({
      type: "response.output_item.added",
      output_item: {
        type: "function_call",
        name: "apply_patch",
        input: JSON.stringify({
          patch: [
            "*** Begin Patch",
            "*** Update File: packages/cli/src/cli.ts",
            "@@",
            "-old",
            "+new",
            "*** End Patch",
          ].join("\n"),
        }),
      },
    });

    expect(parseCodexJsonlLine(line, start, receivedAt)).toEqual([
      { elapsedMs: 4_000, tool: "Edit", detail: "cli.ts" },
    ]);
  });

  it("maps error events to error activity", () => {
    const line = JSON.stringify({
      type: "error",
      message: "stream disconnected before completion",
    });

    expect(parseCodexJsonlLine(line, start, receivedAt)).toEqual([
      {
        elapsedMs: 4_000,
        tool: "Codex",
        detail: "stream disconnected before completion",
        isError: true,
      },
    ]);
  });
});

describe("collapseActivityEvents", () => {
  it("keeps a single research event visible instead of collapsing it", () => {
    expect(
      collapseActivityEvents([
        { elapsedMs: 4_000, tool: "Read", detail: "SOUL.md" },
      ]),
    ).toEqual([{ elapsedMs: 4_000, tool: "Read", detail: "SOUL.md" }]);
  });

  it("still collapses consecutive research events into Exploring", () => {
    expect(
      collapseActivityEvents([
        { elapsedMs: 4_000, tool: "Read", detail: "SOUL.md" },
        { elapsedMs: 5_000, tool: "Grep", detail: "watchCodexDebugLog" },
      ]),
    ).toEqual([
      { elapsedMs: 4_000, tool: "Exploring", detail: "1× Read, 1× Grep" },
    ]);
  });
});

describe("parseCopilotJsonlLine", () => {
  const start = Date.parse("2026-03-29T12:00:00.000Z");
  const receivedAt = start + 4_000;

  it("maps view tool starts on files to Read activity", () => {
    const line = JSON.stringify({
      type: "tool.execution_start",
      data: {
        toolName: "view",
        arguments: {
          path: "C:\\source\\teammates\\packages\\cli\\src\\adapters\\presets.ts",
        },
      },
    });

    expect(parseCopilotJsonlLine(line, start, receivedAt)).toEqual([
      { elapsedMs: 4_000, tool: "Read", detail: "presets.ts" },
    ]);
  });

  it("maps view tool starts on directories to Glob activity", () => {
    const line = JSON.stringify({
      type: "tool.execution_start",
      data: {
        toolName: "view",
        arguments: {
          path: "C:\\source\\teammates\\packages\\cli\\src",
        },
      },
    });

    expect(parseCopilotJsonlLine(line, start, receivedAt)).toEqual([
      { elapsedMs: 4_000, tool: "Glob", detail: "src" },
    ]);
  });

  it("maps shell commands to Grep activity", () => {
    const line = JSON.stringify({
      type: "tool.execution_start",
      data: {
        toolName: "shell",
        arguments: {
          command: 'rg -n "watchCopilotDebugLog" packages/cli/src',
        },
      },
    });

    expect(parseCopilotJsonlLine(line, start, receivedAt)).toEqual([
      { elapsedMs: 4_000, tool: "Grep", detail: "watchCopilotDebugLog" },
    ]);
  });

  it("maps failed tool completions to error activity", () => {
    const line = JSON.stringify({
      type: "tool.execution_complete",
      data: {
        toolName: "view",
        success: false,
        result: { content: "permission denied" },
      },
    });

    expect(parseCopilotJsonlLine(line, start, receivedAt)).toEqual([
      {
        elapsedMs: 4_000,
        tool: "view",
        detail: "permission denied",
        isError: true,
      },
    ]);
  });

  it("maps powershell tool to Bash activity", () => {
    const line = JSON.stringify({
      type: "tool.execution_start",
      data: {
        toolName: "powershell",
        arguments: { command: "npm run build" },
      },
    });

    expect(parseCopilotJsonlLine(line, start, receivedAt)).toEqual([
      { elapsedMs: 4_000, tool: "Bash", detail: "npm run build" },
    ]);
  });

  it("maps powershell grep commands to Grep activity", () => {
    const line = JSON.stringify({
      type: "tool.execution_start",
      data: {
        toolName: "powershell",
        arguments: { command: 'rg -n "pattern" src/' },
      },
    });

    expect(parseCopilotJsonlLine(line, start, receivedAt)).toEqual([
      { elapsedMs: 4_000, tool: "Grep", detail: "pattern" },
    ]);
  });

  it("maps task tool to Agent activity", () => {
    const line = JSON.stringify({
      type: "tool.execution_start",
      data: {
        toolName: "task",
        arguments: {
          agent_type: "explore",
          name: "find-auth",
          description: "Find auth logic",
        },
      },
    });

    expect(parseCopilotJsonlLine(line, start, receivedAt)).toEqual([
      { elapsedMs: 4_000, tool: "Agent", detail: "Find auth logic" },
    ]);
  });

  it("maps read_agent to Agent activity", () => {
    const line = JSON.stringify({
      type: "tool.execution_start",
      data: {
        toolName: "read_agent",
        arguments: { agent_id: "abc-123" },
      },
    });

    expect(parseCopilotJsonlLine(line, start, receivedAt)).toEqual([
      { elapsedMs: 4_000, tool: "Agent" },
    ]);
  });

  it("maps web_search to WebSearch activity", () => {
    const line = JSON.stringify({
      type: "tool.execution_start",
      data: {
        toolName: "web_search",
        arguments: { query: "typescript strict mode" },
      },
    });

    expect(parseCopilotJsonlLine(line, start, receivedAt)).toEqual([
      {
        elapsedMs: 4_000,
        tool: "WebSearch",
        detail: "typescript strict mode",
      },
    ]);
  });

  it("maps web_fetch to WebFetch activity", () => {
    const line = JSON.stringify({
      type: "tool.execution_start",
      data: {
        toolName: "web_fetch",
        arguments: { url: "https://example.com/docs" },
      },
    });

    expect(parseCopilotJsonlLine(line, start, receivedAt)).toEqual([
      {
        elapsedMs: 4_000,
        tool: "WebFetch",
        detail: "https://example.com/docs",
      },
    ]);
  });

  it("maps github-mcp-server-search_code to Search activity", () => {
    const line = JSON.stringify({
      type: "tool.execution_start",
      data: {
        toolName: "github-mcp-server-search_code",
        arguments: { query: "mapCopilotToolCall language:typescript" },
      },
    });

    expect(parseCopilotJsonlLine(line, start, receivedAt)).toEqual([
      {
        elapsedMs: 4_000,
        tool: "Search",
        detail: "mapCopilotToolCall language:typescript",
      },
    ]);
  });

  it("maps github-mcp-server-get_file_contents to Read activity", () => {
    const line = JSON.stringify({
      type: "tool.execution_start",
      data: {
        toolName: "github-mcp-server-get_file_contents",
        arguments: {
          owner: "github",
          repo: "copilot-cli",
          path: "src/index.ts",
        },
      },
    });

    expect(parseCopilotJsonlLine(line, start, receivedAt)).toEqual([
      { elapsedMs: 4_000, tool: "Read", detail: "github/copilot-cli" },
    ]);
  });

  it("drops plumbing tools (report_intent)", () => {
    const line = JSON.stringify({
      type: "tool.execution_start",
      data: {
        toolName: "report_intent",
        arguments: { intent: "Fixing bug" },
      },
    });

    expect(parseCopilotJsonlLine(line, start, receivedAt)).toEqual([]);
  });

  it("drops plumbing tools (store_memory)", () => {
    const line = JSON.stringify({
      type: "tool.execution_start",
      data: {
        toolName: "store_memory",
        arguments: { subject: "test", fact: "test fact" },
      },
    });

    expect(parseCopilotJsonlLine(line, start, receivedAt)).toEqual([]);
  });

  it("uses event timestamp for elapsed time when present", () => {
    const eventTs = "2026-03-29T12:00:02.500Z";
    const line = JSON.stringify({
      type: "tool.execution_start",
      timestamp: eventTs,
      data: {
        toolName: "view",
        arguments: { path: "C:\\source\\file.ts" },
      },
    });

    expect(parseCopilotJsonlLine(line, start, receivedAt)).toEqual([
      { elapsedMs: 2_500, tool: "Read", detail: "file.ts" },
    ]);
  });
});
