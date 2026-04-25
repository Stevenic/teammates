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

import type { DrawingContext, TextStyle } from "../drawing/context.js";
import type { InputEvent } from "../input/events.js";
import { Control } from "../layout/control.js";
import type { Constraint, Rect, Size } from "../layout/types.js";
import type { StyledSegment, StyledSpan } from "../styled.js";
import {
  type FeedActionEntry,
  type FeedActionItem,
  FeedStore,
} from "./feed-store.js";
import { type StyledLine, StyledText } from "./styled-text.js";
import { Text } from "./text.js";
import {
  type DeleteSizer,
  type InputColorizer,
  TextInput,
} from "./text-input.js";
import { VirtualList, type VirtualListItem } from "./virtual-list.js";

// ── URL / file path detection ───────────────────────────────────────
const URL_REGEX = /https?:\/\/[^\s)>\]]+/g;
const FILE_PATH_REGEX =
  /(?:[A-Za-z]:[/\\]|\/)[^\s:*?"<>|)>\]]*[^\s:*?"<>|)>\].,:;!]/g;

// ── Selection highlight color ─────────────────────────────────────
const SELECTION_BG = { r: 60, g: 100, b: 180, a: 255 };

// ── Types ──────────────────────────────────────────────────────────

export interface DropdownItem {
  /** Display label (left column). */
  label: string;
  /** Description (right column). */
  description: string;
  /** Full text to insert on accept. */
  completion: string;
}

// Re-export types that moved to feed-store.ts for backward compatibility
export type {
  FeedActionEntry,
  FeedActionItem,
  FeedItem,
} from "./feed-store.js";

export interface ChatViewOptions {
  /** Banner text shown at the top of the chat area. */
  banner?: string;
  /** Style for the banner text. */
  bannerStyle?: TextStyle;
  /** Custom widget to use as the banner instead of the built-in Text. */
  bannerWidget?: Control;
  /** Optional widget docked between the top separator and the feed.
   *  Remains pinned at the top even when the feed scrolls. */
  dockedBar?: Control;
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
  /** Hint callback — returns dim text shown after the cursor (e.g. param placeholders). */
  inputHint?: (value: string) => string | null;
  /** Style for input hint text (default: dim). */
  inputHintStyle?: TextStyle;
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
  /** Footer content shown below the input (StyledLine for mixed colors). Sets the left side. */
  footer?: StyledLine;
  /** Right-aligned footer content. */
  footerRight?: StyledLine;
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
  /** Docked bar between top separator and feed (e.g. thread tab bar). */
  private _dockedBar: Control | null = null;
  /** Identity-based feed item store — replaces _feedLines + _feedActions + _hiddenFeedLines. */
  private _store: FeedStore = new FeedStore();
  /** ID of the feed item currently hovered (null if none). */
  private _hoveredItemId: string | null = null;
  /** ID of the feed item whose URL/file region is currently hovered. */
  private _hoveredLinkItemId: string | null = null;
  /** Char offset of the currently hovered URL/file target within its item. */
  private _hoveredLinkIndex: number | null = null;
  /** Original content.lines of the link-hover item, cached so we can restore. */
  private _hoveredLinkOriginalLines: StyledLine[] | null = null;
  /** Scrollable list widget — owns scroll state, height cache, screen mapping, scrollbar. */
  private _feed!: VirtualList;
  /** Number of non-feed items (banner + separator) prepended to VirtualList items. */
  private _feedItemOffset = 0;
  private _bottomSeparator: _Separator;
  private _progressText: StyledText;
  private _input: TextInput;
  private _inputSeparator: _Separator;
  private _footer: StyledText;
  private _footerRight: StyledText;
  private _dropdownItems: DropdownItem[] = [];
  private _dropdownIndex: number = -1;

  // ── Configuration ──────────────────────────────────────────────
  private _feedStyle: TextStyle;
  private _progressStyle: TextStyle;
  private _separatorStyle: TextStyle;
  private _separatorChar: string;
  private _dropdownHighlightStyle: TextStyle;
  private _dropdownStyle: TextStyle;
  private _footerStyle: TextStyle;
  private _maxInputH: number;

  // ── Selection state ──────────────────────────────────────────
  private _selAnchor: { x: number; y: number } | null = null;
  private _selEnd: { x: number; y: number } | null = null;
  private _selecting: boolean = false;
  /** Timer for auto-scrolling the feed during drag-to-select. */
  private _selScrollTimer: ReturnType<typeof setInterval> | null = null;
  /** Direction of auto-scroll: -1 = up, 1 = down, 0 = none. */
  private _selScrollDir: number = 0;
  /** DrawingContext reference from the last render (for text extraction). */
  private _ctx: DrawingContext | null = null;

  /** Optional widget that replaces the input area (e.g. Interview). */
  private _inputOverride: Control | null = null;

  constructor(options: ChatViewOptions = {}) {
    super();

    this._feedStyle = options.feedStyle ?? {};
    this._progressStyle = options.progressStyle ?? { italic: true };
    this._separatorStyle = options.separatorStyle ?? {};
    this._separatorChar = options.separatorChar ?? "─";
    this._dropdownHighlightStyle = options.dropdownHighlightStyle ?? {
      bold: true,
    };
    this._dropdownStyle = options.dropdownStyle ?? {};
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
    this._topSeparator = new _Separator(
      this._separatorChar,
      this._separatorStyle,
    );
    this.addChild(this._topSeparator);

    // Docked bar (between separator and feed, optional)
    if (options.dockedBar) {
      this._dockedBar = options.dockedBar;
      this.addChild(this._dockedBar);
    }

    // Virtual list (scrollable feed area — owns scroll, height cache, scrollbar)
    this._feed = new VirtualList({
      trackStyle: this._separatorStyle,
      thumbStyle: this._feedStyle,
    });
    this._feed.onRenderOverlay = (ctx, x, y, w, h) => {
      if (this._selAnchor && this._selEnd) {
        this._renderSelection(ctx, x, y, w, h);
      }
    };
    this.addChild(this._feed);

    // Bottom separator (between feed and input area)
    this._bottomSeparator = new _Separator(
      this._separatorChar,
      this._separatorStyle,
    );
    this.addChild(this._bottomSeparator);

    // Progress text (above separator, fixed)
    this._progressText = new StyledText({
      lines: [],
      defaultStyle: this._progressStyle,
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
      hint: options.inputHint,
      hintStyle: options.inputHintStyle,
    });
    this._input.focusable = true;
    this._input.onFocus();
    this.addChild(this._input);

    // Separator between input and footer
    this._inputSeparator = new _Separator(
      this._separatorChar,
      this._separatorStyle,
    );
    this.addChild(this._inputSeparator);

    // Footer (below input separator / dropdown, always 1 row)
    const footerLine: StyledLine = options.footer ?? "";
    this._footer = new StyledText({
      lines: [footerLine],
      defaultStyle: this._footerStyle,
      wrap: false,
    });
    this.addChild(this._footer);

    const footerRightLine: StyledLine = options.footerRight ?? "";
    this._footerRight = new StyledText({
      lines: [footerRightLine],
      defaultStyle: this._footerStyle,
      wrap: false,
    });
    this.addChild(this._footerRight);

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

  /** Set left-side footer content (plain string or StyledSpan for mixed colors). */
  setFooter(content: StyledLine): void {
    this._footer.lines = [content];
    this.invalidate();
  }

  /** Set right-side footer content (plain string or StyledSpan for mixed colors). */
  setFooterRight(content: StyledLine): void {
    this._footerRight.lines = [content];
    this.invalidate();
  }

  // ── Public API: Docked Bar ─────────────────────────────────────

  /** Set or replace the docked bar widget (pinned between separator and feed). */
  set dockedBar(widget: Control | null) {
    if (this._dockedBar) this.removeChild(this._dockedBar);
    this._dockedBar = widget;
    if (widget) this.addChild(widget);
    this.invalidate();
  }

  /** Get the current docked bar widget. */
  get dockedBar(): Control | null {
    return this._dockedBar;
  }

  // ── Public API: FeedStore swapping ────────────────────────────

  /** Get the current FeedStore. */
  get store(): FeedStore {
    return this._store;
  }

  /**
   * Swap the active FeedStore (e.g. when switching thread tabs).
   * Saves the current scroll offset and restores the target's.
   * Returns the previously active store.
   */
  setStore(newStore: FeedStore, savedScroll?: number): FeedStore {
    const prev = this._store;
    // Save current scroll state on the outgoing store
    (prev as any).__savedScroll = this._feed
      ? ((this._feed as any)._scrollOffset ?? 0)
      : 0;
    (prev as any).__savedScrolledAway = this._feed
      ? ((this._feed as any)._userScrolledAway ?? false)
      : false;

    this._store = newStore;
    this._hoveredItemId = null;
    this._hoveredLinkItemId = null;
    this._hoveredLinkIndex = null;
    this._hoveredLinkOriginalLines = null;

    // Restore scroll state for the incoming store
    if (this._feed) {
      const scroll =
        savedScroll ??
        (newStore as any).__savedScroll ??
        Number.MAX_SAFE_INTEGER;
      const scrolledAway = (newStore as any).__savedScrolledAway ?? false;
      (this._feed as any)._scrollOffset = scroll;
      (this._feed as any)._userScrolledAway = scrolledAway;
      this._feed.invalidateAllHeights();
    }

    this.invalidate();
    return prev;
  }

  // ── Public API: Feed ───────────────────────────────────────────

  /** Append a line of plain text to the feed. Auto-scrolls to bottom. */
  appendToFeed(text: string, style?: TextStyle): void {
    const content = new StyledText({
      lines: [text],
      defaultStyle: style ?? this._feedStyle,
      wrap: true,
    });
    this._store.push(content);
    this._autoScrollToBottom();
    this.invalidate();
  }

  /** Append a styled line (StyledSpan) to the feed. */
  appendStyledToFeed(styledLine: StyledSpan): void {
    const content = new StyledText({
      lines: [styledLine],
      defaultStyle: this._feedStyle,
      wrap: true,
    });
    this._store.push(content);
    this._autoScrollToBottom();
    this.invalidate();
  }

  /** Append a clickable action line to the feed. Emits "action" on click. */
  appendAction(
    id: string,
    normalContent: StyledLine,
    hoverContent: StyledLine,
  ): void {
    const content = new StyledText({
      lines: [normalContent],
      defaultStyle: this._feedStyle,
      wrap: false,
    });
    this._store.push(content, {
      items: [{ id, normalStyle: normalContent, hoverStyle: hoverContent }],
      normalStyle: normalContent,
    });
    this._autoScrollToBottom();
    this.invalidate();
  }

  /** Append a line with multiple side-by-side clickable actions. */
  appendActionList(actions: FeedActionItem[]): void {
    if (actions.length === 0) return;
    const combined = this._concatSpans(actions.map((a) => a.normalStyle));
    const content = new StyledText({
      lines: [combined],
      defaultStyle: this._feedStyle,
      wrap: false,
    });
    this._store.push(content, { items: actions, normalStyle: combined });
    this._autoScrollToBottom();
    this.invalidate();
  }

  /** Concatenate multiple StyledLine arrays into one. */
  private _concatSpans(spans: StyledLine[]): StyledLine {
    const result: unknown[] = [];
    for (const s of spans) {
      if (Array.isArray(s)) result.push(...s);
      else result.push(s);
    }
    return result as unknown as StyledLine;
  }

  /** Append multiple plain lines to the feed. */
  appendLines(lines: string[], style?: TextStyle): void {
    for (const text of lines) {
      const content = new StyledText({
        lines: [text],
        defaultStyle: style ?? this._feedStyle,
        wrap: true,
      });
      this._store.push(content);
    }
    this._autoScrollToBottom();
    this.invalidate();
  }

  /** Clear everything between the banner and the input box. */
  clear(): void {
    this._store.clear();
    this._hoveredItemId = null;
    this._hoveredLinkItemId = null;
    this._hoveredLinkIndex = null;
    this._hoveredLinkOriginalLines = null;
    this._feed.reset();
    this.invalidate();
  }

  /** Total number of feed lines. */
  get feedLineCount(): number {
    return this._store.length;
  }

  /** Update the content of an existing feed line by index. Also removes its action if any. */
  updateFeedLine(index: number, content: StyledLine): void {
    const item = this._store.at(index);
    if (!item) return;
    item.content.lines = [content];
    this._feed.invalidateItem(item.id);
    item.actions = undefined;
    if (this._hoveredItemId === item.id) this._hoveredItemId = null;
    if (this._hoveredLinkItemId === item.id) {
      this._hoveredLinkItemId = null;
      this._hoveredLinkIndex = null;
      this._hoveredLinkOriginalLines = null;
    }
    this.invalidate();
  }

  /** Update the action items on an existing action line by index. */
  updateActionList(index: number, actions: FeedActionItem[]): void {
    const item = this._store.at(index);
    if (!item) return;
    if (actions.length === 0) return;
    const combined = this._concatSpans(actions.map((a) => a.normalStyle));
    item.content.lines = [combined];
    this._feed.invalidateItem(item.id);
    item.actions = { items: actions, normalStyle: combined };
    if (this._hoveredItemId === item.id) this._hoveredItemId = null;
    if (this._hoveredLinkItemId === item.id) {
      this._hoveredLinkItemId = null;
      this._hoveredLinkIndex = null;
      this._hoveredLinkOriginalLines = null;
    }
    this.invalidate();
  }

  // ── Insert API ──────────────────────────────────────────────────
  // No _shiftFeedIndices needed — FeedStore handles the single array splice.

  /** Insert a plain text line at a specific feed index. */
  insertToFeed(atIndex: number, text: string, style?: TextStyle): void {
    const content = new StyledText({
      lines: [text],
      defaultStyle: style ?? this._feedStyle,
      wrap: true,
    });
    this._store.insert(atIndex, content);
    this._autoScrollToBottom();
    this.invalidate();
  }

  /** Insert a styled line at a specific feed index. */
  insertStyledToFeed(atIndex: number, styledLine: StyledSpan): void {
    const content = new StyledText({
      lines: [styledLine],
      defaultStyle: this._feedStyle,
      wrap: true,
    });
    this._store.insert(atIndex, content);
    this._autoScrollToBottom();
    this.invalidate();
  }

  /** Insert an action list at a specific feed index. */
  insertActionList(atIndex: number, actions: FeedActionItem[]): void {
    if (actions.length === 0) return;
    const combined = this._concatSpans(actions.map((a) => a.normalStyle));
    const content = new StyledText({
      lines: [combined],
      defaultStyle: this._feedStyle,
      wrap: false,
    });
    this._store.insert(atIndex, content, {
      items: actions,
      normalStyle: combined,
    });
    this._autoScrollToBottom();
    this.invalidate();
  }

  // ── Visibility API ────────────────────────────────────────────────

  /** Hide or show a single feed line. Hidden lines take zero height. */
  setFeedLineHidden(index: number, hidden: boolean): void {
    const item = this._store.at(index);
    if (item) item.hidden = hidden;
    this.invalidate();
  }

  /** Hide or show a range of feed lines. */
  setFeedLinesHidden(startIndex: number, count: number, hidden: boolean): void {
    for (let i = startIndex; i < startIndex + count; i++) {
      const item = this._store.at(i);
      if (item) item.hidden = hidden;
    }
    this.invalidate();
  }

  /** Check if a feed line is hidden. */
  isFeedLineHidden(index: number): boolean {
    return this._store.at(index)?.hidden === true;
  }

  /** Scroll the feed to the bottom. */
  scrollToBottom(): void {
    this._feed.scrollToBottom();
    this.invalidate();
  }

  /** Scroll the feed by a delta (positive = down, negative = up). */
  scrollFeed(delta: number): void {
    this._feed.scroll(delta);
    // Clear selection when scrolling (unless actively drag-selecting)
    if (!this._selecting && this._hasSelection()) {
      this.clearSelection();
    }
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

  /** Show a progress/status message just above the separator. */
  setProgress(content: StyledLine | null): void {
    if (
      content === null ||
      (typeof content === "string" && content.length === 0)
    ) {
      this._progressText.lines = [];
      this._progressText.visible = false;
    } else {
      this._progressText.lines = [content];
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
    if (
      this._dropdownIndex < 0 ||
      this._dropdownIndex >= this._dropdownItems.length
    ) {
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

  // ── Public API: Input Override ─────────────────────────────────

  /**
   * Replace the normal input/footer area with a custom widget
   * (e.g. an Interview). While an override is active the normal
   * input, separator, footer and dropdown are hidden and input
   * events are routed to the override widget.
   *
   * Pass `null` to remove the override and restore normal input.
   */
  setInputOverride(widget: Control | null): void {
    // Remove previous override
    if (this._inputOverride) {
      this.removeChild(this._inputOverride);
    }

    this._inputOverride = widget;

    if (widget) {
      this.addChild(widget);
      // Hide normal input chrome
      this._input.visible = false;
      this._input.focusable = false;
      this._inputSeparator.visible = false;
      this._footer.visible = false;
      this._footerRight.visible = false;
    } else {
      // Restore normal input chrome
      this._input.visible = true;
      this._input.focusable = true;
      this._input.onFocus();
      this._inputSeparator.visible = true;
      this._footer.visible = true;
      this._footerRight.visible = true;
    }

    this.invalidate();
  }

  /** Get the current input override widget, or null. */
  get inputOverride(): Control | null {
    return this._inputOverride;
  }

  // ── Input handling ─────────────────────────────────────────────

  override handleInput(event: InputEvent): boolean {
    if (event.type === "key") {
      const ke = event.event;

      // Ctrl+C: if selection active, copy; otherwise emit for the app
      if (ke.key === "c" && ke.ctrl && !ke.alt && !ke.shift) {
        if (this._hasSelection()) {
          this._copySelection();
          return true;
        }
        this.emit("ctrlc");
        return true;
      }

      // Enter: if selection active, copy; otherwise fall through
      if (ke.key === "enter" && this._hasSelection()) {
        this._copySelection();
        return true;
      }

      // Any key clears active selection
      if (this._hasSelection()) {
        this.clearSelection();
      }

      // Dropdown navigation
      if (this._dropdownItems.length > 0) {
        if (ke.key === "up") return this.dropdownUp();
        if (ke.key === "down") return this.dropdownDown();
        if (ke.key === "enter" && this._dropdownIndex >= 0) {
          // Only consume Enter if the highlighted item has a completion value
          // AND the input doesn't already match the completion (otherwise submit).
          const item = this._dropdownItems[this._dropdownIndex];
          if (item?.completion) {
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

    // Mouse events: wheel scrolling, scrollbar drag, selection, actions
    if (event.type === "mouse") {
      const me = event.event;
      const fb = this._feed.bounds;
      if (me.type === "wheelup") {
        this.scrollFeed(-3);
        return true;
      }
      if (me.type === "wheeldown") {
        this.scrollFeed(3);
        return true;
      }

      // Docked bar mouse handling — delegate clicks and hover to the bar widget
      if (this._dockedBar?.visible && this._dockedBar.bounds) {
        const db = this._dockedBar.bounds;
        const inDockedBar = me.y >= db.y && me.y < db.y + db.height;

        if (me.type === "move") {
          if (inDockedBar && "handleMouseMove" in this._dockedBar) {
            (this._dockedBar as any).handleMouseMove(me.x, me.y - db.y);
          } else if (!inDockedBar && "handleMouseLeave" in this._dockedBar) {
            (this._dockedBar as any).handleMouseLeave();
          }
        }

        if (me.type === "press" && me.button === "left" && inDockedBar) {
          // Delegate to the docked bar's handleClick if available
          if ("handleClick" in this._dockedBar) {
            (this._dockedBar as any).handleClick(me.x, me.y - db.y);
          }
          return true;
        }
      }

      // Precompute scrollbar hit for reuse
      const onScrollbar =
        fb != null &&
        this._feed.scrollbarVisible &&
        me.x === this._feed.scrollbarX &&
        me.y >= fb.y &&
        me.y < fb.y + fb.height;

      // Scrollbar drag — delegate to VirtualList
      if (this._feed.scrollbarVisible) {
        if (me.type === "press" && me.button === "left" && onScrollbar) {
          this._feed.handleScrollbarPress(me.y);
          if (this._hasSelection()) this.clearSelection();
          this.invalidate();
          return true;
        }

        if (me.type === "move" && this._feed.isDragging) {
          this._feed.handleScrollbarDrag(me.y);
          if (this._hasSelection()) this.clearSelection();
          this.invalidate();
          return true;
        }

        if (me.type === "release" && this._feed.isDragging) {
          this._feed.handleScrollbarRelease();
          return true;
        }
      }

      // Ctrl+click to open URLs or file paths
      if (me.type === "press" && me.button === "left" && me.ctrl) {
        const feedLineIdx = this._feedLineAtScreen(me.y);
        if (feedLineIdx >= 0) {
          const text = this._extractFeedLineText(feedLineIdx);
          // Collect all clickable targets: URLs and absolute file paths
          URL_REGEX.lastIndex = 0;
          FILE_PATH_REGEX.lastIndex = 0;
          const urls = [...text.matchAll(URL_REGEX)];
          const paths = [...text.matchAll(FILE_PATH_REGEX)];
          const allTargets = [
            ...urls.map((m) => ({
              index: m.index!,
              text: m[0],
              type: "link" as const,
            })),
            ...paths.map((m) => ({
              index: m.index!,
              text: m[0],
              type: "file" as const,
            })),
          ].sort((a, b) => a.index - b.index);
          if (allTargets.length === 1) {
            this.emit(allTargets[0].type, allTargets[0].text);
            return true;
          }
          if (allTargets.length > 1) {
            const row = this._feed.rowAtScreen(me.y);
            const col = me.x - (fb?.x ?? 0);
            const charOffset = row * this._feed.contentWidth + col;
            const hit = allTargets.find(
              (t) =>
                charOffset >= t.index && charOffset < t.index + t.text.length,
            );
            const target = hit ?? allTargets[0];
            this.emit(target.type, target.text);
            return true;
          }
        }
      }

      // Text selection: start on left press in feed area
      if (
        me.type === "press" &&
        me.button === "left" &&
        !me.ctrl &&
        !onScrollbar
      ) {
        const feedLineIdx = this._feedLineAtScreen(me.y);
        const isAction =
          feedLineIdx >= 0 && !!this._store.at(feedLineIdx)?.actions;
        if (!isAction) {
          this._selAnchor = { x: me.x, y: me.y };
          this._selEnd = { x: me.x, y: me.y };
          this._selecting = true;
          this.invalidate();
          return true;
        }
      }

      // Text selection: extend on move (with auto-scroll at edges)
      if (me.type === "move" && this._selecting) {
        this._selEnd = { x: me.x, y: me.y };
        const feedTop = fb?.y ?? 0;
        const feedBot = feedTop + (fb?.height ?? 0);
        if (me.y < feedTop) {
          this._startSelScroll(-1);
        } else if (me.y >= feedBot) {
          this._startSelScroll(1);
        } else {
          this._stopSelScroll();
        }
        this.invalidate();
        return true;
      }

      // Text selection: finalize on release
      if (me.type === "release" && this._selecting) {
        this._selecting = false;
        this._stopSelScroll();
        this._selEnd = { x: me.x, y: me.y };
        // If anchor == end (just a click, no drag), clear selection
        if (
          this._selAnchor &&
          this._selEnd &&
          this._selAnchor.x === this._selEnd.x &&
          this._selAnchor.y === this._selEnd.y
        ) {
          this._selAnchor = null;
          this._selEnd = null;
        }
        this.invalidate();
        return true;
      }

      // Action hover/click in feed area
      if (this._store.hasActions) {
        const feedLineIdx = this._feedLineAtScreen(me.y);
        const feedItem =
          feedLineIdx >= 0 ? this._store.at(feedLineIdx) : undefined;
        const entry = feedItem?.actions;

        if (me.type === "move") {
          const newHoverId = entry ? feedItem!.id : null;
          if (
            newHoverId !== this._hoveredItemId ||
            (entry && entry.items.length > 1)
          ) {
            // Restore previous hover item to normal style
            if (this._hoveredItemId) {
              const prevItem = this._store.get(this._hoveredItemId);
              if (prevItem?.actions) {
                prevItem.content.lines = [prevItem.actions.normalStyle];
                this._feed.invalidateItem(prevItem.id);
              }
            }
            // Apply hover style to new item
            if (entry && feedItem) {
              const hitItem = this._resolveActionItem(entry, me.x);
              const hoverLine = this._buildHoverLine(entry, hitItem);
              feedItem.content.lines = [hoverLine];
              this._feed.invalidateItem(feedItem.id);
            }
            this._hoveredItemId = newHoverId;
            this.invalidate();
          }
        }

        if (me.type === "press" && me.button === "left" && entry) {
          const hitItem = this._resolveActionItem(entry, me.x);
          if (hitItem) this.emit("action", hitItem.id);
          return true;
        }
      }

      // URL / file-path hover: underline the target under the cursor
      if (me.type === "move") {
        const hit = this._linkTargetAt(me.x, me.y);
        const hitItem = hit ? this._store.at(hit.itemIdx) : undefined;
        // Skip items that own an action entry — their hover is owned by the
        // action subsystem above.
        const newItemId = hitItem && !hitItem.actions ? hitItem.id : null;
        const newIndex = hit && newItemId ? hit.index : null;
        if (
          newItemId !== this._hoveredLinkItemId ||
          newIndex !== this._hoveredLinkIndex
        ) {
          const cleared = this._clearLinkHover();
          if (hit && hitItem && newItemId) {
            this._hoveredLinkItemId = newItemId;
            this._hoveredLinkIndex = hit.index;
            this._hoveredLinkOriginalLines = hitItem.content.lines;
            hitItem.content.lines = this._applyUnderlineOverlay(
              hitItem.content.lines,
              hit.index,
              hit.text.length,
            );
            this._feed.invalidateItem(hitItem.id);
            this.invalidate();
          } else if (cleared) {
            this.invalidate();
          }
        }
      }
    }

    // Delegate to override widget or normal input
    if (this._inputOverride) {
      return this._inputOverride.handleInput(event);
    }
    return this._input.handleInput(event);
  }

  /** Map screen Y → feed line index (accounting for banner/separator prefix items). */
  private _feedLineAtScreen(screenY: number): number {
    const itemIdx = this._feed.itemIndexAtScreen(screenY);
    return itemIdx >= this._feedItemOffset
      ? itemIdx - this._feedItemOffset
      : -1;
  }

  /** Extract the plain text content of a feed line. */
  private _extractFeedLineText(idx: number): string {
    const styledText = this._store.at(idx)?.content;
    if (!styledText) return "";
    return styledText.lines
      .map((line) => {
        if (typeof line === "string") return line;
        return line.map((seg) => seg.text).join("");
      })
      .join("\n");
  }

  /** Resolve which action item the mouse x-position falls on. */
  private _resolveActionItem(
    entry: FeedActionEntry,
    x: number,
  ): FeedActionItem | null {
    if (entry.items.length === 1) return entry.items[0];
    // Calculate text length of each item's normal style to find boundaries
    let col = 0;
    for (const item of entry.items) {
      const len = this._spanTextLength(item.normalStyle);
      if (x < col + len) return item;
      col += len;
    }
    return entry.items[entry.items.length - 1];
  }

  /** Build a hover line: highlight only the target item, keep others normal. */
  private _buildHoverLine(
    entry: FeedActionEntry,
    target: FeedActionItem | null,
  ): StyledLine {
    if (entry.items.length === 1 && target) return target.hoverStyle;
    const parts: StyledLine[] = entry.items.map((item) =>
      item === target ? item.hoverStyle : item.normalStyle,
    );
    return this._concatSpans(parts);
  }

  /** Get the plain text length of a StyledLine. */
  private _spanTextLength(span: StyledLine): number {
    if (typeof span === "string") return span.length;
    const segments = span as unknown[];
    if (!Array.isArray(segments)) return 0;
    let len = 0;
    for (const seg of segments) {
      if (typeof seg === "string") len += seg.length;
      else if (seg && typeof seg === "object" && "text" in seg)
        len += (seg as { text: string }).text.length;
    }
    return len;
  }

  /** Find the URL or file-path target at screen (x, y), if any. */
  private _linkTargetAt(
    x: number,
    y: number,
  ): {
    itemIdx: number;
    type: "link" | "file";
    text: string;
    index: number;
  } | null {
    const feedLineIdx = this._feedLineAtScreen(y);
    if (feedLineIdx < 0) return null;
    const text = this._extractFeedLineText(feedLineIdx);
    if (!text) return null;
    URL_REGEX.lastIndex = 0;
    FILE_PATH_REGEX.lastIndex = 0;
    const urls = [...text.matchAll(URL_REGEX)];
    const paths = [...text.matchAll(FILE_PATH_REGEX)];
    if (urls.length === 0 && paths.length === 0) return null;
    const allTargets = [
      ...urls.map((m) => ({
        index: m.index!,
        text: m[0],
        type: "link" as const,
      })),
      ...paths.map((m) => ({
        index: m.index!,
        text: m[0],
        type: "file" as const,
      })),
    ];
    const fb = this._feed.bounds;
    const row = this._feed.rowAtScreen(y);
    const col = x - (fb?.x ?? 0);
    const charOffset = row * this._feed.contentWidth + col;
    const hit = allTargets.find(
      (t) => charOffset >= t.index && charOffset < t.index + t.text.length,
    );
    if (!hit) return null;
    return {
      itemIdx: feedLineIdx,
      type: hit.type,
      text: hit.text,
      index: hit.index,
    };
  }

  /** Return a copy of content.lines with underline applied to chars [start, start+length). */
  private _applyUnderlineOverlay(
    lines: StyledLine[],
    startOffset: number,
    length: number,
  ): StyledLine[] {
    const endOffset = startOffset + length;
    const result: StyledLine[] = [];
    let cursor = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineText =
        typeof line === "string"
          ? line
          : (line as StyledSpan).map((s) => s.text).join("");
      const lineLen = lineText.length;
      const lineStart = cursor;
      const lineEnd = cursor + lineLen;
      const intersects =
        startOffset < lineEnd && endOffset > lineStart && lineLen > 0;
      if (!intersects) {
        result.push(line);
      } else {
        const segs: StyledSegment[] =
          typeof line === "string"
            ? [{ text: line, style: {} }]
            : [...(line as StyledSpan)];
        const newSegs: StyledSegment[] = [];
        let segCursor = lineStart;
        for (const seg of segs) {
          const segStart = segCursor;
          const segEnd = segCursor + seg.text.length;
          if (segEnd <= startOffset || segStart >= endOffset) {
            newSegs.push(seg);
          } else {
            if (segStart < startOffset) {
              newSegs.push({
                text: seg.text.slice(0, startOffset - segStart),
                style: seg.style,
              });
            }
            const insideStart = Math.max(segStart, startOffset) - segStart;
            const insideEnd = Math.min(segEnd, endOffset) - segStart;
            newSegs.push({
              text: seg.text.slice(insideStart, insideEnd),
              style: { ...seg.style, underline: true },
            });
            if (segEnd > endOffset) {
              newSegs.push({
                text: seg.text.slice(endOffset - segStart),
                style: seg.style,
              });
            }
          }
          segCursor = segEnd;
        }
        result.push(newSegs as unknown as StyledSpan);
      }
      cursor = lineEnd + 1; // +1 accounts for the "\n" joiner
    }
    return result;
  }

  /** Restore the link-hover item's original content.lines, if any. */
  private _clearLinkHover(): boolean {
    if (this._hoveredLinkItemId && this._hoveredLinkOriginalLines) {
      const prev = this._store.get(this._hoveredLinkItemId);
      if (prev) {
        prev.content.lines = this._hoveredLinkOriginalLines;
        this._feed.invalidateItem(prev.id);
      }
    }
    const had = this._hoveredLinkItemId !== null;
    this._hoveredLinkItemId = null;
    this._hoveredLinkIndex = null;
    this._hoveredLinkOriginalLines = null;
    return had;
  }

  // ── Layout ─────────────────────────────────────────────────────

  override measure(constraint: Constraint): Size {
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
    this._ctx = ctx;
    const b = this.bounds;
    if (!b || b.width < 1 || b.height < 3) return;

    const W = b.width;
    const H = b.height;

    // Build VirtualList items: banner + separator + feed items
    this._buildVirtualListItems();

    // ── Measure fixed-height sections ────────────────────────

    // Progress text height (always 1 row when visible)
    let progressH = 0;
    if (this._progressText.visible && this._progressText.lines.length > 0) {
      progressH = 1;
    }

    // Bottom separator: 1 row
    const botSepH = 1;

    // When an input override is active, it replaces input + inputSep + footer
    if (this._inputOverride) {
      // Measure the override widget
      const overrideSize = this._inputOverride.measure({
        minWidth: 0,
        maxWidth: W,
        minHeight: 0,
        maxHeight: Math.max(1, Math.floor(H / 2)), // up to half the screen
      });
      const overrideH = overrideSize.height;

      // Docked bar height
      let dockedH = 0;
      if (this._dockedBar?.visible) {
        const ds = this._dockedBar.measure({
          minWidth: 0,
          maxWidth: W,
          minHeight: 0,
          maxHeight: 3,
        });
        dockedH = ds.height;
      }

      // Banner height (fixed above docked bar when bar is present)
      let bannerFixedH = 0;
      if (this._dockedBar?.visible && this._banner.visible) {
        const bannerSize = this._banner.measure({
          minWidth: 0,
          maxWidth: W,
          minHeight: 0,
          maxHeight: Math.max(1, Math.floor(H / 3)),
        });
        bannerFixedH = bannerSize.height;
      }

      const chromeH = botSepH + progressH + overrideH + dockedH + bannerFixedH;
      const feedH = Math.max(0, H - chromeH);

      let y = b.y;

      // 0a. Banner (fixed above docked bar when bar is present)
      if (bannerFixedH > 0) {
        this._banner.arrange({ x: b.x, y, width: W, height: bannerFixedH });
        this._banner.render(ctx);
        y += bannerFixedH;
      }

      // 0b. Docked bar
      if (dockedH > 0 && this._dockedBar) {
        this._dockedBar.arrange({ x: b.x, y, width: W, height: dockedH });
        this._dockedBar.render(ctx);
        y += dockedH;
      }

      // 1. Feed area — delegate to VirtualList
      if (feedH > 0) {
        this._feed.arrange({ x: b.x, y, width: W, height: feedH });
        this._feed.render(ctx);
        y += feedH;
      }

      // 2. Progress text
      if (progressH > 0) {
        this._progressText.measure({
          minWidth: 0,
          maxWidth: W,
          minHeight: 0,
          maxHeight: 1,
        });
        this._progressText.arrange({
          x: b.x,
          y,
          width: W,
          height: progressH,
        });
        this._progressText.render(ctx);
        y += progressH;
      }

      // 3. Bottom separator
      this._bottomSeparator.arrange({ x: b.x, y, width: W, height: 1 });
      this._bottomSeparator.render(ctx);
      y += 1;

      // 4. Override widget (replaces input + inputSep + footer)
      this._inputOverride.arrange({
        x: b.x,
        y,
        width: W,
        height: overrideH,
      });
      this._inputOverride.render(ctx);
      return;
    }

    // ── Normal input mode ────────────────────────────────────

    // Input: measure to get wrapped height (up to maxInputH rows)
    const inputSize = this._input.measure({
      minWidth: 0,
      maxWidth: W,
      minHeight: 0,
      maxHeight: this._maxInputH,
    });
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

    // Docked bar height (0 if hidden or absent)
    let dockedH = 0;
    if (this._dockedBar?.visible) {
      const dockedSize = this._dockedBar.measure({
        minWidth: 0,
        maxWidth: W,
        minHeight: 0,
        maxHeight: 3,
      });
      dockedH = dockedSize.height;
    }

    // Banner height (fixed above docked bar when bar is present)
    let bannerFixedH = 0;
    if (this._dockedBar?.visible && this._banner.visible) {
      const bannerSize = this._banner.measure({
        minWidth: 0,
        maxWidth: W,
        minHeight: 0,
        maxHeight: Math.max(1, Math.floor(H / 3)),
      });
      bannerFixedH = bannerSize.height;
    }

    // Feed gets remaining space (banner + separator scroll within it when no docked bar)
    const fixedH = chromeH + dropdownExtraH + dockedH + bannerFixedH;
    const feedH = Math.max(0, H - fixedH);

    // ── Arrange and render each section ──────────────────────

    let y = b.y;

    // 0a. Banner (fixed above docked bar when bar is present)
    if (bannerFixedH > 0) {
      this._banner.arrange({ x: b.x, y, width: W, height: bannerFixedH });
      this._banner.render(ctx);
      y += bannerFixedH;
    }

    // 0b. Docked bar (pinned below banner, above the scrollable feed)
    if (dockedH > 0 && this._dockedBar) {
      this._dockedBar.arrange({ x: b.x, y, width: W, height: dockedH });
      this._dockedBar.render(ctx);
      y += dockedH;
    }

    // 1. Feed area — delegate to VirtualList
    if (feedH > 0) {
      this._feed.arrange({ x: b.x, y, width: W, height: feedH });
      this._feed.render(ctx);
      y += feedH;
    }

    // 2. Progress text (above separator, fixed — not part of scrollable feed)
    if (progressH > 0) {
      this._progressText.measure({
        minWidth: 0,
        maxWidth: W,
        minHeight: 0,
        maxHeight: 1,
      });
      this._progressText.arrange({ x: b.x, y, width: W, height: progressH });
      this._progressText.render(ctx);
      y += progressH;
    }

    // 3. Bottom separator
    this._bottomSeparator.arrange({ x: b.x, y, width: W, height: 1 });
    this._bottomSeparator.render(ctx);
    y += 1;

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
      // Left footer
      this._footer.measure({
        minWidth: 0,
        maxWidth: W,
        minHeight: 0,
        maxHeight: 1,
      });
      this._footer.arrange({ x: b.x, y, width: W, height: footerH });
      this._footer.render(ctx);

      // Right footer (right-aligned on the same row)
      const rightSize = this._footerRight.measure({
        minWidth: 0,
        maxWidth: W,
        minHeight: 0,
        maxHeight: 1,
      });
      if (rightSize.width > 0) {
        const rightX = b.x + W - rightSize.width;
        this._footerRight.arrange({
          x: rightX,
          y,
          width: rightSize.width,
          height: footerH,
        });
        this._footerRight.render(ctx);
      }
    }
  }

  /** Build the VirtualList items array from banner + separator + feed store items. */
  private _buildVirtualListItems(): void {
    const items: VirtualListItem[] = [];
    // When a docked bar is present, the banner is rendered as a fixed element
    // above the bar (not in the scrollable feed). Otherwise include it in the feed.
    if (this._banner.visible && !this._dockedBar?.visible) {
      // Banner height changes during animation — always re-measure
      this._feed.invalidateItem("__banner__");
      items.push({ id: "__banner__", content: this._banner });
      items.push({ id: "__topsep__", content: this._topSeparator });
    }
    this._feedItemOffset = items.length;
    for (const fi of this._store.items) {
      items.push(fi);
    }
    this._feed.items = items;
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
      const style = isHighlighted
        ? this._dropdownHighlightStyle
        : this._dropdownStyle;

      const prefix = isHighlighted ? "▸ " : "  ";
      const labelPad = item.label.padEnd(16);
      const text = prefix + labelPad + item.description;
      const truncated = text.length > width ? text.slice(0, width) : text;
      ctx.drawText(x, y + i, truncated, style);
    }
  }

  // ── Selection ──────────────────────────────────────────────────

  /** Whether a non-zero text selection is active. */
  private _hasSelection(): boolean {
    return (
      this._selAnchor !== null &&
      this._selEnd !== null &&
      (this._selAnchor.x !== this._selEnd.x ||
        this._selAnchor.y !== this._selEnd.y)
    );
  }

  /** Copy the selected text and clear the selection. */
  private _copySelection(): void {
    const text = this._getSelectedText();
    if (text) {
      this.emit("copy", text);
    }
    this.clearSelection();
  }

  /** Extract the plain text within the current selection from the pixel buffer. */
  private _getSelectedText(): string {
    if (!this._selAnchor || !this._selEnd || !this._ctx) return "";

    let startY = this._selAnchor.y;
    let startX = this._selAnchor.x;
    let endY = this._selEnd.y;
    let endX = this._selEnd.x;

    if (startY > endY || (startY === endY && startX > endX)) {
      [startY, endY] = [endY, startY];
      [startX, endX] = [endX, startX];
    }

    const fb = this._feed.bounds;
    const feedX = fb?.x ?? 0;
    const contentW = this._feed.contentWidth;
    const lines: string[] = [];
    for (let row = startY; row <= endY; row++) {
      const colStart = row === startY ? startX : feedX;
      const colEnd = row === endY ? endX : feedX + contentW - 1;
      let line = "";
      for (let col = colStart; col <= colEnd; col++) {
        const ch = this._ctx.readCharAbsolute(col, row);
        line += ch || " ";
      }
      lines.push(line.trimEnd());
    }

    return lines.join("\n");
  }

  /** Render the selection highlight overlay within the feed area. */
  private _renderSelection(
    ctx: DrawingContext,
    feedX: number,
    feedY: number,
    feedW: number,
    feedH: number,
  ): void {
    if (!this._selAnchor || !this._selEnd) return;

    let startY = this._selAnchor.y;
    let startX = this._selAnchor.x;
    let endY = this._selEnd.y;
    let endX = this._selEnd.x;

    if (startY > endY || (startY === endY && startX > endX)) {
      [startY, endY] = [endY, startY];
      [startX, endX] = [endX, startX];
    }

    // Clamp to feed area
    startY = Math.max(startY, feedY);
    endY = Math.min(endY, feedY + feedH - 1);

    for (let row = startY; row <= endY; row++) {
      const colStart = row === startY ? startX : feedX;
      const colEnd = row === endY ? endX : feedX + feedW - 2;
      for (let col = colStart; col <= colEnd; col++) {
        ctx.highlightCell(col, row, SELECTION_BG);
      }
    }
  }

  /** Clear any active text selection. */
  clearSelection(): void {
    this._selAnchor = null;
    this._selEnd = null;
    this._selecting = false;
    this._stopSelScroll();
    this.invalidate();
  }

  // ── Auto-scroll ────────────────────────────────────────────────

  /** Start interval-based scroll during drag-to-select at feed edges. */
  private _startSelScroll(dir: number): void {
    if (this._selScrollDir === dir && this._selScrollTimer) return;
    this._stopSelScroll();
    this._selScrollDir = dir;
    this._selScrollTimer = setInterval(() => {
      this.scrollFeed(this._selScrollDir * 3);
      // Move selEnd to keep extending the selection while scrolling
      if (this._selEnd) {
        const fb = this._feed.bounds;
        const feedY = fb?.y ?? 0;
        const feedH = fb?.height ?? 0;
        this._selEnd = {
          x: this._selEnd.x,
          y: this._selScrollDir < 0 ? feedY : feedY + feedH - 1,
        };
      }
    }, 80);
  }

  /** Stop auto-scroll timer. */
  private _stopSelScroll(): void {
    if (this._selScrollTimer) {
      clearInterval(this._selScrollTimer);
      this._selScrollTimer = null;
    }
    this._selScrollDir = 0;
  }

  private _autoScrollToBottom(): void {
    this._feed.autoScrollToBottom();
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
