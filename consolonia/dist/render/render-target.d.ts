/**
 * RenderTarget — incremental pixel renderer.
 * Port of Consolonia's RenderTarget.cs.
 *
 * Compares the current PixelBuffer against a cached copy of what was
 * last written to output, and only emits ANSI sequences for cells that
 * have actually changed *and* fall inside the current dirty regions.
 */
import type { Pixel } from '../pixel/pixel.js';
import type { PixelBuffer } from '../pixel/buffer.js';
import type { AnsiOutput } from '../ansi/output.js';
import { DirtyRegions } from './regions.js';
export declare class RenderTarget {
    private readonly _buffer;
    private readonly _output;
    /** 2-D cache indexed [y][x]. null means "never rendered at this cell". */
    private _cache;
    constructor(buffer: PixelBuffer, output: AnsiOutput);
    /**
     * Render only the cells that are both inside a dirty region *and*
     * differ from the cached version last written to output.
     */
    render(dirtyRegions: DirtyRegions): void;
    /**
     * Recreate the cache at new dimensions.  Every cell is set to null
     * so the next render pass will treat everything as dirty.
     */
    resize(width: number, height: number): void;
    /**
     * Mark the entire buffer as dirty and perform a full render pass.
     */
    fullRender(): void;
    /**
     * Retrieve the cached pixel at (x, y) — useful for tests.
     * Returns null if the cell has never been rendered.
     */
    getCachePixel(x: number, y: number): Pixel | null;
    /**
     * Build a fresh cache grid filled with null (meaning "unknown / never rendered").
     */
    private _initCache;
}
