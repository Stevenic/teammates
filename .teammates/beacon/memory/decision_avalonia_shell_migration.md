---
version: 0.7.2
name: avalonia-shell-migration
description: Treat the Avalonia app as a composable shell over the existing Node teammates engine, with layout metrics driven by styles/settings.
type: decision
---
# Avalonia shell migration

## Decision

For the Teammates UI migration, keep the current Node/TypeScript engine (`@teammates/cli`, `@teammates/recall`, adapters, orchestration, handoffs, memory flows) with minimal change and introduce Avalonia as a new shell over a transport boundary.

## Why

- Preserves current coding functionality and zero-cloud local behavior.
- Reduces migration risk by avoiding a simultaneous engine rewrite.
- Lets Avalonia own structured UI while terminal controls remain available for PTY-heavy workflows.
- Keeps Consolonia relevant for TUI targets by moving spacing/layout rhythm into shared settings or style tokens instead of hard-coded margins.

## Implementation guidance

- Use `CommunityToolkit.Mvvm` and compiled bindings.
- Prefer small composable controls and view models over monolithic window logic.
- Separate shell regions such as transcript, input, roster, queue, status, action bar, and terminal panes.
- Keep shell-specific state in Avalonia and orchestration/task state in the Node engine.
- Put margins, padding, spacing scale, and similar layout constants in styles/settings so they can be themed or mirrored across Avalonia and Consolonia shells.

## Consequence

The first concrete deliverable should be a transport contract and shell composition plan, not a direct port of `cli.ts` rendering logic into Avalonia.
