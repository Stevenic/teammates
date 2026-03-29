/**
 * VirtualList — Reusable scrollable widget for terminal UIs.
 *
 * Handles virtual scrolling, height caching (by item ID), screen-to-item
 * mapping for hit-testing, and scrollbar rendering. Extracted from ChatView
 * as part of the widget model redesign (Phase 2).
 */

import type { DrawingContext, TextStyle } from "../drawing/context.js";
import { Control } from "../layout/control.js";
import type { Constraint, Rect, Size } from "../layout/types.js";

// ── Types ──────────────────────────────────────────────────────────

/** An item renderable by VirtualList. */
export interface VirtualListItem {
  /** Stable unique ID (used for height cache keying). */
  readonly id: string;
  /** The renderable content — must support measure/arrange/render. */
  readonly content: {
    measure(constraint: Constraint): Size;
    arrange(rect: Rect): void;
    render(ctx: DrawingContext): void;
  };
  /** Whether this item is currently hidden (takes zero height). */
  hidden?: boolean;
}

export interface VirtualListOptions {
  /** Style for the scrollbar track. */
  trackStyle?: TextStyle;
  /** Style for the scrollbar thumb. */
  thumbStyle?: TextStyle;
}

// ── VirtualList ────────────────────────────────────────────────────

export class VirtualList extends Control {
  private _items: VirtualListItem[] = [];

  // ── Scroll state ──────────────────────────────────────────────
  private _scrollOffset = 0;
  private _userScrolledAway = false;
  private _maxScroll = 0;

  // ── Height cache (keyed by item ID, cleared on width change) ──
  private _heightCache = new Map<string, number>();
  private _cacheWidth = -1;

  // ── Screen mapping (rebuilt each render) ──────────────────────
  private _screenToItemIdx = new Map<number, number>();
  private _screenToRow = new Map<number, number>();

  // ── Scrollbar state ───────────────────────────────────────────
  private _scrollbarX = -1;
  private _scrollbarVisible = false;
  private _thumbPos = 0;
  private _thumbSize = 0;
  private _dragging = false;
  private _dragOffsetY = 0;

  // ── Styles ────────────────────────────────────────────────────
  private _trackStyle: TextStyle;
  private _thumbStyle: TextStyle;

  // ── Content geometry (set during render, used by callers) ─────
  private _contentWidth = 0;

  /** Called after items render but before clip pops. For selection overlay etc. */
  onRenderOverlay?: (
    ctx: DrawingContext,
    x: number,
    y: number,
    width: number,
    height: number,
  ) => void;

  constructor(options: VirtualListOptions = {}) {
    super();
    this._trackStyle = options.trackStyle ?? {};
    this._thumbStyle = options.thumbStyle ?? {};
  }

  // ── Public: Items ─────────────────────────────────────────────

  set items(items: VirtualListItem[]) {
    this._items = items;
  }

  get items(): VirtualListItem[] {
    return this._items;
  }

  // ── Public: Scroll ────────────────────────────────────────────

  /** Scroll by delta rows (positive = down, negative = up). */
  scroll(delta: number): void {
    this._scrollOffset = Math.max(0, this._scrollOffset + delta);
    this._userScrolledAway = this._scrollOffset < this._maxScroll;
  }

  /** Scroll to the very bottom. Resets the "scrolled away" flag. */
  scrollToBottom(): void {
    this._userScrolledAway = false;
    this._scrollOffset = Number.MAX_SAFE_INTEGER;
  }

  /** Auto-scroll to bottom if the user hasn't scrolled away. */
  autoScrollToBottom(): void {
    if (this._userScrolledAway) return;
    this._scrollOffset = Number.MAX_SAFE_INTEGER;
  }

  /** Whether the user has scrolled away from the bottom. */
  get isScrolledAway(): boolean {
    return this._userScrolledAway;
  }

  // ── Public: Height cache ──────────────────────────────────────

  /** Invalidate cached height for a single item (e.g. after content change). */
  invalidateItem(id: string): void {
    this._heightCache.delete(id);
  }

  /** Invalidate all cached heights. */
  invalidateAllHeights(): void {
    this._heightCache.clear();
    this._cacheWidth = -1;
  }

  /** Reset all state (scroll, cache, maps). Used when feed is cleared. */
  reset(): void {
    this._scrollOffset = 0;
    this._userScrolledAway = false;
    this._maxScroll = 0;
    this._heightCache.clear();
    this._cacheWidth = -1;
    this._screenToItemIdx.clear();
    this._screenToRow.clear();
    this._scrollbarVisible = false;
  }

  // ── Public: Hit-testing ───────────────────────────────────────

  /** Get the item index (in the items array) at a screen Y coordinate. Returns -1 if none. */
  itemIndexAtScreen(screenY: number): number {
    return this._screenToItemIdx.get(screenY) ?? -1;
  }

  /** Get the row offset within the item at a screen Y coordinate. */
  rowAtScreen(screenY: number): number {
    return this._screenToRow.get(screenY) ?? 0;
  }

  // ── Public: Scrollbar geometry ────────────────────────────────

  get scrollbarVisible(): boolean {
    return this._scrollbarVisible;
  }

  get scrollbarX(): number {
    return this._scrollbarX;
  }

  get maxScroll(): number {
    return this._maxScroll;
  }

  get contentWidth(): number {
    return this._contentWidth;
  }

  get isDragging(): boolean {
    return this._dragging;
  }

  // ── Public: Scrollbar interaction ─────────────────────────────

  /** Handle a mouse press on the scrollbar. */
  handleScrollbarPress(screenY: number): void {
    const b = this.bounds;
    if (!b) return;
    const relY = screenY - b.y;
    if (relY >= this._thumbPos && relY < this._thumbPos + this._thumbSize) {
      this._dragging = true;
      this._dragOffsetY = relY - this._thumbPos;
    } else {
      // Click-to-position
      const ratio = relY / b.height;
      this._scrollOffset = Math.round(ratio * this._maxScroll);
      this._scrollOffset = Math.max(
        0,
        Math.min(this._scrollOffset, this._maxScroll),
      );
      this._userScrolledAway = this._scrollOffset < this._maxScroll;
    }
  }

  /** Handle a mouse drag on the scrollbar. */
  handleScrollbarDrag(screenY: number): void {
    const b = this.bounds;
    if (!b || !this._dragging) return;
    const relY = screenY - b.y;
    const newThumbPos = relY - this._dragOffsetY;
    const maxThumbPos = b.height - this._thumbSize;
    const clampedPos = Math.max(0, Math.min(newThumbPos, maxThumbPos));
    const ratio = maxThumbPos > 0 ? clampedPos / maxThumbPos : 0;
    this._scrollOffset = Math.round(ratio * this._maxScroll);
    this._userScrolledAway = this._scrollOffset < this._maxScroll;
  }

  /** Handle mouse release (end scrollbar drag). */
  handleScrollbarRelease(): void {
    this._dragging = false;
  }

  // ── Control overrides ─────────────────────────────────────────

  override measure(constraint: Constraint): Size {
    const size: Size = {
      width: constraint.maxWidth,
      height: constraint.maxHeight,
    };
    this.desiredSize = size;
    return size;
  }

  override arrange(rect: Rect): void {
    this.bounds = rect;
  }

  override render(ctx: DrawingContext): void {
    const b = this.bounds;
    if (!b || b.width < 1 || b.height < 1) return;

    const width = b.width;
    const height = b.height;
    const contentWidth = width - 1; // reserve 1 col for scrollbar
    this._contentWidth = contentWidth;

    // Invalidate height cache on width change
    if (contentWidth !== this._cacheWidth) {
      this._heightCache.clear();
      this._cacheWidth = contentWidth;
    }

    // Build measured visible items
    const indices: number[] = [];
    const heights: number[] = [];

    for (let i = 0; i < this._items.length; i++) {
      const item = this._items[i];
      if (item.hidden) continue;

      let h = this._heightCache.get(item.id);
      if (h === undefined) {
        const size = item.content.measure({
          minWidth: 0,
          maxWidth: contentWidth,
          minHeight: 0,
          maxHeight: Infinity,
        });
        h = Math.max(1, size.height);
        this._heightCache.set(item.id, h);
      }
      indices.push(i);
      heights.push(h);
    }

    // Total content height
    let totalContentH = 0;
    for (const h of heights) {
      totalContentH += h;
    }

    // Clamp scroll offset
    const maxScroll = Math.max(0, totalContentH - height);
    this._scrollOffset = Math.max(0, Math.min(this._scrollOffset, maxScroll));
    this._maxScroll = maxScroll;

    // Clip to our bounds
    ctx.pushClip({ x: b.x, y: b.y, width, height });

    // Find first visible item
    let skippedRows = 0;
    let startIdx = 0;
    for (let i = 0; i < indices.length; i++) {
      if (skippedRows + heights[i] > this._scrollOffset) break;
      skippedRows += heights[i];
      startIdx = i + 1;
    }

    // Render visible items and build screen→item maps
    this._screenToItemIdx.clear();
    this._screenToRow.clear();
    let cy = b.y - (this._scrollOffset - skippedRows);
    for (let i = startIdx; i < indices.length && cy < b.y + height; i++) {
      const itemIdx = indices[i];
      const item = this._items[itemIdx];
      const h = heights[i];

      item.content.arrange({ x: b.x, y: cy, width: contentWidth, height: h });
      item.content.render(ctx);

      // Map screen rows to item index + row offset
      for (let row = 0; row < h; row++) {
        const screenY = cy + row;
        if (screenY >= b.y && screenY < b.y + height) {
          this._screenToItemIdx.set(screenY, itemIdx);
          this._screenToRow.set(screenY, row);
        }
      }
      cy += h;
    }

    // Render scrollbar
    if (height > 0 && totalContentH > height) {
      const scrollX = b.x + width - 1;
      const thumbSize = Math.max(
        1,
        Math.round((height / totalContentH) * height),
      );
      const thumbPos =
        maxScroll > 0
          ? Math.round((this._scrollOffset / maxScroll) * (height - thumbSize))
          : 0;

      this._scrollbarX = scrollX;
      this._thumbPos = thumbPos;
      this._thumbSize = thumbSize;
      this._scrollbarVisible = true;

      for (let row = 0; row < height; row++) {
        const inThumb = row >= thumbPos && row < thumbPos + thumbSize;
        ctx.drawChar(
          scrollX,
          b.y + row,
          inThumb ? "┃" : "│",
          inThumb ? this._thumbStyle : this._trackStyle,
        );
      }
    } else {
      this._scrollbarVisible = false;
    }

    // Overlay callback (selection, etc.)
    if (this.onRenderOverlay) {
      this.onRenderOverlay(ctx, b.x, b.y, width, height);
    }

    ctx.popClip();
  }
}
