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
export declare function color(r: number, g: number, b: number, a?: number): Color;
/**
 * Alpha-composite `source` over `target` using standard "over" operator.
 * Both colors use premultiplied-style blending with 0-255 alpha.
 */
export declare function colorBlend(target: Color, source: Color): Color;
/**
 * Brighten a color by a factor (0-1). 1.0 produces white.
 */
export declare function colorBrighten(c: Color, factor: number): Color;
/**
 * Shade (darken) a color by a factor (0-1). 1.0 produces black.
 */
export declare function colorShade(c: Color, factor: number): Color;
export declare const TRANSPARENT: Color;
export declare const BLACK: Color;
export declare const WHITE: Color;
export declare const RED: Color;
export declare const GREEN: Color;
export declare const BLUE: Color;
export declare const YELLOW: Color;
export declare const CYAN: Color;
export declare const MAGENTA: Color;
export declare const GRAY: Color;
export declare const DARK_GRAY: Color;
export declare const LIGHT_GRAY: Color;
