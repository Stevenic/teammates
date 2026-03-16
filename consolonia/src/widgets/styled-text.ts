/**
 * StyledText — text display widget that renders multi-styled lines.
 *
 * Unlike Text (which applies one TextStyle to the whole block), StyledText
 * accepts StyledSpan lines where each segment can have its own color,
 * bold, italic, etc.  Plain strings are also accepted and rendered with
 * a default style.
 *
 * Supports word wrapping, but wrapping is computed on the plain-text
 * representation and styles are carried across wrap boundaries.
 */

import type { DrawingContext, TextStyle } from "../drawing/context.js";
import { Control } from "../layout/control.js";
import type { Constraint, Size } from "../layout/types.js";
import { charWidth, stringDisplayWidth } from "../pixel/symbol.js";
import { type StyledSegment, type StyledSpan, spanLength } from "../styled.js";

// ── Types ────────────────────────────────────────────────────────

/** A line of styled text: either a StyledSpan or a plain string. */
export type StyledLine = StyledSpan | string;

export interface StyledTextOptions {
  lines?: StyledLine[];
  defaultStyle?: TextStyle;
  wrap?: boolean;
}

// ── Widget ───────────────────────────────────────────────────────

export class StyledText extends Control {
  private _lines: StyledLine[];
  private _defaultStyle: TextStyle;
  private _wrap: boolean;

  /** Cached wrapped lines from the last measure pass. */
  private _wrapped: StyledLine[] = [];

  constructor(options: StyledTextOptions = {}) {
    super();
    this._lines = options.lines ?? [];
    this._defaultStyle = options.defaultStyle ?? {};
    this._wrap = options.wrap ?? false;
  }

  // ── Properties ─────────────────────────────────────────────────

  get lines(): StyledLine[] {
    return this._lines;
  }

  set lines(value: StyledLine[]) {
    this._lines = value;
    this.invalidate();
  }

  get defaultStyle(): TextStyle {
    return this._defaultStyle;
  }

  set defaultStyle(value: TextStyle) {
    this._defaultStyle = value;
    this.invalidate();
  }

  get wrap(): boolean {
    return this._wrap;
  }

  set wrap(value: boolean) {
    if (this._wrap !== value) {
      this._wrap = value;
      this.invalidate();
    }
  }

  // ── Layout ─────────────────────────────────────────────────────

  measure(constraint: Constraint): Size {
    if (this._lines.length === 0) {
      this._wrapped = [];
      return { width: 0, height: 0 };
    }

    if (!this._wrap) {
      this._wrapped = this._lines;
      const maxW = this._lines.reduce(
        (max, line) => Math.max(max, lineLength(line)),
        0,
      );
      return {
        width: Math.min(maxW, constraint.maxWidth),
        height: Math.min(this._lines.length, constraint.maxHeight),
      };
    }

    // Word-wrap mode
    const maxW = constraint.maxWidth;
    if (maxW <= 0) {
      this._wrapped = [];
      return { width: 0, height: 0 };
    }

    const wrapped: StyledLine[] = [];
    for (const line of this._lines) {
      const sub = wrapStyledLine(line, maxW);
      wrapped.push(...sub);
    }
    this._wrapped = wrapped;

    const longestW = wrapped.reduce(
      (max, line) => Math.max(max, lineLength(line)),
      0,
    );
    return {
      width: Math.min(longestW, constraint.maxWidth),
      height: Math.min(wrapped.length, constraint.maxHeight),
    };
  }

  render(ctx: DrawingContext): void {
    const bounds = this.bounds;
    if (!bounds || this._wrapped.length === 0) return;

    for (let i = 0; i < this._wrapped.length && i < bounds.height; i++) {
      const line = this._wrapped[i];
      if (typeof line === "string") {
        ctx.drawText(bounds.x, bounds.y + i, line, this._defaultStyle);
      } else {
        // Apply defaultStyle as fallback for segments without explicit colors
        const merged = line.map((seg) => ({
          text: seg.text,
          style: mergeStyles(this._defaultStyle, seg.style),
        }));
        ctx.drawStyledText(bounds.x, bounds.y + i, merged);
      }
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────

function lineLength(line: StyledLine): number {
  if (typeof line === "string") return stringDisplayWidth(line);
  return spanLength(line);
}

/** Merge a default style with a segment's explicit style. */
function mergeStyles(base: TextStyle, over: TextStyle): TextStyle {
  return {
    fg: over.fg ?? base.fg,
    bg: over.bg ?? base.bg,
    bold: over.bold ?? base.bold,
    italic: over.italic ?? base.italic,
    underline: over.underline ?? base.underline,
    strikethrough: over.strikethrough ?? base.strikethrough,
  };
}

/**
 * Wrap a styled line to fit within maxWidth.
 * For plain strings, standard word-wrap. For StyledSpans,
 * we wrap on the concatenated text and split segments at boundaries.
 */
function wrapStyledLine(line: StyledLine, maxWidth: number): StyledLine[] {
  if (typeof line === "string") {
    return wrapPlainLine(line, maxWidth);
  }

  // Flatten to a stream of { char, style } for wrap calculation
  const chars: { char: string; style: TextStyle }[] = [];
  for (const seg of line) {
    for (const ch of seg.text) {
      chars.push({ char: ch, style: seg.style });
    }
  }

  if (chars.length <= maxWidth) return [line];

  // Simple hard-wrap at maxWidth (word-aware wrap is complex for styled text)
  const result: StyledLine[] = [];
  for (let start = 0; start < chars.length; start += maxWidth) {
    const slice = chars.slice(start, start + maxWidth);
    // Coalesce consecutive chars with same style into segments
    const segments: StyledSegment[] = [];
    let cur: StyledSegment | null = null;
    for (const { char, style } of slice) {
      if (cur && cur.style === style) {
        cur.text += char;
      } else {
        if (cur) segments.push(cur);
        cur = { text: char, style };
      }
    }
    if (cur) segments.push(cur);
    result.push(segments as StyledLine as StyledSpan);
  }
  return result;
}

function wrapPlainLine(text: string, maxWidth: number): string[] {
  if (stringDisplayWidth(text) <= maxWidth) return [text];
  const result: string[] = [];
  let current = "";
  let currentWidth = 0;
  for (const char of text) {
    const w = charWidth(char.codePointAt(0)!);
    if (currentWidth + w > maxWidth && current.length > 0) {
      result.push(current);
      current = char;
      currentWidth = w;
    } else {
      current += char;
      currentWidth += w;
    }
  }
  if (current) result.push(current);
  return result;
}
