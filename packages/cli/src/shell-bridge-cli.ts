#!/usr/bin/env node

import { findTeammatesDir, parseCliArgs } from "./cli-args.js";
import { runShellBridge } from "./shell-bridge.js";

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.showHelp) {
    printBridgeUsage();
    return;
  }

  const teammatesDir = await findTeammatesDir(args.dirOverride);
  if (!teammatesDir) {
    console.error("Could not locate a .teammates directory.");
    process.exitCode = 1;
    return;
  }

  await runShellBridge({
    adapterName: args.adapterName,
    teammatesDir,
    modelOverride: args.modelOverride,
    agentPassthrough: args.agentPassthrough,
  });
}

function printBridgeUsage(): void {
  console.log(
    [
      "@teammates/cli shell bridge",
      "",
      "Usage:",
      "  teammates-shell-bridge <agent> [--model <model>] [--dir <path>]",
      "",
      "Examples:",
      "  teammates-shell-bridge echo",
      "  teammates-shell-bridge codex --dir .teammates",
      "",
      "Transport:",
      "  Reads line-delimited JSON command envelopes from stdin.",
      "  Writes line-delimited JSON responses and events to stdout.",
      "",
      "Use --help to show this message.",
    ].join("\n"),
  );
}

main().catch((error) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(message);
  process.exit(1);
});
