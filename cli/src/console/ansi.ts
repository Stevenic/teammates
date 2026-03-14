/**
 * ANSI escape code helpers — portable across Windows and macOS terminals.
 */

/** Move cursor up N lines. */
export const cursorUp = (n = 1): string => `\x1b[${n}A`;

/** Move cursor down N lines. */
export const cursorDown = (n = 1): string => `\x1b[${n}B`;

/** Move cursor to absolute column (1-based). */
export const cursorToCol = (col: number): string => `\x1b[${col}G`;

/** Erase the entire current line. */
export const eraseLine = "\x1b[2K";

/** Erase from cursor to end of line. */
export const eraseToEnd = "\x1b[0K";

/** Erase from cursor to end of display. */
export const eraseDown = "\x1b[0J";

/** Erase the entire display. */
export const eraseScreen = "\x1b[2J";

/** Move cursor to home (0,0). */
export const cursorHome = "\x1b[H";

/** Carriage return. */
export const cr = "\r";

/** Strip ANSI escape codes from a string. */
export function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Get the visible (non-ANSI) length of a string. */
export function visibleLength(str: string): number {
  return stripAnsi(str).length;
}

/** Truncate a string with ANSI codes to `max` visible characters. */
export function truncateAnsi(str: string, max: number): string {
  let visible = 0;
  let i = 0;
  while (i < str.length && visible < max) {
    if (str[i] === "\x1b") {
      const end = str.indexOf("m", i);
      if (end !== -1) { i = end + 1; continue; }
    }
    visible++;
    i++;
  }
  return str.slice(0, i);
}
