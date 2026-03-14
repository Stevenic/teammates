/**
 * Column — vertical layout container.
 *
 * Children are laid out top to bottom. If total desired heights exceed
 * the available height, children are proportionally scaled down.
 */
import type { Size, Rect, Constraint } from './types.js';
import type { DrawingContext } from '../drawing/context.js';
import { Control } from './control.js';
export interface ColumnOptions {
    children?: Control[];
    /** Spacing in rows between adjacent children (default 0). */
    gap?: number;
}
export declare class Column extends Control {
    gap: number;
    constructor(options?: ColumnOptions);
    measure(constraint: Constraint): Size;
    arrange(rect: Rect): void;
    render(ctx: DrawingContext): void;
}
