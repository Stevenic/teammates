/**
 * Dirty-region tracking for incremental rendering.
 * Port of Consolonia's Regions.cs / Snapshot pattern.
 *
 * Maintains a list of dirty rectangles and provides a snapshot mechanism
 * so the renderer can consume the current set while new rects accumulate.
 */
import type { Rect } from '../layout/types.js';
/**
 * A frozen snapshot of dirty rectangles at the moment it was taken.
 * The renderer iterates cells and calls `contains(x, y)` to decide
 * whether a given cell needs to be re-drawn.
 */
export declare class DirtySnapshot {
    private readonly _rects;
    constructor(rects: readonly Rect[]);
    /**
     * Returns true if (x, y) falls inside any of the snapshot's rectangles.
     * Uses exclusive upper bounds: a Rect {x:0, y:0, width:10, height:5}
     * contains columns 0-9 and rows 0-4.
     */
    contains(x: number, y: number): boolean;
}
/**
 * Accumulates dirty rectangles.  Before each render pass the renderer
 * calls `getSnapshotAndClear()` which atomically captures the current
 * set and resets the internal list so new mutations can be collected
 * while the frame is being drawn.
 */
export declare class DirtyRegions {
    private _rects;
    /**
     * Register a rectangle as dirty.
     *
     * Optimisations (mirroring the C# Regions.AddRect):
     *  - If `rect` is empty (width or height <= 0), it is ignored.
     *  - If an existing rect already fully contains the new one, skip.
     *  - If the new rect fully contains an existing one, remove the existing one.
     */
    addRect(rect: Rect): void;
    /**
     * Check whether a point is inside any tracked dirty region.
     * Uses exclusive upper bounds (same semantics as DirtySnapshot.contains).
     */
    contains(x: number, y: number): boolean;
    /**
     * Capture a snapshot of the current dirty rects and reset the list.
     */
    getSnapshotAndClear(): DirtySnapshot;
    /**
     * Discard all tracked regions without creating a snapshot.
     */
    clear(): void;
}
