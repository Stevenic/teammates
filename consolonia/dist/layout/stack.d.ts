/**
 * Stack — z-stacking container.
 *
 * All children overlap the same area. They are rendered back to front
 * (first child = bottom, last child = top).
 */
import type { Size, Rect, Constraint } from './types.js';
import type { DrawingContext } from '../drawing/context.js';
import { Control } from './control.js';
export interface StackOptions {
    children?: Control[];
}
export declare class Stack extends Control {
    constructor(options?: StackOptions);
    measure(constraint: Constraint): Size;
    arrange(rect: Rect): void;
    render(ctx: DrawingContext): void;
}
