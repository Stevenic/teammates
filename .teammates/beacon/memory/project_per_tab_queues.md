---
name: Per-tab task queues (slot-keyed serialization)
description: Task serialization in cli.ts is now per-(thread, teammate) slot, not per-teammate — same teammate can run concurrently in different tabs
type: project
---

# Per-tab task queues — the "slot" model

As of 0.9.1, task serialization in `packages/cli/src/cli.ts` is keyed by `(threadId, teammate)` pairs called **slots**, not by teammate alone. Same teammate in two tabs = two slots = two concurrent tasks.

**Why:** User wanted each tab to have its own task queue so the same teammate could work on different things in different tabs. Status bar already rotates through all active tasks via StatusTracker's animation.

**How to apply:**

## Slot key convention

Use `slotKey(threadId, teammate)` helper — format is `"t{threadId ?? 0}:{teammate}"`. Three core maps are keyed this way:

- `agentActive: Map<string, QueueEntry>` — the active task for each slot
- `abortControllers: Map<string, AbortController>` — per-slot cancel handle
- `agentDrainLocks: Map<string, Promise<void>>` — prevents double-drain

## Queue iteration

`drainSlot(threadId, teammate)` filters `taskQueue` by **both** threadId and teammate. `kickDrain()` iterates unique `(threadId, teammate)` pairs from the queue, not unique teammates. `isSlotBusy(threadId, teammate)` checks only that specific slot.

## StatusTracker uses entry.id, not teammate

Lifecycle is driven from the drain loop, not from orchestrator events. `startTask(entry.id, ...)` at loop start, `stopTask(entry.id)` in finally. The queue entry ID is unique per task; using teammate as the ID would clobber concurrent tasks.

`handleEvent` in cli.ts no longer calls `startTask`/`stopTask` — only handles the `error` case for display.

## Activity manager is keyed by taskId (entry.id)

`buffers`, `shown`, `lineIndices`, `threadIds`, `blankIdx` all keyed by `taskId`. Two concurrent tasks for the same teammate would otherwise collide on all of these. `handleActivityEvents(taskId, events)`, `cleanupActivityLines(taskId)`, `initForTask(taskId, threadId)` — all take `taskId`, not `teammate`.

The onActivity callback in drainSlot captures `entry.id` as `taskId` and passes it through.

## What didn't need to change

- Adapters spawn fresh child processes per `executeTask()` call (via `spawnAndProxy`) — two tasks naturally run in isolation.
- `orchestrator.sessions: Map<teammate, sessionId>` — session IDs are synthetic and ignored by `cli-proxy.executeTask` (param is `_sessionId`). Safe to share across concurrent tasks.
- Per-thread `pendingTasks: Set<string>` — already taskId-based, worked correctly.
- StatusTracker's animation already rotates across all active task IDs — no change needed for the "rotate through all active tasks" requirement.

## Commands.ts cancel paths

`cancelTeammateInThread` computes slot from `(threadId, teammate)` arguments, looks up activeEntry via `agentActive.get(slot)`. `cmdInterrupt` uses `slotKey(taskId, resolvedName)` where `taskId` is the /interrupt thread ID argument.

`/status` now iterates all entries in `agentActive.values()` matching a teammate (there can be multiple) and shows the tab number (e.g. `▸#3 <task>`) when a teammate has active work.

## Risk surface for future changes

- If you add a new per-agent map in cli.ts, ask: does it need per-teammate or per-slot semantics? Almost always per-slot now.
- If orchestrator events grow a new consumer that uses `teammate` as an ID, remember the concurrency implication.
- `orchestrator.sessions` could race if two concurrent `assign()` calls for the same teammate hit `!sessionId` simultaneously — minor cost (duplicate startSession) but not broken. If startSession gets expensive, gate it with a `startingSessions: Map<teammate, Promise<string>>`.
