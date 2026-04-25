---
name: BTW Memory Suppression
description: The /btw command is an ephemeral side-question path and must not write daily logs or typed memories.
type: decision
---

# /btw Memory Suppression

## Decision

`/btw` tasks must suppress memory-update instructions. They are ephemeral side questions sent to the coding agent, not normal task work that should append to daily logs or create typed memories.

## Why

- The user explicitly defined `/btw` as "just a raw question/input passed to the coding agent".
- Reusing the normal teammate prompt without adjustment causes accidental memory pollution.
- Reusing `system` semantics would be wrong because `/btw` is still a user-facing task, not maintenance work.

## Implementation Pattern

- Add a dedicated `skipMemoryUpdates` flag on `TaskAssignment` and adapter execute options.
- Thread that flag through orchestrator and adapters into `buildTeammatePrompt()`.
- When the flag is set, emit a `### Memory Updates` section that explicitly says not to update daily logs, typed memories, or `WISDOM.md`.
- Set `skipMemoryUpdates` for `/btw` queue entries in `cli.ts`.
