/**
 * Box container — a single-child wrapper with padding.
 *
 * The Box adds padding around its child during measure and arrange,
 * but produces no visual output of its own.
 */
import { Control, clampSize } from './control.js';
export class Box extends Control {
    paddingTop;
    paddingRight;
    paddingBottom;
    paddingLeft;
    constructor(options = {}) {
        super();
        const p = options.padding ?? 0;
        this.paddingTop = options.paddingTop ?? p;
        this.paddingRight = options.paddingRight ?? p;
        this.paddingBottom = options.paddingBottom ?? p;
        this.paddingLeft = options.paddingLeft ?? p;
        if (options.child) {
            this.addChild(options.child);
        }
    }
    /** The single child, or null. */
    get child() {
        return this.children.length > 0 ? this.children[0] : null;
    }
    set child(ctrl) {
        // Remove existing child
        while (this.children.length > 0) {
            this.removeChild(this.children[0]);
        }
        if (ctrl) {
            this.addChild(ctrl);
        }
    }
    // ── Horizontal / vertical padding totals ──────────────────────────
    get hPad() {
        return this.paddingLeft + this.paddingRight;
    }
    get vPad() {
        return this.paddingTop + this.paddingBottom;
    }
    // ── Layout ────────────────────────────────────────────────────────
    measure(constraint) {
        const innerConstraint = {
            minWidth: Math.max(0, constraint.minWidth - this.hPad),
            minHeight: Math.max(0, constraint.minHeight - this.vPad),
            maxWidth: Math.max(0, constraint.maxWidth - this.hPad),
            maxHeight: Math.max(0, constraint.maxHeight - this.vPad),
        };
        let childSize = { width: 0, height: 0 };
        if (this.child && this.child.visible) {
            childSize = this.child.measure(innerConstraint);
        }
        const size = clampSize({
            width: childSize.width + this.hPad,
            height: childSize.height + this.vPad,
        }, constraint);
        this.desiredSize = size;
        return size;
    }
    arrange(rect) {
        this.bounds = rect;
        if (this.child && this.child.visible) {
            const innerRect = {
                x: this.paddingLeft,
                y: this.paddingTop,
                width: Math.max(0, rect.width - this.hPad),
                height: Math.max(0, rect.height - this.vPad),
            };
            this.child.arrange(innerRect);
        }
    }
    // ── Render ────────────────────────────────────────────────────────
    render(ctx) {
        if (this.child && this.child.visible) {
            const child = this.child;
            ctx.pushClip({
                x: child.bounds.x,
                y: child.bounds.y,
                width: child.bounds.width,
                height: child.bounds.height,
            });
            ctx.pushTranslate(child.bounds.x, child.bounds.y);
            child.render(ctx);
            child.dirty = false;
            ctx.popTranslate();
            ctx.popClip();
        }
    }
}
