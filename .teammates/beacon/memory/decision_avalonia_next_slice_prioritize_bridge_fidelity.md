---
version: 0.7.2
name: avalonia-next-slice-prioritize-bridge-fidelity
description: Prioritize richer shell bridge events and incremental state over more Avalonia shell polish.
type: decision
---

# Avalonia next slice prioritizes bridge fidelity

## Decision

After wiring the real stdio bridge, the next implementation slice should deepen the shell bridge contract and Avalonia state handling instead of adding more shell chrome.

## Why

- The bridge already exists and launches at runtime, so the highest remaining product risk is missing engine state, not missing UI structure.
- `packages/cli/src/shell-types.ts` already declares a broader command and event surface than `packages/cli/src/shell-bridge.ts` currently implements.
- `src/TeamMates/TeamMates/ViewModels/MainViewModel.cs` still rebuilds tabs and feed collections from snapshots, which is acceptable for the first slice but the wrong foundation for live queue, approval, and terminal behavior.

## Apply this

- First add real payloads and emissions for queue updates, approvals, richer task progress/output, and terminal session lifecycle in the Node bridge.
- Then teach `ProcessEngineShellClient` and the Avalonia view-model layer to reduce those events into local state instead of clearing and recreating the whole shell on each refresh.
- Defer additional host-specific shell polish until the shell is reflecting real engine behavior with enough fidelity to validate the UX.

## Consequence

The next meaningful shell features should be driven by real engine state, not by more static layout work. UI refinement should follow once the bridge can represent the workflows the shell needs to render.
