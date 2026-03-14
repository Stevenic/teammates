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
export declare const UP = 1;
export declare const RIGHT = 2;
export declare const DOWN = 4;
export declare const LEFT = 8;
/** A box pattern is a 4-bit bitmask (0-15). */
export type BoxPattern = number;
/** No lines in any direction. */
export declare const BOX_NONE: BoxPattern;
/**
 * Lookup table from 4-bit bitmask to Unicode box-drawing character (single-line style).
 *
 * Index 0 (no bits) maps to a space since there is no line to draw.
 */
export declare const BOX_CHARS: readonly string[];
/**
 * Get the box-drawing character for a given pattern.
 */
export declare function boxChar(pattern: BoxPattern): string;
/**
 * Merge two box patterns by ORing their bitmasks together.
 * This produces smart corners where lines meet — e.g., merging
 * a horizontal line (RIGHT|LEFT) with a vertical line (UP|DOWN)
 * yields a cross (┼).
 */
export declare function mergeBoxPatterns(a: BoxPattern, b: BoxPattern): BoxPattern;
