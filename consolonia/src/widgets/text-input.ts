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

export interface TextInputOptions {
  placeholder?: string;
  placeholderStyle?: TextStyle;
  style?: TextStyle;
  cursorStyle?: TextStyle;
  prompt?: string;
  promptStyle?: TextStyle;
  value?: string;
  history?: string[];
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

    // ── Backspace → delete char before cursor ───────────────
    if (key.key === "backspace") {
      if (this._cursor > 0) {
        this._value =
          this._value.slice(0, this._cursor - 1) +
          this._value.slice(this._cursor);
        this._cursor--;
        this.emit("change", this._value);
        this.invalidate();
      }
      return true;
    }

    // ── Delete → delete char at cursor ──────────────────────
    if (key.key === "delete") {
      if (this._cursor < this._value.length) {
        this._value =
          this._value.slice(0, this._cursor) +
          this._value.slice(this._cursor + 1);
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

    // ── Up → history back ───────────────────────────────────
    if (key.key === "up") {
      if (this._history.length > 0) {
        if (this._historyIndex === -1) {
          // Start browsing: save current input
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

    // ── Down → history forward ──────────────────────────────
    if (key.key === "down") {
      if (this._historyIndex >= 0) {
        if (this._historyIndex < this._history.length - 1) {
          this._historyIndex++;
          this._value = this._history[this._historyIndex];
        } else {
          // Past the end: restore saved input
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

  // ── Layout ────────────────────────────────────────────────────

  measure(constraint: Constraint): Size {
    // TextInput always occupies 1 row; width is prompt + as much as available
    return {
      width: constraint.maxWidth,
      height: 1,
    };
  }

  render(ctx: DrawingContext): void {
    const bounds = this.bounds;
    if (!bounds) return;

    const bx = bounds.x;
    const by = bounds.y;
    const totalWidth = bounds.width;

    let x = bx;

    // Draw prompt
    if (this._prompt.length > 0) {
      ctx.drawText(x, by, this._prompt, this._promptStyle);
      x += this._prompt.length;
    }

    const availWidth = totalWidth - (x - bx);
    if (availWidth <= 0) return;

    const isFocused = this.focused;

    // ── Empty value: show placeholder or cursor ─────────────
    if (this._value.length === 0) {
      if (isFocused) {
        // Draw cursor at first position
        this._drawCursor(ctx, x, by, " ");
        // Draw placeholder after cursor
        if (this._placeholder.length > 0) {
          const phText = this._placeholder.slice(0, availWidth - 1);
          ctx.drawText(x + 1, by, phText, this._placeholderStyle);
        }
      } else if (this._placeholder.length > 0) {
        const phText = this._placeholder.slice(0, availWidth);
        ctx.drawText(x, by, phText, this._placeholderStyle);
      }
      return;
    }

    // ── Non-empty value: handle scrolling ───────────────────
    this._updateScrollOffset(availWidth);

    const visibleText = this._value.slice(
      this._scrollOffset,
      this._scrollOffset + availWidth,
    );

    // Draw the visible text
    for (let i = 0; i < visibleText.length; i++) {
      const charIdx = this._scrollOffset + i;
      if (isFocused && charIdx === this._cursor) {
        // This is the cursor position — draw inverted
        this._drawCursor(ctx, x + i, by, visibleText[i]);
      } else {
        ctx.drawText(x + i, by, visibleText[i], this._style);
      }
    }

    // If cursor is at the end of visible text (append position)
    if (isFocused && this._cursor === this._value.length) {
      const cursorScreenPos = this._cursor - this._scrollOffset;
      if (cursorScreenPos >= 0 && cursorScreenPos < availWidth) {
        this._drawCursor(ctx, x + cursorScreenPos, by, " ");
      }
    }
  }

  // ── Scroll offset management ──────────────────────────────────

  /**
   * Ensure the cursor is visible within the available width by
   * adjusting _scrollOffset.
   */
  private _updateScrollOffset(availWidth: number): void {
    if (availWidth <= 0) {
      this._scrollOffset = 0;
      return;
    }

    // Cursor before visible window → scroll left
    if (this._cursor < this._scrollOffset) {
      this._scrollOffset = this._cursor;
    }

    // Cursor beyond visible window → scroll right
    // Keep 1 cell of room if possible for the cursor-at-end case
    if (this._cursor >= this._scrollOffset + availWidth) {
      this._scrollOffset = this._cursor - availWidth + 1;
    }

    // Clamp
    this._scrollOffset = Math.max(0, this._scrollOffset);
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
