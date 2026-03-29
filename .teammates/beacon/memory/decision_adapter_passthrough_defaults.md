---
version: 0.7.0
name: adapter-passthrough-defaults
description: Keep agent CLI passthrough in adapter argv construction and use explicit Codex defaults instead of bundled aliases.
type: decision
---

# Adapter passthrough defaults

## Decision
Keep additional agent CLI options as adapter-level argv passthrough (`agentPassthrough` -> `extraFlags`) and express Codex defaults with explicit flags instead of `--full-auto`.

## Why
- The CLI already preserves unknown arguments after the adapter name, so the missing behavior was in preset defaults, not in parsing or orchestration.
- `--full-auto` hides two separate behaviors and does not match the desired non-interactive Codex defaults.
- Explicit `-s danger-full-access` makes the adapter contract obvious and keeps later user-supplied passthrough flags easy to reason about.
- Codex `exec` does NOT have an `-a` (approval) flag — only `-s` (sandbox). The earlier `-a never` was invalid and caused `unexpected argument '-a'` errors.

## Current behavior
- Claude continues to run in print mode with `-p` and accepts additional passthrough flags after the adapter name.
- Codex now defaults to `codex exec - -s danger-full-access --ephemeral --json`.
- Teammate-specific sandbox config still overrides the generic Codex fallback sandbox before any user passthrough flags are appended.

## Verification notes
- Verified available options by running `claude --help`, `codex --help`, and `codex exec --help`.
- `packages/cli` TypeScript build passed after the change.
- Vitest could not be run in this sandbox because Vite startup failed with `spawn EPERM`.
