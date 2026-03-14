/**
 * ANSI helpers — re-exports from consolonia plus CLI-specific extras.
 */

import { esc, stripAnsi, visibleLength, truncateAnsi } from "@teammates/consolonia";

// ── Re-exports from consolonia ──────────────────────────────────

export { stripAnsi, visibleLength, truncateAnsi };

export const cursorUp = (n = 1): string => esc.moveUp(n);
export const cursorDown = (n = 1): string => esc.moveDown(n);
export const eraseLine = esc.eraseLine;
export const eraseDown = esc.eraseDown;
export const eraseScreen = esc.clearScreen;

// ── CLI-specific (not in consolonia) ────────────────────────────

/** Move cursor to absolute column (1-based). */
export const cursorToCol = (col: number): string => `\x1b[${col}G`;

/** Erase from cursor to end of line. */
export const eraseToEnd = "\x1b[0K";

/** Move cursor to home (0,0). */
export const cursorHome = "\x1b[H";

/** Carriage return. */
export const cr = "\r";
