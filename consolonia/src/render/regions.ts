/**
 * Dirty-region tracking for incremental rendering.
 * Port of Consolonia's Regions.cs / Snapshot pattern.
 *
 * Maintains a list of dirty rectangles and provides a snapshot mechanism
 * so the renderer can consume the current set while new rects accumulate.
 */

import type { Rect } from '../layout/types.js';

// ── Snapshot ────────────────────────────────────────────────────────

/**
 * A frozen snapshot of dirty rectangles at the moment it was taken.
 * The renderer iterates cells and calls `contains(x, y)` to decide
 * whether a given cell needs to be re-drawn.
 */
export class DirtySnapshot {
  private readonly _rects: readonly Rect[];

  constructor(rects: readonly Rect[]) {
    this._rects = rects;
  }

  /**
   * Returns true if (x, y) falls inside any of the snapshot's rectangles.
   * Uses exclusive upper bounds: a Rect {x:0, y:0, width:10, height:5}
   * contains columns 0-9 and rows 0-4.
   */
  contains(x: number, y: number): boolean {
    for (const r of this._rects) {
      if (
        x >= r.x &&
        x < r.x + r.width &&
        y >= r.y &&
        y < r.y + r.height
      ) {
        return true;
      }
    }
    return false;
  }
}

// ── DirtyRegions ────────────────────────────────────────────────────

/**
 * Accumulates dirty rectangles.  Before each render pass the renderer
 * calls `getSnapshotAndClear()` which atomically captures the current
 * set and resets the internal list so new mutations can be collected
 * while the frame is being drawn.
 */
export class DirtyRegions {
  private _rects: Rect[] = [];

  /**
   * Register a rectangle as dirty.
   *
   * Optimisations (mirroring the C# Regions.AddRect):
   *  - If `rect` is empty (width or height <= 0), it is ignored.
   *  - If an existing rect already fully contains the new one, skip.
   *  - If the new rect fully contains an existing one, remove the existing one.
   */
  addRect(rect: Rect): void {
    if (rect.width <= 0 || rect.height <= 0) return;

    for (let i = 0; i < this._rects.length; i++) {
      const existing = this._rects[i];

      // Existing rect contains the new one — nothing to add.
      if (rectContains(existing, rect)) return;

      // New rect contains the existing one — remove existing.
      if (rectContains(rect, existing)) {
        this._rects.splice(i, 1);
        i--;
      }
    }

    this._rects.push(rect);
  }

  /**
   * Check whether a point is inside any tracked dirty region.
   * Uses exclusive upper bounds (same semantics as DirtySnapshot.contains).
   */
  contains(x: number, y: number): boolean {
    for (const r of this._rects) {
      if (
        x >= r.x &&
        x < r.x + r.width &&
        y >= r.y &&
        y < r.y + r.height
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Capture a snapshot of the current dirty rects and reset the list.
   */
  getSnapshotAndClear(): DirtySnapshot {
    const snapshot = new DirtySnapshot([...this._rects]);
    this._rects = [];
    return snapshot;
  }

  /**
   * Discard all tracked regions without creating a snapshot.
   */
  clear(): void {
    this._rects = [];
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Returns true when `outer` fully contains `inner` (exclusive upper bound).
 */
function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}
