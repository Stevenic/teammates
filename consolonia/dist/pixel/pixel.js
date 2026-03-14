/**
 * A Pixel represents a single terminal cell: foreground (character + style) over background.
 */
import { TRANSPARENT } from "./color.js";
import { EMPTY_SYMBOL } from "./symbol.js";
import { EMPTY_FOREGROUND, blendForeground, } from "./foreground.js";
import { EMPTY_BACKGROUND, blendBackground, } from "./background.js";
/** Create a Pixel. */
export function pixel(fg = EMPTY_FOREGROUND, bg = EMPTY_BACKGROUND) {
    return { foreground: fg, background: bg };
}
/**
 * Composite `above` pixel onto `below` pixel.
 * Both foreground and background are blended independently.
 */
export function blendPixel(above, below) {
    return {
        foreground: blendForeground(above.foreground, below.foreground),
        background: blendBackground(above.background, below.background),
    };
}
/** A fully transparent, empty pixel. */
export const PIXEL_EMPTY = {
    foreground: EMPTY_FOREGROUND,
    background: EMPTY_BACKGROUND,
};
/** A space character with transparent colors — the default cell state. */
export const PIXEL_SPACE = {
    foreground: {
        symbol: EMPTY_SYMBOL,
        color: TRANSPARENT,
        bold: false,
        italic: false,
        underline: false,
        strikethrough: false,
    },
    background: EMPTY_BACKGROUND,
};
