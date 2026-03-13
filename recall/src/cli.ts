#!/usr/bin/env node

import * as path from "node:path";
import * as fs from "node:fs/promises";
import { Indexer } from "./indexer.js";
import { search } from "./search.js";

const HELP = `
teammates-recall — Semantic memory search for teammates

Usage:
  teammates-recall index   [options]              Full rebuild of all indexes
  teammates-recall sync    [options]              Sync new/changed files into indexes
  teammates-recall add     <file> [options]       Add a single file to a teammate's index
  teammates-recall search  <query> [options]      Search teammate memories (auto-syncs)
  teammates-recall status  [options]              Show index status

Options:
  --dir <path>         Path to .teammates directory (default: ./.teammates)
  --teammate <name>    Limit to a specific teammate
  --results <n>        Max results (default: 5)
  --model <name>       Embedding model (default: Xenova/all-MiniLM-L6-v2)
  --no-sync            Skip auto-sync before search
  --json               Output as JSON
  --help               Show this help
`.trim();

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
  // Skip node and script path
  while (i < argv.length && (argv[i].includes("node") || argv[i].includes("teammates-recall") || argv[i].endsWith(".js"))) {
    i++;
  }

  if (i < argv.length && !argv[i].startsWith("-")) {
    args.command = argv[i++];
  }

  // For search, next non-flag arg is the query; for add, it's the file path
  if (args.command === "search" && i < argv.length && !argv[i].startsWith("-")) {
    args.query = argv[i++];
  } else if (args.command === "add" && i < argv.length && !argv[i].startsWith("-")) {
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
      case "--help":
      case "-h":
        console.log(HELP);
        process.exit(0);
    }
  }

  return args;
}

async function resolveTeammatesDir(dir: string): Promise<string> {
  const resolved = path.resolve(dir);
  try {
    await fs.access(resolved);
    return resolved;
  } catch {
    console.error(`Error: .teammates directory not found at ${resolved}`);
    process.exit(1);
  }
}

async function cmdIndex(args: Args): Promise<void> {
  const teammatesDir = await resolveTeammatesDir(args.dir);
  const indexer = new Indexer({ teammatesDir, model: args.model });

  if (args.teammate) {
    console.error(`Indexing ${args.teammate}...`);
    const count = await indexer.indexTeammate(args.teammate);
    if (args.json) {
      console.log(JSON.stringify({ teammate: args.teammate, files: count }));
    } else {
      console.log(`Indexed ${count} files for ${args.teammate}`);
    }
  } else {
    console.error("Indexing all teammates...");
    const results = await indexer.indexAll();
    if (args.json) {
      const obj = Object.fromEntries(results);
      console.log(JSON.stringify(obj));
    } else {
      for (const [teammate, count] of results) {
        console.log(`  ${teammate}: ${count} files`);
      }
      console.log(`Done.`);
    }
  }
}

async function cmdSync(args: Args): Promise<void> {
  const teammatesDir = await resolveTeammatesDir(args.dir);
  const indexer = new Indexer({ teammatesDir, model: args.model });

  if (args.teammate) {
    console.error(`Syncing ${args.teammate}...`);
    const count = await indexer.syncTeammate(args.teammate);
    if (args.json) {
      console.log(JSON.stringify({ teammate: args.teammate, files: count }));
    } else {
      console.log(`Synced ${count} files for ${args.teammate}`);
    }
  } else {
    console.error("Syncing all teammates...");
    const results = await indexer.syncAll();
    if (args.json) {
      const obj = Object.fromEntries(results);
      console.log(JSON.stringify(obj));
    } else {
      for (const [teammate, count] of results) {
        console.log(`  ${teammate}: ${count} files`);
      }
      console.log(`Done.`);
    }
  }
}

async function cmdAdd(args: Args): Promise<void> {
  if (!args.file) {
    console.error("Error: add requires a file path argument");
    console.error("Usage: teammates-recall add <file> --teammate <name>");
    process.exit(1);
  }
  if (!args.teammate) {
    console.error("Error: add requires --teammate <name>");
    process.exit(1);
  }

  const teammatesDir = await resolveTeammatesDir(args.dir);
  const indexer = new Indexer({ teammatesDir, model: args.model });
  await indexer.upsertFile(args.teammate, args.file);

  if (args.json) {
    console.log(JSON.stringify({ teammate: args.teammate, file: args.file, status: "ok" }));
  } else {
    console.log(`Added ${args.file} to ${args.teammate}'s index`);
  }
}

async function cmdSearch(args: Args): Promise<void> {
  if (!args.query) {
    console.error("Error: search requires a query argument");
    console.error("Usage: teammates-recall search <query> [options]");
    process.exit(1);
  }

  const teammatesDir = await resolveTeammatesDir(args.dir);
  const results = await search(args.query, {
    teammatesDir,
    teammate: args.teammate,
    maxResults: args.results,
    model: args.model,
    skipSync: !args.sync,
  });

  if (args.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    if (results.length === 0) {
      console.log("No results found.");
      return;
    }
    for (const result of results) {
      console.log(`--- ${result.teammate} | ${result.uri} (score: ${result.score.toFixed(3)}) ---`);
      console.log(result.text);
      console.log();
    }
  }
}

async function cmdStatus(args: Args): Promise<void> {
  const teammatesDir = await resolveTeammatesDir(args.dir);
  const indexer = new Indexer({ teammatesDir, model: args.model });
  const teammates = await indexer.discoverTeammates();

  const status: Record<string, { memoryFiles: number; indexed: boolean }> = {};

  for (const teammate of teammates) {
    const { files } = await indexer.collectFiles(teammate);
    const indexPath = indexer.indexPath(teammate);
    let indexed = false;
    try {
      await fs.access(indexPath);
      indexed = true;
    } catch {
      // Not indexed
    }
    status[teammate] = { memoryFiles: files.length, indexed };
  }

  if (args.json) {
    console.log(JSON.stringify(status, null, 2));
  } else {
    for (const [teammate, info] of Object.entries(status)) {
      const tag = info.indexed ? "indexed" : "not indexed";
      console.log(`  ${teammate}: ${info.memoryFiles} memory files (${tag})`);
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  switch (args.command) {
    case "index":
      await cmdIndex(args);
      break;
    case "sync":
      await cmdSync(args);
      break;
    case "add":
      await cmdAdd(args);
      break;
    case "search":
      await cmdSearch(args);
      break;
    case "status":
      await cmdStatus(args);
      break;
    default:
      console.log(HELP);
      process.exit(args.command ? 1 : 0);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
