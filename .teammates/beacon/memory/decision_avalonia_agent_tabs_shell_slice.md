---
version: 0.7.2
name: avalonia_agent_tabs_shell_slice
description: First Avalonia shell slice uses explicit target-based routing and structured startup snapshots for TEAM plus agent tabs.
type: decision
---

# Avalonia agent tabs shell slice

## Decision

The first Avalonia shell interaction slice should model the UI around a shell-owned `activeTabId` with structured snapshot data for `TEAM` plus one tab per agent, and the shared composer must send input using an explicit `targetId`.

## Why

- The spec requires tab selection to be the routing rule, not free-text inference.
- Structured snapshot DTOs let the shell rebuild TEAM and per-agent views on startup or reconnect without scraping transcript text.
- Keeping the transport behind an `IEngineShellClient` seam preserves the boundary where Node/TypeScript remains authoritative and Avalonia stays a shell.

## Implementation guidance

- Keep `TEAM` as the first tab and treat its feed as the aggregate view.
- Preserve `activeTabId` locally in the shell and fall back to `team` when the selected agent is unavailable.
- Model tab metadata separately from feed items so unread counts, activity state, and composer availability are machine-readable.
- Route shared composer submissions only through `send_input(targetId, text)`.
- Start with a local/demo shell client if needed, but shape it like the future bridge contract.

## Consequence

The next step is to swap the demo shell client for a bridge-backed implementation that streams snapshot and update events from the Node engine.
