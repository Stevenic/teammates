/**
 * FeedAdapter — Wraps a FeedStore to provide the ThreadFeedView interface.
 *
 * Each thread gets its own FeedAdapter + FeedStore. This replaces the
 * ChatView-direct approach from the old single-feed architecture.
 * Mutations go through the adapter, which creates StyledText objects
 * and pushes them to the underlying FeedStore.
 *
 * When the thread is active (visible in ChatView), mutations also
 * trigger ChatView invalidation and auto-scroll. When the thread is
 * in the background, mutations are silent.
 */

import {
  type ChatView,
  type FeedActionItem,
  FeedStore,
  type StyledLine,
  type StyledSpan,
  StyledText,
  type TextStyle,
} from "@teammates/consolonia";
import type { ThreadFeedView } from "./thread-container.js";

// ── FeedAdapter ──────────────────────────────────────────────────

export class FeedAdapter implements ThreadFeedView {
  readonly store: FeedStore;
  private _feedStyle: TextStyle;
  /** Reference to the ChatView — used to trigger invalidation when active. */
  private _chatView: ChatView | null = null;
  /** Whether this adapter's store is currently the active one in ChatView. */
  private _active = false;

  constructor(store?: FeedStore, feedStyle?: TextStyle) {
    this.store = store ?? new FeedStore();
    this._feedStyle = feedStyle ?? {};
  }

  /** Bind to a ChatView. Call setActive(true) when this feed is visible. */
  bind(chatView: ChatView): void {
    this._chatView = chatView;
  }

  /** Mark this adapter as active (its store is currently displayed in ChatView). */
  setActive(active: boolean): void {
    this._active = active;
  }

  get isActive(): boolean {
    return this._active;
  }

  // ── ThreadFeedView implementation ──────────────────────────────

  get feedLineCount(): number {
    return this.store.length;
  }

  insertToFeed(atIndex: number, text: string): void {
    const content = new StyledText({
      lines: [text],
      defaultStyle: this._feedStyle,
      wrap: true,
    });
    this.store.insert(atIndex, content);
    this._invalidate();
  }

  insertStyledToFeed(atIndex: number, styledLine: StyledSpan): void {
    const content = new StyledText({
      lines: [styledLine],
      defaultStyle: this._feedStyle,
      wrap: true,
    });
    this.store.insert(atIndex, content);
    this._invalidate();
  }

  insertActionList(atIndex: number, actions: FeedActionItem[]): void {
    if (actions.length === 0) return;
    const combined = this._concatSpans(actions.map((a) => a.normalStyle));
    const content = new StyledText({
      lines: [combined],
      defaultStyle: this._feedStyle,
      wrap: false,
    });
    this.store.insert(atIndex, content, {
      items: actions,
      normalStyle: combined,
    });
    this._invalidate();
  }

  setFeedLineHidden(index: number, hidden: boolean): void {
    const item = this.store.at(index);
    if (item) item.hidden = hidden;
    this._invalidate();
  }

  setFeedLinesHidden(startIndex: number, count: number, hidden: boolean): void {
    for (let i = startIndex; i < startIndex + count; i++) {
      const item = this.store.at(i);
      if (item) item.hidden = hidden;
    }
    this._invalidate();
  }

  isFeedLineHidden(index: number): boolean {
    return this.store.at(index)?.hidden === true;
  }

  updateFeedLine(index: number, content: StyledLine): void {
    const item = this.store.at(index);
    if (!item) return;
    item.content.lines = [content];
    item.actions = undefined;
    this._invalidate();
  }

  updateActionList(index: number, actions: FeedActionItem[]): void {
    const item = this.store.at(index);
    if (!item || actions.length === 0) return;
    const combined = this._concatSpans(actions.map((a) => a.normalStyle));
    item.content.lines = [combined];
    item.actions = { items: actions, normalStyle: combined };
    this._invalidate();
  }

  // ── Append methods (for non-threaded content like user messages) ──

  appendToFeed(text: string): void {
    const content = new StyledText({
      lines: [text],
      defaultStyle: this._feedStyle,
      wrap: true,
    });
    this.store.push(content);
    this._invalidate();
  }

  appendStyledToFeed(styledLine: StyledSpan): void {
    const content = new StyledText({
      lines: [styledLine],
      defaultStyle: this._feedStyle,
      wrap: true,
    });
    this.store.push(content);
    this._invalidate();
  }

  appendActionList(actions: FeedActionItem[]): void {
    if (actions.length === 0) return;
    const combined = this._concatSpans(actions.map((a) => a.normalStyle));
    const content = new StyledText({
      lines: [combined],
      defaultStyle: this._feedStyle,
      wrap: false,
    });
    this.store.push(content, { items: actions, normalStyle: combined });
    this._invalidate();
  }

  /** Clear all feed content. */
  clear(): void {
    this.store.clear();
    this._invalidate();
  }

  // ── Internal ──────────────────────────────────────────────────

  private _invalidate(): void {
    if (this._active && this._chatView) {
      this._chatView.invalidate();
    }
  }

  private _concatSpans(spans: StyledLine[]): StyledLine {
    const result: unknown[] = [];
    for (const s of spans) {
      if (Array.isArray(s)) result.push(...s);
      else result.push(s);
    }
    return result as unknown as StyledLine;
  }
}
