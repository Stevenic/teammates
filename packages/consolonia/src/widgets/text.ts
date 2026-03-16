/**
 * Static text display widget.
 *
 * Supports word wrapping, text alignment (left/center/right), and
 * multi-line content. Automatically invalidates on text or style changes.
 */

import type { DrawingContext, TextStyle } from "../drawing/context.js";
import { Control } from "../layout/control.js";
import type { Constraint, Size } from "../layout/types.js";

export interface TextOptions {
  text?: string;
  style?: TextStyle;
  wrap?: boolean;
  align?: "left" | "center" | "right";
}

export class Text extends Control {
  private _text: string;
  private _style: TextStyle;
  private _wrap: boolean;
  private _align: "left" | "center" | "right";

  /** Cached wrapped lines from the last measure/render pass. */
  private _lines: string[] = [];

  constructor(options: TextOptions = {}) {
    super();
    this._text = options.text ?? "";
    this._style = options.style ?? {};
    this._wrap = options.wrap ?? false;
    this._align = options.align ?? "left";
  }

  // ── Properties ────────────────────────────────────────────────

  get text(): string {
    return this._text;
  }

  set text(value: string) {
    if (this._text !== value) {
      this._text = value;
      this.invalidate();
    }
  }

  get style(): TextStyle {
    return this._style;
  }

  set style(value: TextStyle) {
    this._style = value;
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

  get align(): "left" | "center" | "right" {
    return this._align;
  }

  set align(value: "left" | "center" | "right") {
    if (this._align !== value) {
      this._align = value;
      this.invalidate();
    }
  }

  // ── Layout ────────────────────────────────────────────────────

  measure(constraint: Constraint): Size {
    if (this._text.length === 0) {
      this._lines = [];
      return { width: 0, height: 0 };
    }

    const rawLines = this._text.split("\n");

    if (!this._wrap) {
      this._lines = rawLines;
      const longestLine = rawLines.reduce(
        (max, line) => Math.max(max, line.length),
        0,
      );
      return {
        width: Math.min(longestLine, constraint.maxWidth),
        height: Math.min(rawLines.length, constraint.maxHeight),
      };
    }

    // Word-wrap mode: wrap to maxWidth
    const maxW = constraint.maxWidth;
    if (maxW <= 0) {
      this._lines = [];
      return { width: 0, height: 0 };
    }

    const wrapped = wrapLines(rawLines, maxW);
    this._lines = wrapped;

    const longestWrapped = wrapped.reduce(
      (max, line) => Math.max(max, line.length),
      0,
    );

    return {
      width: Math.min(longestWrapped, constraint.maxWidth),
      height: Math.min(wrapped.length, constraint.maxHeight),
    };
  }

  render(ctx: DrawingContext): void {
    const bounds = this.bounds;
    if (!bounds || this._lines.length === 0) return;

    const availW = bounds.width;

    for (let i = 0; i < this._lines.length && i < bounds.height; i++) {
      const line = this._lines[i];
      const x = alignOffset(line.length, availW, this._align);
      ctx.drawText(bounds.x + x, bounds.y + i, line, this._style);
    }
  }
}

// ── Helper: word wrapping ──────────────────────────────────────────

/**
 * Wrap an array of raw lines to fit within `maxWidth` columns.
 *
 * Rules:
 * - Break on spaces when possible.
 * - If a single word exceeds `maxWidth`, hard-break it at the width boundary.
 * - Preserve explicit line breaks (already split by caller).
 */
function wrapLines(rawLines: string[], maxWidth: number): string[] {
  const result: string[] = [];

  for (const rawLine of rawLines) {
    if (rawLine.length === 0) {
      result.push("");
      continue;
    }

    const words = rawLine.split(" ");
    let current = "";

    for (let wi = 0; wi < words.length; wi++) {
      const word = words[wi];

      if (word.length === 0) {
        // Consecutive spaces: add a space to current if it fits
        if (current.length < maxWidth) {
          current += " ";
        }
        continue;
      }

      // If the word itself exceeds maxWidth, hard-break it
      if (word.length > maxWidth) {
        // Flush current line first
        if (current.length > 0) {
          result.push(current);
          current = "";
        }
        // Split the long word into chunks
        for (let ci = 0; ci < word.length; ci += maxWidth) {
          const chunk = word.slice(ci, ci + maxWidth);
          if (ci + maxWidth < word.length) {
            result.push(chunk);
          } else {
            current = chunk;
          }
        }
        continue;
      }

      if (current.length === 0) {
        current = word;
      } else if (current.length + 1 + word.length <= maxWidth) {
        current += ` ${word}`;
      } else {
        result.push(current);
        current = word;
      }
    }

    result.push(current);
  }

  return result;
}

// ── Helper: alignment offset ───────────────────────────────────────

function alignOffset(
  textLen: number,
  availWidth: number,
  align: "left" | "center" | "right",
): number {
  if (align === "center") {
    return Math.max(0, Math.floor((availWidth - textLen) / 2));
  }
  if (align === "right") {
    return Math.max(0, availWidth - textLen);
  }
  return 0;
}
