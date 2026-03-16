/**
 * DrawingContext: the main drawing API for rendering to a PixelBuffer.
 *
 * Port of Consolonia's DrawingContextImpl.cs + DrawingContextImpl.Boxes.cs,
 * simplified for the Node.js/TypeScript environment.
 */

import type { Rect } from "../layout/types.js";
import { background } from "../pixel/background.js";
import {
  boxChar,
  DOWN,
  LEFT,
  mergeBoxPatterns,
  RIGHT,
  UP,
} from "../pixel/box-pattern.js";
import type { PixelBuffer } from "../pixel/buffer.js";
import type { Color } from "../pixel/color.js";
import { foreground } from "../pixel/foreground.js";
import type { Pixel } from "../pixel/pixel.js";
import { blendPixel } from "../pixel/pixel.js";
import { charWidth, isZeroWidth, sym } from "../pixel/symbol.js";
import { ClipStack } from "./clip.js";

// ── Style interfaces ──────────────────────────────────────────────

export interface TextStyle {
  fg?: Color;
  bg?: Color;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
}

export interface BoxStyle {
  fg?: Color;
  bg?: Color;
  bold?: boolean;
}

// ── Defaults ──────────────────────────────────────────────────────

const DEFAULT_FG: Color = { r: 255, g: 255, b: 255, a: 255 };
const TRANSPARENT: Color = { r: 0, g: 0, b: 0, a: 0 };
const TAB_WIDTH = 4;

// ── DrawingContext ────────────────────────────────────────────────

export class DrawingContext {
  private readonly buffer: PixelBuffer;
  private readonly clipStack: ClipStack;
  private translateStack: { dx: number; dy: number }[] = [];
  private offsetX = 0;
  private offsetY = 0;

  constructor(buffer: PixelBuffer) {
    this.buffer = buffer;
    this.clipStack = new ClipStack();
  }

  // ── Clip management ──────────────────────────────────────────

  /** Push a clip rectangle. All drawing is clipped to this region. */
  pushClip(rect: Rect): void {
    this.clipStack.push(rect);
  }

  /** Pop the last clip rectangle. */
  popClip(): void {
    this.clipStack.pop();
  }

  // ── Translate management ───────────────────────────────────

  /** Push a coordinate translation. All drawing coordinates are offset. */
  pushTranslate(dx: number, dy: number): void {
    this.translateStack.push({ dx: this.offsetX, dy: this.offsetY });
    this.offsetX += dx;
    this.offsetY += dy;
  }

  /** Pop the last coordinate translation. */
  popTranslate(): void {
    const prev = this.translateStack.pop();
    if (prev) {
      this.offsetX = prev.dx;
      this.offsetY = prev.dy;
    } else {
      this.offsetX = 0;
      this.offsetY = 0;
    }
  }

  // ── Visibility check ────────────────────────────────────────

  /** Translate a point by the current offset. */
  private tx(x: number): number {
    return x + this.offsetX;
  }
  private ty(y: number): number {
    return y + this.offsetY;
  }

  /** Check if a local-coord point is visible after translate. */
  private isVisible(x: number, y: number): boolean {
    const wx = this.tx(x);
    const wy = this.ty(y);
    if (
      wx < 0 ||
      wx >= this.buffer.width ||
      wy < 0 ||
      wy >= this.buffer.height
    ) {
      return false;
    }
    return this.clipStack.contains(wx, wy);
  }

  /** Get a pixel at local coordinates (translated to buffer coords). */
  private bufGet(x: number, y: number): Pixel {
    return this.buffer.get(this.tx(x), this.ty(y));
  }

  /** Set a pixel at local coordinates (translated to buffer coords). */
  private bufSet(x: number, y: number, px: Pixel): void {
    this.buffer.set(this.tx(x), this.ty(y), px);
  }

  // ── Fill ─────────────────────────────────────────────────────

  /** Fill a rectangle with a solid color. */
  fillRect(rect: Rect, color: Color): void {
    const bg = background(color);
    const fg = foreground(sym(" "), TRANSPARENT);
    const px: Pixel = { foreground: fg, background: bg };

    for (let y = rect.y; y < rect.y + rect.height; y++) {
      for (let x = rect.x; x < rect.x + rect.width; x++) {
        if (this.isVisible(x, y)) {
          this.bufSet(x, y, blendPixel(px, this.bufGet(x, y)));
        }
      }
    }
  }

  // ── Single character ─────────────────────────────────────────

  /** Draw a single character at (x, y) with styling. */
  drawChar(x: number, y: number, char: string, style?: TextStyle): void {
    if (!this.isVisible(x, y)) return;

    const fgColor = style?.fg ?? DEFAULT_FG;
    const bgColor = style?.bg ?? TRANSPARENT;

    const s = sym(char);
    const fg = foreground(s, fgColor, {
      bold: style?.bold ?? false,
      italic: style?.italic ?? false,
      underline: style?.underline ?? false,
      strikethrough: style?.strikethrough ?? false,
    });
    const bg = background(bgColor);
    const px: Pixel = { foreground: fg, background: bg };

    this.bufSet(x, y, blendPixel(px, this.bufGet(x, y)));

    // Wide characters need a continuation marker in the next cell
    if (s.width === 2 && this.isVisible(x + 1, y)) {
      const contFg = foreground(sym(""), TRANSPARENT);
      const contPx: Pixel = { foreground: contFg, background: bg };
      this.bufSet(x + 1, y, blendPixel(contPx, this.bufGet(x + 1, y)));
    }
  }

  // ── Text string ──────────────────────────────────────────────

  /** Draw a text string at (x, y). Handles wide characters and tabs. */
  drawText(x: number, y: number, text: string, style?: TextStyle): void {
    let cx = x;

    for (const char of text) {
      // Handle tab characters as spaces
      if (char === "\t") {
        for (let i = 0; i < TAB_WIDTH; i++) {
          this.drawChar(cx, y, " ", style);
          cx++;
        }
        continue;
      }

      // Skip control characters and zero-width characters (variation
      // selectors, ZWJ, combining marks, etc.) — they have no visual
      // representation and would render as "missing glyph" boxes.
      const cp = char.codePointAt(0)!;
      if (cp < 0x20 && cp !== 0x09) continue;
      if (isZeroWidth(cp)) continue;

      const w = charWidth(cp);
      this.drawChar(cx, y, char, style);
      cx += w;
    }
  }

  // ── Styled text (segment arrays) ────────────────────────────

  /**
   * Draw an array of styled segments at (x, y).
   * Each segment carries its own TextStyle; segments are drawn sequentially.
   */
  drawStyledText(
    x: number,
    y: number,
    segments: { text: string; style: TextStyle }[],
  ): void {
    let cx = x;
    for (const seg of segments) {
      for (const char of seg.text) {
        if (char === "\t") {
          for (let i = 0; i < TAB_WIDTH; i++) {
            this.drawChar(cx, y, " ", seg.style);
            cx++;
          }
          continue;
        }
        const cp = char.codePointAt(0)!;
        if (cp < 0x20 && cp !== 0x09) continue;
        if (isZeroWidth(cp)) continue;
        const w = charWidth(cp);
        this.drawChar(cx, y, char, seg.style);
        cx += w;
      }
    }
  }

  // ── Box drawing ──────────────────────────────────────────────

  /** Draw a box-drawing rectangle (border) with smart corner merging. */
  drawBox(rect: Rect, style?: BoxStyle): void {
    const { x, y, width, height } = rect;
    if (width < 1 || height < 1) return;

    const fgColor = style?.fg ?? DEFAULT_FG;
    const bgColor = style?.bg ?? TRANSPARENT;
    const bold = style?.bold ?? false;

    // Single cell box — draw a cross
    if (width === 1 && height === 1) {
      this.drawBoxChar(x, y, UP | RIGHT | DOWN | LEFT, fgColor, bgColor, bold);
      return;
    }

    // Single column box
    if (width === 1) {
      this.drawBoxChar(x, y, DOWN, fgColor, bgColor, bold); // top
      for (let dy = 1; dy < height - 1; dy++) {
        this.drawBoxChar(x, y + dy, UP | DOWN, fgColor, bgColor, bold);
      }
      this.drawBoxChar(x, y + height - 1, UP, fgColor, bgColor, bold); // bottom
      return;
    }

    // Single row box
    if (height === 1) {
      this.drawBoxChar(x, y, RIGHT, fgColor, bgColor, bold); // left
      for (let dx = 1; dx < width - 1; dx++) {
        this.drawBoxChar(x + dx, y, LEFT | RIGHT, fgColor, bgColor, bold);
      }
      this.drawBoxChar(x + width - 1, y, LEFT, fgColor, bgColor, bold); // right
      return;
    }

    // Corners
    this.drawBoxChar(x, y, DOWN | RIGHT, fgColor, bgColor, bold); // top-left
    this.drawBoxChar(x + width - 1, y, DOWN | LEFT, fgColor, bgColor, bold); // top-right
    this.drawBoxChar(x, y + height - 1, UP | RIGHT, fgColor, bgColor, bold); // bottom-left
    this.drawBoxChar(
      x + width - 1,
      y + height - 1,
      UP | LEFT,
      fgColor,
      bgColor,
      bold,
    ); // bottom-right

    // Top and bottom edges
    for (let dx = 1; dx < width - 1; dx++) {
      this.drawBoxChar(x + dx, y, LEFT | RIGHT, fgColor, bgColor, bold); // top
      this.drawBoxChar(
        x + dx,
        y + height - 1,
        LEFT | RIGHT,
        fgColor,
        bgColor,
        bold,
      ); // bottom
    }

    // Left and right edges
    for (let dy = 1; dy < height - 1; dy++) {
      this.drawBoxChar(x, y + dy, UP | DOWN, fgColor, bgColor, bold); // left
      this.drawBoxChar(
        x + width - 1,
        y + dy,
        UP | DOWN,
        fgColor,
        bgColor,
        bold,
      ); // right
    }
  }

  /**
   * Draw a single box-drawing character at (x, y), merging with any existing
   * box pattern at that position.
   */
  private drawBoxChar(
    x: number,
    y: number,
    pattern: number,
    fgColor: Color,
    bgColor: Color,
    bold: boolean,
  ): void {
    if (!this.isVisible(x, y)) return;

    // Check if there's already a box pattern at this position
    const existing = this.bufGet(x, y);
    const existingPattern = existing.foreground.symbol.pattern;
    const mergedPattern =
      existingPattern !== 0
        ? mergeBoxPatterns(existingPattern, pattern)
        : pattern;

    const char = boxChar(mergedPattern);
    const s = sym(char, mergedPattern);
    const fg = foreground(s, fgColor, { bold });
    const bg = background(bgColor);
    const px: Pixel = { foreground: fg, background: bg };

    this.bufSet(x, y, blendPixel(px, this.bufGet(x, y)));
  }

  // ── Lines ────────────────────────────────────────────────────

  /** Draw a horizontal line using box-drawing characters. */
  drawHLine(x: number, y: number, width: number, style?: TextStyle): void {
    const fgColor = style?.fg ?? DEFAULT_FG;
    const bgColor = style?.bg ?? TRANSPARENT;
    const bold = style?.bold ?? false;

    for (let dx = 0; dx < width; dx++) {
      this.drawBoxChar(x + dx, y, LEFT | RIGHT, fgColor, bgColor, bold);
    }
  }

  /** Draw a vertical line using box-drawing characters. */
  drawVLine(x: number, y: number, height: number, style?: TextStyle): void {
    const fgColor = style?.fg ?? DEFAULT_FG;
    const bgColor = style?.bg ?? TRANSPARENT;
    const bold = style?.bold ?? false;

    for (let dy = 0; dy < height; dy++) {
      this.drawBoxChar(x, y + dy, UP | DOWN, fgColor, bgColor, bold);
    }
  }

  // ── Raw pixel operations ─────────────────────────────────────

  /** Set a pixel directly. Respects clip. */
  setPixel(x: number, y: number, pixel: Pixel): void {
    if (!this.isVisible(x, y)) return;
    this.bufSet(x, y, pixel);
  }

  /** Blend a pixel at (x, y) with what's already there. Respects clip. */
  blendPixel(x: number, y: number, pixel: Pixel): void {
    if (!this.isVisible(x, y)) return;
    this.bufSet(x, y, blendPixel(pixel, this.bufGet(x, y)));
  }
}
