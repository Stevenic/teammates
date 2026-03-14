/**
 * PixelBuffer: a 2D grid of Pixel cells representing a terminal surface.
 */
import type { Pixel } from "./pixel.js";
import type { Rect } from "../layout/types.js";
/**
 * A 2D pixel buffer backed by a flat array.
 * Cells are stored row-major: index = y * width + x.
 */
export declare class PixelBuffer {
    readonly width: number;
    readonly height: number;
    private readonly cells;
    constructor(width: number, height: number);
    /** Check whether (x, y) is within bounds. */
    private inBounds;
    /** Get the pixel at (x, y). Returns PIXEL_SPACE for out-of-bounds. */
    get(x: number, y: number): Pixel;
    /** Set the pixel at (x, y). Silently ignores out-of-bounds writes. */
    set(x: number, y: number, pixel: Pixel): void;
    /** Fill a rectangular region with a pixel value, clipped to buffer bounds. */
    fill(rect: Rect, pixel: Pixel): void;
    /** Reset all cells to PIXEL_SPACE. */
    clear(): void;
}
