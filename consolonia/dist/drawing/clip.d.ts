/**
 * Clip stack: manages a stack of clip rectangles for restricting drawing regions.
 *
 * Each push intersects the new rect with the current top to produce the effective
 * clip. Pop restores the previous effective clip.
 */
import type { Rect } from "../layout/types.js";
export declare class ClipStack {
    /**
     * Stack of effective clip rects. Each entry is the intersection of the
     * pushed rect with its parent. A null entry means the clip is fully
     * degenerate (zero-area) but we still track it so pop() works correctly.
     */
    private readonly stack;
    /** Push a clip rectangle. Drawing outside this rect is ignored. */
    push(rect: Rect): void;
    /** Pop the last clip rectangle. */
    pop(): void;
    /** Check if a point is within the current clip bounds. */
    contains(x: number, y: number): boolean;
    /** Get the current effective clip rect (intersection of all pushed rects). */
    current(): Rect | null;
}
