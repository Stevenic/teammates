/**
 * Box container — a single-child wrapper with padding.
 *
 * The Box adds padding around its child during measure and arrange,
 * but produces no visual output of its own.
 */
import type { Size, Rect, Constraint } from './types.js';
import type { DrawingContext } from '../drawing/context.js';
import { Control } from './control.js';
export interface BoxOptions {
    child?: Control;
    paddingTop?: number;
    paddingRight?: number;
    paddingBottom?: number;
    paddingLeft?: number;
    /** Shorthand: sets all four sides when the individual values are not given. */
    padding?: number;
}
export declare class Box extends Control {
    paddingTop: number;
    paddingRight: number;
    paddingBottom: number;
    paddingLeft: number;
    constructor(options?: BoxOptions);
    /** The single child, or null. */
    get child(): Control | null;
    set child(ctrl: Control | null);
    private get hPad();
    private get vPad();
    measure(constraint: Constraint): Size;
    arrange(rect: Rect): void;
    render(ctx: DrawingContext): void;
}
