/**
 * Clip stack: manages a stack of clip rectangles for restricting drawing regions.
 *
 * Each push intersects the new rect with the current top to produce the effective
 * clip. Pop restores the previous effective clip.
 */

import type { Rect } from "../layout/types.js";

/**
 * Intersect two rectangles, returning the overlapping region.
 * Returns null if there is no overlap.
 */
function intersectRects(a: Rect, b: Rect): Rect | null {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.width, b.x + b.width);
  const y1 = Math.min(a.y + a.height, b.y + b.height);

  if (x1 <= x0 || y1 <= y0) return null;

  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export class ClipStack {
  /**
   * Stack of effective clip rects. Each entry is the intersection of the
   * pushed rect with its parent. A null entry means the clip is fully
   * degenerate (zero-area) but we still track it so pop() works correctly.
   */
  private readonly stack: (Rect | null)[] = [];

  /** Push a clip rectangle. Drawing outside this rect is ignored. */
  push(rect: Rect): void {
    const top = this.current();
    if (top === null && this.stack.length > 0) {
      // Already fully clipped — intersection stays null
      this.stack.push(null);
    } else if (top === null) {
      // First push — use the rect directly
      this.stack.push(rect);
    } else {
      this.stack.push(intersectRects(top, rect));
    }
  }

  /** Pop the last clip rectangle. */
  pop(): void {
    if (this.stack.length === 0) {
      throw new Error("ClipStack underflow: cannot pop from an empty stack");
    }
    this.stack.pop();
  }

  /** Check if a point is within the current clip bounds. */
  contains(x: number, y: number): boolean {
    const clip = this.current();
    if (clip === null) {
      // No clip means everything is visible (empty stack) or nothing is (degenerate)
      return this.stack.length === 0;
    }
    return (
      x >= clip.x &&
      x < clip.x + clip.width &&
      y >= clip.y &&
      y < clip.y + clip.height
    );
  }

  /** Get the current effective clip rect (intersection of all pushed rects). */
  current(): Rect | null {
    if (this.stack.length === 0) return null;
    return this.stack[this.stack.length - 1] ?? null;
  }
}
