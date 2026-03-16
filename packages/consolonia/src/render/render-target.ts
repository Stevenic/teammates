/**
 * RenderTarget — incremental pixel renderer.
 * Port of Consolonia's RenderTarget.cs.
 *
 * Compares the current PixelBuffer against a cached copy of what was
 * last written to output, and only emits ANSI sequences for cells that
 * have actually changed *and* fall inside the current dirty regions.
 */

import type { AnsiOutput } from "../ansi/output.js";
import type { PixelBuffer } from "../pixel/buffer.js";
import type { Pixel } from "../pixel/pixel.js";
import { DirtyRegions } from "./regions.js";

export class RenderTarget {
  private readonly _buffer: PixelBuffer;
  private readonly _output: AnsiOutput;

  /** 2-D cache indexed [y][x]. null means "never rendered at this cell". */
  private _cache: (Pixel | null)[][];

  constructor(buffer: PixelBuffer, output: AnsiOutput) {
    this._buffer = buffer;
    this._output = output;
    this._cache = this._initCache(buffer.width, buffer.height);
  }

  // ── Public API ──────────────────────────────────────────────────

  /**
   * Render only the cells that are both inside a dirty region *and*
   * differ from the cached version last written to output.
   */
  render(dirtyRegions: DirtyRegions): void {
    const snapshot = dirtyRegions.getSnapshotAndClear();

    this._output.hideCursor();

    for (let y = 0; y < this._buffer.height; y++) {
      for (let x = 0; x < this._buffer.width; x++) {
        if (!snapshot.contains(x, y)) continue;

        const pixel = this._buffer.get(x, y);
        const cached = this._cache[y][x];

        if (cached !== null && pixelsEqual(pixel, cached)) continue;

        this._output.writePixel(x, y, pixel);
        this._cache[y][x] = pixel;
      }
    }

    this._output.flush();
  }

  /**
   * Recreate the cache at new dimensions.  Every cell is set to null
   * so the next render pass will treat everything as dirty.
   */
  resize(width: number, height: number): void {
    this._cache = this._initCache(width, height);
  }

  /**
   * Mark the entire buffer as dirty and perform a full render pass.
   */
  fullRender(): void {
    const regions = new DirtyRegions();
    regions.addRect({
      x: 0,
      y: 0,
      width: this._buffer.width,
      height: this._buffer.height,
    });
    this.render(regions);
  }

  /**
   * Retrieve the cached pixel at (x, y) — useful for tests.
   * Returns null if the cell has never been rendered.
   */
  getCachePixel(x: number, y: number): Pixel | null {
    if (y < 0 || y >= this._cache.length) return null;
    if (x < 0 || x >= this._cache[y].length) return null;
    return this._cache[y][x];
  }

  // ── Internal ────────────────────────────────────────────────────

  /**
   * Build a fresh cache grid filled with null (meaning "unknown / never rendered").
   */
  private _initCache(width: number, height: number): (Pixel | null)[][] {
    const cache: (Pixel | null)[][] = [];
    for (let y = 0; y < height; y++) {
      const row: (Pixel | null)[] = new Array(width).fill(null);
      cache.push(row);
    }
    return cache;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Shallow structural equality for two Pixel values.
 *
 * Pixels are plain data objects so reference equality is almost never
 * true.  We compare every leaf field instead.  The implementation is
 * kept deliberately simple — if the Pixel type grows, this function
 * must be updated.
 */
function pixelsEqual(a: Pixel, b: Pixel): boolean {
  // Fast path: same reference.
  if (a === b) return true;

  // Compare foreground
  const af = a.foreground;
  const bf = b.foreground;
  if (af.symbol.text !== bf.symbol.text) return false;
  if (af.symbol.width !== bf.symbol.width) return false;
  if (!colorsEq(af.color, bf.color)) return false;

  // Compare background
  const ab = a.background;
  const bb = b.background;
  if (!colorsEq(ab.color, bb.color)) return false;

  return true;
}

/** Fast inline color equality (avoids importing colorsEqual). */
function colorsEq(
  a: { r: number; g: number; b: number; a: number },
  b: { r: number; g: number; b: number; a: number },
): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}
