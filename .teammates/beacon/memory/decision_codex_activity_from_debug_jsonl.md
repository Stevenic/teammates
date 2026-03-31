---
name: codex_activity_from_debug_jsonl
description: Codex live activity should be tailed from the paired debug JSONL file and must parse command_execution items, not just older tool_call shapes.
type: decision
---

# Codex activity comes from the paired debug JSONL file

## Decision
Use the paired `.teammates\.tmp\debug\<teammate>-<timestamp>.md` JSONL file as the live activity source for Codex runs, and parse `item.started` / `item.completed` entries with `item.type: command_execution` and `item.type: file_change` in addition to older tool-call style events.

## Why
The current Codex logs in this repo are emitting live shell work as `command_execution` items and edit/write phases as `file_change` items, not primarily as `tool_call` items. Parsing only the older shapes leaves `[show activity]` empty or reduced to a single `Exploring` line even though the debug file is filling in real time.

## Consequences
- Codex activity now follows a log-watcher model similar to Claude.
- Per-task activity watchers must read from byte `0` on startup, not from the
  current file size, otherwise early commands can be lost before the watcher
  attaches.
- The parser must unwrap PowerShell `-Command "..."` wrappers before classifying `Read` / `Grep` / `Glob` / `Bash`.
- The parser must map `file_change` batches into `Edit` / `Write` activity so Codex runs show visible implementation phases instead of only research.
- The watcher needs trailing-line buffering so partial JSONL appends are not dropped.
- Collapsing should preserve a single research event as-is; turning one `Read`
  into a generic `Exploring (1× Read)` line hides useful evidence that the
  renderer is working.
