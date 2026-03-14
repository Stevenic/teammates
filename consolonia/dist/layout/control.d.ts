/**
 * Base Control class — the root of the widget tree.
 *
 * Every UI element extends Control. It provides:
 *  - Parent/child tree management
 *  - Measure/arrange layout protocol
 *  - Abstract render() for drawing
 *  - Input event routing with bubbling
 *  - Focus management (tab-cycle through focusable descendants)
 *  - Dirty tracking with upward propagation
 *  - Lightweight inline event emitter (no Node.js dependency)
 */
import type { Size, Rect, Constraint } from './types.js';
import type { DrawingContext } from '../drawing/context.js';
import type { InputEvent } from '../input/events.js';
/** Clamp a measured size to the constraint bounds. */
declare function clampSize(size: Size, c: Constraint): Size;
/** Collect all focusable controls in depth-first order. */
declare function collectFocusable(root: Control): Control[];
export declare abstract class Control {
    parent: Control | null;
    children: Control[];
    desiredSize: Size;
    bounds: Rect;
    focusable: boolean;
    focused: boolean;
    visible: boolean;
    dirty: boolean;
    private _listeners;
    /**
     * Measure: determine desired size given constraints.
     * Override in subclasses. Default returns (0,0) clamped to constraints.
     */
    measure(constraint: Constraint): Size;
    /**
     * Arrange: position this control within the given rect.
     * Override in subclasses. Default sets this.bounds = rect.
     */
    arrange(rect: Rect): void;
    /**
     * Render this control using the drawing context.
     * The context's coordinate system is already translated so (0,0) is
     * this control's top-left corner. Override in subclasses.
     */
    abstract render(ctx: DrawingContext): void;
    /**
     * Handle an input event. Return true if consumed.
     *
     * Default behaviour:
     *  1. If this is a Tab key event, cycle focus and consume.
     *  2. Route to the focused child (depth-first) — if it consumes, return true.
     *  3. Otherwise return false so the event bubbles up.
     */
    handleInput(event: InputEvent): boolean;
    /** Check whether any descendant of the given control has focus. */
    private _hasFocusedDescendant;
    /** Called when this control gains focus. */
    onFocus(): void;
    /** Called when this control loses focus. */
    onBlur(): void;
    /** Move focus to the next focusable control in depth-first order. */
    focusNext(): void;
    /** Move focus to the previous focusable control in depth-first order. */
    focusPrev(): void;
    addChild(child: Control): void;
    removeChild(child: Control): void;
    /** Mark this control as needing re-render. Propagates up to the root. */
    invalidate(): void;
    on(event: string, handler: (...args: any[]) => void): void;
    off(event: string, handler: (...args: any[]) => void): void;
    emit(event: string, ...args: any[]): void;
}
export { clampSize, collectFocusable };
