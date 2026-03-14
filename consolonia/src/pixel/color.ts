/**
 * RGBA color representation and compositing functions.
 * All channel values are integers in the range 0-255.
 */

/** RGBA color with each channel in 0-255. */
export interface Color {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/** Create a color from RGBA values (all 0-255). */
export function color(r: number, g: number, b: number, a: number = 255): Color {
  return { r, g, b, a };
}

/** Clamp a value to 0-255 integer range. */
function clamp(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/**
 * Alpha-composite `source` over `target` using standard "over" operator.
 * Both colors use premultiplied-style blending with 0-255 alpha.
 */
export function colorBlend(target: Color, source: Color): Color {
  if (source.a === 0) return target;
  if (source.a === 255) return source;
  if (target.a === 0) return source;

  const sa = source.a / 255;
  const ta = target.a / 255;

  // Standard Porter-Duff "over" operator
  const outA = sa + ta * (1 - sa);
  if (outA === 0) return TRANSPARENT;

  const outR = (source.r * sa + target.r * ta * (1 - sa)) / outA;
  const outG = (source.g * sa + target.g * ta * (1 - sa)) / outA;
  const outB = (source.b * sa + target.b * ta * (1 - sa)) / outA;

  return {
    r: clamp(outR),
    g: clamp(outG),
    b: clamp(outB),
    a: clamp(outA * 255),
  };
}

/**
 * Brighten a color by a factor (0-1). 1.0 produces white.
 */
export function colorBrighten(c: Color, factor: number): Color {
  const f = Math.max(0, Math.min(1, factor));
  return {
    r: clamp(c.r + (255 - c.r) * f),
    g: clamp(c.g + (255 - c.g) * f),
    b: clamp(c.b + (255 - c.b) * f),
    a: c.a,
  };
}

/**
 * Shade (darken) a color by a factor (0-1). 1.0 produces black.
 */
export function colorShade(c: Color, factor: number): Color {
  const f = 1 - Math.max(0, Math.min(1, factor));
  return {
    r: clamp(c.r * f),
    g: clamp(c.g * f),
    b: clamp(c.b * f),
    a: c.a,
  };
}

// ── Common color constants ──────────────────────────────────────────

export const TRANSPARENT: Color = { r: 0, g: 0, b: 0, a: 0 };
export const BLACK: Color = { r: 0, g: 0, b: 0, a: 255 };
export const WHITE: Color = { r: 255, g: 255, b: 255, a: 255 };
export const RED: Color = { r: 255, g: 0, b: 0, a: 255 };
export const GREEN: Color = { r: 0, g: 255, b: 0, a: 255 };
export const BLUE: Color = { r: 0, g: 0, b: 255, a: 255 };
export const YELLOW: Color = { r: 255, g: 255, b: 0, a: 255 };
export const CYAN: Color = { r: 0, g: 255, b: 255, a: 255 };
export const MAGENTA: Color = { r: 255, g: 0, b: 255, a: 255 };
export const GRAY: Color = { r: 128, g: 128, b: 128, a: 255 };
export const DARK_GRAY: Color = { r: 64, g: 64, b: 64, a: 255 };
export const LIGHT_GRAY: Color = { r: 192, g: 192, b: 192, a: 255 };
