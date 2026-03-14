/**
 * Box-drawing pattern system ported from Consolonia's BoxPattern.cs.
 *
 * A box pattern is a 4-bit bitmask encoding which sides of a cell have
 * line segments. The bits correspond to:
 *   bit 0 (0x1) = UP
 *   bit 1 (0x2) = RIGHT
 *   bit 2 (0x4) = DOWN
 *   bit 3 (0x8) = LEFT
 *
 * This maps cleanly to Unicode box-drawing characters for single-line style.
 */

/** Direction bit flags. */
export const UP    = 0x1;
export const RIGHT = 0x2;
export const DOWN  = 0x4;
export const LEFT  = 0x8;

/** A box pattern is a 4-bit bitmask (0-15). */
export type BoxPattern = number;

/** No lines in any direction. */
export const BOX_NONE: BoxPattern = 0;

/**
 * Lookup table from 4-bit bitmask to Unicode box-drawing character (single-line style).
 *
 * Index 0 (no bits) maps to a space since there is no line to draw.
 */
export const BOX_CHARS: readonly string[] = [
  " ",  // 0b0000 = none
  "\u2502", // 0b0001 = UP             │
  "\u2500", // 0b0010 = RIGHT          ─
  "\u2514", // 0b0011 = UP+RIGHT       └
  "\u2502", // 0b0100 = DOWN           │
  "\u2502", // 0b0101 = UP+DOWN        │
  "\u250C", // 0b0110 = DOWN+RIGHT     ┌
  "\u251C", // 0b0111 = UP+DOWN+RIGHT  ├
  "\u2500", // 0b1000 = LEFT           ─
  "\u2518", // 0b1001 = UP+LEFT        ┘
  "\u2500", // 0b1010 = RIGHT+LEFT     ─
  "\u2534", // 0b1011 = UP+RIGHT+LEFT  ┴
  "\u2510", // 0b1100 = DOWN+LEFT      ┐
  "\u2524", // 0b1101 = UP+DOWN+LEFT   ┤
  "\u252C", // 0b1110 = DOWN+RIGHT+LEFT┬
  "\u253C", // 0b1111 = all            ┼
];

/**
 * Get the box-drawing character for a given pattern.
 */
export function boxChar(pattern: BoxPattern): string {
  return BOX_CHARS[pattern & 0xF]!;
}

/**
 * Merge two box patterns by ORing their bitmasks together.
 * This produces smart corners where lines meet — e.g., merging
 * a horizontal line (RIGHT|LEFT) with a vertical line (UP|DOWN)
 * yields a cross (┼).
 */
export function mergeBoxPatterns(a: BoxPattern, b: BoxPattern): BoxPattern {
  return (a | b) & 0xF;
}
