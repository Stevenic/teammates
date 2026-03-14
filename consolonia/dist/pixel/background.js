/**
 * Pixel background: just a color.
 */
import { colorBlend, TRANSPARENT } from "./color.js";
/** Create a PixelBackground. */
export function background(color = TRANSPARENT) {
    return { color };
}
/**
 * Blend an upper background over a lower background using alpha compositing.
 */
export function blendBackground(above, below) {
    return { color: colorBlend(below.color, above.color) };
}
/** An empty (transparent) background. */
export const EMPTY_BACKGROUND = { color: TRANSPARENT };
