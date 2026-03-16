/**
 * Pixel background: just a color.
 */

import { type Color, colorBlend, TRANSPARENT } from "./color.js";

/** Background of a single pixel cell. */
export interface PixelBackground {
  readonly color: Color;
}

/** Create a PixelBackground. */
export function background(color: Color = TRANSPARENT): PixelBackground {
  return { color };
}

/**
 * Blend an upper background over a lower background using alpha compositing.
 */
export function blendBackground(
  above: PixelBackground,
  below: PixelBackground,
): PixelBackground {
  return { color: colorBlend(below.color, above.color) };
}

/** An empty (transparent) background. */
export const EMPTY_BACKGROUND: PixelBackground = { color: TRANSPARENT };
