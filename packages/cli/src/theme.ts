/**
 * Theme — centralized color palette for the teammates CLI.
 *
 * All semantic colors used throughout the UI are defined here.
 * The default palette is derived from the base accent #3A96DD.
 *
 * To change the look of the entire CLI, modify the values in
 * DEFAULT_THEME below. Run `/theme` inside a session to preview
 * all variables with live examples.
 */

import { type Color, color } from "@teammates/consolonia";

// ── Theme interface ──────────────────────────────────────────────

export interface Theme {
  // ── Brand / accent ───────────────────────────────────────────
  /** Primary accent — used for the logo, commands, teammate names. */
  accent: Color;
  /** Brighter accent — used for highlights, selected items. */
  accentBright: Color;
  /** Dimmed accent — used for borders, subtle accents. */
  accentDim: Color;

  // ── Semantic foreground ──────────────────────────────────────
  /** Primary text — most readable foreground. */
  text: Color;
  /** Secondary / muted text — descriptions, metadata. */
  textMuted: Color;
  /** Dimmed text — separators, subtle UI chrome. */
  textDim: Color;

  // ── Status ───────────────────────────────────────────────────
  /** Success — checkmarks, "installed", completed tasks. */
  success: Color;
  /** Warning — pending items, caution indicators. */
  warning: Color;
  /** Error — failures, error messages. */
  error: Color;
  /** Info — progress messages, working state. */
  info: Color;

  // ── Interactive ──────────────────────────────────────────────
  /** Prompt symbol color. */
  prompt: Color;
  /** User input text. */
  input: Color;
  /** Cursor foreground. */
  cursorFg: Color;
  /** Cursor background. */
  cursorBg: Color;
  /** Separator lines between sections. */
  separator: Color;
  /** Progress/status messages. */
  progress: Color;
  /** Dropdown: normal items. */
  dropdown: Color;
  /** Dropdown: highlighted/selected item. */
  dropdownHighlight: Color;
}

// ── Default theme (based on #3A96DD) ─────────────────────────────

export const DEFAULT_THEME: Theme = {
  // Brand / accent — derived from #3A96DD
  accent: color(58, 150, 221), // #3A96DD — the base blue
  accentBright: color(85, 187, 255), // #55BBFF — lighter for highlights
  accentDim: color(40, 100, 150), // #286496 — muted for borders

  // Foreground
  text: color(230, 230, 230), // #E6E6E6 — near-white primary text
  textMuted: color(150, 150, 150), // #969696 — gray for descriptions
  textDim: color(100, 100, 100), // #646464 — dim for separators

  // Status
  success: color(80, 200, 120), // #50C878 — green
  warning: color(230, 180, 50), // #E6B432 — amber
  error: color(230, 70, 70), // #E64646 — red
  info: color(58, 150, 221), // #3A96DD — same as accent

  // Interactive
  prompt: color(150, 150, 150), // #969696 — gray prompt
  input: color(230, 230, 230), // #E6E6E6 — near-white
  cursorFg: color(0, 0, 0), // #000000 — black on light cursor
  cursorBg: color(230, 230, 230), // #E6E6E6 — light block cursor
  separator: color(100, 100, 100), // #646464 — dim rule lines
  progress: color(58, 150, 221), // #3A96DD — blue italic
  dropdown: color(58, 150, 221), // #3A96DD — accent for items
  dropdownHighlight: color(85, 187, 255), // #55BBFF — bright for selected
};

// ── Active theme (mutable singleton) ─────────────────────────────

let _active: Theme = { ...DEFAULT_THEME };

/** Get the current active theme. */
export function theme(): Theme {
  return _active;
}

/** Replace the active theme. */
export function setTheme(t: Theme): void {
  _active = { ...t };
}

// ── Helpers ──────────────────────────────────────────────────────

/** Format a Color as a hex string for display. */
export function colorToHex(c: Color): string {
  const r = c.r.toString(16).padStart(2, "0");
  const g = c.g.toString(16).padStart(2, "0");
  const b = c.b.toString(16).padStart(2, "0");
  return `#${r}${g}${b}`.toUpperCase();
}
