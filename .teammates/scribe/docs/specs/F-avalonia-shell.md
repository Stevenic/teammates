# F — Avalonia Shell Over Node Engine

**Status:** Draft
**Owner:** Scribe (spec) → Beacon (implementation)
**Date:** 2026-03-30
**Implements:** Avalonia/Consolonia shell migration while preserving the existing Node/TypeScript teammates engine

---

## Summary

Port the current JavaScript UI into a new Avalonia shell without rewriting the teammates engine. The new shell must treat the existing Node/TypeScript stack as the system of record for task execution, routing, handoffs, memory, recall, and coding workflows.

The migration is a **shell replacement**, not an orchestration rewrite:

- Keep `@teammates/cli`, `@teammates/recall`, adapters, task routing, handoffs, memory flows, and coding behaviors in Node/TypeScript with minimal change.
- Add a thin bridge process and a versioned JSON transport between the shell and the engine.
- Build the new UI as composable Avalonia controls and view models using `CommunityToolkit.Mvvm` and compiled bindings.
- Keep spacing, margins, padding, and layout rhythm token-driven so the same conceptual layout system can map to Avalonia and Consolonia.
- Use `Iciclecreek.Avalonia.Terminal` only for PTY-heavy surfaces, not as the primary structured UI.

This spec is written against the current solution shape in [src/TeamMates.slnx](/s:/github/teammates/src/TeamMates.slnx):

- Shared UI project: [src/TeamMates/TeamMates/TeamMates.csproj](/s:/github/teammates/src/TeamMates/TeamMates/TeamMates.csproj)
- Desktop head: [src/TeamMates/TeamMates.Desktop/TeamMates.Desktop.csproj](/s:/github/teammates/src/TeamMates/TeamMates.Desktop/TeamMates.Desktop.csproj)
- Console/TUI head: [src/TeamMates/Teammates.Console/Teammates.Console.csproj](/s:/github/teammates/src/TeamMates/Teammates.Console/Teammates.Console.csproj)
- Mobile heads: Android and iOS

---

## Goals

1. Preserve existing teammates coding functionality while replacing the current UI shell.
2. Minimize changes to the Node/TypeScript engine during the first migration waves.
3. Define a stable, explicit shell-to-engine contract before porting substantial UI behavior.
4. Use Avalonia MVVM best practices: compiled bindings, `CommunityToolkit.Mvvm`, composable controls, and thin code-behind.
5. Keep layout primitives style-driven and token-based so Avalonia and Consolonia can share the same conceptual spacing system.
6. Support a hybrid shell where structured UX is native and terminal-heavy workflows stay terminal-native.
7. Make the first shipped slice small enough to verify parity without a full application rewrite.

## Non-Goals

1. Rewriting the teammates engine from TypeScript to C#.
2. Moving routing, memory, recall, handoffs, adapter execution, or orchestration logic into Avalonia view models.
3. Building a monolithic `MainWindow` with all behavior embedded in one view and one view model.
4. Using the terminal control as the primary rendering surface for transcript, queue, approvals, roster, or status.
5. Achieving full cross-platform shell parity in one phase.
6. Designing a new product model for teammates; this migration preserves existing behavior first.

---

## Architecture Decision

**Decision:** Avalonia is a shell. Node/TypeScript remains the engine.

This boundary is the anti-regression move. The shell owns presentation and local interaction state. The engine owns domain behavior and long-running task execution.

If the team later decides to move engine responsibilities into .NET, that should be a separate spec after the shell contract is proven stable in production.

---

## Ownership Boundary

### Engine Owns

The existing Node/TypeScript engine remains authoritative for:

- teammate routing and task assignment
- agent spawning and lifecycle
- memory injection and continuity rules
- recall indexing and lookup
- handoffs and approvals
- slash-command behavior and task semantics
- adapter invocation and streaming task output
- debug/event generation for task progress
- persistence rules for sessions, queues, and task state

### Shell Owns

The Avalonia/Consolonia shell owns:

- windows, panes, tabs, docking, and shell composition
- view models and UI interaction state
- transcript rendering and virtualized UI presentation
- input capture, command entry, keybindings, and local UX affordances
- theme selection and style resources
- spacing/layout tokens and shell-level visual rhythm
- terminal-host lifetime and placement inside the shell
- local shell preferences such as pane visibility, sizing, active tab, and layout presets

### Shared But Contract-Driven

These concepts cross the boundary and therefore require explicit transport contracts:

- task lifecycle
- task queue state
- transcript/feed items
- approvals and handoff requests
- teammate roster and availability
- progress and diagnostics
- terminal session requests
- engine/service health
- settings exposed by the engine

---

## Solution Shape

### Current .NET Solution

The solution already has the right top-level separation for this migration:

- `TeamMates` shared UI/application project
- `TeamMates.Desktop` desktop head
- `Teammates.Console` TUI head using Consolonia
- `TeamMates.Android` mobile head
- `TeamMates.iOS` mobile head

### Required High-Level Runtime Shape

```
+---------------------------------------------------------------+
| Avalonia / Consolonia Shell                                   |
|                                                               |
|  Transcript  Queue  Roster  Approvals  Status  Terminal Host  |
|       |         |      |         |         |         |         |
|       +---------+------+------+---------+--+---------+         |
|                             |                                  |
|                    Shell ViewModels                            |
+-----------------------------|----------------------------------+
                              |
                   versioned JSON commands/events
                              |
+-----------------------------v----------------------------------+
| Thin Bridge Process / Engine Client                            |
| - spawn/connect to Node engine                                 |
| - serialize commands                                            |
| - deserialize events                                             |
| - reconnect / heartbeat / correlation                           |
+-----------------------------|----------------------------------+
                              |
+-----------------------------v----------------------------------+
| Node / TypeScript Engine                                        |
| @teammates/cli, recall, adapters, routing, handoffs, memory     |
+---------------------------------------------------------------+
```

### Bridge Responsibility

The bridge should stay thin. It is not a second orchestrator. Its job is:

- start or connect to the engine process
- send commands to the engine
- receive streamed events from the engine
- correlate request/response pairs
- surface transport failures and engine health state
- translate shell cancellation into engine interrupts

It should not:

- re-implement queue logic
- interpret task routing rules
- perform memory assembly
- make domain decisions on behalf of the engine

---

## Transport Contract

## Design Principles

1. All shell-engine communication is JSON.
2. Commands and events use versioned envelopes.
3. Every command has a correlation id.
4. Streaming is event-based, not polling-based by default.
5. The shell must tolerate unknown fields for forward compatibility.
6. The engine must surface explicit machine-readable error envelopes.
7. Transport should work over `stdio` first; alternate transports can come later.

## Recommended Transport

**Phase 1 transport:** JSON over `stdio` between the .NET bridge and a dedicated Node bridge/engine entrypoint.

Why `stdio` first:

- lowest implementation complexity
- works locally across platforms
- easy to supervise from desktop and console heads
- no server requirement
- maps well to request/response plus event streaming

Later transports such as named pipes or local sockets can be added if needed, but they should preserve the same envelope schema.

## Envelope Shape

### Command Envelope

```json
{
  "kind": "command",
  "version": 1,
  "id": "cmd_01HV...",
  "command": "send_input",
  "timestamp": "2026-03-30T20:35:00Z",
  "payload": {}
}
```

### Response Envelope

```json
{
  "kind": "response",
  "version": 1,
  "id": "cmd_01HV...",
  "success": true,
  "timestamp": "2026-03-30T20:35:00Z",
  "payload": {}
}
```

### Event Envelope

```json
{
  "kind": "event",
  "version": 1,
  "event": "task_progress",
  "timestamp": "2026-03-30T20:35:01Z",
  "payload": {}
}
```

### Error Envelope

```json
{
  "kind": "error",
  "version": 1,
  "id": "cmd_01HV...",
  "code": "task_not_found",
  "message": "Task 'task_123' was not found.",
  "retryable": false,
  "details": {}
}
```

## Required Command Inventory

The bridge and DTO work should start with this minimal command surface:

| Command | Purpose | Notes |
|---|---|---|
| `initialize_shell` | handshake, engine version, capability discovery | first command after connect |
| `get_shell_state` | fetch initial roster, queue, active tasks, approvals, services | used on app startup/reconnect |
| `send_input` | submit user input or message into the active session/task flow | primary interaction path |
| `run_command` | execute slash-command style operations | preserve existing command semantics |
| `create_task` | enqueue a new task explicitly | needed for structured UI flows |
| `interrupt_task` | interrupt a running task | maps to existing or planned interrupt semantics |
| `approve_handoff` | approve pending handoff/approval item | explicit human-control step |
| `reject_handoff` | reject pending handoff/approval item | explicit human-control step |
| `open_terminal_session` | request a PTY-backed session | shell may host via terminal control |
| `close_terminal_session` | close a terminal session | clean shutdown |
| `focus_task` | request detailed state for a specific task/session | optional but useful for detail panes |
| `update_shell_preferences` | persist shell-owned preferences if stored via engine | keep shell state ownership clear |
| `ping` | heartbeat / liveness | keeps reconnect logic simple |

## Required Event Inventory

The engine must stream the following event families:

### Session and Engine Events

- `engine_ready`
- `engine_warning`
- `engine_error`
- `service_status_changed`
- `capabilities_reported`
- `shell_state_snapshot`

### Task Lifecycle Events

- `task_queued`
- `task_started`
- `task_progress`
- `task_output`
- `task_completed`
- `task_failed`
- `task_cancelled`
- `task_interrupted`

### Queue and Roster Events

- `queue_updated`
- `roster_updated`
- `teammate_status_changed`

### Approval and Handoff Events

- `handoff_requested`
- `approval_requested`
- `approval_resolved`

### Transcript/Feed Events

- `feed_item_added`
- `feed_item_updated`

### Terminal Events

- `terminal_session_opened`
- `terminal_session_output`
- `terminal_session_closed`
- `terminal_session_failed`

## Event Payload Requirements

Every payload should include enough structure to avoid text parsing in the shell.

Minimum expectations:

- stable identifiers for tasks, sessions, teammates, approvals, and terminals
- timestamps
- machine-readable status enums
- display-ready summary text where appropriate
- structured detail objects for richer UI

The shell should never have to infer task state from unstructured console output.

## Transport Rules

1. Commands must be idempotent where possible, or reject duplicate ids explicitly.
2. Events may arrive out of order; payloads must contain enough state to reconcile.
3. The shell must treat the engine as reconnectable and request a fresh snapshot after reconnect.
4. Long-running task output must be chunked as events, not buffered until completion.
5. Approval actions must remain explicit user actions; the shell must not auto-approve.

---

## Shell Composition

The shared `TeamMates` UI project should be composed from discrete surfaces rather than a single giant window/view model.

## Recommended Top-Level Surfaces

### `ShellViewModel`

Root coordinator for shell-owned UI state:

- active workspace/session selection
- current pane layout
- active task and selection
- shell notifications
- connection state
- shell command routing to child view models

### `TranscriptPane`

Purpose:

- display conversation/task feed items
- group related output
- show structured progress/status inline
- support selection, expansion, filtering, and copy

Owns:

- feed rendering state
- viewport/virtualization state
- local filtering and grouping toggles

Does not own:

- transcript truth or task semantics

### `InputBar`

Purpose:

- capture freeform input
- submit slash commands
- show target/mention context
- host approval-required affordances only when explicitly invoked by the user

Owns:

- local draft state
- keyboard shortcuts
- validation before sending commands

### `RosterPane`

Purpose:

- show teammates, status, role, availability, and active work summary

Owns:

- sorting/filtering/presence display preferences

### `TaskQueuePane`

Purpose:

- show queued, active, blocked, completed, and failed work
- expose queue details without relying on raw logs

Owns:

- queue grouping, selection, and local visualization state

### `ApprovalPanel`

Purpose:

- present approvals and handoff decisions that require human action

Requirements:

- actions are explicit
- proposed action, source teammate, target, and reason are visible
- no automatic execution of impactful actions

### `StatusBar`

Purpose:

- show engine connection state, sync/health indicators, active shell profile, and compact notifications

### `TerminalHostPane`

Purpose:

- host `Iciclecreek.Avalonia.Terminal` for PTY-native workflows

Good uses:

- shell panes
- raw agent/task output
- debugging consoles
- power-user fallback terminal
- live process views

Bad uses:

- primary transcript
- task queue
- roster
- approval UX
- settings

## Composition Rules

1. Each pane gets its own view and view model.
2. Shared models should be DTOs or adapter-facing state objects, not giant global mutable bags.
3. Code-behind stays limited to view concerns that cannot reasonably live in bindings or attached behaviors.
4. Cross-pane coordination goes through shell-level services or root view models, not direct view-to-view calls.

---

## MVVM Guidance

The current shared UI project already enables compiled bindings and references `CommunityToolkit.Mvvm`. Keep that direction.

## Required Practices

1. Use `ObservableObject`, source generators, and `RelayCommand`/`AsyncRelayCommand` where appropriate.
2. Prefer compiled bindings in views.
3. Keep view models UI-facing; do not let them absorb engine orchestration.
4. Keep domain transport DTOs separate from view models.
5. Use services behind interfaces for bridge communication, terminal session hosting, settings, and layout persistence.

## Avoid

1. Monolithic root view models with every pane's state and behavior.
2. Domain logic in converters or code-behind.
3. Hard-coded margins and padding inside each control.
4. Shell behavior that depends on scraping terminal text.

---

## Styling and Layout Tokens

Spacing and layout rhythm must be style-driven because the UI is targeting both Avalonia and Consolonia concepts.

## Requirements

1. No hard-coded per-control spacing values for normal layout rhythm.
2. Common spacing, padding, and density values must come from central resources/settings.
3. Controls should compose around semantic tokens, not arbitrary numeric values.
4. The same conceptual spacing model should be available to both desktop and console heads, even if rendered differently.

## Recommended Token Set

Start small:

- `SpacingXs`
- `SpacingSm`
- `SpacingMd`
- `SpacingLg`
- `SpacingXl`
- `PaneGap`
- `ControlPadding`
- `SectionPadding`
- `CardPadding`
- `TouchTargetMinHeight`
- `DenseRowHeight`
- `DefaultCornerRadius`
- `BorderThicknessThin`
- `BorderThicknessStrong`

These can live as resources first. If user-configurable density becomes necessary, add a settings layer that maps named density profiles onto these tokens.

## Token Usage Rules

1. Pane spacing uses token resources.
2. Reusable controls define defaults via styles.
3. Theming and density are expressed by swapping or overriding resource dictionaries, not editing every control.
4. Consolonia compatibility should consume the same semantic token names even if the implementation differs.

## Theming Guidance

Phase 1 should keep theming simple:

- one default theme
- one spacing scale
- consistent typography
- explicit visual distinction between transcript, queue, approvals, and terminal areas

Do not over-design theme systems before parity is established.

---

## Terminal Integration

`Iciclecreek.Avalonia.Terminal` is a hosted capability, not the application architecture.

## Rules

1. Terminal panes are opt-in surfaces inside the shell.
2. Terminal sessions are opened by explicit shell actions or engine requests.
3. Terminal output does not replace structured events.
4. If a workflow matters to the product model, the engine should still emit structured events for it.
5. Shell layout must allow terminal panes to coexist with transcript and queue rather than consume the entire experience.

## Terminal Integration Paths

### Path A: Engine Requests a Terminal

The engine emits `terminal_open_requested` or responds to `open_terminal_session`, and the shell creates a hosted pane.

### Path B: User Opens a Utility Terminal

The shell opens an ad hoc shell/debug pane for power-user workflows.

### Path C: Attached Task Terminal

A task detail surface can optionally show a terminal session associated with that task, but it should sit beside structured task state, not instead of it.

---

## Phased Rollout

## Phase 0 — Contract and Skeleton

Deliverables:

- this spec approved
- DTO/envelope design in Beacon-owned implementation docs/code
- thin bridge process plan
- shell composition scaffold in the shared UI project
- token resource scaffold for spacing/layout

Exit criteria:

- command/event inventory agreed
- root shell surfaces defined
- transport version `1` reserved

## Phase 1 — Thin Vertical Slice

Scope:

- startup handshake
- engine connection indicator
- transcript pane
- input bar
- task queue summary
- task progress rendering

Exit criteria:

- user can submit input from Avalonia shell
- engine returns streamed events
- transcript and progress update live
- no major behavior regression for the primary coding loop

## Phase 2 — Structured Work Management

Scope:

- roster pane
- richer queue interactions
- approvals/handoffs panel
- engine/service status
- reconnect and state snapshot recovery

Exit criteria:

- task, roster, and approval state are usable without falling back to raw terminal output

## Phase 3 — Terminal Hosting and Power-User Flows

Scope:

- embedded terminal host pane
- task-linked terminals
- debug terminal
- terminal session lifecycle integration

Exit criteria:

- PTY-heavy workflows are preserved inside the shell without degrading structured UI

## Phase 4 — Consolonia Alignment and Refinement

Scope:

- confirm token model works in `Teammates.Console`
- align shared view model composition between desktop and console heads where practical
- refine density/theming strategy

Exit criteria:

- desktop and TUI heads share the same shell concepts and transport semantics

## Phase 5 — Mobile Heads

Mobile should come after desktop and console flows are stable. The transport and shell composition work should make this possible, but mobile parity is not a gating requirement for the initial migration.

---

## Risks

## 1. Protocol Drift

If shell expectations and engine events evolve independently, parity breaks quickly.

Mitigation:

- versioned envelopes
- DTO-first implementation
- snapshot-based reconnect
- explicit event inventory tests

## 2. Bridge Becomes a Second Engine

If the .NET side starts re-implementing queue logic or task semantics, behavior will fork.

Mitigation:

- keep bridge thin
- keep domain authority in Node
- audit bridge responsibilities during implementation

## 3. Monolithic Shell Architecture

Avalonia migrations often collapse into one giant view/window and one giant view model.

Mitigation:

- pane-by-pane composition from the start
- service interfaces for bridge/settings/layout
- independent view models per surface

## 4. Terminal-First Regression

It is easy to rely on the terminal control for everything and fail to build a real structured shell.

Mitigation:

- terminal only for PTY-native scenarios
- structured event coverage required for core flows

## 5. Styling Drift Between Avalonia and Consolonia

Hard-coded layout values in Avalonia will make the TUI head divergent and brittle.

Mitigation:

- semantic spacing tokens
- style-based defaults
- shared token naming across heads

## 6. Engine Contract Too Small

If the initial event model is underspecified, the shell will fall back to parsing text output.

Mitigation:

- include machine-readable queue, task, approval, and roster events from the start
- treat text output as presentation, not state

---

## Open Questions

1. Should the Node side expose a dedicated bridge entrypoint distinct from today's CLI REPL, or should the existing CLI evolve to provide bridge mode?
2. What is the minimum startup state snapshot required for shell reconnect to feel correct?
3. Which shell preferences belong purely in .NET local settings versus engine-backed persistence?
4. Does `Teammates.Console` share the same view model layer as desktop from day one, or only the token and transport abstractions?
5. What exact terminal abstraction should the shell use so `Iciclecreek.Avalonia.Terminal` can be swapped or disabled cleanly where unsupported?
6. How much of current JavaScript UI behavior should be mirrored exactly in Phase 1 versus deferred until after the transport is proven?
7. Do approvals and handoffs need richer structured payloads than the current engine produces today?

---

## Beacon Next Steps

Beacon should follow this spec with implementation work in this order:

1. Define the transport DTOs and envelope schema.
2. Decide the Node bridge entrypoint shape.
3. Implement handshake, snapshot, and basic task streaming.
4. Wire the first thin vertical slice in Avalonia: transcript, input, queue summary, progress.
5. Add approvals, roster, and reconnect behavior.
6. Add hosted terminal sessions only after the structured loop is working.

## Handoff Constraint

This spec intentionally does not modify CLI or recall code. Engine and bridge implementation remain Beacon-owned.
