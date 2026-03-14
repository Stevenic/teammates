/**
 * PixelBuffer: a 2D grid of Pixel cells representing a terminal surface.
 */

import type { Pixel } from "./pixel.js";
import { PIXEL_SPACE } from "./pixel.js";
import type { Rect } from "../layout/types.js";

/**
 * A 2D pixel buffer backed by a flat array.
 * Cells are stored row-major: index = y * width + x.
 */
export class PixelBuffer {
  readonly width: number;
  readonly height: number;
  private readonly cells: Pixel[];

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.cells = new Array<Pixel>(width * height);
    this.cells.fill(PIXEL_SPACE);
  }

  /** Check whether (x, y) is within bounds. */
  private inBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  /** Get the pixel at (x, y). Returns PIXEL_SPACE for out-of-bounds. */
  get(x: number, y: number): Pixel {
    if (!this.inBounds(x, y)) return PIXEL_SPACE;
    return this.cells[y * this.width + x]!;
  }

  /** Set the pixel at (x, y). Silently ignores out-of-bounds writes. */
  set(x: number, y: number, pixel: Pixel): void {
    if (!this.inBounds(x, y)) return;
    this.cells[y * this.width + x] = pixel;
  }

  /** Fill a rectangular region with a pixel value, clipped to buffer bounds. */
  fill(rect: Rect, pixel: Pixel): void {
    const x0 = Math.max(0, rect.x);
    const y0 = Math.max(0, rect.y);
    const x1 = Math.min(this.width, rect.x + rect.width);
    const y1 = Math.min(this.height, rect.y + rect.height);

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        this.cells[y * this.width + x] = pixel;
      }
    }
  }

  /** Reset all cells to PIXEL_SPACE. */
  clear(): void {
    this.cells.fill(PIXEL_SPACE);
  }
}
