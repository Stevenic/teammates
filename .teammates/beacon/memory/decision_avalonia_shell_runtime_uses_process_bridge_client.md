---
version: 0.7.2
name: Avalonia shell runtime uses process bridge client
description: Runtime shell state should come from the real Node stdio bridge, not a demo snapshot source.
type: decision
---
# Avalonia shell runtime uses process bridge client

## Decision

At runtime, the Avalonia shell should launch the local `@teammates/cli` shell bridge over stdio and treat that process as the source of truth for shell snapshots and incremental shell events. Demo shell data is allowed only for design-time or explicit demo use, not as the normal app runtime path.

## Why

- The shell structure is already implemented; the next missing capability is live engine-backed state rather than more static UI polish.
- Keeping the Node bridge authoritative preserves existing routing, recall, adapters, handoffs, and local-only behavior.
- A fail-closed disconnected shell is safer than silently showing fake data when the runtime bridge cannot start.

## Apply this

- Resolve the repo-local bridge entrypoint from `packages\cli\dist\shell-bridge-cli.js`.
- Keep the bridge runtime configurable through environment variables for adapter/model overrides.
- Subscribe the shell view model to streamed bridge updates while preserving shell-owned tab selection locally.
- If the bridge is unavailable, expose that explicitly in the TEAM tab and disable composer input.

## Consequence

Future bridge slices should deepen the streamed event model and client-side state reducer instead of reintroducing demo-backed runtime flows.
