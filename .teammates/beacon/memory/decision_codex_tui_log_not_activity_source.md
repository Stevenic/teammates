---
version: 0.7.0
name: Codex TUI Log Not Activity Source
description: `codex-tui.log` exposes Codex runtime telemetry, not the detailed tool activity needed for the CLI's `[show activity]` stream.
type: decision
---
# Codex TUI Log Not Activity Source

## Decision
Do not use `C:\Users\stevenickman\.codex\log\codex-tui.log` as the primary source for Codex `[show activity]`.

## Why
- The log contains coarse lifecycle/runtime telemetry such as `thread_spawn`, `session_init`, model-cache checks, websocket startup, shell snapshot warnings, and shutdown.
- It does not contain the tool-level events the CLI needs for lines like `Exploring (...)`, `Edit foo.ts`, or `Write bar.md`.
- Grep against the log found no `tool_call`, `item.completed`, `shell_command`, or `apply_patch` entries during the inspected session.

## Use Instead
- Primary detailed source: stream `codex exec --json` stdout and parse `item.completed` tool-call events.
- Optional secondary source: use `codex-tui.log` only for coarse lifecycle/error status if needed.

## Implication
If richer Codex activity is needed beyond the current stdout JSONL mapping, the solution must come from additional Codex event types or a dedicated hook, not from `codex-tui.log`.
