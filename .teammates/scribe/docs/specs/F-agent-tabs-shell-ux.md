# F — Agent Tabs Shell UX

**Status:** Draft
**Owner:** Scribe (spec) -> Beacon (implementation)
**Date:** 2026-03-30
**Depends on:** [F — Avalonia Shell Over Node Engine](F-avalonia-shell.md)

---

## Summary

The shell should present the team as a left-side tab list:

1. `TEAM` tab first
2. One tab per agent after `TEAM`
3. Clicking a tab switches the main activity view to that target
4. There is one shared input box at the bottom of the window
5. Submitting input sends the message to the currently active tab

This is a shell-level interaction model. The engine remains authoritative for task execution, routing, transcript events, and agent activity state.

---

## Goals

1. Make target selection explicit at all times.
2. Keep the messaging model simple: one active target, one input box.
3. Let the user inspect per-agent activity without mixing all activity into one undifferentiated feed.
4. Preserve a team-wide view through a dedicated `TEAM` tab.
5. Keep the UX compatible with the Avalonia shell boundary already defined in `F-avalonia-shell.md`.

## Non-Goals

1. Multiple composer boxes, one per tab.
2. Free-floating chat windows per agent.
3. Implicit routing from the input box to some agent other than the active tab.
4. Replacing engine routing rules for background work.

---

## Core UX Model

## Left Navigation

The primary navigation is a vertical tab rail on the left side of the shell.

Required order:

1. `TEAM`
2. `@beacon`
3. `@scribe`
4. `@lexicon`
5. `@pipeline`
6. Additional agents in roster order

Each tab should show:

- display name
- status indicator
- optional unread/activity marker
- optional active-task indicator

The left rail is for selection, not dense detail. It should stay scannable.

## Main Content Area

The main pane shows the activity feed for the selected tab only.

### `TEAM` tab

The `TEAM` tab is the aggregate view. It should show:

- team-wide activity feed
- cross-agent events
- handoffs/approvals that affect the team view
- user-visible orchestration events

The `TEAM` tab is the default landing tab on startup unless the shell is restoring a previous local selection.

### Agent tabs

Each agent tab shows that agent's activity only, including:

- transcript items addressed to or emitted by that agent
- task progress for that agent
- status changes for that agent
- agent-specific approvals or handoff context when relevant

Switching tabs must not destroy scroll position or local reading state if practical.

## Shared Input Composer

There is exactly one input composer at the bottom of the shell.

Rules:

1. The composer is always visible.
2. The composer targets the active tab.
3. The send action routes input to the active target only.
4. The UI must make the current target obvious in the composer chrome.
5. Changing tabs changes the input target immediately.

Recommended label pattern:

- `Message TEAM`
- `Message @beacon`
- `Message @scribe`

If the active tab is unavailable for input, the composer should be disabled with a clear reason.

---

## Interaction Rules

## Tab Selection

1. Single active tab only.
2. Mouse click or keyboard selection changes the active tab.
3. The selected tab controls both the visible feed and the composer target.
4. Selection state is shell-owned UI state and may be restored locally between sessions.

## Message Routing

When the user submits input:

- if `TEAM` is active, send input to the team-level target/context
- if an agent tab is active, send input to that specific agent

The shell must not guess another target. The active tab is the routing rule.

## Background Activity

Agents may continue working while inactive.

Required behavior:

- inactive tabs can show activity badges
- inactive tabs can show running/blocked/error status
- tab switching reveals the full activity view for that agent

The shell should support awareness without forcing focus changes.

---

## State Model

The shell should treat the following as first-class view state:

- `activeTabId`
- `tabs[]`
- `hasUnread`
- `activityState`
- `displayName`
- `targetKind` (`team` or `agent`)
- `composerEnabled`
- `composerPlaceholder`

Representative shape:

```json
{
  "activeTabId": "agent:beacon",
  "tabs": [
    {
      "id": "team",
      "targetKind": "team",
      "displayName": "TEAM",
      "hasUnread": false,
      "activityState": "active"
    },
    {
      "id": "agent:beacon",
      "targetKind": "agent",
      "agentId": "beacon",
      "displayName": "@beacon",
      "hasUnread": true,
      "activityState": "running"
    }
  ]
}
```

---

## Engine Contract Expectations

Beacon should expose enough structured state/events for the shell to support the tab UX without scraping text.

Minimum needs:

1. Stable identifiers for team view and each agent
2. Per-agent activity/status updates
3. Team-wide feed events
4. Agent-scoped feed events
5. Message submission command that accepts an explicit target id
6. Snapshot API/event that returns current tab-relevant state on startup/reconnect

Suggested command shape:

```json
{
  "command": "send_input",
  "payload": {
    "targetId": "agent:beacon",
    "text": "Please review the bridge DTOs"
  }
}
```

For `TEAM`:

```json
{
  "command": "send_input",
  "payload": {
    "targetId": "team",
    "text": "Who should take the transport schema work?"
  }
}
```

---

## Layout Guidance

Within the broader shell layout from `F-avalonia-shell.md`:

- left column: tab rail
- center/main area: selected tab activity
- bottom: shared composer

This spec does not require additional right-side panes. Those can coexist later, but this left-tab + main-view + bottom-input structure is the required core interaction model.

---

## Edge Cases

1. If a new agent joins the roster, add a tab without disturbing current selection unless the active tab disappears.
2. If the active agent is removed or unavailable, fall back to `TEAM`.
3. If an agent is busy, input still routes there unless the engine explicitly reports input disabled.
4. If the shell reconnects, restore the last active tab when possible; otherwise fall back to `TEAM`.

---

## Acceptance Criteria

1. The shell shows a left-side tab rail with `TEAM` first and one tab per agent after it.
2. Clicking a tab changes the main activity view to that tab's target.
3. A single composer at the bottom always routes to the active tab.
4. The composer visibly indicates the current target.
5. Background activity on inactive tabs is still visible via badges/status.
6. Startup and reconnect restore a valid selected tab and activity view.

---

## Beacon Next Steps

1. Map this UX onto the Avalonia shell composition already defined in `F-avalonia-shell.md`.
2. Define the tab/target DTOs and snapshot/event payloads needed to drive the shell.
3. Implement explicit `targetId` routing for the shared input box.
4. Build the left rail, selected activity view, and bottom composer as the first shell interaction slice.
