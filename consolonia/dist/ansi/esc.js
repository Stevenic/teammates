/**
 * ANSI escape sequence constants and builder functions.
 * All functions return raw escape strings — nothing is written to stdout.
 */
const ESC = "\x1b[";
const OSC = "\x1b]";
// ── Text style ──────────────────────────────────────────────────────
export const reset = `${ESC}0m`;
export const bold = `${ESC}1m`;
export const dim = `${ESC}2m`;
export const italic = `${ESC}3m`;
export const underline = `${ESC}4m`;
export const strikethrough = `${ESC}9m`;
export const boldOff = `${ESC}22m`;
export const dimOff = `${ESC}22m`;
export const italicOff = `${ESC}23m`;
export const underlineOff = `${ESC}24m`;
export const strikethroughOff = `${ESC}29m`;
// ── RGB truecolor ───────────────────────────────────────────────────
/** Set foreground to an RGB truecolor value. */
export function fg(r, g, b) {
    return `${ESC}38;2;${r};${g};${b}m`;
}
/** Set background to an RGB truecolor value. */
export function bg(r, g, b) {
    return `${ESC}48;2;${r};${g};${b}m`;
}
/** Reset foreground color to default. */
export const fgDefault = `${ESC}39m`;
/** Reset background color to default. */
export const bgDefault = `${ESC}49m`;
// ── Cursor movement ─────────────────────────────────────────────────
/** Move cursor to absolute position (0-based). */
export function moveTo(x, y) {
    return `${ESC}${y + 1};${x + 1}H`;
}
/** Move cursor up by n lines. */
export function moveUp(n = 1) {
    return `${ESC}${n}A`;
}
/** Move cursor down by n lines. */
export function moveDown(n = 1) {
    return `${ESC}${n}B`;
}
/** Move cursor right by n columns. */
export function moveRight(n = 1) {
    return `${ESC}${n}C`;
}
/** Move cursor left by n columns. */
export function moveLeft(n = 1) {
    return `${ESC}${n}D`;
}
/** Save cursor position. */
export const saveCursor = `${ESC}s`;
/** Restore cursor position. */
export const restoreCursor = `${ESC}u`;
/** Hide the cursor. */
export const hideCursor = `${ESC}?25l`;
/** Show the cursor. */
export const showCursor = `${ESC}?25h`;
// ── Screen ──────────────────────────────────────────────────────────
/** Switch to the alternate screen buffer. */
export const alternateScreenOn = `${ESC}?1049h`;
/** Switch back from the alternate screen buffer. */
export const alternateScreenOff = `${ESC}?1049l`;
/** Clear the entire screen. */
export const clearScreen = `${ESC}2J`;
/** Erase from cursor to end of display. */
export const eraseDown = `${ESC}0J`;
/** Erase the entire current line. */
export const eraseLine = `${ESC}2K`;
// ── Input modes ─────────────────────────────────────────────────────
/** Enable bracketed paste mode. */
export const bracketedPasteOn = `${ESC}?2004h`;
/** Disable bracketed paste mode. */
export const bracketedPasteOff = `${ESC}?2004l`;
/** Enable SGR mouse tracking (button-event tracking + SGR extended coordinates). */
export const mouseTrackingOn = `${ESC}?1002h${ESC}?1006h`;
/** Disable SGR mouse tracking. */
export const mouseTrackingOff = `${ESC}?1006l${ESC}?1002l`;
// ── Window ──────────────────────────────────────────────────────────
/** Set the terminal window title. */
export function setTitle(title) {
    return `${OSC}0;${title}\x07`;
}
