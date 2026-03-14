/**
 * Single-line text input widget — the primary replacement for readline.
 *
 * Handles cursor movement, text editing, history navigation, word-jump,
 * clipboard paste, and visual scrolling when the value exceeds the
 * visible width.
 */
import { Control } from "../layout/control.js";
import type { Size, Constraint } from "../layout/types.js";
import type { DrawingContext, TextStyle } from "../drawing/context.js";
import type { InputEvent } from "../input/events.js";
/** Returns the style to use at each character position in the input value. */
export type InputColorizer = (value: string) => (TextStyle | null)[];
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
}
export declare class TextInput extends Control {
    private _value;
    private _cursor;
    private _prompt;
    private _placeholder;
    private _placeholderStyle;
    private _style;
    private _cursorStyle;
    private _promptStyle;
    private _colorize;
    /** Command history entries (most recent last). */
    private _history;
    /** Current position in history (-1 = not browsing, 0 = oldest). */
    private _historyIndex;
    /** Saved input when user starts browsing history. */
    private _savedInput;
    /** Horizontal scroll offset (first visible column in value). */
    private _scrollOffset;
    constructor(options?: TextInputOptions);
    get value(): string;
    set value(v: string);
    get cursor(): number;
    set cursor(pos: number);
    get prompt(): string;
    set prompt(v: string);
    get placeholder(): string;
    set placeholder(v: string);
    get style(): TextStyle;
    set style(v: TextStyle);
    get cursorStyle(): TextStyle;
    set cursorStyle(v: TextStyle);
    get promptStyle(): TextStyle;
    set promptStyle(v: TextStyle);
    get placeholderStyle(): TextStyle;
    set placeholderStyle(v: TextStyle);
    get history(): string[];
    /** Clear the input value and reset cursor. */
    clear(): void;
    /** Set the value and move cursor to the end. */
    setValue(text: string): void;
    /** Insert text at the current cursor position. */
    insert(text: string): void;
    handleInput(event: InputEvent): boolean;
    private _handlePaste;
    private _handleKey;
    /**
     * Find the position of the start of the word to the left of `pos`.
     * Skips any whitespace first, then skips non-whitespace.
     */
    private _wordBoundaryLeft;
    /**
     * Find the position of the end of the word to the right of `pos`.
     * Skips any non-whitespace first, then skips whitespace.
     */
    private _wordBoundaryRight;
    /**
     * Build wrapped lines from the current value.
     * Row 0 starts after the prompt (firstRowW chars wide).
     * Subsequent rows use the full width.
     * Breaks prefer spaces (word wrap) but will hard-break if a word
     * is longer than the row width.
     */
    private _wrapLines;
    /**
     * Find which wrapped line and column the cursor is on.
     * Returns { row, col } in wrapped coordinates.
     */
    private _cursorToRowCol;
    /** Get the character offset where a given wrapped line starts. */
    private _lineOffset;
    /** Vertical scroll offset (first visible row). */
    private _vScrollOffset;
    /** Cached layout widths from last measure/render. */
    private _lastTotalWidth;
    private _lastFirstRowW;
    measure(constraint: Constraint): Size;
    render(ctx: DrawingContext): void;
    /**
     * Draw the cursor character with inverted foreground/background
     * colours (swap fg and bg from the text style).
     */
    private _drawCursor;
}
