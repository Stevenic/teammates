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
import { StyledText, type StyledLine } from "./styled-text.js";
import { TextInput, type InputColorizer, type DeleteSizer } from "./text-input.js";
import type { StyledSpan } from "../styled.js";

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
  /** Custom widget to use as the banner instead of the built-in Text. */
  bannerWidget?: Control;
  /** Prompt string for the input box (default "❯ "). */
  prompt?: string;
  /** Style for the prompt. */
  promptStyle?: TextStyle;
  /** Style for input text. */
  inputStyle?: TextStyle;
  /** Style for the cursor. */
  cursorStyle?: TextStyle;
  /** Per-character colorizer for input text. */
  inputColorize?: InputColorizer;
  /** Callback to determine delete size for backspace/delete in input. */
  inputDeleteSize?: DeleteSizer;
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
  /** Style for normal dropdown item description. */
  dropdownStyle?: TextStyle;
  /** Style for non-highlighted dropdown item label (/command, @name). */
  dropdownLabelStyle?: TextStyle;
  /** Maximum number of lines the input box can grow to (default 1). */
  maxInputHeight?: number;
  /** Footer content shown below the input (StyledLine for mixed colors). */
  footer?: StyledLine;
  /** Style for footer text (used as default when footer is a plain string). */
  footerStyle?: TextStyle;
  /** Command history entries. */
  history?: string[];
}

// ── ChatView ───────────────────────────────────────────────────────

export class ChatView extends Control {
  // ── Child controls ─────────────────────────────────────────────
  private _banner: Control;
  private _topSeparator: _Separator;
  private _feedLines: StyledText[] = [];
  private _bottomSeparator: _Separator;
  private _progressText: Text;
  private _input: TextInput;
  private _inputSeparator: _Separator;
  private _footer: StyledText;
  private _dropdownItems: DropdownItem[] = [];
  private _dropdownIndex: number = -1;

  // ── Configuration ──────────────────────────────────────────────
  private _feedStyle: TextStyle;
  private _progressStyle: TextStyle;
  private _separatorStyle: TextStyle;
  private _separatorChar: string;
  private _dropdownHighlightStyle: TextStyle;
  private _dropdownStyle: TextStyle;
  private _dropdownLabelStyle: TextStyle;
  private _footerStyle: TextStyle;
  private _maxInputH: number;

  // ── Layout cache ───────────────────────────────────────────────
  private _feedScrollOffset: number = 0;
  private _lastWidth: number = 0;
  private _lastHeight: number = 0;

  // ── Scrollbar state ───────────────────────────────────────────
  /** Cached from last render for hit-testing. */
  private _scrollbarX: number = -1;
  private _feedY: number = 0;
  private _feedH: number = 0;
  private _thumbPos: number = 0;
  private _thumbSize: number = 0;
  private _totalContentH: number = 0;
  private _maxScroll: number = 0;
  private _scrollbarVisible: boolean = false;
  /** True while the user is dragging the scrollbar thumb. */
  private _dragging: boolean = false;
  /** The Y offset within the thumb where the drag started. */
  private _dragOffsetY: number = 0;

  // ── Double buffer ──────────────────────────────────────────────

  constructor(options: ChatViewOptions = {}) {
    super();

    this._feedStyle = options.feedStyle ?? {};
    this._progressStyle = options.progressStyle ?? { italic: true };
    this._separatorStyle = options.separatorStyle ?? {};
    this._separatorChar = options.separatorChar ?? "─";
    this._dropdownHighlightStyle = options.dropdownHighlightStyle ?? { bold: true };
    this._dropdownStyle = options.dropdownStyle ?? {};
    this._dropdownLabelStyle = options.dropdownLabelStyle ?? this._dropdownStyle;
    this._footerStyle = options.footerStyle ?? {};
    this._maxInputH = options.maxInputHeight ?? 1;

    // Banner — use custom widget if provided, otherwise fall back to Text
    if (options.bannerWidget) {
      this._banner = options.bannerWidget;
    } else {
      this._banner = new Text({
        text: options.banner ?? "",
        style: options.bannerStyle ?? {},
        wrap: true,
      });
    }
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
      colorize: options.inputColorize,
      deleteSize: options.inputDeleteSize,
    });
    this._input.focusable = true;
    this._input.onFocus();
    this.addChild(this._input);

    // Separator between input and footer
    this._inputSeparator = new _Separator(this._separatorChar, this._separatorStyle);
    this.addChild(this._inputSeparator);

    // Footer (below input separator / dropdown, always 1 row)
    const footerLine: StyledLine = options.footer ?? "";
    this._footer = new StyledText({
      lines: [footerLine],
      defaultStyle: this._footerStyle,
      wrap: false,
    });
    this.addChild(this._footer);

    // Wire input events to ChatView events
    this._input.on("submit", (text: string) => this.emit("submit", text));
    this._input.on("change", (text: string) => this.emit("change", text));
    this._input.on("paste", (text: string) => this.emit("paste", text));
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

  /** Get the banner text (only works when using the built-in Text banner). */
  get banner(): string {
    return this._banner instanceof Text ? this._banner.text : "";
  }

  /** Set the banner text (only works when using the built-in Text banner). */
  set banner(text: string) {
    if (this._banner instanceof Text) {
      this._banner.text = text;
      this._banner.visible = text.length > 0;
      this.invalidate();
    }
  }

  /** Get the banner style (only works when using the built-in Text banner). */
  get bannerStyle(): TextStyle {
    return this._banner instanceof Text ? this._banner.style : {};
  }

  /** Set the banner style (only works when using the built-in Text banner). */
  set bannerStyle(style: TextStyle) {
    if (this._banner instanceof Text) {
      this._banner.style = style;
    }
  }

  /** Replace the banner with a custom widget. */
  set bannerWidget(widget: Control) {
    this.removeChild(this._banner);
    this._banner = widget;
    // Insert as first child so it stays at the top
    this.children.unshift(widget);
    widget.parent = this;
    this.invalidate();
  }

  /** Get the current banner widget. */
  get bannerWidget(): Control {
    return this._banner;
  }

  // ── Public API: Footer ─────────────────────────────────────────

  /** Set footer content (plain string or StyledSpan for mixed colors). */
  setFooter(content: StyledLine): void {
    this._footer.lines = [content];
    this.invalidate();
  }

  // ── Public API: Feed ───────────────────────────────────────────

  /** Append a line of plain text to the feed. Auto-scrolls to bottom. */
  appendToFeed(text: string, style?: TextStyle): void {
    const line = new StyledText({
      lines: [text],
      defaultStyle: style ?? this._feedStyle,
      wrap: true,
    });
    this._feedLines.push(line);
    this._autoScrollToBottom();
    this.invalidate();
  }

  /** Append a styled line (StyledSpan) to the feed. */
  appendStyledToFeed(styledLine: StyledSpan): void {
    const line = new StyledText({
      lines: [styledLine],
      defaultStyle: this._feedStyle,
      wrap: true,
    });
    this._feedLines.push(line);
    this._autoScrollToBottom();
    this.invalidate();
  }

  /** Append multiple plain lines to the feed. */
  appendLines(lines: string[], style?: TextStyle): void {
    for (const text of lines) {
      const line = new StyledText({
        lines: [text],
        defaultStyle: style ?? this._feedStyle,
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
          // Only consume Enter if the highlighted item has a completion value
          // AND the input doesn't already match the completion (otherwise submit).
          const item = this._dropdownItems[this._dropdownIndex];
          if (item && item.completion) {
            const currentVal = this._input.value.trim();
            if (currentVal !== item.completion.trim()) {
              this.acceptDropdownItem();
              return true;
            }
            // Input already matches — hide dropdown and let Enter fall through to submit
            this.hideDropdown();
          }
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

    // Mouse events: wheel scrolling + scrollbar drag
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

      // Scrollbar drag
      if (this._scrollbarVisible) {
        const onScrollbar = me.x === this._scrollbarX
          && me.y >= this._feedY
          && me.y < this._feedY + this._feedH;

        if (me.type === "press" && me.button === "left" && onScrollbar) {
          const relY = me.y - this._feedY;
          if (relY >= this._thumbPos && relY < this._thumbPos + this._thumbSize) {
            // Clicked on thumb — start dragging
            this._dragging = true;
            this._dragOffsetY = relY - this._thumbPos;
          } else {
            // Clicked on track — jump to that position
            const ratio = relY / this._feedH;
            this._feedScrollOffset = Math.round(ratio * this._maxScroll);
            this._feedScrollOffset = Math.max(0, Math.min(this._feedScrollOffset, this._maxScroll));
            this.invalidate();
          }
          return true;
        }

        if (me.type === "move" && this._dragging) {
          const relY = me.y - this._feedY;
          const newThumbPos = relY - this._dragOffsetY;
          const maxThumbPos = this._feedH - this._thumbSize;
          const clampedPos = Math.max(0, Math.min(newThumbPos, maxThumbPos));
          const ratio = maxThumbPos > 0 ? clampedPos / maxThumbPos : 0;
          this._feedScrollOffset = Math.round(ratio * this._maxScroll);
          this.invalidate();
          return true;
        }

        if (me.type === "release" && this._dragging) {
          this._dragging = false;
          return true;
        }
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

    // Progress text height
    let progressH = 0;
    if (this._progressText.visible && this._progressText.text.length > 0) {
      const progressSize = this._progressText.measure({ minWidth: 0, maxWidth: W, minHeight: 0, maxHeight: 2 });
      progressH = progressSize.height;
    }

    // Bottom separator: 1 row
    const botSepH = 1;

    // Input: measure to get wrapped height (up to maxInputH rows)
    const inputSize = this._input.measure({ minWidth: 0, maxWidth: W, minHeight: 0, maxHeight: this._maxInputH });
    const inputH = inputSize.height;

    // Input separator: 1 row (between input and footer/dropdown)
    const inputSepH = 1;

    // Footer: always 1 row (shows footer text or first row of dropdown)
    const footerH = 1;

    // Dropdown height — when active, replaces the footer row and can grow.
    const chromeH = botSepH + progressH + inputH + inputSepH + footerH;
    const hasDropdown = this._dropdownItems.length > 0;
    const maxDropdownH = Math.max(0, H - chromeH);
    const dropdownExtraH = hasDropdown
      ? Math.min(this._dropdownItems.length - 1, maxDropdownH)
      : 0;

    // Feed gets remaining space (banner + separator scroll within it)
    const fixedH = chromeH + dropdownExtraH;
    const feedH = Math.max(0, H - fixedH);

    // ── Arrange and render each section ──────────────────────

    let y = b.y;

    // 1. Feed area (banner + separator + feed lines all scroll together)
    if (feedH > 0) {
      this._renderFeed(ctx, b.x, y, W, feedH);
      y += feedH;
    }

    // 2. Bottom separator
    this._bottomSeparator.arrange({ x: b.x, y, width: W, height: 1 });
    this._bottomSeparator.render(ctx);
    y += 1;

    // 3. Progress text
    if (progressH > 0) {
      this._progressText.arrange({ x: b.x, y, width: W, height: progressH });
      this._progressText.render(ctx);
      y += progressH;
    }

    // 4. Input
    this._input.arrange({ x: b.x, y, width: W, height: inputH });
    this._input.render(ctx);
    y += inputH;

    // 5. Input separator
    this._inputSeparator.arrange({ x: b.x, y, width: W, height: 1 });
    this._inputSeparator.render(ctx);
    y += inputSepH;

    // 6. Dropdown or footer
    if (hasDropdown) {
      const totalDropdownH = dropdownExtraH + 1;
      this._renderDropdown(ctx, b.x, y, W, totalDropdownH);
    } else {
      this._footer.measure({ minWidth: 0, maxWidth: W, minHeight: 0, maxHeight: 1 });
      this._footer.arrange({ x: b.x, y, width: W, height: footerH });
      this._footer.render(ctx);
    }

  }

  // ── Feed rendering ─────────────────────────────────────────────

  private _renderFeed(
    ctx: DrawingContext,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    // Build the list of scrollable items: banner + separator + feed lines
    // Each item is { control, height } measured against content width.
    const contentWidth = width - 1; // reserve 1 col for scrollbar

    interface ScrollItem {
      render: (cx: number, cy: number, cw: number, ch: number) => void;
      height: number;
    }
    const items: ScrollItem[] = [];

    // Banner (if visible)
    if (this._banner.visible) {
      const bannerSize = this._banner.measure({ minWidth: 0, maxWidth: contentWidth, minHeight: 0, maxHeight: Infinity });
      const bh = Math.max(1, bannerSize.height);
      items.push({
        height: bh,
        render: (cx, cy, cw, ch) => {
          this._banner.arrange({ x: cx, y: cy, width: cw, height: ch });
          this._banner.render(ctx);
        },
      });
      // Top separator after banner
      items.push({
        height: 1,
        render: (cx, cy, cw, _ch) => {
          this._topSeparator.arrange({ x: cx, y: cy, width: cw, height: 1 });
          this._topSeparator.render(ctx);
        },
      });
    }

    // Feed lines
    for (const line of this._feedLines) {
      const lineSize = line.measure({ minWidth: 0, maxWidth: contentWidth, minHeight: 0, maxHeight: Infinity });
      const h = Math.max(1, lineSize.height);
      items.push({
        height: h,
        render: (cx, cy, cw, ch) => {
          line.arrange({ x: cx, y: cy, width: cw, height: ch });
          line.render(ctx);
        },
      });
    }

    // Calculate total content height
    let totalContentH = 0;
    for (const item of items) {
      totalContentH += item.height;
    }

    // Clamp scroll offset
    const maxScroll = Math.max(0, totalContentH - height);
    this._feedScrollOffset = Math.max(0, Math.min(this._feedScrollOffset, maxScroll));

    // Clip feed area
    ctx.pushClip({ x, y, width, height });

    // Find the first visible item
    let skippedRows = 0;
    let startIdx = 0;
    for (let i = 0; i < items.length; i++) {
      if (skippedRows + items[i].height > this._feedScrollOffset) break;
      skippedRows += items[i].height;
      startIdx = i + 1;
    }

    // Render visible items
    let cy = y - (this._feedScrollOffset - skippedRows);
    for (let i = startIdx; i < items.length && cy < y + height; i++) {
      const item = items[i];
      item.render(x, cy, contentWidth, item.height);
      cy += item.height;
    }

    // Render scrollbar and cache geometry for hit-testing
    if (height > 0 && totalContentH > height) {
      const scrollX = x + width - 1;
      const thumbSize = Math.max(1, Math.round((height / totalContentH) * height));
      const thumbPos = maxScroll > 0
        ? Math.round((this._feedScrollOffset / maxScroll) * (height - thumbSize))
        : 0;
      const trackStyle = this._separatorStyle;
      const thumbStyle = this._feedStyle;

      // Cache for mouse interaction
      this._scrollbarX = scrollX;
      this._feedY = y;
      this._feedH = height;
      this._thumbPos = thumbPos;
      this._thumbSize = thumbSize;
      this._totalContentH = totalContentH;
      this._maxScroll = maxScroll;
      this._scrollbarVisible = true;

      for (let row = 0; row < height; row++) {
        const inThumb = row >= thumbPos && row < thumbPos + thumbSize;
        ctx.drawChar(scrollX, y + row, inThumb ? "┃" : "│", inThumb ? thumbStyle : trackStyle);
      }
    } else {
      this._scrollbarVisible = false;
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

      if (isHighlighted) {
        // Selected row: entire row in highlight style
        const prefix = "▸ ";
        const labelPad = item.label.padEnd(16);
        const text = prefix + labelPad + item.description;
        const truncated = text.length > width ? text.slice(0, width) : text;
        ctx.drawText(x, y + i, truncated, this._dropdownHighlightStyle);
      } else {
        // Non-selected: label in accent (dropdownLabelStyle), description in muted (dropdownStyle)
        const prefix = "  ";
        const labelPad = item.label.padEnd(16);
        ctx.drawStyledText(x, y + i, [
          { text: prefix + labelPad, style: this._dropdownLabelStyle },
          { text: item.description, style: this._dropdownStyle },
        ]);
      }
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
