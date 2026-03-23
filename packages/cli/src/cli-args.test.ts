import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findTeammatesDir, parseCliArgs, PKG_VERSION, printUsage } from "./cli-args.js";

describe("parseCliArgs", () => {
  it("returns defaults with no arguments", () => {
    const result = parseCliArgs([]);
    expect(result).toEqual({
      showHelp: false,
      modelOverride: undefined,
      dirOverride: undefined,
      adapterName: "echo",
      agentPassthrough: [],
    });
  });

  it("parses --help flag", () => {
    const result = parseCliArgs(["--help"]);
    expect(result.showHelp).toBe(true);
  });

  it("parses --model option with value", () => {
    const result = parseCliArgs(["--model", "gpt-4"]);
    expect(result.modelOverride).toBe("gpt-4");
  });

  it("parses --dir option with value", () => {
    const result = parseCliArgs(["--dir", "/custom/path"]);
    expect(result.dirOverride).toBe("/custom/path");
  });

  it("extracts adapter name as first positional argument", () => {
    const result = parseCliArgs(["claude"]);
    expect(result.adapterName).toBe("claude");
  });

  it("passes remaining args as agentPassthrough", () => {
    const result = parseCliArgs(["claude", "--verbose", "--debug"]);
    expect(result.adapterName).toBe("claude");
    expect(result.agentPassthrough).toEqual(["--verbose", "--debug"]);
  });

  it("handles all options together", () => {
    const result = parseCliArgs([
      "--help",
      "--model",
      "sonnet",
      "--dir",
      "/tmp/tm",
      "codex",
      "--extra",
    ]);
    expect(result.showHelp).toBe(true);
    expect(result.modelOverride).toBe("sonnet");
    expect(result.dirOverride).toBe("/tmp/tm");
    expect(result.adapterName).toBe("codex");
    expect(result.agentPassthrough).toEqual(["--extra"]);
  });

  it("does not consume --model when no value follows", () => {
    const result = parseCliArgs(["--model"]);
    // getOption finds --model but no value after it, so it's left in args
    // args.shift() then picks it up as the adapter name
    expect(result.modelOverride).toBeUndefined();
    expect(result.adapterName).toBe("--model");
  });

  it("does not treat --help value as an option value", () => {
    const result = parseCliArgs(["--help", "claude"]);
    expect(result.showHelp).toBe(true);
    expect(result.adapterName).toBe("claude");
  });
});

// ── PKG_VERSION ────────────────────────────────────────────────────

describe("PKG_VERSION", () => {
  it("is a valid semver-like string", () => {
    expect(PKG_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});

// ── findTeammatesDir ───────────────────────────────────────────────

describe("findTeammatesDir", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `cli-args-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("returns dirOverride when provided", async () => {
    const result = await findTeammatesDir("/some/custom/dir");
    expect(result).toContain("some");
  });

  it("returns .teammates dir when it exists under cwd", async () => {
    const tmDir = join(testDir, ".teammates");
    await mkdir(tmDir, { recursive: true });

    // Mock process.cwd to return our test dir
    const origCwd = process.cwd;
    process.cwd = () => testDir;
    try {
      const result = await findTeammatesDir(undefined);
      expect(result).toBe(tmDir);
    } finally {
      process.cwd = origCwd;
    }
  });

  it("returns null when no .teammates dir exists", async () => {
    const origCwd = process.cwd;
    process.cwd = () => testDir;
    try {
      const result = await findTeammatesDir(undefined);
      expect(result).toBeNull();
    } finally {
      process.cwd = origCwd;
    }
  });
});

// ── printUsage ────────────────────────────────────────────────────

describe("printUsage", () => {
  it("prints usage text to console", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    printUsage();
    expect(spy).toHaveBeenCalled();
    const output = spy.mock.calls[0][0] as string;
    expect(output).toContain("teammates");
    expect(output).toContain("--model");
    expect(output).toContain("--dir");
    spy.mockRestore();
  });
});
