# F — Widget Model Redesign

**Status:** Draft
**Author:** Scribe
**Date:** 2026-03-29

---

## Problem

ChatView (`packages/consolonia/src/widgets/chat-view.ts`, 1,623 lines) manages feed content through **five parallel, index-keyed data structures** that must stay in sync:

| Structure | Type | Purpose |
|-----------|------|---------|
| `_feedLines` | `StyledText[]` | The actual rendered widgets |
| `_feedActions` | `Map<number, FeedActionEntry>` | Clickable actions keyed by line index |
| `_hiddenFeedLines` | `Set<number>` | Collapsed/hidden line indices |
| `_feedHeightCache` | `number[]` | Cached measured height per line |
| `_hoveredAction` | `number` | Currently hovered action index |

Every insert or remove requires `_shiftFeedIndices()` to rebuild all of these maps/sets/arrays by offsetting every key ≥ the insertion point. This is:

1. **Brittle** — forgetting to shift one structure silently breaks hit-testing, visibility, or actions. Adding a new index-keyed structure requires updating `_shiftFeedIndices` too.
2. **Error-prone** — the `_screenToFeedLine` and `_screenToFeedRow` maps are rebuilt every render frame, coupling screen layout to feed indices.
3. **Monolithic** — scrolling, height caching, hit-testing, selection, scrollbar, dropdown, input, banner, and feed management are all in one 1,600-line class with no reusable parts.

Additionally, the feed rendering logic (`_renderFeed`, lines 1297–1468) hand-rolls a virtual scrolling algorithm with height accumulation, skip-based offset, and per-row screen mapping — all of which should be a reusable `VirtualList` widget.

---

## Design

### Core Idea: Identity-Based Items + Composable Widgets

Replace the flat `StyledText[]` array + parallel index maps with an **identity-based item model**, and extract the scrollable list logic into a reusable **VirtualList** widget.

### 1. FeedItem — Identity-Based Model

```typescript
interface FeedItem {
  /** Stable unique ID (e.g., nanoid or incrementing counter). Never changes after creation. */
  id: string;
  /** The renderable content. */
  content: StyledText;
  /** Optional clickable actions attached to this item. */
  actions?: FeedActionEntry;
  /** Whether this item is currently hidden/collapsed. */
  hidden?: boolean;
}
```

**What this replaces:**
- `_feedLines[i]` → `item.content`
- `_feedActions.get(i)` → `item.actions`
- `_hiddenFeedLines.has(i)` → `item.hidden`
- `_feedHeightCache[i]` → managed internally by VirtualList via item ID
- `_hoveredAction` index → `_hoveredItemId: string | null`

**Why identity matters:** When you insert a new item at position 3, items at positions 3+ don't need any shifting. Their IDs stay the same. The array index is just their current position — nothing else references it.

### 2. FeedStore — Collection Manager

```typescript
class FeedStore {
  private _items: FeedItem[] = [];
  private _byId: Map<string, FeedItem> = new Map();
  private _nextId: number = 0;

  /** Generate a stable unique ID. */
  createId(): string { return `f${this._nextId++}`; }

  /** Append item to end. */
  push(item: FeedItem): void;

  /** Insert item at position. No shifting of external structures needed. */
  insert(index: number, item: FeedItem): void;

  /** Remove item by ID. */
  remove(id: string): void;

  /** Get item by ID. */
  get(id: string): FeedItem | undefined;

  /** Get item by position index (for rendering). */
  at(index: number): FeedItem | undefined;

  /** Number of items. */
  get length(): number;

  /** Iterate visible items (skips hidden). */
  visibleItems(): Iterable<FeedItem>;

  /** Update an item's properties by ID. */
  update(id: string, patch: Partial<Omit<FeedItem, 'id'>>): void;
}
```

**Key property:** All lookups by ID are O(1). Inserts/removes are array splices on a single array — no parallel structures to keep in sync.

### 3. VirtualList — Reusable Scrollable Widget

Extract the scrolling, height caching, hit-testing, and scrollbar logic from `_renderFeed` into a standalone widget:

```typescript
interface VirtualListItem {
  /** Stable unique ID. */
  id: string;
  /** Render this item into the given region. */
  render(ctx: DrawingContext, x: number, y: number, width: number, height: number): void;
  /** Measure this item's height given a width constraint. */
  measureHeight(width: number): number;
  /** Whether this item is currently hidden. */
  hidden?: boolean;
}

interface VirtualListOptions {
  /** Items to render. */
  items: VirtualListItem[];
  /** Show scrollbar when content overflows. */
  scrollbar?: boolean;
  /** Scrollbar style. */
  scrollbarStyle?: { track: string; thumb: string; style: TextStyle };
}

class VirtualList extends Control {
  // ── Public API ──
  /** Scroll to bottom. */
  scrollToBottom(): void;
  /** Scroll to make item with given ID visible. */
  scrollToItem(id: string): void;
  /** Whether the user has manually scrolled away from bottom. */
  get isScrolledAway(): boolean;
  /** Auto-scroll to bottom on new items (unless user scrolled away). */
  autoScrollToBottom(): void;

  // ── Hit-testing ──
  /** Get the item ID at a screen coordinate. */
  itemAtScreen(screenY: number): string | null;
  /** Get the row offset within the item at a screen coordinate. */
  rowOffsetAtScreen(screenY: number): number;

  // ── Internals (moved from ChatView) ──
  private _scrollOffset: number = 0;
  private _userScrolledAway: boolean = false;
  private _heightCache: Map<string, { width: number; height: number }> = new Map();
  private _screenToItem: Map<number, string> = new Map();
  private _screenToRow: Map<number, number> = new Map();
  // scrollbar state...
  // selection state could also live here...

  // measure/arrange/render implement the same algorithm as
  // current _renderFeed but driven by VirtualListItem interface
}
```

**What this extracts from ChatView:**
- Scroll offset management (~30 lines)
- Height caching with width invalidation (~20 lines)
- Skip-based visible item calculation (~30 lines)
- Screen-to-item mapping for hit-testing (~20 lines)
- Scrollbar rendering (~40 lines)
- Mouse wheel / keyboard scroll handling (~40 lines)
- Selection overlay rendering (~20 lines, optional)

**Total: ~200 lines extracted into a reusable widget.**

### 4. Simplified ChatView

After extraction, ChatView becomes a **compositor** that owns the layout regions but delegates feed rendering:

```typescript
class ChatView extends Control {
  // ── Child widgets (composed, not hand-managed) ──
  private _banner: Control;
  private _topSeparator: Separator;
  private _feed: VirtualList;          // ← NEW: replaces all feed state
  private _feedStore: FeedStore;       // ← NEW: replaces _feedLines + parallel maps
  private _bottomSeparator: Separator;
  private _progressText: StyledText;
  private _input: TextInput;
  private _inputSeparator: Separator;
  private _footer: StyledText;
  private _footerRight: StyledText;
  private _dropdown: Dropdown;         // ← future: extract dropdown too

  // ── Simplified feed API ──

  appendToFeed(text: string, style?: TextStyle): string {
    const id = this._feedStore.createId();
    const content = new StyledText({ lines: [text], defaultStyle: style ?? this._feedStyle, wrap: true });
    this._feedStore.push({ id, content });
    this._feed.autoScrollToBottom();
    this.invalidate();
    return id;  // caller can use ID to update/remove later
  }

  insertToFeed(atIndex: number, text: string, style?: TextStyle): string {
    const id = this._feedStore.createId();
    const content = new StyledText({ lines: [text], defaultStyle: style ?? this._feedStyle, wrap: true });
    this._feedStore.insert(atIndex, { id, content });
    // No _shiftFeedIndices needed!
    this._feed.autoScrollToBottom();
    this.invalidate();
    return id;
  }

  /** Update an existing feed item by ID. */
  updateFeedItem(id: string, text: string, style?: TextStyle): void {
    this._feedStore.update(id, {
      content: new StyledText({ lines: [text], defaultStyle: style ?? this._feedStyle, wrap: true }),
    });
    this._feed.invalidateItem(id);  // clear height cache for this item
    this.invalidate();
  }

  /** Hide/show a feed item by ID. */
  setFeedItemHidden(id: string, hidden: boolean): void {
    this._feedStore.update(id, { hidden });
    this.invalidate();
  }
}
```

**What disappears from ChatView:**
- `_shiftFeedIndices()` — gone entirely
- `_feedActions` map — lives on each `FeedItem`
- `_hiddenFeedLines` set — `item.hidden` flag
- `_feedHeightCache` array — managed by `VirtualList` keyed by item ID
- `_hoveredAction` index — `_hoveredItemId` string
- `_screenToFeedLine` / `_screenToFeedRow` maps — inside `VirtualList`
- `_renderFeed()` method (~170 lines) — `VirtualList.render()`
- Scrollbar state & rendering — inside `VirtualList`
- Feed scroll offset management — inside `VirtualList`

### 5. FeedItem Adapter (Bridge for VirtualList)

VirtualList needs `VirtualListItem` objects. A thin adapter bridges `FeedItem` → `VirtualListItem`:

```typescript
function feedItemToListItem(item: FeedItem): VirtualListItem {
  return {
    id: item.id,
    hidden: item.hidden,
    measureHeight(width: number): number {
      return item.content.measure({ minWidth: 0, maxWidth: width, minHeight: 0, maxHeight: Infinity }).height;
    },
    render(ctx, x, y, width, height) {
      item.content.arrange({ x, y, width, height });
      item.content.render(ctx);
    },
  };
}
```

This keeps the VirtualList generic (could render anything, not just StyledText) while ChatView works with the richer FeedItem model.

---

## Migration Path

### Phase 1: FeedStore (low risk, high impact)

1. Create `FeedStore` class in `packages/consolonia/src/widgets/feed-store.ts`
2. Replace `_feedLines[]` + `_feedActions` + `_hiddenFeedLines` with a single `FeedStore` inside ChatView
3. Delete `_shiftFeedIndices()` entirely
4. Update all feed mutation methods to use `FeedStore`
5. Height cache stays index-based temporarily (keyed by position, not ID)

**Test:** All existing chat behavior works identically. Feed actions, hiding, hovering all work.

### Phase 2: VirtualList extraction (medium risk)

1. Create `VirtualList` widget in `packages/consolonia/src/widgets/virtual-list.ts`
2. Move height cache, scroll logic, screen mapping, scrollbar into VirtualList
3. Height cache becomes ID-keyed (`Map<string, ...>` instead of `number[]`)
4. ChatView's `_renderFeed()` is replaced by `this._feed.render(ctx)`
5. Hit-testing goes through `this._feed.itemAtScreen(y)`

**Test:** Scrolling, auto-scroll-to-bottom, scrollbar thumb, mouse wheel, selection all work.

### Phase 3: Selection extraction (optional, lower priority)

1. Move selection state and rendering into VirtualList (or a `SelectionOverlay` composed with it)
2. ChatView delegates copy-to-clipboard through VirtualList's selection API

### Phase 4: Dropdown extraction (optional, lower priority)

1. Extract dropdown into a standalone `Dropdown` widget
2. ChatView composes it as a child positioned below input

---

## Before / After Comparison

### Inserting a line at index 5

**Before (current):**
```
1. splice _feedLines at 5
2. rebuild _feedActions map (shift all keys >= 5)
3. rebuild _hiddenFeedLines set (shift all entries >= 5)
4. splice _feedHeightCache at 5
5. adjust _hoveredAction if >= 5
6. auto-scroll
7. invalidate
```

**After (proposed):**
```
1. feedStore.insert(5, item)
2. auto-scroll
3. invalidate
```

### Hiding a line

**Before:** `this._hiddenFeedLines.add(index)` — but what if another insert shifted the index since you captured it?

**After:** `this._feedStore.update(id, { hidden: true })` — ID is stable regardless of inserts.

### Looking up actions for a clicked line

**Before:** Screen Y → `_screenToFeedLine.get(y)` → index → `_feedActions.get(index)` — requires two maps rebuilt every frame.

**After:** Screen Y → `virtualList.itemAtScreen(y)` → item ID → `feedStore.get(id).actions` — one map (inside VirtualList) + one O(1) lookup.

---

## File Plan

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/widgets/feed-store.ts` | New | ~80 |
| `src/widgets/virtual-list.ts` | New | ~250 |
| `src/widgets/chat-view.ts` | Refactor | ~1,200 (down from 1,623) |
| `src/index.ts` | Add exports | ~3 |

---

## Open Questions

1. **Should VirtualList own selection?** Selection is tightly coupled to screen coordinates and text extraction. It could live in VirtualList (making it reusable for any selectable list) or stay in ChatView (simpler first pass).

2. **Should banner/separator be VirtualList items?** Currently `_renderFeed` includes the banner and top separator as scroll items. They could become special `FeedItem` entries or stay as separate widgets composed above the VirtualList.

3. **Should the feed API return IDs?** If callers get IDs back from `appendToFeed()`, they can later update/remove specific items without tracking indices. This is a public API change.

---

## Risks

- **Public API change** — Any code calling `insertToFeed(index, ...)` works the same, but new ID-returning signatures and `updateFeedItem(id)` are additive changes. Existing callers don't break.
- **Phase 2 is the risky phase** — extracting `_renderFeed` into VirtualList touches scrolling, hit-testing, and selection simultaneously. Should be done in a single focused PR with manual testing of scroll, click, hover, select, resize.
- **ChatView is 1,623 lines** — AI agents editing it will struggle (per WISDOM). The extraction itself should be done in focused batches, not all at once.
