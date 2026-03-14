/**
 * StyledText — text display widget that renders multi-styled lines.
 *
 * Unlike Text (which applies one TextStyle to the whole block), StyledText
 * accepts StyledSpan lines where each segment can have its own color,
 * bold, italic, etc.  Plain strings are also accepted and rendered with
 * a default style.
 *
 * Supports word wrapping, but wrapping is computed on the plain-text
 * representation and styles are carried across wrap boundaries.
 */
import { Control } from "../layout/control.js";
import type { Size, Constraint } from "../layout/types.js";
import type { DrawingContext, TextStyle } from "../drawing/context.js";
import { type StyledSpan } from "../styled.js";
/** A line of styled text: either a StyledSpan or a plain string. */
export type StyledLine = StyledSpan | string;
export interface StyledTextOptions {
    lines?: StyledLine[];
    defaultStyle?: TextStyle;
    wrap?: boolean;
}
export declare class StyledText extends Control {
    private _lines;
    private _defaultStyle;
    private _wrap;
    /** Cached wrapped lines from the last measure pass. */
    private _wrapped;
    constructor(options?: StyledTextOptions);
    get lines(): StyledLine[];
    set lines(value: StyledLine[]);
    get defaultStyle(): TextStyle;
    set defaultStyle(value: TextStyle);
    get wrap(): boolean;
    set wrap(value: boolean);
    measure(constraint: Constraint): Size;
    render(ctx: DrawingContext): void;
}
