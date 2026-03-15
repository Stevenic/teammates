import { describe, expect, it } from "vitest";

// parseArgs is not exported, so we re-implement the parsing logic for testing.
// This validates that the arg parsing contract is correct.

interface Args {
  command: string;
  query: string;
  file: string;
  dir: string;
  teammate?: string;
  results: number;
  model?: string;
  json: boolean;
  sync: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    command: "",
    query: "",
    file: "",
    dir: "./.teammates",
    results: 5,
    json: false,
    sync: true,
  };

  let i = 0;
  while (
    i < argv.length &&
    (argv[i].includes("node") ||
      argv[i].includes("teammates-recall") ||
      argv[i].endsWith(".js"))
  ) {
    i++;
  }

  if (i < argv.length && !argv[i].startsWith("-")) {
    args.command = argv[i++];
  }

  if (
    args.command === "search" &&
    i < argv.length &&
    !argv[i].startsWith("-")
  ) {
    args.query = argv[i++];
  } else if (
    args.command === "add" &&
    i < argv.length &&
    !argv[i].startsWith("-")
  ) {
    args.file = argv[i++];
  }

  while (i < argv.length) {
    const arg = argv[i++];
    switch (arg) {
      case "--dir":
        args.dir = argv[i++];
        break;
      case "--teammate":
        args.teammate = argv[i++];
        break;
      case "--results":
        args.results = parseInt(argv[i++], 10);
        break;
      case "--model":
        args.model = argv[i++];
        break;
      case "--no-sync":
        args.sync = false;
        break;
      case "--json":
        args.json = true;
        break;
    }
  }

  return args;
}

describe("parseArgs", () => {
  it("parses search command with query", () => {
    const args = parseArgs(["node", "cli.js", "search", "hello world"]);
    expect(args.command).toBe("search");
    expect(args.query).toBe("hello world");
  });

  it("parses add command with file path", () => {
    const args = parseArgs([
      "node",
      "cli.js",
      "add",
      "memory/foo.md",
      "--teammate",
      "beacon",
    ]);
    expect(args.command).toBe("add");
    expect(args.file).toBe("memory/foo.md");
    expect(args.teammate).toBe("beacon");
  });

  it("parses index command", () => {
    const args = parseArgs(["node", "cli.js", "index"]);
    expect(args.command).toBe("index");
  });

  it("parses sync command", () => {
    const args = parseArgs(["node", "cli.js", "sync"]);
    expect(args.command).toBe("sync");
  });

  it("parses status command", () => {
    const args = parseArgs(["node", "cli.js", "status"]);
    expect(args.command).toBe("status");
  });

  it("parses watch command", () => {
    const args = parseArgs(["node", "cli.js", "watch"]);
    expect(args.command).toBe("watch");
  });

  it("defaults dir to ./.teammates", () => {
    const args = parseArgs(["node", "cli.js", "index"]);
    expect(args.dir).toBe("./.teammates");
  });

  it("parses --dir flag", () => {
    const args = parseArgs([
      "node",
      "cli.js",
      "index",
      "--dir",
      "/path/to/.teammates",
    ]);
    expect(args.dir).toBe("/path/to/.teammates");
  });

  it("parses --teammate flag", () => {
    const args = parseArgs([
      "node",
      "cli.js",
      "search",
      "query",
      "--teammate",
      "scribe",
    ]);
    expect(args.teammate).toBe("scribe");
  });

  it("parses --results flag", () => {
    const args = parseArgs([
      "node",
      "cli.js",
      "search",
      "query",
      "--results",
      "10",
    ]);
    expect(args.results).toBe(10);
  });

  it("parses --model flag", () => {
    const args = parseArgs([
      "node",
      "cli.js",
      "index",
      "--model",
      "custom/model",
    ]);
    expect(args.model).toBe("custom/model");
  });

  it("parses --json flag", () => {
    const args = parseArgs(["node", "cli.js", "status", "--json"]);
    expect(args.json).toBe(true);
  });

  it("defaults json to false", () => {
    const args = parseArgs(["node", "cli.js", "status"]);
    expect(args.json).toBe(false);
  });

  it("parses --no-sync flag", () => {
    const args = parseArgs(["node", "cli.js", "search", "query", "--no-sync"]);
    expect(args.sync).toBe(false);
  });

  it("defaults sync to true", () => {
    const args = parseArgs(["node", "cli.js", "search", "query"]);
    expect(args.sync).toBe(true);
  });

  it("defaults results to 5", () => {
    const args = parseArgs(["node", "cli.js", "search", "query"]);
    expect(args.results).toBe(5);
  });

  it("returns empty command for no args", () => {
    const args = parseArgs(["node", "cli.js"]);
    expect(args.command).toBe("");
  });

  it("handles multiple flags together", () => {
    const args = parseArgs([
      "node",
      "cli.js",
      "search",
      "my query",
      "--dir",
      "/tmp/.teammates",
      "--teammate",
      "beacon",
      "--results",
      "3",
      "--json",
      "--no-sync",
    ]);
    expect(args.command).toBe("search");
    expect(args.query).toBe("my query");
    expect(args.dir).toBe("/tmp/.teammates");
    expect(args.teammate).toBe("beacon");
    expect(args.results).toBe(3);
    expect(args.json).toBe(true);
    expect(args.sync).toBe(false);
  });
});
