/**
 * Static text display widget.
 *
 * Supports word wrapping, text alignment (left/center/right), and
 * multi-line content. Automatically invalidates on text or style changes.
 */
import { Control } from "../layout/control.js";
import type { Size, Constraint } from "../layout/types.js";
import type { DrawingContext, TextStyle } from "../drawing/context.js";
export interface TextOptions {
    text?: string;
    style?: TextStyle;
    wrap?: boolean;
    align?: "left" | "center" | "right";
}
export declare class Text extends Control {
    private _text;
    private _style;
    private _wrap;
    private _align;
    /** Cached wrapped lines from the last measure/render pass. */
    private _lines;
    constructor(options?: TextOptions);
    get text(): string;
    set text(value: string);
    get style(): TextStyle;
    set style(value: TextStyle);
    get wrap(): boolean;
    set wrap(value: boolean);
    get align(): "left" | "center" | "right";
    set align(value: "left" | "center" | "right");
    measure(constraint: Constraint): Size;
    render(ctx: DrawingContext): void;
}
