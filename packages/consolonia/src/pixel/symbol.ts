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
 * Check if a code point is zero-width (invisible) and should be skipped
 * during rendering. These characters have no visual representation and
 * occupy zero terminal columns. If drawn as individual cells, terminals
 * typically show them as "missing glyph" boxes.
 */
export function isZeroWidth(codePoint: number): boolean {
  // Soft hyphen
  if (codePoint === 0x00ad) return true;
  // Combining diacritical marks (U+0300–U+036F)
  if (codePoint >= 0x0300 && codePoint <= 0x036f) return true;
  // Zero-width space, non-joiner, joiner
  if (codePoint >= 0x200b && codePoint <= 0x200d) return true;
  // Left-to-right / right-to-left marks
  if (codePoint >= 0x200e && codePoint <= 0x200f) return true;
  // LRE, RLE, PDF, LRO, RLO
  if (codePoint >= 0x202a && codePoint <= 0x202e) return true;
  // Word joiner
  if (codePoint === 0x2060) return true;
  // LRI, RLI, FSI, PDI
  if (codePoint >= 0x2066 && codePoint <= 0x2069) return true;
  // Combining grapheme joiner
  if (codePoint === 0x034f) return true;
  // Variation selectors (VS1-VS16)
  if (codePoint >= 0xfe00 && codePoint <= 0xfe0f) return true;
  // BOM / zero-width no-break space
  if (codePoint === 0xfeff) return true;
  // Variation selectors supplement (VS17-VS256)
  if (codePoint >= 0xe0100 && codePoint <= 0xe01ef) return true;
  // Tags block (used in flag sequences)
  if (codePoint >= 0xe0001 && codePoint <= 0xe007f) return true;
  return false;
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

  // ── Emoji with Emoji_Presentation=Yes (rendered as 2 cells by default) ──
  // Only characters that terminals render as wide WITHOUT a variation selector.

  // ── Text-presentation characters that Windows Terminal renders as wide ──
  // These have Emoji_Presentation=No in Unicode but modern terminals (Windows
  // Terminal, VS Code integrated terminal) render them as double-width emoji.
  if (codePoint === 0x2139) return 2; // ℹ Information Source
  if (codePoint === 0x2605 || codePoint === 0x2606) return 2; // ★☆ Stars
  if (codePoint === 0x2660) return 2; // ♠ Black Spade Suit
  if (codePoint === 0x2663) return 2; // ♣ Black Club Suit
  if (codePoint === 0x2665) return 2; // ♥ Black Heart Suit
  if (codePoint === 0x2666) return 2; // ♦ Black Diamond Suit
  if (codePoint === 0x2690 || codePoint === 0x2691) return 2; // ⚐⚑ Flags
  if (codePoint === 0x2699) return 2; // ⚙ Gear
  if (codePoint === 0x26a0) return 2; // ⚠ Warning Sign
  if (codePoint === 0x2714) return 2; // ✔ Heavy Check Mark
  if (codePoint === 0x2716) return 2; // ✖ Heavy Multiplication X
  if (codePoint === 0x279c) return 2; // ➜ Heavy Round-Tipped Arrow
  if (codePoint === 0x27a4) return 2; // ➤ Black Right Arrowhead
  if (codePoint === 0x25b6) return 2; // ▶ Black Right Triangle
  if (codePoint === 0x23f1) return 2; // ⏱ Stopwatch

  // Hourglass + Watch (⌚⌛)
  if (codePoint === 0x231a || codePoint === 0x231b) return 2;
  // Fast-forward through rewind (⏩⏪⏫⏬)
  if (codePoint >= 0x23e9 && codePoint <= 0x23ec) return 2;
  // Alarm clock (⏰)
  if (codePoint === 0x23f0) return 2;
  // Hourglass flowing (⏳)
  if (codePoint === 0x23f3) return 2;
  // White/black medium small square with emoji pres (◽◾)
  if (codePoint === 0x25fd || codePoint === 0x25fe) return 2;
  // Misc Symbols — only Emoji_Presentation=Yes entries
  if (codePoint === 0x2614 || codePoint === 0x2615) return 2; // ☔☕
  if (codePoint >= 0x2648 && codePoint <= 0x2653) return 2; // ♈-♓
  if (codePoint === 0x267f) return 2; // ♿
  if (codePoint === 0x2693) return 2; // ⚓
  if (codePoint === 0x26a1) return 2; // ⚡
  if (codePoint === 0x26aa || codePoint === 0x26ab) return 2; // ⚪⚫
  if (codePoint === 0x26bd || codePoint === 0x26be) return 2; // ⚽⚾
  if (codePoint === 0x26c4 || codePoint === 0x26c5) return 2; // ⛄⛅
  if (codePoint === 0x26ce) return 2; // ⛎
  if (codePoint === 0x26d4) return 2; // ⛔
  if (codePoint === 0x26ea) return 2; // ⛪
  if (codePoint === 0x26f2 || codePoint === 0x26f3) return 2; // ⛲⛳
  if (codePoint === 0x26f5) return 2; // ⛵
  if (codePoint === 0x26fa) return 2; // ⛺
  if (codePoint === 0x26fd) return 2; // ⛽
  // Dingbats — only Emoji_Presentation=Yes entries
  if (codePoint === 0x2705) return 2; // ✅
  if (codePoint === 0x270a || codePoint === 0x270b) return 2; // ✊✋
  if (codePoint === 0x2728) return 2; // ✨
  if (codePoint === 0x274c) return 2; // ❌
  if (codePoint === 0x274e) return 2; // ❎
  if (codePoint >= 0x2753 && codePoint <= 0x2755) return 2; // ❓❔❕
  if (codePoint === 0x2757) return 2; // ❗
  if (codePoint === 0x2764) return 2; // ❤
  if (codePoint >= 0x2795 && codePoint <= 0x2797) return 2; // ➕➖➗
  // Curly loop / double curly loop (➰➿)
  if (codePoint === 0x27b0 || codePoint === 0x27bf) return 2;
  // Black large square/circle, star, hollow circle (⬛⬜⭐⭕)
  if (codePoint === 0x2b1b || codePoint === 0x2b1c) return 2;
  if (codePoint === 0x2b50 || codePoint === 0x2b55) return 2;
  // SMP Emoji: Mahjong through Symbols & Pictographs Extended-A
  if (codePoint >= 0x1f000 && codePoint <= 0x1faff) return 2;

  return 1;
}

/**
 * Calculate the display width of a string (sum of charWidth per code point).
 * Zero-width characters (variation selectors, ZWJ, etc.) are excluded.
 * Useful for layout and wrapping where terminal column count matters.
 */
export function stringDisplayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    const cp = char.codePointAt(0)!;
    if (!isZeroWidth(cp)) {
      width += charWidth(cp);
    }
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
