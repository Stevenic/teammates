---
version: 0.7.0
name: Codex Activity From JSONL Stdout
description: For Codex, live activity should be derived from the `codex exec --json` stdout stream, not the markdown debug log.
type: decision
---
# Codex Activity From JSONL Stdout

## Decision
When the CLI runs Codex, `[show activity]` should be powered by incremental parsing of the live `--json` stdout stream. Do not treat the `.teammates\.tmp\debug\*.md` file as the activity source for Codex; that file is a post-task diagnostic artifact written after completion.

## Why
- Codex does not expose a Claude-style `--debug-file` stream with live tool events.
- `codex exec --json` already emits structured JSONL lifecycle events on stdout.
- The CLI was buffering that stream only for final output parsing, which meant Codex had no real-time activity feed even though the data already existed.

## Implementation Notes
- Parse stdout incrementally by line during process execution.
- Convert Codex tool calls into the existing activity vocabulary so the UI stays adapter-agnostic.
- Infer `Read`/`Grep`/`Glob`/`Bash` from `shell_command` commands and `Edit` from `apply_patch` targets.
- Continue using Claude hook/debug-log watchers for Claude; the source of truth is adapter-specific.
