/**
 * Buffered ANSI output writer.
 * Inspired by Consolonia's AnsiConsoleOutput.cs — tracks terminal state
 * to emit minimal escape sequences when writing pixels.
 */
import type { Writable } from "node:stream";
import type { Color } from "../pixel/color.js";
import type { Pixel } from "../pixel/pixel.js";
/**
 * Buffered ANSI writer that accumulates escape sequences in a string buffer
 * and flushes them in a single write to the underlying stream.
 */
export declare class AnsiOutput {
    private readonly stream;
    private buf;
    private lastX;
    private lastY;
    private lastFgColor;
    private lastBgColor;
    private lastBold;
    private lastItalic;
    private lastUnderline;
    private lastStrikethrough;
    constructor(stream?: Writable);
    /** Append raw text to the internal buffer. */
    private write;
    /** Move cursor to (x, y) if not already there. */
    setCursor(x: number, y: number): void;
    /** Emit hide-cursor sequence. */
    hideCursor(): void;
    /** Emit show-cursor sequence. */
    showCursor(): void;
    /**
     * Write a single pixel at (x, y).
     * Cursor is moved only if necessary. Colors and styles are set only when
     * they differ from the previously written state.
     */
    writePixel(x: number, y: number, pixel: Pixel): void;
    /**
     * Write a string starting at (x, y) with optional style overrides.
     * Convenience wrapper that writes character-by-character is wasteful,
     * so instead we set styles once and write the full text.
     */
    writeText(x: number, y: number, text: string, style?: {
        fgColor?: Color;
        bgColor?: Color;
        bold?: boolean;
        italic?: boolean;
        underline?: boolean;
        strikethrough?: boolean;
    }): void;
    /** Write the accumulated buffer to the output stream and clear it. */
    flush(): void;
    /**
     * Prepare the terminal for full-screen TUI rendering:
     * alternate screen, hide cursor, bracketed paste, mouse tracking.
     */
    prepareTerminal(): void;
    /**
     * Restore the terminal to its normal state:
     * disable mouse, disable bracketed paste, show cursor, leave alternate screen.
     */
    restoreTerminal(): void;
    /** Reset all tracked state so the next write re-emits everything. */
    private resetState;
}
