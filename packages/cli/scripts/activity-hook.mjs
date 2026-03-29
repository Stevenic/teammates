#!/usr/bin/env node
/**
 * PostToolUse hook for @teammates/cli activity tracking.
 *
 * Claude Code fires this after every tool call. It receives JSON on stdin
 * with { tool_name, tool_input, ... }. We extract the relevant detail
 * (file path, command, pattern) and append a one-line entry to the
 * activity log file specified by TEAMMATES_ACTIVITY_LOG.
 *
 * No-op when TEAMMATES_ACTIVITY_LOG is not set, so it's safe to leave
 * installed globally.
 */

import { appendFileSync } from "node:fs";
import { basename } from "node:path";

const logFile = process.env.TEAMMATES_ACTIVITY_LOG;
if (!logFile) process.exit(0);

// Read JSON from stdin
let raw = "";
for await (const chunk of process.stdin) raw += chunk;
if (!raw) process.exit(0);

try {
  const data = JSON.parse(raw);
  const tool = data.tool_name;
  const input = data.tool_input || {};

  let detail = "";
  switch (tool) {
    case "Read":
      detail = input.file_path ? basename(input.file_path) : "";
      break;
    case "Edit":
    case "Write":
      detail = input.file_path ? basename(input.file_path) : "";
      break;
    case "Bash":
      // First 100 chars of command, single line
      detail = (input.command || "").split("\n")[0].slice(0, 100);
      break;
    case "Grep":
      detail = input.pattern ? `/${input.pattern.slice(0, 50)}/` : "";
      break;
    case "Glob":
      detail = input.pattern || "";
      break;
    case "Agent":
      detail = input.description || input.prompt?.slice(0, 60) || "";
      break;
    case "WebFetch":
    case "WebSearch":
      detail = input.url || input.query || "";
      break;
    default:
      break;
  }

  const line = `${new Date().toISOString()} ${tool} ${detail}\n`;
  appendFileSync(logFile, line);
} catch {
  // Never break the agent — silently ignore parse/write errors
}
