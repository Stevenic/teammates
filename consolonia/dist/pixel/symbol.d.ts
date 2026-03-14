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
 * Returns 2 for wide characters (CJK, fullwidth forms), 1 otherwise.
 */
export declare function charWidth(codePoint: number): 1 | 2;
/**
 * Create a Symbol from a text string.
 * Width is auto-detected from the first code point.
 */
export declare function sym(text: string, pattern?: BoxPattern): Symbol;
/** An empty symbol (space character). */
export declare const EMPTY_SYMBOL: Symbol;
