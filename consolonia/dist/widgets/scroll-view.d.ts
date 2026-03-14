/**
 * Vertical scrollable container.
 *
 * Wraps a single child control and clips rendering to a visible
 * window. Supports mouse wheel scrolling and arrow-key scrolling
 * when the child does not consume the events.
 */
import { Control } from "../layout/control.js";
import type { Size, Constraint, Rect } from "../layout/types.js";
import type { DrawingContext } from "../drawing/context.js";
import type { InputEvent } from "../input/events.js";
export interface ScrollViewOptions {
    child?: Control;
    maxHeight?: number;
}
export declare class ScrollView extends Control {
    private _child;
    private _scrollOffset;
    private _maxHeight;
    /** The child's full measured height (updated after measure). */
    private _contentHeight;
    constructor(options?: ScrollViewOptions);
    get child(): Control | null;
    set child(value: Control | null);
    get scrollOffset(): number;
    set scrollOffset(value: number);
    get maxHeight(): number;
    set maxHeight(value: number);
    /** Total height of the child content. */
    get contentHeight(): number;
    /** Currently visible line range (0-based, inclusive top, exclusive bottom). */
    get visibleRange(): {
        top: number;
        bottom: number;
    };
    /** Scroll so that the given y position (in child coordinates) is visible. */
    scrollTo(y: number): void;
    measure(constraint: Constraint): Size;
    arrange(rect: Rect): void;
    render(ctx: DrawingContext): void;
    handleInput(event: InputEvent): boolean;
    private _clampOffset;
}
