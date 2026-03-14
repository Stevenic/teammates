/**
 * Row — horizontal layout container.
 *
 * Children are laid out left to right. If total desired widths exceed
 * the available width, children are proportionally scaled down.
 */
import type { Size, Rect, Constraint } from './types.js';
import type { DrawingContext } from '../drawing/context.js';
import { Control } from './control.js';
export interface RowOptions {
    children?: Control[];
    /** Spacing in columns between adjacent children (default 0). */
    gap?: number;
}
export declare class Row extends Control {
    gap: number;
    constructor(options?: RowOptions);
    measure(constraint: Constraint): Size;
    arrange(rect: Rect): void;
    render(ctx: DrawingContext): void;
}
