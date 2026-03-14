/**
 * Single-line text input widget — the primary replacement for readline.
 *
 * Handles cursor movement, text editing, history navigation, word-jump,
 * clipboard paste, and visual scrolling when the value exceeds the
 * visible width.
 */

import { Control } from "../layout/control.js";
import type { Size, Constraint, Rect } from "../layout/types.js";
import type { DrawingContext, TextStyle } from "../drawing/context.js";
import type { InputEvent, KeyEvent, PasteEvent } from "../input/events.js";

/** Returns the style to use at each character position in the input value. */
export type InputColorizer = (value: string) => (TextStyle | null)[];

/**
 * Called on backspace/delete to determine how many characters to remove.
 * Receives the value and cursor position. Returns the number of chars to
 * delete (backward for backspace, forward for delete). Default: 1.
 */
export type DeleteSizer = (value: string, cursor: number, direction: "backward" | "forward") => number;

export interface TextInputOptions {
  placeholder?: string;
  placeholderStyle?: TextStyle;
  style?: TextStyle;
  cursorStyle?: TextStyle;
  prompt?: string;
  promptStyle?: TextStyle;
  value?: string;
  history?: string[];
  /** Optional per-character colorizer. Return null to use default style. */
  colorize?: InputColorizer;
  /** Optional callback to determine delete size for backspace/delete. */
  deleteSize?: DeleteSizer;
}

export class TextInput extends Control {
  private _value: string;
  private _cursor: number;
  private _prompt: string;
  private _placeholder: string;
  private _placeholderStyle: TextStyle;
  private _style: TextStyle;
  private _cursorStyle: TextStyle;
  private _promptStyle: TextStyle;
  private _colorize: InputColorizer | null;
  private _deleteSize: DeleteSizer | null;

  /** Command history entries (most recent last). */
  private _history: string[];
  /** Current position in history (-1 = not browsing, 0 = oldest). */
  private _historyIndex: number = -1;
  /** Saved input when user starts browsing history. */
  private _savedInput: string = "";

  /** Horizontal scroll offset (first visible column in value). */
  private _scrollOffset: number = 0;

  constructor(options: TextInputOptions = {}) {
    super();
    this.focusable = true;

    this._value = options.value ?? "";
    this._cursor = this._value.length;
    this._prompt = options.prompt ?? "";
    this._placeholder = options.placeholder ?? "";
    this._placeholderStyle = options.placeholderStyle ?? { italic: true };
    this._style = options.style ?? {};
    this._cursorStyle = options.cursorStyle ?? {};
    this._promptStyle = options.promptStyle ?? {};
    this._history = options.history ? [...options.history] : [];
    this._colorize = options.colorize ?? null;
    this._deleteSize = options.deleteSize ?? null;
  }

  // ── Public properties ─────────────────────────────────────────

  get value(): string {
    return this._value;
  }

  set value(v: string) {
    if (this._value !== v) {
      this._value = v;
      this._cursor = Math.min(this._cursor, v.length);
      this.emit("change", v);
      this.invalidate();
    }
  }

  get cursor(): number {
    return this._cursor;
  }

  set cursor(pos: number) {
    const clamped = Math.max(0, Math.min(pos, this._value.length));
    if (this._cursor !== clamped) {
      this._cursor = clamped;
      this.invalidate();
    }
  }

  get prompt(): string {
    return this._prompt;
  }

  set prompt(v: string) {
    if (this._prompt !== v) {
      this._prompt = v;
      this.invalidate();
    }
  }

  get placeholder(): string {
    return this._placeholder;
  }

  set placeholder(v: string) {
    this._placeholder = v;
  }

  get style(): TextStyle {
    return this._style;
  }

  set style(v: TextStyle) {
    this._style = v;
    this.invalidate();
  }

  get cursorStyle(): TextStyle {
    return this._cursorStyle;
  }

  set cursorStyle(v: TextStyle) {
    this._cursorStyle = v;
    this.invalidate();
  }

  get promptStyle(): TextStyle {
    return this._promptStyle;
  }

  set promptStyle(v: TextStyle) {
    this._promptStyle = v;
    this.invalidate();
  }

  get placeholderStyle(): TextStyle {
    return this._placeholderStyle;
  }

  set placeholderStyle(v: TextStyle) {
    this._placeholderStyle = v;
  }

  get history(): string[] {
    return this._history;
  }

  // ── Public methods ────────────────────────────────────────────

  /** Clear the input value and reset cursor. */
  clear(): void {
    this._value = "";
    this._cursor = 0;
    this._scrollOffset = 0;
    this._historyIndex = -1;
    this._savedInput = "";
    this.emit("change", "");
    this.invalidate();
  }

  /** Set the value and move cursor to the end. */
  setValue(text: string): void {
    this._value = text;
    this._cursor = text.length;
    this._historyIndex = -1;
    this._savedInput = "";
    this.emit("change", text);
    this.invalidate();
  }

  /** Insert text at the current cursor position. */
  insert(text: string): void {
    this._value =
      this._value.slice(0, this._cursor) +
      text +
      this._value.slice(this._cursor);
    this._cursor += text.length;
    this.emit("change", this._value);
    this.invalidate();
  }

  // ── Input handling ────────────────────────────────────────────

  handleInput(event: InputEvent): boolean {
    if (event.type === "paste") {
      return this._handlePaste(event.event);
    }

    if (event.type === "key") {
      return this._handleKey(event.event);
    }

    return false;
  }

  private _handlePaste(paste: PasteEvent): boolean {
    // Strip newlines from pasted text (single-line input)
    const clean = paste.text.replace(/[\r\n]/g, "");
    if (clean.length > 0) {
      this.insert(clean);
      this.emit("paste", clean);
    }
    return true;
  }

  private _handleKey(key: KeyEvent): boolean {
    // ── Enter → submit ──────────────────────────────────────
    if (key.key === "enter") {
      const val = this._value;
      // Add to history if non-empty and different from last entry
      if (
        val.length > 0 &&
        (this._history.length === 0 ||
          this._history[this._history.length - 1] !== val)
      ) {
        this._history.push(val);
      }
      this.emit("submit", val);
      this.clear();
      return true;
    }

    // ── Escape → cancel ─────────────────────────────────────
    if (key.key === "escape") {
      this.emit("cancel");
      return true;
    }

    // ── Tab → tab event (for autocomplete) ──────────────────
    if (key.key === "tab") {
      this.emit("tab");
      return true;
    }

    // ── Backspace → delete char(s) before cursor ─────────────
    if (key.key === "backspace") {
      if (this._cursor > 0) {
        const count = this._deleteSize
          ? Math.max(1, this._deleteSize(this._value, this._cursor, "backward"))
          : 1;
        const deleteFrom = Math.max(0, this._cursor - count);
        this._value =
          this._value.slice(0, deleteFrom) +
          this._value.slice(this._cursor);
        this._cursor = deleteFrom;
        this.emit("change", this._value);
        this.invalidate();
      }
      return true;
    }

    // ── Delete → delete char(s) at cursor ────────────────────
    if (key.key === "delete") {
      if (this._cursor < this._value.length) {
        const count = this._deleteSize
          ? Math.max(1, this._deleteSize(this._value, this._cursor, "forward"))
          : 1;
        this._value =
          this._value.slice(0, this._cursor) +
          this._value.slice(this._cursor + count);
        this.emit("change", this._value);
        this.invalidate();
      }
      return true;
    }

    // ── Left / Right ────────────────────────────────────────
    if (key.key === "left" && !key.ctrl) {
      if (this._cursor > 0) {
        this._cursor--;
        this.invalidate();
      }
      return true;
    }
    if (key.key === "right" && !key.ctrl) {
      if (this._cursor < this._value.length) {
        this._cursor++;
        this.invalidate();
      }
      return true;
    }

    // ── Ctrl+Left → word jump left ──────────────────────────
    if (key.key === "left" && key.ctrl) {
      this._cursor = this._wordBoundaryLeft(this._cursor);
      this.invalidate();
      return true;
    }

    // ── Ctrl+Right → word jump right ────────────────────────
    if (key.key === "right" && key.ctrl) {
      this._cursor = this._wordBoundaryRight(this._cursor);
      this.invalidate();
      return true;
    }

    // ── Home → cursor to start ──────────────────────────────
    if (key.key === "home") {
      this._cursor = 0;
      this.invalidate();
      return true;
    }

    // ── End → cursor to end ─────────────────────────────────
    if (key.key === "end") {
      this._cursor = this._value.length;
      this.invalidate();
      return true;
    }

    // ── Ctrl+A → move cursor to start (select-all semantics) ─
    if (key.key === "a" && key.ctrl) {
      this._cursor = 0;
      this.invalidate();
      return true;
    }

    // ── Ctrl+E → move cursor to end ─────────────────────────
    if (key.key === "e" && key.ctrl) {
      this._cursor = this._value.length;
      this.invalidate();
      return true;
    }

    // ── Ctrl+U → clear line (kill backward) ─────────────────
    if (key.key === "u" && key.ctrl) {
      this._value = this._value.slice(this._cursor);
      this._cursor = 0;
      this.emit("change", this._value);
      this.invalidate();
      return true;
    }

    // ── Ctrl+K → kill to end of line ────────────────────────
    if (key.key === "k" && key.ctrl) {
      this._value = this._value.slice(0, this._cursor);
      this.emit("change", this._value);
      this.invalidate();
      return true;
    }

    // ── Up → move cursor up in wrapped text, or history ─────
    if (key.key === "up") {
      const lines = this._wrapLines(this._lastFirstRowW, this._lastTotalWidth);
      if (lines.length > 1) {
        const { row, col } = this._cursorToRowCol(lines);
        if (row > 0) {
          // Move cursor to same column on previous row
          const prevLine = lines[row - 1];
          const prevLineOffset = this._lineOffset(lines, row - 1);
          this._cursor = prevLineOffset + Math.min(col, prevLine.length - 1);
          this.invalidate();
          return true;
        }
        // On first row — fall through to history
      }
      if (this._history.length > 0) {
        if (this._historyIndex === -1) {
          this._savedInput = this._value;
          this._historyIndex = this._history.length - 1;
        } else if (this._historyIndex > 0) {
          this._historyIndex--;
        }
        this._value = this._history[this._historyIndex];
        this._cursor = this._value.length;
        this.emit("change", this._value);
        this.invalidate();
      }
      return true;
    }

    // ── Down → move cursor down in wrapped text, or history ─
    if (key.key === "down") {
      const lines = this._wrapLines(this._lastFirstRowW, this._lastTotalWidth);
      if (lines.length > 1) {
        const { row, col } = this._cursorToRowCol(lines);
        if (row < lines.length - 1) {
          // Move cursor to same column on next row
          const nextLine = lines[row + 1];
          const nextLineOffset = this._lineOffset(lines, row + 1);
          this._cursor = nextLineOffset + Math.min(col, nextLine.length);
          this.invalidate();
          return true;
        }
        // On last row — fall through to history
      }
      if (this._historyIndex >= 0) {
        if (this._historyIndex < this._history.length - 1) {
          this._historyIndex++;
          this._value = this._history[this._historyIndex];
        } else {
          this._historyIndex = -1;
          this._value = this._savedInput;
          this._savedInput = "";
        }
        this._cursor = this._value.length;
        this.emit("change", this._value);
        this.invalidate();
      }
      return true;
    }

    // ── Printable characters → insert ───────────────────────
    if (key.char.length > 0 && !key.ctrl && !key.alt) {
      this.insert(key.char);
      return true;
    }

    return false;
  }

  // ── Word boundary helpers ─────────────────────────────────────

  /**
   * Find the position of the start of the word to the left of `pos`.
   * Skips any whitespace first, then skips non-whitespace.
   */
  private _wordBoundaryLeft(pos: number): number {
    if (pos <= 0) return 0;
    let i = pos - 1;
    // Skip whitespace
    while (i > 0 && this._value[i] === " ") i--;
    // Skip word characters
    while (i > 0 && this._value[i - 1] !== " ") i--;
    return i;
  }

  /**
   * Find the position of the end of the word to the right of `pos`.
   * Skips any non-whitespace first, then skips whitespace.
   */
  private _wordBoundaryRight(pos: number): number {
    const len = this._value.length;
    if (pos >= len) return len;
    let i = pos;
    // Skip word characters
    while (i < len && this._value[i] !== " ") i++;
    // Skip whitespace
    while (i < len && this._value[i] === " ") i++;
    return i;
  }

  // ── Word-wrap layout ────────────────────────────────────────

  /**
   * Build wrapped lines from the current value.
   * Row 0 starts after the prompt (firstRowW chars wide).
   * Subsequent rows use the full width.
   * Breaks prefer spaces (word wrap) but will hard-break if a word
   * is longer than the row width.
   */
  private _wrapLines(firstRowW: number, fullW: number): string[] {
    if (this._value.length === 0) return [""];

    const lines: string[] = [];
    let remaining = this._value;
    let rowW = firstRowW;

    while (remaining.length > 0) {
      if (remaining.length <= rowW) {
        lines.push(remaining);
        remaining = "";
      } else {
        // Find a space to break on within the row width
        let breakAt = remaining.lastIndexOf(" ", rowW - 1);
        if (breakAt <= 0) {
          // No space found — hard break
          breakAt = rowW;
          lines.push(remaining.slice(0, breakAt));
          remaining = remaining.slice(breakAt);
        } else {
          // Break after the space (space stays on this line)
          lines.push(remaining.slice(0, breakAt + 1));
          remaining = remaining.slice(breakAt + 1);
        }
      }
      rowW = fullW; // subsequent rows use full width
    }

    return lines;
  }

  /**
   * Find which wrapped line and column the cursor is on.
   * Returns { row, col } in wrapped coordinates.
   */
  private _cursorToRowCol(lines: string[]): { row: number; col: number } {
    let offset = 0;
    for (let row = 0; row < lines.length; row++) {
      const lineLen = lines[row].length;
      if (this._cursor <= offset + lineLen) {
        // Handle cursor-at-end on last line vs start-of-next-line
        if (this._cursor === offset + lineLen && row < lines.length - 1) {
          return { row: row + 1, col: 0 };
        }
        return { row, col: this._cursor - offset };
      }
      offset += lineLen;
    }
    // Cursor past all text — put on last line
    const lastLine = lines[lines.length - 1];
    return { row: lines.length - 1, col: lastLine.length };
  }

  /** Get the character offset where a given wrapped line starts. */
  private _lineOffset(lines: string[], lineIdx: number): number {
    let off = 0;
    for (let i = 0; i < lineIdx; i++) off += lines[i].length;
    return off;
  }

  /** Vertical scroll offset (first visible row). */
  private _vScrollOffset: number = 0;
  /** Cached layout widths from last measure/render. */
  private _lastTotalWidth: number = 80;
  private _lastFirstRowW: number = 78;

  // ── Layout ────────────────────────────────────────────────────

  measure(constraint: Constraint): Size {
    const maxH = constraint.maxHeight;
    const totalWidth = constraint.maxWidth;
    const firstRowW = Math.max(1, totalWidth - this._prompt.length);

    const lines = this._wrapLines(firstRowW, totalWidth);
    // +1 for cursor row if cursor is at the very end and would start a new line
    const cursorOnNewLine = this._value.length > 0
      && this._cursor === this._value.length
      && lines[lines.length - 1].length >= (lines.length === 1 ? firstRowW : totalWidth);
    const totalRows = lines.length + (cursorOnNewLine ? 1 : 0);
    const rows = Math.min(maxH, Math.max(1, totalRows));

    return {
      width: totalWidth,
      height: rows,
    };
  }

  render(ctx: DrawingContext): void {
    const bounds = this.bounds;
    if (!bounds) return;

    const bx = bounds.x;
    const by = bounds.y;
    const totalWidth = bounds.width;
    const visibleRows = bounds.height;

    const promptLen = this._prompt.length;
    const firstRowW = Math.max(1, totalWidth - promptLen);
    this._lastTotalWidth = totalWidth;
    this._lastFirstRowW = firstRowW;
    const isFocused = this.focused;

    // ── Empty value: show placeholder or cursor ─────────────
    if (this._value.length === 0) {
      const promptX = bx + promptLen;
      if (this._prompt.length > 0) {
        ctx.drawText(bx, by, this._prompt, this._promptStyle);
      }
      if (isFocused) {
        this._drawCursor(ctx, promptX, by, " ");
        if (this._placeholder.length > 0) {
          const phText = this._placeholder.slice(0, firstRowW - 1);
          ctx.drawText(promptX + 1, by, phText, this._placeholderStyle);
        }
      } else if (this._placeholder.length > 0) {
        const phText = this._placeholder.slice(0, firstRowW);
        ctx.drawText(promptX, by, phText, this._placeholderStyle);
      }
      this._vScrollOffset = 0;
      return;
    }

    // ── Word-wrap and scroll ────────────────────────────────
    const lines = this._wrapLines(firstRowW, totalWidth);
    const { row: cursorRow, col: cursorCol } = this._cursorToRowCol(lines);

    // Ensure cursor row is visible by adjusting vertical scroll
    if (cursorRow < this._vScrollOffset) {
      this._vScrollOffset = cursorRow;
    }
    if (cursorRow >= this._vScrollOffset + visibleRows) {
      this._vScrollOffset = cursorRow - visibleRows + 1;
    }
    // Clamp
    const totalLines = lines.length;
    const maxVScroll = Math.max(0, totalLines - visibleRows);
    this._vScrollOffset = Math.max(0, Math.min(this._vScrollOffset, maxVScroll));

    // Compute per-character styles
    const charStyles = this._colorize ? this._colorize(this._value) : null;

    // Build a char-offset map: charOffset[row] = index into this._value
    // where that wrapped line starts.
    const lineOffsets: number[] = [];
    let off = 0;
    for (const line of lines) {
      lineOffsets.push(off);
      off += line.length;
    }

    // Render visible rows
    for (let vr = 0; vr < visibleRows; vr++) {
      const lineIdx = this._vScrollOffset + vr;
      if (lineIdx >= lines.length) break;

      const lineText = lines[lineIdx];
      const lineOffset = lineOffsets[lineIdx];
      const rowX = lineIdx === 0 ? bx + promptLen : bx;
      const screenY = by + vr;

      // Draw prompt on the first visible row if it's line 0
      if (lineIdx === 0 && this._prompt.length > 0) {
        ctx.drawText(bx, screenY, this._prompt, this._promptStyle);
      }

      // Draw characters
      for (let col = 0; col < lineText.length; col++) {
        const charIdx = lineOffset + col;
        if (isFocused && charIdx === this._cursor) {
          this._drawCursor(ctx, rowX + col, screenY, lineText[col]);
        } else {
          const style = charStyles?.[charIdx] ?? this._style;
          ctx.drawChar(rowX + col, screenY, lineText[col], style);
        }
      }

      // Cursor at end of this line (append position)
      if (isFocused && lineIdx === cursorRow && cursorCol === lineText.length) {
        this._drawCursor(ctx, rowX + cursorCol, screenY, " ");
      }
    }
  }

  // ── Cursor rendering ──────────────────────────────────────────

  /**
   * Draw the cursor character with inverted foreground/background
   * colours (swap fg and bg from the text style).
   */
  private _drawCursor(
    ctx: DrawingContext,
    x: number,
    y: number,
    char: string,
  ): void {
    const cursorStyle: TextStyle = {
      ...this._cursorStyle,
      // If no explicit cursor style colours are set, invert the text style
      fg: this._cursorStyle.fg ?? this._style.bg,
      bg: this._cursorStyle.bg ?? this._style.fg,
    };
    ctx.drawChar(x, y, char, cursorStyle);
  }
}
