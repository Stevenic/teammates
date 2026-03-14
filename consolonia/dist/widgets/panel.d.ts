/**
 * Panel = Border + background fill.
 *
 * Fills its entire bounds with a background color before drawing
 * the border and child, producing a filled, bordered container.
 */
import { Border, type BorderOptions } from "./border.js";
import type { DrawingContext } from "../drawing/context.js";
import type { Color } from "../pixel/color.js";
export interface PanelOptions extends BorderOptions {
    background?: Color;
}
export declare class Panel extends Border {
    private _background;
    constructor(options?: PanelOptions);
    get background(): Color;
    set background(value: Color);
    render(ctx: DrawingContext): void;
}
