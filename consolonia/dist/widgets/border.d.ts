/**
 * Box-drawing border around a single child control.
 *
 * Draws a Unicode box-drawing rectangle (via DrawingContext.drawBox)
 * and optionally renders a title string embedded in the top border
 * in the form: ┤ Title ├
 */
import { Control } from "../layout/control.js";
import type { Size, Constraint, Rect } from "../layout/types.js";
import type { DrawingContext, TextStyle, BoxStyle } from "../drawing/context.js";
export interface BorderOptions {
    child?: Control;
    title?: string;
    style?: BoxStyle;
    titleStyle?: TextStyle;
}
export declare class Border extends Control {
    private _child;
    private _title;
    private _style;
    private _titleStyle;
    constructor(options?: BorderOptions);
    get child(): Control | null;
    set child(value: Control | null);
    get title(): string;
    set title(value: string);
    get style(): BoxStyle;
    set style(value: BoxStyle);
    get titleStyle(): TextStyle;
    set titleStyle(value: TextStyle);
    measure(constraint: Constraint): Size;
    arrange(rect: Rect): void;
    render(ctx: DrawingContext): void;
}
