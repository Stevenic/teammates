# F — Thread View Redesign

**Status:** Draft
**Author:** Scribe
**Date:** 2026-03-28
**Handoff to:** @beacon

---

## Problem

The current thread rendering logic in `cli.ts` is fragile and hard to maintain. Threads are rendered as a flat sequence of feed lines with index arithmetic tracking where things go. There's no encapsulating container — just raw feed-line bookkeeping spread across `threadFeedRanges`, `workingPlaceholders`, `replyBodyRanges`, etc. This makes layout changes (like moving verbs) a game of whack-a-mole with off-by-one errors.

## Goals

1. Introduce a **ThreadContainer** abstraction that owns the layout of all child items within a thread
2. Move item-level **verbs to the subject line** (inline with the teammate name)
3. Add thread-level **[reply]** and **[copy thread]** verbs below the container
4. Track **conversation history at the thread level**, not globally
5. Simplify **input routing** so the input box auto-replies to the bottom-most thread

---

## Architecture

### ThreadContainer

A new class (or structured object) that manages a thread's visual representation in the feed. It replaces the scattered `threadFeedRanges`, `workingPlaceholders`, and `replyBodyRanges` maps.

```
ThreadContainer {
  threadId: number
  feedStartIndex: number        // first feed line owned by this container
  feedEndIndex: number          // last feed line (exclusive) — updated on insert
  headerLineIndex: number       // the "#1  → @alice, @bob" line
  items: ThreadItemEntry[]      // ordered child items
  replyActionIndex: number      // feed line of [reply] [copy thread] verbs
}

ThreadItemEntry {
  entryIndex: number            // index into TaskThread.entries
  subjectLineIndex: number      // feed line for "  @alice: Subject [show/hide] [copy]"
  bodyStartIndex: number        // first feed line of content
  bodyEndIndex: number          // last feed line of content (exclusive)
  collapsed: boolean            // is the body currently hidden?
}
```

**Key invariant:** All feed-line mutations for a thread go through `ThreadContainer` methods. No direct index arithmetic in the REPL main loop.

### Layout

Each rendered thread looks like this in the feed:

```
#1  → @alice, @bob                                    ← thread header (clickable toggle)
  @alice: Summary of response [show/hide] [copy]      ← item subject line with inline verbs
    Response body line 1                               ← item body (hideable)
    Response body line 2
  @bob: Their response [show/hide] [copy]              ← second item
    Body text here
  steve: Follow-up message                             ← user reply (indented, no verbs)
  [reply] [copy thread]                                ← thread-level verbs
```

#### Thread Header
- Same as today: `#<id>  → @name1, @name2`
- Clickable to collapse/expand the entire thread

#### Item Subject Line (THE KEY CHANGE)
- Format: `  @<teammate>: <subject> [show/hide] [copy]`
- Verbs are **on the same line** as the subject, right-aligned or appended after the subject text
- `[show/hide]` toggles visibility of that item's body lines only
- `[copy]` copies that single item's content to the clipboard
- User messages within threads show as `  <username>: <message>` with no verbs

#### Item Body
- Indented markdown content (same as today but managed by the container)
- Hidden/shown via `[show/hide]` on the subject line
- Default state: **visible** (expanded)

#### Thread-Level Verbs
- Rendered as a single action list at the bottom of the container: `  [reply] [copy thread]`
- `[reply]` sets the input focus to this thread (same as today's reply behavior but at thread level)
- `[copy thread]` copies ALL entries in the thread (subject lines + bodies + user messages) to clipboard

### Verb Placement Summary

| Verb | Level | Location | Action |
|------|-------|----------|--------|
| `[show/hide]` | Item | Subject line, inline | Toggle that item's body visibility |
| `[copy]` | Item | Subject line, inline | Copy that item's content to clipboard |
| `[reply]` | Thread | Below last item | Set input focus to this thread (`#<id>`) |
| `[copy thread]` | Thread | Below last item | Copy entire thread contents to clipboard |

---

## Conversation History

### Current Behavior
- Global `conversationHistory` array with thread context built on-the-fly via `buildThreadContext()`

### New Behavior
- Each `TaskThread` owns its conversation history directly
- When a task is queued for a thread, the thread's entries ARE the conversation history — no separate array needed
- `buildThreadContext()` already does this; the change is to **stop falling back to global history** for threaded tasks
- Global history remains for non-threaded interactions only (if any)

---

## Input Routing

### Auto-Reply to Bottom Thread
- The input box should automatically target the **last thread in the feed** (the one at the bottom)
- Display a hint in the input area or footer showing the current target: `replying to #3`
- No `#<id>` prefix needed when replying to the auto-targeted thread

### @mention Starts New Thread
- `@alice do something` with no `#<id>` prefix → **new thread** (new `#<id>` assigned)
- `#3 @alice do something` → **reply within thread #3** (message appears indented in that thread's container)
- `@everyone do something` → **new thread** with all teammates queued

### Multiple @mentions in Thread Reply
- `#3 @alice @bob what do you think?` → user message indented in thread #3, tasks queued to both alice and bob within that thread
- Their responses appear as new items in the same thread container

### Focus Behavior
- Clicking `[reply]` on a thread sets `focusedThreadId` to that thread
- Subsequent messages without `@mention` or `#id` go to the focused thread
- `@mention` without `#id` always starts a new thread (breaks focus)

---

## Implementation Notes for @beacon

### Phase 1: ThreadContainer Class
1. Create `ThreadContainer` in `cli.ts` (or a new `thread-container.ts` file)
2. It wraps all the feed-line index management currently spread across the REPL
3. Methods: `addItem()`, `removeItem()`, `toggleItemBody()`, `getInsertPoint()`, `updateRange()`, `toClipboardText()`
4. Migrate existing `threadFeedRanges`, `workingPlaceholders`, `replyBodyRanges` into container instances

### Phase 2: Verb Relocation
1. Move `[show/hide]` and `[copy]` from standalone action lines to **inline on the subject line**
2. Use `appendActionList` on the subject line itself (or compose the subject as a styled line with embedded actions)
3. Add `[reply]` and `[copy thread]` as a single action list at `container.replyActionIndex`
4. Remove the old per-item `[reply]` and `[copy]` action lines

### Phase 3: Input Routing Update
1. Default `focusedThreadId` to the last thread in the feed
2. Show current target hint in footer or input separator
3. Ensure `@mention` without `#id` always creates a new thread

### Migration
- No data migration needed — `TaskThread` and `ThreadEntry` interfaces are unchanged
- This is purely a rendering/layout refactor
- The `ThreadContainer` is a view-layer abstraction over the existing data model

### Risk Areas
- **Inline actions on subject line**: The current `appendActionList` puts actions on their own feed line. Embedding actions within a content line may require changes to `chat-view.ts`'s action hit-testing (`_resolveActionItem`). Check if `FeedActionEntry` supports multiple actions on a line that also has non-action content.
- **Feed index shifting**: When items are inserted mid-container, all subsequent containers' indices must shift. The container abstraction should handle this, but test thoroughly with multiple concurrent threads.

---

## Out of Scope

- Thread persistence across sessions (threads are already in memory via `TaskThread`)
- Thread search or filtering
- Nested threads (threads of threads)
- Changes to `chat-view.ts` widget internals (only if inline action support requires it)
