/**
 * Pixel background: just a color.
 */
import { type Color } from "./color.js";
/** Background of a single pixel cell. */
export interface PixelBackground {
    readonly color: Color;
}
/** Create a PixelBackground. */
export declare function background(color?: Color): PixelBackground;
/**
 * Blend an upper background over a lower background using alpha compositing.
 */
export declare function blendBackground(above: PixelBackground, below: PixelBackground): PixelBackground;
/** An empty (transparent) background. */
export declare const EMPTY_BACKGROUND: PixelBackground;
