/**
 * ChatView — full-screen chat widget for terminal REPLs.
 *
 * Layout (top to bottom):
 *
 *   ┌─ banner ──────────────────────────────┐
 *   │  customizable multi-line header text   │
 *   ├───────────────────────────────────────-┤
 *   │                                        │
 *   │  scrollable feed area                  │
 *   │  (messages, agent output, etc.)        │
 *   │                                        │
 *   ├───────────────────────────────────────-┤
 *   │  progress message (optional)           │
 *   │  ❯ input box                           │
 *   │  ┌─ dropdown ───────────────────────┐  │
 *   │  │  /command1   description          │  │
 *   │  │  /command2   description          │  │
 *   │  └──────────────────────────────────-┘  │
 *   └────────────────────────────────────────┘
 *
 * The feed is the terminal's own scrollback: new content is appended
 * as Text children to the feed Column. Everything is double-buffered
 * through Consolonia's PixelBuffer so resizing redraws cleanly.
 *
 * Events emitted:
 *   "submit"  (text: string)         — user pressed Enter
 *   "change"  (text: string)         — input value changed
 *   "cancel"  ()                     — user pressed Escape
 *   "tab"     ()                     — user pressed Tab (for autocomplete)
 */

import { Control } from "../layout/control.js";
import type { Size, Constraint, Rect } from "../layout/types.js";
import type { DrawingContext, TextStyle } from "../drawing/context.js";
import type { InputEvent } from "../input/events.js";
import { Text } from "./text.js";
import { TextInput } from "./text-input.js";

// ── Types ──────────────────────────────────────────────────────────

export interface DropdownItem {
  /** Display label (left column). */
  label: string;
  /** Description (right column). */
  description: string;
  /** Full text to insert on accept. */
  completion: string;
}

export interface ChatViewOptions {
  /** Banner text shown at the top of the chat area. */
  banner?: string;
  /** Style for the banner text. */
  bannerStyle?: TextStyle;
  /** Prompt string for the input box (default "❯ "). */
  prompt?: string;
  /** Style for the prompt. */
  promptStyle?: TextStyle;
  /** Style for input text. */
  inputStyle?: TextStyle;
  /** Style for the cursor. */
  cursorStyle?: TextStyle;
  /** Placeholder when input is empty. */
  placeholder?: string;
  /** Style for placeholder text. */
  placeholderStyle?: TextStyle;
  /** Style for feed text (default messages). */
  feedStyle?: TextStyle;
  /** Style for progress message text. */
  progressStyle?: TextStyle;
  /** Style for the separator lines between banner/feed/input. */
  separatorStyle?: TextStyle;
  /** Character used for separator lines (default "─"). */
  separatorChar?: string;
  /** Style for highlighted dropdown item. */
  dropdownHighlightStyle?: TextStyle;
  /** Style for normal dropdown item. */
  dropdownStyle?: TextStyle;
  /** Command history entries. */
  history?: string[];
}

// ── ChatView ───────────────────────────────────────────────────────

export class ChatView extends Control {
  // ── Child controls ─────────────────────────────────────────────
  private _banner: Text;
  private _topSeparator: _Separator;
  private _feedLines: Text[] = [];
  private _bottomSeparator: _Separator;
  private _progressText: Text;
  private _input: TextInput;
  private _dropdownItems: DropdownItem[] = [];
  private _dropdownIndex: number = -1;

  // ── Configuration ──────────────────────────────────────────────
  private _feedStyle: TextStyle;
  private _progressStyle: TextStyle;
  private _separatorStyle: TextStyle;
  private _separatorChar: string;
  private _dropdownHighlightStyle: TextStyle;
  private _dropdownStyle: TextStyle;

  // ── Layout cache ───────────────────────────────────────────────
  private _feedScrollOffset: number = 0;
  private _lastWidth: number = 0;
  private _lastHeight: number = 0;

  // ── Double buffer ──────────────────────────────────────────────
  /** Snapshot of feed line texts for diff-based redraw. */
  private _prevFeedSnapshot: string[] = [];

  constructor(options: ChatViewOptions = {}) {
    super();

    this._feedStyle = options.feedStyle ?? {};
    this._progressStyle = options.progressStyle ?? { italic: true };
    this._separatorStyle = options.separatorStyle ?? {};
    this._separatorChar = options.separatorChar ?? "─";
    this._dropdownHighlightStyle = options.dropdownHighlightStyle ?? { bold: true };
    this._dropdownStyle = options.dropdownStyle ?? {};

    // Banner
    this._banner = new Text({
      text: options.banner ?? "",
      style: options.bannerStyle ?? {},
      wrap: true,
    });
    this.addChild(this._banner);

    // Top separator (between banner and feed)
    this._topSeparator = new _Separator(this._separatorChar, this._separatorStyle);
    this.addChild(this._topSeparator);

    // Bottom separator (between feed and input area)
    this._bottomSeparator = new _Separator(this._separatorChar, this._separatorStyle);
    this.addChild(this._bottomSeparator);

    // Progress text (above input, below bottom separator)
    this._progressText = new Text({
      text: "",
      style: this._progressStyle,
      wrap: false,
    });
    this._progressText.visible = false;
    this.addChild(this._progressText);

    // Input
    this._input = new TextInput({
      prompt: options.prompt ?? "❯ ",
      promptStyle: options.promptStyle ?? {},
      style: options.inputStyle ?? {},
      cursorStyle: options.cursorStyle ?? {},
      placeholder: options.placeholder ?? "",
      placeholderStyle: options.placeholderStyle ?? { italic: true },
      history: options.history,
    });
    this._input.focusable = true;
    this._input.onFocus();
    this.addChild(this._input);

    // Wire input events to ChatView events
    this._input.on("submit", (text: string) => this.emit("submit", text));
    this._input.on("change", (text: string) => this.emit("change", text));
    this._input.on("cancel", () => {
      if (this._dropdownItems.length > 0) {
        this.hideDropdown();
      } else {
        this.emit("cancel");
      }
    });
    this._input.on("tab", () => {
      if (this._dropdownItems.length > 0 && this._dropdownIndex >= 0) {
        this.acceptDropdownItem();
      } else {
        this.emit("tab");
      }
    });
  }

  // ── Public API: Banner ─────────────────────────────────────────

  get banner(): string {
    return this._banner.text;
  }

  set banner(text: string) {
    this._banner.text = text;
    this._banner.visible = text.length > 0;
    this.invalidate();
  }

  get bannerStyle(): TextStyle {
    return this._banner.style;
  }

  set bannerStyle(style: TextStyle) {
    this._banner.style = style;
  }

  // ── Public API: Feed ───────────────────────────────────────────

  /** Append a line of text to the feed. Auto-scrolls to bottom. */
  appendToFeed(text: string, style?: TextStyle): void {
    const line = new Text({
      text,
      style: style ?? this._feedStyle,
      wrap: true,
    });
    this._feedLines.push(line);
    this._autoScrollToBottom();
    this.invalidate();
  }

  /** Append multiple lines to the feed. */
  appendLines(lines: string[], style?: TextStyle): void {
    for (const text of lines) {
      const line = new Text({
        text,
        style: style ?? this._feedStyle,
        wrap: true,
      });
      this._feedLines.push(line);
    }
    this._autoScrollToBottom();
    this.invalidate();
  }

  /** Clear everything between the banner and the input box. */
  clear(): void {
    this._feedLines = [];
    this._feedScrollOffset = 0;
    this._prevFeedSnapshot = [];
    this.invalidate();
  }

  /** Total number of feed lines. */
  get feedLineCount(): number {
    return this._feedLines.length;
  }

  /** Scroll the feed to the bottom. */
  scrollToBottom(): void {
    this._autoScrollToBottom();
    this.invalidate();
  }

  /** Scroll the feed by a delta (positive = down, negative = up). */
  scrollFeed(delta: number): void {
    this._feedScrollOffset = Math.max(0, this._feedScrollOffset + delta);
    this.invalidate();
  }

  // ── Public API: Input ──────────────────────────────────────────

  /** Get current input value. */
  get inputValue(): string {
    return this._input.value;
  }

  /** Set the input value and move cursor to end. */
  set inputValue(text: string) {
    this._input.setValue(text);
  }

  /** Get the underlying TextInput for advanced use. */
  get input(): TextInput {
    return this._input;
  }

  /** Get input history. */
  get history(): string[] {
    return this._input.history;
  }

  /** Set the input prompt text. */
  set prompt(text: string) {
    this._input.prompt = text;
  }

  get prompt(): string {
    return this._input.prompt;
  }

  // ── Public API: Progress ───────────────────────────────────────

  /** Show a progress/status message just above the input box. */
  setProgress(text: string | null): void {
    if (text === null || text.length === 0) {
      this._progressText.text = "";
      this._progressText.visible = false;
    } else {
      this._progressText.text = text;
      this._progressText.visible = true;
    }
    this.invalidate();
  }

  // ── Public API: Dropdown ───────────────────────────────────────

  /** Show dropdown items below the input box. */
  showDropdown(items: DropdownItem[]): void {
    this._dropdownItems = items;
    this._dropdownIndex = items.length > 0 ? 0 : -1;
    this.invalidate();
  }

  /** Hide the dropdown. */
  hideDropdown(): void {
    this._dropdownItems = [];
    this._dropdownIndex = -1;
    this.invalidate();
  }

  /** Move dropdown selection down. */
  dropdownDown(): boolean {
    if (this._dropdownItems.length === 0) return false;
    this._dropdownIndex = Math.min(
      this._dropdownIndex + 1,
      this._dropdownItems.length - 1,
    );
    this.invalidate();
    return true;
  }

  /** Move dropdown selection up. */
  dropdownUp(): boolean {
    if (this._dropdownItems.length === 0) return false;
    this._dropdownIndex = Math.max(this._dropdownIndex - 1, 0);
    this.invalidate();
    return true;
  }

  /** Accept the currently highlighted dropdown item. Returns it, or null. */
  acceptDropdownItem(): DropdownItem | null {
    if (this._dropdownIndex < 0 || this._dropdownIndex >= this._dropdownItems.length) {
      return null;
    }
    const item = this._dropdownItems[this._dropdownIndex];
    this._input.setValue(item.completion);
    this.hideDropdown();
    this.emit("change", item.completion);
    return item;
  }

  /** Get current dropdown items. */
  get dropdownItems(): DropdownItem[] {
    return this._dropdownItems;
  }

  /** Get current dropdown selection index. */
  get dropdownIndex(): number {
    return this._dropdownIndex;
  }

  // ── Input handling ─────────────────────────────────────────────

  override handleInput(event: InputEvent): boolean {
    // Intercept up/down for dropdown navigation
    if (event.type === "key") {
      const ke = event.event;

      // Dropdown navigation
      if (this._dropdownItems.length > 0) {
        if (ke.key === "up") return this.dropdownUp();
        if (ke.key === "down") return this.dropdownDown();
        if (ke.key === "enter" && this._dropdownIndex >= 0) {
          this.acceptDropdownItem();
          return true;
        }
        if (ke.key === "escape") {
          this.hideDropdown();
          return true;
        }
      }

      // Mouse wheel scrolling for feed
      if (ke.key === "pageup") {
        this.scrollFeed(-10);
        return true;
      }
      if (ke.key === "pagedown") {
        this.scrollFeed(10);
        return true;
      }
    }

    // Mouse wheel events for feed scrolling
    if (event.type === "mouse") {
      const me = event.event;
      if (me.type === "wheelup") {
        this.scrollFeed(-3);
        return true;
      }
      if (me.type === "wheeldown") {
        this.scrollFeed(3);
        return true;
      }
    }

    // Delegate to input
    return this._input.handleInput(event);
  }

  // ── Layout ─────────────────────────────────────────────────────

  override measure(constraint: Constraint): Size {
    this._lastWidth = constraint.maxWidth;
    this._lastHeight = constraint.maxHeight;

    // ChatView always fills the full available space
    const size: Size = {
      width: constraint.maxWidth,
      height: constraint.maxHeight,
    };
    this.desiredSize = size;
    return size;
  }

  override arrange(rect: Rect): void {
    this.bounds = rect;
    // Actual child arrangement happens in render() because we need
    // to know the computed heights of variable-height elements.
  }

  // ── Render ─────────────────────────────────────────────────────

  override render(ctx: DrawingContext): void {
    const b = this.bounds;
    if (!b || b.width < 1 || b.height < 3) return;

    const W = b.width;
    const H = b.height;

    // ── Measure fixed-height sections ────────────────────────

    // Banner height
    let bannerH = 0;
    if (this._banner.visible && this._banner.text.length > 0) {
      const bannerSize = this._banner.measure({ minWidth: 0, maxWidth: W, minHeight: 0, maxHeight: H });
      bannerH = bannerSize.height;
    }

    // Top separator: 1 row (only if banner is visible)
    const topSepH = bannerH > 0 ? 1 : 0;

    // Progress text height
    let progressH = 0;
    if (this._progressText.visible && this._progressText.text.length > 0) {
      const progressSize = this._progressText.measure({ minWidth: 0, maxWidth: W, minHeight: 0, maxHeight: 2 });
      progressH = progressSize.height;
    }

    // Bottom separator: 1 row
    const botSepH = 1;

    // Input: 1 row
    const inputH = 1;

    // Dropdown height
    const dropdownH = this._dropdownItems.length;

    // Feed gets remaining space
    const fixedH = bannerH + topSepH + botSepH + progressH + inputH + dropdownH;
    const feedH = Math.max(0, H - fixedH);

    // ── Arrange and render each section ──────────────────────

    let y = b.y;

    // 1. Banner
    if (bannerH > 0) {
      this._banner.arrange({ x: b.x, y, width: W, height: bannerH });
      this._banner.render(ctx);
      y += bannerH;
    }

    // 2. Top separator
    if (topSepH > 0) {
      this._topSeparator.arrange({ x: b.x, y, width: W, height: 1 });
      this._topSeparator.render(ctx);
      y += 1;
    }

    // 3. Feed area — render visible lines with clipping
    if (feedH > 0) {
      this._renderFeed(ctx, b.x, y, W, feedH);
      y += feedH;
    }

    // 4. Bottom separator
    this._bottomSeparator.arrange({ x: b.x, y, width: W, height: 1 });
    this._bottomSeparator.render(ctx);
    y += 1;

    // 5. Progress text
    if (progressH > 0) {
      this._progressText.arrange({ x: b.x, y, width: W, height: progressH });
      this._progressText.render(ctx);
      y += progressH;
    }

    // 6. Input
    this._input.measure({ minWidth: 0, maxWidth: W, minHeight: 0, maxHeight: 1 });
    this._input.arrange({ x: b.x, y, width: W, height: inputH });
    this._input.render(ctx);
    y += inputH;

    // 7. Dropdown
    if (dropdownH > 0) {
      this._renderDropdown(ctx, b.x, y, W, dropdownH);
    }

    // Save snapshot for next diff
    this._prevFeedSnapshot = this._feedLines.map((l) => l.text);
  }

  // ── Feed rendering ─────────────────────────────────────────────

  private _renderFeed(
    ctx: DrawingContext,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    // Clip feed area
    ctx.pushClip({ x, y, width, height });

    // Measure all feed lines to determine wrapped heights
    const lineHeights: number[] = [];
    let totalContentH = 0;

    for (const line of this._feedLines) {
      const lineSize = line.measure({ minWidth: 0, maxWidth: width, minHeight: 0, maxHeight: Infinity });
      const h = Math.max(1, lineSize.height);
      lineHeights.push(h);
      totalContentH += h;
    }

    // Clamp scroll offset
    const maxScroll = Math.max(0, totalContentH - height);
    this._feedScrollOffset = Math.max(0, Math.min(this._feedScrollOffset, maxScroll));

    // Find the first visible line
    let skippedRows = 0;
    let startLine = 0;
    for (let i = 0; i < this._feedLines.length; i++) {
      if (skippedRows + lineHeights[i] > this._feedScrollOffset) break;
      skippedRows += lineHeights[i];
      startLine = i + 1;
    }

    // Render visible lines
    let cy = y - (this._feedScrollOffset - skippedRows);
    for (let i = startLine; i < this._feedLines.length && cy < y + height; i++) {
      const line = this._feedLines[i];
      const lh = lineHeights[i];
      line.arrange({ x, y: cy, width, height: lh });
      line.render(ctx);
      cy += lh;
    }

    ctx.popClip();
  }

  // ── Dropdown rendering ─────────────────────────────────────────

  private _renderDropdown(
    ctx: DrawingContext,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    for (let i = 0; i < this._dropdownItems.length && i < height; i++) {
      const item = this._dropdownItems[i];
      const isHighlighted = i === this._dropdownIndex;
      const style = isHighlighted ? this._dropdownHighlightStyle : this._dropdownStyle;

      const prefix = isHighlighted ? "▸ " : "  ";
      const labelPad = item.label.padEnd(16);
      const text = prefix + labelPad + item.description;
      const truncated = text.length > width ? text.slice(0, width) : text;

      ctx.drawText(x, y + i, truncated, style);
    }
  }

  // ── Auto-scroll ────────────────────────────────────────────────

  private _autoScrollToBottom(): void {
    // Set scroll to a very large value; it will be clamped during render
    this._feedScrollOffset = Number.MAX_SAFE_INTEGER;
  }
}

// ── Internal: Separator line control ─────────────────────────────

/**
 * Thin separator line that fills its width with a repeated character.
 * Used for the horizontal rules between banner/feed/input.
 */
class _Separator extends Control {
  private _char: string;
  private _style: TextStyle;

  constructor(char: string, style: TextStyle) {
    super();
    this._char = char;
    this._style = style;
  }

  get separatorChar(): string {
    return this._char;
  }

  set separatorChar(c: string) {
    this._char = c;
    this.invalidate();
  }

  get style(): TextStyle {
    return this._style;
  }

  set style(s: TextStyle) {
    this._style = s;
    this.invalidate();
  }

  measure(_constraint: Constraint): Size {
    return { width: _constraint.maxWidth, height: 1 };
  }

  render(ctx: DrawingContext): void {
    const b = this.bounds;
    if (!b) return;
    const line = this._char.repeat(b.width);
    ctx.drawText(b.x, b.y, line, this._style);
  }
}
