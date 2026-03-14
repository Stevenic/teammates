/**
 * Pixel foreground: the character, its color, and text style attributes.
 */
import { type Color } from "./color.js";
import { type Symbol } from "./symbol.js";
/** Foreground of a single pixel cell. */
export interface PixelForeground {
    readonly symbol: Symbol;
    readonly color: Color;
    readonly bold: boolean;
    readonly italic: boolean;
    readonly underline: boolean;
    readonly strikethrough: boolean;
}
/** Create a PixelForeground with defaults for style flags. */
export declare function foreground(symbol?: Symbol, color?: Color, opts?: {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strikethrough?: boolean;
}): PixelForeground;
/**
 * Blend an upper foreground over a lower foreground.
 *
 * If the upper symbol is a space (and not a box pattern), the lower shows through
 * but colors are still blended. If both have box patterns, they merge via OR.
 * Otherwise the upper symbol wins.
 */
export declare function blendForeground(above: PixelForeground, below: PixelForeground): PixelForeground;
/** An empty foreground (space, transparent, no styles). */
export declare const EMPTY_FOREGROUND: PixelForeground;
