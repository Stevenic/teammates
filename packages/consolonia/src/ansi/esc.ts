/**
 * ANSI escape sequence constants and builder functions.
 * All functions return raw escape strings — nothing is written to stdout.
 */

import type { TerminalCaps } from "./terminal-env.js";

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
export function fg(r: number, g: number, b: number): string {
  return `${ESC}38;2;${r};${g};${b}m`;
}

/** Set background to an RGB truecolor value. */
export function bg(r: number, g: number, b: number): string {
  return `${ESC}48;2;${r};${g};${b}m`;
}

/** Reset foreground color to default. */
export const fgDefault = `${ESC}39m`;

/** Reset background color to default. */
export const bgDefault = `${ESC}49m`;

// ── Cursor movement ─────────────────────────────────────────────────

/** Move cursor to absolute position (0-based). */
export function moveTo(x: number, y: number): string {
  return `${ESC}${y + 1};${x + 1}H`;
}

/** Move cursor up by n lines. */
export function moveUp(n: number = 1): string {
  return `${ESC}${n}A`;
}

/** Move cursor down by n lines. */
export function moveDown(n: number = 1): string {
  return `${ESC}${n}B`;
}

/** Move cursor right by n columns. */
export function moveRight(n: number = 1): string {
  return `${ESC}${n}C`;
}

/** Move cursor left by n columns. */
export function moveLeft(n: number = 1): string {
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

/**
 * Enable mouse tracking with all supported reporting modes.
 *
 * Modes enabled (in order):
 *   ?1000h — Normal/VT200 click tracking (press + release)
 *   ?1003h — Any-event tracking (all mouse movement)
 *   ?1005h — UTF-8 coordinate encoding (extends X10 beyond col/row 223)
 *   ?1006h — SGR extended coordinates (";"-delimited decimals, M/m terminator)
 *   ?1015h — URXVT extended coordinates (decimal params, no "<" prefix)
 *   ?1016h — SGR-Pixels (same wire format as SGR, pixel coordinates)
 *
 * Terminals pick the highest mode they support. SGR is preferred by most
 * modern terminals; URXVT and UTF-8 provide fallback for older ones.
 */
export const mouseTrackingOn = `${ESC}?1000h${ESC}?1003h${ESC}?1005h${ESC}?1006h${ESC}?1015h${ESC}?1016h`;

/**
 * Disable all mouse tracking modes (reverse order of enable).
 */
export const mouseTrackingOff = `${ESC}?1016l${ESC}?1015l${ESC}?1006l${ESC}?1005l${ESC}?1003l${ESC}?1000l`;

// ── Window ──────────────────────────────────────────────────────────

/** Set the terminal window title. */
export function setTitle(title: string): string {
  return `${OSC}0;${title}\x07`;
}

// ── Environment-aware init/restore ─────────────────────────────────

/**
 * Mouse tracking sequence tailored to detected capabilities.
 *
 * When the terminal supports SGR, request all six modes so the terminal
 * picks the highest one it handles. When SGR is not available (e.g. GNU
 * screen), fall back to normal + any-event tracking only — UTF-8 and
 * URXVT modes could confuse terminals that don't understand them.
 */
export function mouseOn(caps: TerminalCaps): string {
  if (!caps.mouse) return "";
  if (caps.sgrMouse) return mouseTrackingOn;
  // Minimal: normal click + any-event only
  return `${ESC}?1000h${ESC}?1003h`;
}

/** Matching disable sequence for mouseOn(). */
export function mouseOff(caps: TerminalCaps): string {
  if (!caps.mouse) return "";
  if (caps.sgrMouse) return mouseTrackingOff;
  return `${ESC}?1003l${ESC}?1000l`;
}

/**
 * Build the full terminal preparation sequence for the given environment.
 *
 * @param caps  - Detected terminal capabilities
 * @param opts  - Which optional features the app requested
 */
export function initSequence(
  caps: TerminalCaps,
  opts: { alternateScreen: boolean; mouse: boolean },
): string {
  if (!caps.isTTY) return "";

  let seq = "";
  if (opts.alternateScreen && caps.alternateScreen) {
    seq += alternateScreenOn;
  }
  seq += hideCursor;
  if (caps.bracketedPaste) {
    seq += bracketedPasteOn;
  }
  if (opts.mouse) {
    seq += mouseOn(caps);
  }
  seq += clearScreen;
  return seq;
}

/**
 * Build the full terminal restore sequence (mirror of initSequence).
 */
export function restoreSequence(
  caps: TerminalCaps,
  opts: { alternateScreen: boolean; mouse: boolean },
): string {
  if (!caps.isTTY) return "";

  let seq = reset;
  if (opts.mouse) {
    seq += mouseOff(caps);
  }
  if (caps.bracketedPaste) {
    seq += bracketedPasteOff;
  }
  seq += showCursor;
  if (opts.alternateScreen && caps.alternateScreen) {
    seq += alternateScreenOff;
  }
  return seq;
}
