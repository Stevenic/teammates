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
import { type StyledLine } from "./styled-text.js";
import { TextInput, type InputColorizer } from "./text-input.js";
import type { StyledSpan } from "../styled.js";
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
export declare class ChatView extends Control {
    private _banner;
    private _topSeparator;
    private _feedLines;
    private _bottomSeparator;
    private _progressText;
    private _input;
    private _inputSeparator;
    private _footer;
    private _dropdownItems;
    private _dropdownIndex;
    private _feedStyle;
    private _progressStyle;
    private _separatorStyle;
    private _separatorChar;
    private _dropdownHighlightStyle;
    private _dropdownStyle;
    private _dropdownLabelStyle;
    private _footerStyle;
    private _maxInputH;
    private _feedScrollOffset;
    private _lastWidth;
    private _lastHeight;
    /** Cached from last render for hit-testing. */
    private _scrollbarX;
    private _feedY;
    private _feedH;
    private _thumbPos;
    private _thumbSize;
    private _totalContentH;
    private _maxScroll;
    private _scrollbarVisible;
    /** True while the user is dragging the scrollbar thumb. */
    private _dragging;
    /** The Y offset within the thumb where the drag started. */
    private _dragOffsetY;
    constructor(options?: ChatViewOptions);
    /** Get the banner text (only works when using the built-in Text banner). */
    get banner(): string;
    /** Set the banner text (only works when using the built-in Text banner). */
    set banner(text: string);
    /** Get the banner style (only works when using the built-in Text banner). */
    get bannerStyle(): TextStyle;
    /** Set the banner style (only works when using the built-in Text banner). */
    set bannerStyle(style: TextStyle);
    /** Replace the banner with a custom widget. */
    set bannerWidget(widget: Control);
    /** Get the current banner widget. */
    get bannerWidget(): Control;
    /** Set footer content (plain string or StyledSpan for mixed colors). */
    setFooter(content: StyledLine): void;
    /** Append a line of plain text to the feed. Auto-scrolls to bottom. */
    appendToFeed(text: string, style?: TextStyle): void;
    /** Append a styled line (StyledSpan) to the feed. */
    appendStyledToFeed(styledLine: StyledSpan): void;
    /** Append multiple plain lines to the feed. */
    appendLines(lines: string[], style?: TextStyle): void;
    /** Clear everything between the banner and the input box. */
    clear(): void;
    /** Total number of feed lines. */
    get feedLineCount(): number;
    /** Scroll the feed to the bottom. */
    scrollToBottom(): void;
    /** Scroll the feed by a delta (positive = down, negative = up). */
    scrollFeed(delta: number): void;
    /** Get current input value. */
    get inputValue(): string;
    /** Set the input value and move cursor to end. */
    set inputValue(text: string);
    /** Get the underlying TextInput for advanced use. */
    get input(): TextInput;
    /** Get input history. */
    get history(): string[];
    /** Set the input prompt text. */
    set prompt(text: string);
    get prompt(): string;
    /** Show a progress/status message just above the input box. */
    setProgress(text: string | null): void;
    /** Show dropdown items below the input box. */
    showDropdown(items: DropdownItem[]): void;
    /** Hide the dropdown. */
    hideDropdown(): void;
    /** Move dropdown selection down. */
    dropdownDown(): boolean;
    /** Move dropdown selection up. */
    dropdownUp(): boolean;
    /** Accept the currently highlighted dropdown item. Returns it, or null. */
    acceptDropdownItem(): DropdownItem | null;
    /** Get current dropdown items. */
    get dropdownItems(): DropdownItem[];
    /** Get current dropdown selection index. */
    get dropdownIndex(): number;
    handleInput(event: InputEvent): boolean;
    measure(constraint: Constraint): Size;
    arrange(rect: Rect): void;
    render(ctx: DrawingContext): void;
    private _renderFeed;
    private _renderDropdown;
    private _autoScrollToBottom;
}
