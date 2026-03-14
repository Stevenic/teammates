/**
 * PromptInput — consolonia-based replacement for node:readline.
 *
 * Uses consolonia's InputProcessor for raw terminal input parsing
 * (escape sequences, bracketed paste, mouse events) and renders
 * the prompt line + fenced borders directly via ANSI escape codes.
 *
 * This is a scrolling REPL input component, NOT a full-screen TUI.
 * Agent output scrolls normally above; only the input area is managed.
 *
 * Layout:
 *   ────────────────────────────────────────
 *   ❯ user input here|
 *   ────────────────────────────────────────
 *   (optional dropdown lines)
 */

import { EventEmitter } from "node:events";
import {
  createInputProcessor,
  type InputEvent,
  type KeyEvent,
  type PasteEvent,
  esc,
  stripAnsi,
  visibleLength,
} from "@teammates/consolonia";

// ── Types ──────────────────────────────────────────────────────────

export interface PromptInputOptions {
  /** Prompt string (may include ANSI color codes). */
  prompt?: string;
  /** Border character (default: "─"). */
  borderChar?: string;
  /** ANSI style wrapper for the border. */
  borderStyle?: (s: string) => string;
  /** Command history entries (most recent last). */
  history?: string[];
  /**
   * Intercept up/down arrow keys before history navigation.
   * Return true to consume the key (e.g. for wordwheel navigation).
   */
  onUpDown?: (direction: "up" | "down") => boolean;
  /**
   * Called just before Enter submits the line. Can modify the value
   * (e.g. to accept a wordwheel selection). Return the final line text,
   * or undefined to use the current value as-is.
   */
  beforeSubmit?: (currentValue: string) => string | undefined;
}

// ── PromptInput ────────────────────────────────────────────────────

export class PromptInput extends EventEmitter {
  private _prompt: string;
  private _promptLen: number;
  private _borderChar: string;
  private _borderStyle: (s: string) => string;
  private _value = "";
  private _cursor = 0;
  private _history: string[];
  private _historyIndex = -1;
  private _savedInput = "";
  private _active = false;
  private _dropdownLines: string[] = [];
  private _linesBelow = 0; // how many lines we drew below prompt
  private _processor: ReturnType<typeof createInputProcessor>["processor"];
  private _events: EventEmitter;
  private _dataHandler: ((chunk: Buffer) => void) | null = null;
  private _resizeHandler: (() => void) | null = null;
  private _wasRawMode = false;
  private _onUpDown: ((direction: "up" | "down") => boolean) | null;
  private _beforeSubmit: ((currentValue: string) => string | undefined) | null;
  private _resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private _lastCols = 0; // terminal width when prompt was last drawn

  constructor(options: PromptInputOptions = {}) {
    super();
    this._prompt = options.prompt ?? "> ";
    this._promptLen = visibleLength(this._prompt);
    this._borderChar = options.borderChar ?? "─";
    this._borderStyle = options.borderStyle ?? ((s) => `\x1b[2m${s}\x1b[0m`);
    this._history = options.history ?? [];
    this._onUpDown = options.onUpDown ?? null;
    this._beforeSubmit = options.beforeSubmit ?? null;

    const { processor, events } = createInputProcessor();
    this._processor = processor;
    this._events = events;

    this._events.on("input", (ev: InputEvent) => this._handleInput(ev));
  }

  // ── Public API ─────────────────────────────────────────────────

  /** Current line text. */
  get line(): string { return this._value; }

  /** Current cursor position. */
  get cursor(): number { return this._cursor; }

  /** Whether the input is active (accepting keystrokes). */
  get active(): boolean { return this._active; }

  /** Command history. */
  get history(): string[] { return this._history; }

  /** Set prompt text. */
  set prompt(text: string) {
    this._prompt = text;
    this._promptLen = visibleLength(text);
  }

  get prompt(): string { return this._prompt; }

  /** Set the line text and move cursor to end. */
  setLine(text: string): void {
    this._value = text;
    this._cursor = text.length;
    if (this._active) this._refresh();
  }

  /** Show dropdown content below the bottom border. */
  setDropdown(lines: string[]): void {
    this._dropdownLines = lines;
    if (this._active) this._refresh();
  }

  /** Clear dropdown content. */
  clearDropdown(): void {
    if (this._dropdownLines.length > 0) {
      this._dropdownLines = [];
      if (this._active) this._refresh();
    }
  }

  /**
   * Activate the prompt: enable raw mode, bracketed paste, draw UI.
   * Call this to show the prompt and start accepting input.
   */
  activate(): void {
    if (this._active) return;
    this._active = true;

    // Set up raw mode + listeners on first activation
    if (!this._dataHandler) {
      // Enable raw mode
      if (process.stdin.isTTY) {
        this._wasRawMode = process.stdin.isRaw ?? false;
        process.stdin.setRawMode(true);
      }

      // Enable bracketed paste
      process.stdout.write(esc.bracketedPasteOn);

      // Listen for raw data
      this._dataHandler = (chunk: Buffer) => {
        this._processor.feed(chunk.toString("utf-8"));
      };
      process.stdin.on("data", this._dataHandler);
      process.stdin.resume();

      // Listen for resize
      this._resizeHandler = () => this._onResize();
      process.stdout.on("resize", this._resizeHandler);
    }

    // Draw the prompt area
    this._drawTopBorder();
    this._drawPromptLine();
    this._drawBelow();
  }

  /**
   * Deactivate the prompt: stop drawing but keep raw mode and input
   * handling active so Ctrl+C still works during dispatch.
   */
  deactivate(): void {
    if (!this._active) return;
    this._active = false;

    // Erase everything below the prompt line (bottom border + dropdown)
    this._eraseBelow();

    // Move to the line after the prompt so output appears below
    process.stdout.write("\n");
  }

  /** Fully close the input, destroy processor, restore terminal. */
  close(): void {
    this._active = false;

    // Cancel pending resize
    if (this._resizeTimer) {
      clearTimeout(this._resizeTimer);
      this._resizeTimer = null;
    }

    // Remove stdin listener
    if (this._dataHandler) {
      process.stdin.removeListener("data", this._dataHandler);
      this._dataHandler = null;
    }
    if (this._resizeHandler) {
      process.stdout.removeListener("resize", this._resizeHandler);
      this._resizeHandler = null;
    }

    // Disable bracketed paste
    process.stdout.write(esc.bracketedPasteOff);

    // Restore raw mode
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(this._wasRawMode);
    }

    this._processor.destroy();
    this.emit("close");
  }

  // ── Input handling ─────────────────────────────────────────────

  private _handleInput(event: InputEvent): void {
    if (!this._active) return;

    if (event.type === "paste") {
      this._handlePaste(event.event);
      return;
    }

    if (event.type === "key") {
      this._handleKey(event.event);
      return;
    }
  }

  private _handlePaste(paste: PasteEvent): void {
    const text = paste.text;

    // Emit paste event so the CLI can handle multi-line paste specially
    this.emit("paste", text);
  }

  private _handleKey(key: KeyEvent): void {
    // ── Ctrl+C → interrupt
    if (key.key === "c" && key.ctrl) {
      // Clear current line
      if (this._value.length > 0) {
        this._value = "";
        this._cursor = 0;
        this._refresh();
      } else {
        // Empty line + Ctrl+C → close
        this.close();
        return;
      }
      return;
    }

    // ── Ctrl+D → close on empty line
    if (key.key === "d" && key.ctrl) {
      if (this._value.length === 0) {
        this.close();
        return;
      }
      // Non-empty: delete forward (like unix behavior)
      if (this._cursor < this._value.length) {
        this._value =
          this._value.slice(0, this._cursor) +
          this._value.slice(this._cursor + 1);
        this._refresh();
      }
      return;
    }

    // ── Ctrl+L → clear screen, redraw
    if (key.key === "l" && key.ctrl) {
      process.stdout.write(esc.clearScreen + esc.moveTo(0, 0));
      this._drawTopBorder();
      this._drawPromptLine();
      this._drawBelow();
      return;
    }

    // ── Enter → submit
    if (key.key === "enter") {
      // Allow consumer to modify the value (e.g. accept wordwheel selection)
      const modified = this._beforeSubmit?.(this._value);
      const val = modified ?? this._value;

      // Add to history
      if (val.length > 0 &&
          (this._history.length === 0 || this._history[this._history.length - 1] !== val)) {
        this._history.push(val);
      }

      this._historyIndex = -1;
      this._savedInput = "";
      this._value = "";
      this._cursor = 0;

      this.emit("line", val);
      return;
    }

    // ── Escape → emit escape (for wordwheel cancellation)
    if (key.key === "escape") {
      this.emit("escape");
      return;
    }

    // ── Tab → emit tab (for autocomplete)
    if (key.key === "tab") {
      this.emit("tab", key.shift);
      return;
    }

    // ── Backspace
    if (key.key === "backspace") {
      if (key.ctrl) {
        // Ctrl+Backspace: delete word backward
        const newPos = this._wordBoundaryLeft(this._cursor);
        this._value = this._value.slice(0, newPos) + this._value.slice(this._cursor);
        this._cursor = newPos;
      } else if (this._cursor > 0) {
        this._value =
          this._value.slice(0, this._cursor - 1) +
          this._value.slice(this._cursor);
        this._cursor--;
      }
      this._refresh();
      this.emit("change", this._value, this._cursor);
      return;
    }

    // ── Delete
    if (key.key === "delete") {
      if (this._cursor < this._value.length) {
        this._value =
          this._value.slice(0, this._cursor) +
          this._value.slice(this._cursor + 1);
        this._refresh();
        this.emit("change", this._value, this._cursor);
      }
      return;
    }

    // ── Left / Right
    if (key.key === "left") {
      if (key.ctrl) {
        this._cursor = this._wordBoundaryLeft(this._cursor);
      } else if (this._cursor > 0) {
        this._cursor--;
      }
      this._refresh();
      return;
    }
    if (key.key === "right") {
      if (key.ctrl) {
        this._cursor = this._wordBoundaryRight(this._cursor);
      } else if (this._cursor < this._value.length) {
        this._cursor++;
      }
      this._refresh();
      return;
    }

    // ── Home / End / Ctrl+A / Ctrl+E
    if (key.key === "home" || (key.key === "a" && key.ctrl)) {
      this._cursor = 0;
      this._refresh();
      return;
    }
    if (key.key === "end" || (key.key === "e" && key.ctrl)) {
      this._cursor = this._value.length;
      this._refresh();
      return;
    }

    // ── Ctrl+U → kill backward
    if (key.key === "u" && key.ctrl) {
      this._value = this._value.slice(this._cursor);
      this._cursor = 0;
      this._refresh();
      this.emit("change", this._value, this._cursor);
      return;
    }

    // ── Ctrl+K → kill forward
    if (key.key === "k" && key.ctrl) {
      this._value = this._value.slice(0, this._cursor);
      this._refresh();
      this.emit("change", this._value, this._cursor);
      return;
    }

    // ── Up → wordwheel intercept, then history back
    if (key.key === "up") {
      if (this._onUpDown?.("up")) return;
      this._historyBack();
      return;
    }

    // ── Down → wordwheel intercept, then history forward
    if (key.key === "down") {
      if (this._onUpDown?.("down")) return;
      this._historyForward();
      return;
    }

    // ── Printable characters
    if (key.char.length > 0 && !key.ctrl && !key.alt) {
      this._value =
        this._value.slice(0, this._cursor) +
        key.char +
        this._value.slice(this._cursor);
      this._cursor += key.char.length;
      this._refresh();
      this.emit("change", this._value, this._cursor);
      return;
    }
  }

  // ── History ────────────────────────────────────────────────────

  private _historyBack(): void {
    if (this._history.length === 0) return;
    if (this._historyIndex === -1) {
      this._savedInput = this._value;
      this._historyIndex = this._history.length - 1;
    } else if (this._historyIndex > 0) {
      this._historyIndex--;
    }
    this._value = this._history[this._historyIndex];
    this._cursor = this._value.length;
    this._refresh();
  }

  private _historyForward(): void {
    if (this._historyIndex < 0) return;
    if (this._historyIndex < this._history.length - 1) {
      this._historyIndex++;
      this._value = this._history[this._historyIndex];
    } else {
      this._historyIndex = -1;
      this._value = this._savedInput;
      this._savedInput = "";
    }
    this._cursor = this._value.length;
    this._refresh();
  }

  // ── Word boundaries ────────────────────────────────────────────

  private _wordBoundaryLeft(pos: number): number {
    if (pos <= 0) return 0;
    let i = pos - 1;
    while (i > 0 && this._value[i] === " ") i--;
    while (i > 0 && this._value[i - 1] !== " ") i--;
    return i;
  }

  private _wordBoundaryRight(pos: number): number {
    const len = this._value.length;
    if (pos >= len) return len;
    let i = pos;
    while (i < len && this._value[i] !== " ") i++;
    while (i < len && this._value[i] === " ") i++;
    return i;
  }

  // ── Rendering ──────────────────────────────────────────────────

  private _cols(): number {
    return process.stdout.columns || 80;
  }

  private _buildBorder(): string {
    return this._borderStyle(this._borderChar.repeat(this._cols()));
  }

  private _drawTopBorder(): void {
    this._lastCols = this._cols();
    process.stdout.write(this._buildBorder() + "\n");
  }

  private _drawPromptLine(): void {
    const cols = this._cols();
    const availWidth = cols - this._promptLen;

    // Calculate visible portion of the value
    let scrollOffset = 0;
    if (this._cursor >= availWidth) {
      scrollOffset = this._cursor - availWidth + 1;
    }
    const visibleText = this._value.slice(scrollOffset, scrollOffset + availWidth);

    // Build the line
    let buf = "\r" + esc.eraseLine;
    buf += this._prompt;
    buf += visibleText;

    // Position cursor
    const cursorCol = this._promptLen + (this._cursor - scrollOffset);
    buf += `\x1b[${cursorCol + 1}G`;

    process.stdout.write(buf);
  }

  private _drawBelow(): void {
    const cols = this._cols();
    let buf = "";
    let lines = 0;

    // Bottom border
    buf += "\n" + this._buildBorder();
    lines++;

    // Dropdown lines
    for (const line of this._dropdownLines) {
      buf += "\n" + line.slice(0, cols);
      lines++;
    }

    process.stdout.write(buf);

    // Move cursor back to the prompt line
    if (lines > 0) {
      process.stdout.write(esc.moveUp(lines));
    }

    // Restore cursor column position
    const availWidth = cols - this._promptLen;
    let scrollOffset = 0;
    if (this._cursor >= availWidth) {
      scrollOffset = this._cursor - availWidth + 1;
    }
    const cursorCol = this._promptLen + (this._cursor - scrollOffset);
    process.stdout.write(`\x1b[${cursorCol + 1}G`);

    this._linesBelow = lines;
  }

  private _eraseBelow(): void {
    if (this._linesBelow > 0) {
      // Save cursor, move to end of prompt line, erase down, restore
      process.stdout.write(esc.saveCursor + esc.eraseDown + esc.restoreCursor);
      this._linesBelow = 0;
    }
  }

  /** Full refresh of the prompt area. */
  private _refresh(): void {
    if (!this._active) return;

    // Erase everything below (old bottom border + dropdown)
    this._eraseBelow();

    // Redraw prompt line
    this._drawPromptLine();

    // Redraw bottom border + dropdown
    this._drawBelow();
  }

  private _onResize(): void {
    if (!this._active) return;

    // Debounce: resize fires many times during window drag.
    // Only redraw once it settles.
    if (this._resizeTimer) clearTimeout(this._resizeTimer);
    this._resizeTimer = setTimeout(() => {
      this._resizeTimer = null;
      if (!this._active) return;

      // After a resize, old lines may have wrapped (or unwrapped).
      // Calculate how many screen rows the old content now occupies.
      const newCols = this._cols();
      const oldCols = this._lastCols || newCols;

      // Each old line that was `oldCols` chars wide now wraps to
      // ceil(oldCols / newCols) screen rows.
      const wrapFactor = (len: number) => Math.max(1, Math.ceil(len / newCols));
      const topBorderRows = wrapFactor(oldCols);
      const promptRows = 1; // prompt line rarely wraps significantly
      const belowRows = (1 + this._linesBelow) * wrapFactor(oldCols); // bottom border + dropdown

      // Cursor is on the prompt line. Move up past prompt rows + top border rows.
      // Then move down past the below rows first to erase them, then back up.
      // Actually: cursor is on prompt line. Below = belowRows. Above = topBorderRows.
      // Move up topBorderRows to get to start of top border, erase down.
      const moveUpCount = topBorderRows;
      // But first, the below content exists. eraseDown from the top border will
      // clear everything including below. So just move up to the top border start.
      process.stdout.write("\r" + esc.moveUp(moveUpCount) + esc.eraseDown);
      this._linesBelow = 0;

      // Redraw in place at new width
      this._drawTopBorder();
      this._drawPromptLine();
      this._drawBelow();
    }, 80);
  }
}
