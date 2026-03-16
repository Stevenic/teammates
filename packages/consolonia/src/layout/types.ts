/**
 * Core layout geometry types.
 */

/** A 2D size. */
export interface Size {
  readonly width: number;
  readonly height: number;
}

/** A 2D point. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A rectangle defined by origin and size. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Layout constraints with minimum and maximum bounds. */
export interface Constraint {
  readonly minWidth: number;
  readonly minHeight: number;
  readonly maxWidth: number;
  readonly maxHeight: number;
}
