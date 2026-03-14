/**
 * Pixel foreground: the character, its color, and text style attributes.
 */
import { colorBlend, TRANSPARENT } from "./color.js";
import { EMPTY_SYMBOL } from "./symbol.js";
import { mergeBoxPatterns, boxChar } from "./box-pattern.js";
/** Create a PixelForeground with defaults for style flags. */
export function foreground(symbol = EMPTY_SYMBOL, color = TRANSPARENT, opts = {}) {
    return {
        symbol,
        color,
        bold: opts.bold ?? false,
        italic: opts.italic ?? false,
        underline: opts.underline ?? false,
        strikethrough: opts.strikethrough ?? false,
    };
}
/**
 * Blend an upper foreground over a lower foreground.
 *
 * If the upper symbol is a space (and not a box pattern), the lower shows through
 * but colors are still blended. If both have box patterns, they merge via OR.
 * Otherwise the upper symbol wins.
 */
export function blendForeground(above, below) {
    const aboveSym = above.symbol;
    const belowSym = below.symbol;
    // Both have box patterns: merge them
    if (aboveSym.pattern !== 0 && belowSym.pattern !== 0) {
        const merged = mergeBoxPatterns(aboveSym.pattern, belowSym.pattern);
        const mergedChar = boxChar(merged);
        return {
            symbol: { text: mergedChar, width: 1, pattern: merged },
            color: above.color.a > 0 ? colorBlend(below.color, above.color) : below.color,
            bold: above.bold || below.bold,
            italic: above.italic || below.italic,
            underline: above.underline || below.underline,
            strikethrough: above.strikethrough || below.strikethrough,
        };
    }
    // Above is a transparent space — lower shows through
    if (aboveSym.text === " " && aboveSym.pattern === 0 && above.color.a === 0) {
        return below;
    }
    // Above has content — it wins, colors are blended
    const blendedColor = colorBlend(below.color, above.color);
    return {
        symbol: aboveSym.text === " " && aboveSym.pattern === 0 ? belowSym : aboveSym,
        color: blendedColor,
        bold: aboveSym.text !== " " ? above.bold : below.bold,
        italic: aboveSym.text !== " " ? above.italic : below.italic,
        underline: aboveSym.text !== " " ? above.underline : below.underline,
        strikethrough: aboveSym.text !== " " ? above.strikethrough : below.strikethrough,
    };
}
/** An empty foreground (space, transparent, no styles). */
export const EMPTY_FOREGROUND = {
    symbol: EMPTY_SYMBOL,
    color: TRANSPARENT,
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
};
