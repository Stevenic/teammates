/**
 * A Pixel represents a single terminal cell: foreground (character + style) over background.
 */
import { type PixelForeground } from "./foreground.js";
import { type PixelBackground } from "./background.js";
/** A single terminal cell combining foreground and background. */
export interface Pixel {
    readonly foreground: PixelForeground;
    readonly background: PixelBackground;
}
/** Create a Pixel. */
export declare function pixel(fg?: PixelForeground, bg?: PixelBackground): Pixel;
/**
 * Composite `above` pixel onto `below` pixel.
 * Both foreground and background are blended independently.
 */
export declare function blendPixel(above: Pixel, below: Pixel): Pixel;
/** A fully transparent, empty pixel. */
export declare const PIXEL_EMPTY: Pixel;
/** A space character with transparent colors — the default cell state. */
export declare const PIXEL_SPACE: Pixel;
