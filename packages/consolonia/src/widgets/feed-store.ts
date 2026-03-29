/**
 * FeedStore — Identity-based feed item collection for ChatView.
 *
 * Replaces the parallel index-keyed data structures (_feedLines, _feedActions,
 * _hiddenFeedLines) with a single array of FeedItem objects. Each item has a
 * stable unique ID so external code can reference items without worrying about
 * index shifts on insert/remove.
 */

import type { StyledLine, StyledText } from "./styled-text.js";

// ── Types ──────────────────────────────────────────────────────────

/** A single clickable action within an action line. */
export interface FeedActionItem {
  id: string;
  normalStyle: StyledLine;
  hoverStyle: StyledLine;
}

/** Entry attached to a feed item — single action or multiple side-by-side. */
export interface FeedActionEntry {
  /** All action items on this line. */
  items: FeedActionItem[];
  /** Combined normal style for the full line. */
  normalStyle: StyledLine;
}

/** A single item in the feed. */
export interface FeedItem {
  /** Stable unique ID. Never changes after creation. */
  readonly id: string;
  /** The renderable content. */
  content: StyledText;
  /** Optional clickable actions attached to this item. */
  actions?: FeedActionEntry;
  /** Whether this item is currently hidden/collapsed. */
  hidden?: boolean;
}

// ── FeedStore ──────────────────────────────────────────────────────

export class FeedStore {
  private _items: FeedItem[] = [];
  private _byId = new Map<string, FeedItem>();
  private _nextId = 0;

  /** Generate a stable unique ID. */
  createId(): string {
    return `f${this._nextId++}`;
  }

  /** Append an item to the end. */
  push(content: StyledText, actions?: FeedActionEntry): FeedItem {
    const item: FeedItem = { id: this.createId(), content, actions };
    this._items.push(item);
    this._byId.set(item.id, item);
    return item;
  }

  /** Insert an item at position. Existing items shift — no external bookkeeping needed. */
  insert(
    index: number,
    content: StyledText,
    actions?: FeedActionEntry,
  ): FeedItem {
    const clamped = Math.max(0, Math.min(index, this._items.length));
    const item: FeedItem = { id: this.createId(), content, actions };
    this._items.splice(clamped, 0, item);
    this._byId.set(item.id, item);
    return item;
  }

  /** Get item by ID (O(1)). */
  get(id: string): FeedItem | undefined {
    return this._byId.get(id);
  }

  /** Get item by position index (for rendering). */
  at(index: number): FeedItem | undefined {
    return this._items[index];
  }

  /** Find the current index of an item by ID. Returns -1 if not found. */
  indexOf(id: string): number {
    const item = this._byId.get(id);
    if (!item) return -1;
    return this._items.indexOf(item);
  }

  /** Number of items. */
  get length(): number {
    return this._items.length;
  }

  /** Read-only access to the items array (for iteration in render loops). */
  get items(): readonly FeedItem[] {
    return this._items;
  }

  /** Remove all items. */
  clear(): void {
    this._items = [];
    this._byId.clear();
  }

  /** Check if any item has actions. */
  get hasActions(): boolean {
    for (const item of this._items) {
      if (item.actions) return true;
    }
    return false;
  }
}
