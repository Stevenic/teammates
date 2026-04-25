# F — Thread UX v2: Tab-Style Task Switching

**Status:** Draft — All open questions resolved, ready for handoff
**Author:** Scribe
**Date:** 2026-04-18
**Handoff to:** @beacon

---

## Problem

The current threading UX has friction in several places:

1. **Implicit thread creation** — Every `@mention` creates a new thread. Users accumulate threads without intending to. There's no "just talk to someone in the current context" flow.
2. **#id is a message prefix, not a switch** — `#3 do something` routes a message to thread 3, but you have to type it every time. There's no "switch to thread 3 and stay there."
3. **No read/unread awareness** — All threads sit expanded in the feed regardless of whether the user has seen new content. The feed gets noisy fast.
4. **No explicit thread lifecycle** — Threads are born implicitly and never die. No way to close, archive, or clean up finished work.

## Goals

1. **Single default thread** — Session starts with one implicit thread. All messages go there until the user creates more.
2. **Explicit thread creation** — `/thread <description>` (or `/new`) creates a new named thread and switches to it.
3. **#id switches focus** — Typing `#3` alone (or clicking a thread in the tab bar) switches the active thread. All subsequent messages go to the focused thread.
4. **Auto-collapse on switch** — When you switch away from a thread, it collapses. When new content arrives in a collapsed thread, it gets an unread indicator.
5. **Thread bar** — A persistent visual element showing all threads with status.

---

## Design

### Option A: Thread Tab Bar (recommended)

A horizontal bar between the banner and the feed showing active threads as tabs:

```
 ┌─ banner ──────────────────────────────────────────────────────────┐
 │  TM v0.8.1 · @steve · 4 teammates                                │
 ├───────────────────────────────────────────────────────────────────┤
 │  #1 Fix auth bug  │  #2 Refactor DB ● [x] │  #3 Feature X ● [x] │ [+] │
 ├───────────────────────────────────────────────────────────────────┤
 │                                                                   │
 │  (feed shows ONLY the focused thread's content)                   │
 │                                                                   │
 │  #1 → @beacon, @scribe                                           │
 │    @beacon: Implemented the fix  [hide] [copy]                    │
 │      Applied patch to auth.ts...                                  │
 │    @scribe: Updated docs  [hide] [copy]                           │
 │      Added changelog entry...                                     │
 │    [reply] [copy thread]                                          │
 │                                                                   │
 ├───────────────────────────────────────────────────────────────────┤
 │  ❯ _                                                              │
 └───────────────────────────────────────────────────────────────────┘
```

- **Active tab** is highlighted (bright fg, underline, or inverted)
- **● indicator** = unread content since last focus
- **[+]** = shortcut hint for `/thread` (or clickable)
- Feed shows **only the focused thread** — no accordion, no clutter
- Switching tabs swaps the visible feed content

#### Tab Overflow

When threads exceed terminal width:
- Show as many tabs as fit, with `‹ ›` scroll arrows
- Or truncate thread names: `#1 Fix au… │ #2 Refac… │ …`
- Thread names auto-truncate to fit; full name shown in footer when focused

### Option B: Accordion Feed (simpler, closer to current)

All threads live in one scrollable feed. Only the focused thread is expanded; others collapse to a single summary line:

```
 ▶ #1 Fix auth bug (3 replies)                    ← collapsed, click to expand
 ▶ #2 Refactor DB (2 replies) ●                   ← collapsed, has unread
 ▼ #3 Feature X                                   ← expanded (focused)
   #3 → @beacon
     @beacon: Working on it...  [hide] [copy]
       Implementation details...
     [reply] [copy thread]
```

- Clicking a collapsed thread header expands it and collapses the previously focused one
- `●` marks threads with unread content
- Simpler implementation — works within the current single-feed model
- Downside: collapsed threads still take vertical space, scrolling can be disorienting

### Recommendation

**Option A (Tab Bar)** is the better UX for multi-thread workflows:
- Zero noise from inactive threads
- Clear mental model (tabs = workspaces)
- Familiar pattern from editors, browsers, tmux
- Thread bar is always visible — no scrolling to find threads

Option B works as a fallback if tab bar implementation is too complex for the ChatView widget model.

---

## Thread Lifecycle

### Creation

| Action | Result |
|--------|--------|
| Session start | Thread `#1` created automatically (unnamed, or named "main") |
| `/thread Fix the auth bug` | Creates `#2 Fix auth bug`, switches focus to it |
| `/thread` (no description) | Creates `#N` with auto-name from first message |
| `/new Fix the auth bug` | Alias for `/thread` |

**@mentions no longer create threads.** `@beacon fix this` in thread #1 queues beacon *within* thread #1. To start a new thread for beacon, use `/thread @beacon fix this` — the `/thread` command both creates the thread and dispatches.

### Switching

| Action | Result |
|--------|--------|
| `#3` (bare, no message) | Switch focus to thread #3, collapse current thread |
| `#3 do more stuff` | Switch focus to #3 AND send message in that thread |
| Click tab in thread bar | Switch focus to that thread |
| Tab/Shift+Tab | Cycle through threads (keyboard shortcut) |

### Auto-collapse ("read" behavior)

When you switch away from thread N:
1. Thread N's content collapses (tab bar: hidden from feed; accordion: collapsed to one line)
2. Thread N is marked as "read" at the current point in time
3. If new replies arrive in thread N while you're elsewhere, it gets a `●` unread badge
4. Switching back to thread N clears the badge and expands it

### Closing

| Action | Result |
|--------|--------|
| `/close` | Delete the focused thread (removes tab and data) |
| `/close #3` | Delete thread #3 specifically |
| Click `[x]` on tab | Delete that thread |

- Thread #1 cannot be closed — it has no `[x]` button and `/close` on #1 is a no-op.
- All other tabs display a `[x]` close button.
- Closing the focused thread switches focus to the nearest remaining tab.

---

## Commands

### New Commands

| Command | Aliases | Usage | Description |
|---------|---------|-------|-------------|
| `/thread` | `/new`, `/t` | `/thread [description]` | Create a new thread and switch to it |
| `/close` | `/done` | `/close [#id]` | Close a thread (remove from tab bar) |
| `/threads` | `/ls` | `/threads` | List all threads with status |

### Modified Commands

| Command | Change |
|---------|--------|
| `/status` | Thread section shows unread counts, active/closed state |
| `/clear` | Clears the focused thread's feed content (per-thread, not global) |

### Removed Behaviors

- `@mention` without `/thread` no longer creates a new thread — it dispatches within the current thread
- Auto-focus "most recently focused thread" logic removed — focus is explicit via `#id` or tab click

---

## Wordwheel Updates

### `#` autocomplete

Current: `#` shows thread list, selecting inserts `#<id> ` (with trailing space for message).

New: `#` shows thread list, selecting inserts `#<id>` and **immediately switches** focus without requiring a message. If the user types more text after `#<id> `, that text is sent as a message in the newly focused thread.

### `/thread` autocomplete

When typing `/thread`, the wordwheel could suggest:
- Recent task descriptions from conversation
- `@teammate` names (for `/thread @beacon do something`)

---

## Thread Bar Widget

### Specification

The thread bar is a new 1-row widget between the banner and the feed separator. It **docks to the top of the viewport** — the banner can scroll off screen, but the tab bar sticks. Hidden when only thread #1 exists (single-thread mode).

```
ThreadBar extends Control {
  threads: { id: number; name: string; unread: boolean; focused: boolean; working: boolean }[]
  visible: boolean  // false when threads.length === 1 (single-thread mode)
  
  render():
    if not visible: return empty
    for each thread:
      if focused: render with bright/inverted style
      if unread: append ● after name
      if working: append ◎ or spinner after name
      if id > 1: append [x] close button
      separate with │
    append [+] at end
    
  onClick(x):
    determine which tab or [x] was clicked from character offsets
    if [x]: emit "close" event with thread id
    else: emit "switch" event with thread id
    
  measure():
    height: 1 row always (0 when hidden)
    width: fill available
}
```

### Visual States

```
 #1 Fix auth ◎ │ #2 Refactor DB ● [x] │ #3 Feature X [x] │ [+]
       ↑              ↑           ↑          ↑
    working        unread       close     focused (highlighted)
    (no [x])                   button
```

- **Focused**: bright foreground, bold or inverse — visually distinct
- **Unread ●**: accent color dot — "something new here"
- **Working ◎**: info color — "agent actively processing"
- **Idle**: muted text — nothing happening

---

## Feed Content Switching (Option A implementation)

### Approach: Virtual feed per thread

Each thread gets its own `FeedStore` (or feed line array). Switching threads swaps which feed is rendered in the ChatView's virtual list.

```
ThreadManager {
  feeds: Map<number, FeedStore>    // per-thread feed content
  activeFeedId: number             // which feed is currently displayed
  
  switchTo(threadId):
    save scroll position of current feed
    set chatView.feedStore = feeds.get(threadId)
    restore scroll position of target feed
    update thread bar focus state
    clear unread badge for target thread
}
```

This is the cleanest approach — no show/hide line gymnastics, no index shifting between threads. Each thread is its own self-contained feed.

### Alternative: Single feed with visibility toggling

Keep the current single feed. On switch, hide all lines belonging to other threads, show lines for the target thread. This is more fragile (index shifting still required) but avoids the FeedStore-per-thread refactor.

### Recommendation

**Virtual feed per thread** is worth the investment. It eliminates the most complex part of the current system (cross-thread index shifting) and makes each thread's rendering fully independent.

---

## Migration from Current Behavior

### Breaking changes

1. `@mention` alone no longer creates a thread — use `/thread @mention task` instead
2. `#id` alone now switches focus (previously it was an error or ignored without a message)
3. Threads auto-collapse — users who liked seeing everything expanded need to adjust
4. **"Task" concept replaced by "tab/thread"** — the "replying to task #1" footer is removed; threads are the only unit of conversation
5. `/clear` is now per-thread (clears only the focused thread's feed), not global

### Mitigation

- First session after upgrade: show a one-time hint explaining the new model
- `/threads` command lists everything if the user feels lost
- The tab bar itself is self-documenting — it's visible and clickable

---

## Resolved Questions

1. **Thread naming** — **Auto-name from first message.** Thread #1 starts unnamed; subsequent threads get a name derived from the first message content.
2. **Tab bar position** — **Top, between banner and feed.** The tab bar docks to the top of the viewport — scrolling can push the banner off screen but tabs stick to the top.
3. **Keyboard shortcuts** — **Approved as proposed.** `Alt+1`/`Alt+2` for direct switching, `Ctrl+T` for new thread. Accept terminal conflict risk.
4. **Thread persistence** — **`/clear` is per-thread** (clears only the focused thread's feed). **`/close` deletes a thread** (removes the tab and its data). Every tab except #1 gets a `[x]` close button. Thread #1 is permanent and cannot be closed.
5. **Single-thread mode** — **Yes, hide the tab bar when only #1 exists.** This also means the "replying to task #1" footer message is removed — the concept of "task" is replaced entirely by "tab/thread."
6. ~~**Option A vs B**~~ — **Resolved: Option A (Tab Bar)** approved by Steve.

---

## Implementation Sketch (for @beacon)

### Phase 1: Thread-per-feed refactor
- Create per-thread FeedStore instances
- Route all feed writes through `threadManager.activeFeed`
- Switching threads swaps the ChatView's active feed store
- Verify: existing thread rendering still works, just scoped to per-thread feeds

### Phase 2: Thread bar widget
- New `ThreadBar` control between banner and feed
- Renders tabs with click handling
- Emits "switch" events consumed by the REPL
- Wire up unread/working/focused state

### Phase 3: Command changes
- Add `/thread`, `/close`, `/threads` commands
- Modify `@mention` to dispatch within current thread
- Update `#id` parsing to support bare switching (no message required)
- Update wordwheel for new behaviors

### Phase 4: Polish
- Tab overflow/scrolling
- Keyboard shortcuts for tab switching
- One-time migration hint
- Auto-name threads from first message content

---

## Out of Scope

- Thread persistence across sessions
- Thread search/filter
- Nested threads
- Split-pane view (showing two threads side by side)
- Thread notifications outside the TUI (desktop notifications, etc.)
