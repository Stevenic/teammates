/**
 * Represents a single cell's character content.
 */

import type { BoxPattern } from "./box-pattern.js";

/** A single terminal cell's character data. */
export interface Symbol {
  /** The character or grapheme cluster to display. */
  readonly text: string;
  /** Display width: 1 for normal chars, 2 for wide (CJK) chars. */
  readonly width: 1 | 2;
  /** Box-drawing pattern bitmask. 0 for normal characters. */
  readonly pattern: BoxPattern;
}

/**
 * Determine the display width of a single character.
 * Returns 2 for wide characters (CJK, fullwidth forms, emoji), 1 otherwise.
 */
export function charWidth(codePoint: number): 1 | 2 {
  // CJK Unified Ideographs
  if (codePoint >= 0x4e00 && codePoint <= 0x9fff) return 2;
  // CJK Unified Ideographs Extension A
  if (codePoint >= 0x3400 && codePoint <= 0x4dbf) return 2;
  // CJK Unified Ideographs Extension B
  if (codePoint >= 0x20000 && codePoint <= 0x2a6df) return 2;
  // CJK Compatibility Ideographs
  if (codePoint >= 0xf900 && codePoint <= 0xfaff) return 2;
  // Fullwidth Forms (excluding halfwidth range)
  if (codePoint >= 0xff01 && codePoint <= 0xff60) return 2;
  // Fullwidth Forms (extra)
  if (codePoint >= 0xffe0 && codePoint <= 0xffe6) return 2;
  // CJK Radicals Supplement
  if (codePoint >= 0x2e80 && codePoint <= 0x2eff) return 2;
  // Kangxi Radicals
  if (codePoint >= 0x2f00 && codePoint <= 0x2fdf) return 2;
  // CJK Symbols and Punctuation
  if (codePoint >= 0x3000 && codePoint <= 0x303f) return 2;
  // Hiragana
  if (codePoint >= 0x3040 && codePoint <= 0x309f) return 2;
  // Katakana
  if (codePoint >= 0x30a0 && codePoint <= 0x30ff) return 2;
  // Bopomofo
  if (codePoint >= 0x3100 && codePoint <= 0x312f) return 2;
  // Hangul Compatibility Jamo
  if (codePoint >= 0x3130 && codePoint <= 0x318f) return 2;
  // Kanbun
  if (codePoint >= 0x3190 && codePoint <= 0x319f) return 2;
  // Bopomofo Extended
  if (codePoint >= 0x31a0 && codePoint <= 0x31bf) return 2;
  // CJK Strokes
  if (codePoint >= 0x31c0 && codePoint <= 0x31ef) return 2;
  // Katakana Phonetic Extensions
  if (codePoint >= 0x31f0 && codePoint <= 0x31ff) return 2;
  // Enclosed CJK Letters and Months
  if (codePoint >= 0x3200 && codePoint <= 0x32ff) return 2;
  // CJK Compatibility
  if (codePoint >= 0x3300 && codePoint <= 0x33ff) return 2;
  // Hangul Syllables
  if (codePoint >= 0xac00 && codePoint <= 0xd7af) return 2;
  // CJK Compatibility Ideographs Supplement
  if (codePoint >= 0x2f800 && codePoint <= 0x2fa1f) return 2;

  // ── Emoji ranges (rendered as width 2 on modern terminals) ─────
  // Hourglass + Watch
  if (codePoint === 0x231a || codePoint === 0x231b) return 2;
  // Player controls (⏩-⏳)
  if (codePoint >= 0x23e9 && codePoint <= 0x23f3) return 2;
  // Media controls (⏸-⏺)
  if (codePoint >= 0x23f8 && codePoint <= 0x23fa) return 2;
  // Play / reverse play buttons
  if (codePoint === 0x25b6 || codePoint === 0x25c0) return 2;
  // Geometric shapes used as emoji (◻◼◽◾)
  if (codePoint >= 0x25fb && codePoint <= 0x25fe) return 2;
  // Miscellaneous Symbols — most have emoji presentation (☀-⛿)
  if (codePoint >= 0x2600 && codePoint <= 0x26ff) return 2;
  // Dingbats with emoji presentation (✂-➿)
  if (codePoint >= 0x2702 && codePoint <= 0x27b0) return 2;
  // Curly loop
  if (codePoint === 0x27bf) return 2;
  // Supplemental arrows used as emoji
  if (codePoint === 0x2934 || codePoint === 0x2935) return 2;
  // Misc symbols used as emoji (⬛⬜⭐⭕)
  if (codePoint >= 0x2b05 && codePoint <= 0x2b07) return 2;
  if (codePoint === 0x2b1b || codePoint === 0x2b1c) return 2;
  if (codePoint === 0x2b50 || codePoint === 0x2b55) return 2;
  // Copyright / Registered / TM (when emoji-styled)
  if (codePoint === 0x00a9 || codePoint === 0x00ae) return 2;
  // Wavy dash, part alternation mark
  if (codePoint === 0x3030 || codePoint === 0x303d) return 2;
  // SMP Emoji: Mahjong through Symbols & Pictographs Extended-A
  // Covers emoticons, transport, flags, supplemental symbols, etc.
  if (codePoint >= 0x1f000 && codePoint <= 0x1faff) return 2;

  return 1;
}

/**
 * Calculate the display width of a string (sum of charWidth per code point).
 * Useful for layout and wrapping where terminal column count matters.
 */
export function stringDisplayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    width += charWidth(char.codePointAt(0)!);
  }
  return width;
}

/**
 * Create a Symbol from a text string.
 * Width is auto-detected from the first code point.
 */
export function sym(text: string, pattern: BoxPattern = 0): Symbol {
  const cp = text.codePointAt(0) ?? 0;
  return {
    text,
    width: pattern !== 0 ? 1 : charWidth(cp),
    pattern,
  };
}

/** An empty symbol (space character). */
export const EMPTY_SYMBOL: Symbol = { text: " ", width: 1, pattern: 0 };
