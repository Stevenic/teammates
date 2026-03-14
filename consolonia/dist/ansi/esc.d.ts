/**
 * ANSI escape sequence constants and builder functions.
 * All functions return raw escape strings — nothing is written to stdout.
 */
export declare const reset = "\u001B[0m";
export declare const bold = "\u001B[1m";
export declare const dim = "\u001B[2m";
export declare const italic = "\u001B[3m";
export declare const underline = "\u001B[4m";
export declare const strikethrough = "\u001B[9m";
export declare const boldOff = "\u001B[22m";
export declare const dimOff = "\u001B[22m";
export declare const italicOff = "\u001B[23m";
export declare const underlineOff = "\u001B[24m";
export declare const strikethroughOff = "\u001B[29m";
/** Set foreground to an RGB truecolor value. */
export declare function fg(r: number, g: number, b: number): string;
/** Set background to an RGB truecolor value. */
export declare function bg(r: number, g: number, b: number): string;
/** Reset foreground color to default. */
export declare const fgDefault = "\u001B[39m";
/** Reset background color to default. */
export declare const bgDefault = "\u001B[49m";
/** Move cursor to absolute position (0-based). */
export declare function moveTo(x: number, y: number): string;
/** Move cursor up by n lines. */
export declare function moveUp(n?: number): string;
/** Move cursor down by n lines. */
export declare function moveDown(n?: number): string;
/** Move cursor right by n columns. */
export declare function moveRight(n?: number): string;
/** Move cursor left by n columns. */
export declare function moveLeft(n?: number): string;
/** Save cursor position. */
export declare const saveCursor = "\u001B[s";
/** Restore cursor position. */
export declare const restoreCursor = "\u001B[u";
/** Hide the cursor. */
export declare const hideCursor = "\u001B[?25l";
/** Show the cursor. */
export declare const showCursor = "\u001B[?25h";
/** Switch to the alternate screen buffer. */
export declare const alternateScreenOn = "\u001B[?1049h";
/** Switch back from the alternate screen buffer. */
export declare const alternateScreenOff = "\u001B[?1049l";
/** Clear the entire screen. */
export declare const clearScreen = "\u001B[2J";
/** Erase from cursor to end of display. */
export declare const eraseDown = "\u001B[0J";
/** Erase the entire current line. */
export declare const eraseLine = "\u001B[2K";
/** Enable bracketed paste mode. */
export declare const bracketedPasteOn = "\u001B[?2004h";
/** Disable bracketed paste mode. */
export declare const bracketedPasteOff = "\u001B[?2004l";
/** Enable SGR mouse tracking (button-event tracking + SGR extended coordinates). */
export declare const mouseTrackingOn = "\u001B[?1002h\u001B[?1006h";
/** Disable SGR mouse tracking. */
export declare const mouseTrackingOff = "\u001B[?1006l\u001B[?1002l";
/** Set the terminal window title. */
export declare function setTitle(title: string): string;
