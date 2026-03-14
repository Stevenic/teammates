/**
 * Buffered ANSI output writer.
 * Inspired by Consolonia's AnsiConsoleOutput.cs — tracks terminal state
 * to emit minimal escape sequences when writing pixels.
 */

import type { Writable } from "node:stream";
import type { Color } from "../pixel/color.js";
import type { Pixel } from "../pixel/pixel.js";
import * as esc from "./esc.js";

/** Sentinel value meaning "no color has been set yet". */
const NO_COLOR: Color = { r: -1, g: -1, b: -1, a: -1 };

function colorsEqual(a: Color, b: Color): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b;
}

/**
 * Buffered ANSI writer that accumulates escape sequences in a string buffer
 * and flushes them in a single write to the underlying stream.
 */
export class AnsiOutput {
  private readonly stream: Writable;
  private buf: string = "";

  // ── Tracked state to avoid redundant escapes ──────────────────────

  private lastX: number = -1;
  private lastY: number = -1;
  private lastFgColor: Color = NO_COLOR;
  private lastBgColor: Color = NO_COLOR;
  private lastBold: boolean = false;
  private lastItalic: boolean = false;
  private lastUnderline: boolean = false;
  private lastStrikethrough: boolean = false;

  constructor(stream?: Writable) {
    this.stream = stream ?? process.stdout;
  }

  // ── Low-level append ──────────────────────────────────────────────

  /** Append raw text to the internal buffer. */
  private write(s: string): void {
    this.buf += s;
  }

  // ── Cursor ────────────────────────────────────────────────────────

  /** Move cursor to (x, y) if not already there. */
  setCursor(x: number, y: number): void {
    if (x !== this.lastX || y !== this.lastY) {
      this.write(esc.moveTo(x, y));
      this.lastX = x;
      this.lastY = y;
    }
  }

  /** Emit hide-cursor sequence. */
  hideCursor(): void {
    this.write(esc.hideCursor);
  }

  /** Emit show-cursor sequence. */
  showCursor(): void {
    this.write(esc.showCursor);
  }

  // ── Pixel writing ─────────────────────────────────────────────────

  /**
   * Write a single pixel at (x, y).
   * Cursor is moved only if necessary. Colors and styles are set only when
   * they differ from the previously written state.
   */
  writePixel(x: number, y: number, pixel: Pixel): void {
    this.setCursor(x, y);

    const fgColor = pixel.foreground.color;
    const bgColor = pixel.background.color;
    const { bold: isBold, italic: isItalic, underline: isUnderline, strikethrough: isStrike } =
      pixel.foreground;

    // ── Style toggles (emit only on change) ─────────────────────
    if (isBold !== this.lastBold) {
      this.write(isBold ? esc.bold : esc.boldOff);
      this.lastBold = isBold;
    }
    if (isItalic !== this.lastItalic) {
      this.write(isItalic ? esc.italic : esc.italicOff);
      this.lastItalic = isItalic;
    }
    if (isUnderline !== this.lastUnderline) {
      this.write(isUnderline ? esc.underline : esc.underlineOff);
      this.lastUnderline = isUnderline;
    }
    if (isStrike !== this.lastStrikethrough) {
      this.write(isStrike ? esc.strikethrough : esc.strikethroughOff);
      this.lastStrikethrough = isStrike;
    }

    // ── Foreground color ────────────────────────────────────────
    if (fgColor.a > 0 && !colorsEqual(fgColor, this.lastFgColor)) {
      this.write(esc.fg(fgColor.r, fgColor.g, fgColor.b));
      this.lastFgColor = fgColor;
    } else if (fgColor.a === 0 && this.lastFgColor !== NO_COLOR && this.lastFgColor.a !== 0) {
      this.write(esc.fgDefault);
      this.lastFgColor = NO_COLOR;
    }

    // ── Background color ────────────────────────────────────────
    if (bgColor.a > 0 && !colorsEqual(bgColor, this.lastBgColor)) {
      this.write(esc.bg(bgColor.r, bgColor.g, bgColor.b));
      this.lastBgColor = bgColor;
    } else if (bgColor.a === 0 && this.lastBgColor !== NO_COLOR && this.lastBgColor.a !== 0) {
      this.write(esc.bgDefault);
      this.lastBgColor = NO_COLOR;
    }

    // ── Character ───────────────────────────────────────────────
    const ch = pixel.foreground.symbol.text;
    this.write(ch);
    this.lastX += pixel.foreground.symbol.width;
  }

  /**
   * Write a string starting at (x, y) with optional style overrides.
   * Convenience wrapper that writes character-by-character is wasteful,
   * so instead we set styles once and write the full text.
   */
  writeText(
    x: number,
    y: number,
    text: string,
    style?: {
      fgColor?: Color;
      bgColor?: Color;
      bold?: boolean;
      italic?: boolean;
      underline?: boolean;
      strikethrough?: boolean;
    },
  ): void {
    this.setCursor(x, y);

    if (style) {
      if (style.bold !== undefined && style.bold !== this.lastBold) {
        this.write(style.bold ? esc.bold : esc.boldOff);
        this.lastBold = style.bold;
      }
      if (style.italic !== undefined && style.italic !== this.lastItalic) {
        this.write(style.italic ? esc.italic : esc.italicOff);
        this.lastItalic = style.italic;
      }
      if (style.underline !== undefined && style.underline !== this.lastUnderline) {
        this.write(style.underline ? esc.underline : esc.underlineOff);
        this.lastUnderline = style.underline;
      }
      if (style.strikethrough !== undefined && style.strikethrough !== this.lastStrikethrough) {
        this.write(style.strikethrough ? esc.strikethrough : esc.strikethroughOff);
        this.lastStrikethrough = style.strikethrough;
      }
      if (style.fgColor && (!colorsEqual(style.fgColor, this.lastFgColor))) {
        this.write(esc.fg(style.fgColor.r, style.fgColor.g, style.fgColor.b));
        this.lastFgColor = style.fgColor;
      }
      if (style.bgColor && (!colorsEqual(style.bgColor, this.lastBgColor))) {
        this.write(esc.bg(style.bgColor.r, style.bgColor.g, style.bgColor.b));
        this.lastBgColor = style.bgColor;
      }
    }

    this.write(text);
    this.lastX += text.length;
  }

  // ── Flush ─────────────────────────────────────────────────────────

  /** Write the accumulated buffer to the output stream and clear it. */
  flush(): void {
    if (this.buf.length > 0) {
      this.stream.write(this.buf);
      this.buf = "";
    }
  }

  // ── Terminal setup / teardown ─────────────────────────────────────

  /**
   * Prepare the terminal for full-screen TUI rendering:
   * alternate screen, hide cursor, bracketed paste, mouse tracking.
   */
  prepareTerminal(): void {
    this.write(esc.alternateScreenOn);
    this.write(esc.hideCursor);
    this.write(esc.bracketedPasteOn);
    this.write(esc.mouseTrackingOn);
    this.write(esc.clearScreen);
    this.flush();
    this.resetState();
  }

  /**
   * Restore the terminal to its normal state:
   * disable mouse, disable bracketed paste, show cursor, leave alternate screen.
   */
  restoreTerminal(): void {
    this.write(esc.reset);
    this.write(esc.mouseTrackingOff);
    this.write(esc.bracketedPasteOff);
    this.write(esc.showCursor);
    this.write(esc.alternateScreenOff);
    this.flush();
    this.resetState();
  }

  /** Reset all tracked state so the next write re-emits everything. */
  private resetState(): void {
    this.lastX = -1;
    this.lastY = -1;
    this.lastFgColor = NO_COLOR;
    this.lastBgColor = NO_COLOR;
    this.lastBold = false;
    this.lastItalic = false;
    this.lastUnderline = false;
    this.lastStrikethrough = false;
  }
}
