import { describe, expect, it } from "vitest";
import { CLAUDE_PRESET, CODEX_PRESET, COPILOT_PRESET } from "./presets.js";

describe("CLAUDE_PRESET", () => {
  it("uses print mode and supports model/debug overrides", () => {
    const args = CLAUDE_PRESET.buildArgs(
      {
        promptFile: "prompt.md",
        prompt: "hello",
        debugFile: "debug.log",
      },
      {
        name: "beacon",
        type: "ai",
        role: "Software Engineer",
        soul: "",
        goals: "",
        wisdom: "",
        dailyLogs: [],
        weeklyLogs: [],
        ownership: { primary: [], secondary: [] },
        routingKeywords: [],
      },
      {
        preset: "claude",
        model: "sonnet",
      },
    );

    expect(args).toEqual([
      "-p",
      "--verbose",
      "--dangerously-skip-permissions",
      "--model",
      "sonnet",
      "--debug-file",
      "debug.log",
    ]);
  });
});

describe("CODEX_PRESET", () => {
  it("uses explicit non-interactive defaults for approval and sandbox", () => {
    const args = CODEX_PRESET.buildArgs(
      {
        promptFile: "prompt.md",
        prompt: "hello",
      },
      {
        name: "beacon",
        type: "ai",
        role: "Software Engineer",
        soul: "",
        goals: "",
        wisdom: "",
        dailyLogs: [],
        weeklyLogs: [],
        ownership: { primary: [], secondary: [] },
        routingKeywords: [],
      },
      {
        preset: "codex",
      },
    );

    expect(args).toEqual([
      "exec",
      "-",
      "-s",
      "danger-full-access",
      "--ephemeral",
      "--json",
    ]);
  });

  it("respects model override", () => {
    const args = CODEX_PRESET.buildArgs(
      { promptFile: "prompt.md", prompt: "hello" },
      {
        name: "beacon",
        type: "ai",
        role: "Software Engineer",
        soul: "",
        goals: "",
        wisdom: "",
        dailyLogs: [],
        weeklyLogs: [],
        ownership: { primary: [], secondary: [] },
        routingKeywords: [],
      },
      { preset: "codex", model: "o3" },
    );

    expect(args).toContain("-m");
    expect(args).toContain("o3");
  });

  it("prefers teammate sandbox over the built-in default", () => {
    const args = CODEX_PRESET.buildArgs(
      {
        promptFile: "prompt.md",
        prompt: "hello",
      },
      {
        name: "beacon",
        type: "ai",
        role: "Software Engineer",
        soul: "",
        goals: "",
        wisdom: "",
        sandbox: "workspace-write",
        dailyLogs: [],
        weeklyLogs: [],
        ownership: { primary: [], secondary: [] },
        routingKeywords: [],
      },
      {
        preset: "codex",
      },
    );

    expect(args).toContain("-s");
    expect(args).toContain("workspace-write");
  });
});

describe("COPILOT_PRESET", () => {
  it("uses stdin prompt with --allow-all and silent mode", () => {
    const args = COPILOT_PRESET.buildArgs(
      { promptFile: "prompt.md", prompt: "hello" },
      {
        name: "beacon",
        type: "ai",
        role: "Software Engineer",
        soul: "",
        goals: "",
        wisdom: "",
        dailyLogs: [],
        weeklyLogs: [],
        ownership: { primary: [], secondary: [] },
        routingKeywords: [],
      },
      { preset: "copilot" },
    );

    expect(args).toEqual(["-p", "-", "--allow-all", "-s"]);
    expect(COPILOT_PRESET.stdinPrompt).toBe(true);
  });

  it("includes model override when provided", () => {
    const args = COPILOT_PRESET.buildArgs(
      { promptFile: "prompt.md", prompt: "hello" },
      {
        name: "beacon",
        type: "ai",
        role: "Software Engineer",
        soul: "",
        goals: "",
        wisdom: "",
        dailyLogs: [],
        weeklyLogs: [],
        ownership: { primary: [], secondary: [] },
        routingKeywords: [],
      },
      { preset: "copilot", model: "gpt-5.2" },
    );

    expect(args).toContain("--model");
    expect(args).toContain("gpt-5.2");
  });
});
