---
name: codex_activity_requires_begin_events
description: Codex live activity needs begin-event parsing, not only completed tool-call events.
type: decision
---

# Codex activity requires begin-event parsing

## Context
The Codex adapter already runs `codex exec --json`, but live activity can still appear blank if the parser only accepts `item.completed` tool events.

## Decision
Treat Codex live activity as a multi-shape JSONL stream. Parse live begin events such as `exec_command_begin`, `patch_apply_begin`, `web_search_begin`, and `item.started`, and also accept `response.output_item.added` / `response.output_item.done` tool-call items. Tool arguments may arrive as objects or as stringified JSON under fields like `arguments`, `input`, `payload`, or `parameters`.

## Why
- The installed Codex binary exposes multiple live event shapes for progress, not just one tool-call envelope.
- Waiting only for `item.completed` is too narrow and can produce no visible activity during work.
- Accepting both start and completed variants requires a small de-dup window at the adapter boundary.
- The adapter must flush the final buffered stdout line on process close or the last activity event can be dropped.

## Implementation note
`packages/cli/src/activity-watcher.ts` owns the event-shape mapping. `packages/cli/src/adapters/cli-proxy.ts` should de-dup near-identical Codex events emitted close together and parse any buffered trailing JSON line before cleanup on close.
