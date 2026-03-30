---
version: 0.7.2
name: shell-bridge-v1-slice
description: First Node-side shell bridge slice for Avalonia/Consolonia shells
type: decision
---

# Shell bridge v1 slice

## Decision

Implement the first Avalonia shell bridge as a thin stdio entrypoint inside `@teammates/cli` with bridge-local snapshot/feed state and versioned JSON envelopes, while leaving the existing Node orchestrator authoritative for routing and task execution.

## Why

- The Avalonia shell already has DTOs for tab/feed snapshot state and needs a concrete transport peer next.
- Reusing the existing orchestrator minimizes migration risk and keeps recall, adapters, handoffs, and memory flows in the current Node engine.
- A bridge-local controller can shape shell-facing events and snapshots without contaminating the main TUI code path.

## Implementation guidance

- Keep transport v1 line-delimited JSON over `stdio`.
- Start with `initialize_shell`, `get_shell_state`, `send_input`, and `ping`.
- Model shell targets explicitly as `team` and `agent:<name>`.
- Mirror agent-scoped feed items into the TEAM feed so the shell can render an aggregate view without scraping text.
- Return explicit `unsupported_command` errors for the remaining spec commands until richer slices land.

## Consequence

The next implementation step is the Avalonia-side process client plus richer bridge events for queue, approvals, roster, and terminal sessions.
