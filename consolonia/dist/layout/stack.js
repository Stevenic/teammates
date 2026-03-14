/**
 * Stack — z-stacking container.
 *
 * All children overlap the same area. They are rendered back to front
 * (first child = bottom, last child = top).
 */
import { Control, clampSize } from './control.js';
export class Stack extends Control {
    constructor(options = {}) {
        super();
        if (options.children) {
            for (const child of options.children) {
                this.addChild(child);
            }
        }
    }
    // ── Layout ────────────────────────────────────────────────────────
    measure(constraint) {
        const visible = this.children.filter(c => c.visible);
        let maxWidth = 0;
        let maxHeight = 0;
        for (const child of visible) {
            const childSize = child.measure(constraint);
            maxWidth = Math.max(maxWidth, childSize.width);
            maxHeight = Math.max(maxHeight, childSize.height);
        }
        const size = clampSize({ width: maxWidth, height: maxHeight }, constraint);
        this.desiredSize = size;
        return size;
    }
    arrange(rect) {
        this.bounds = rect;
        for (const child of this.children) {
            if (!child.visible)
                continue;
            // Every child gets the full rect (positioned at origin within this stack)
            child.arrange({
                x: 0,
                y: 0,
                width: rect.width,
                height: rect.height,
            });
        }
    }
    // ── Render ────────────────────────────────────────────────────────
    render(ctx) {
        // Render back to front: first child is at the bottom, last is on top
        for (const child of this.children) {
            if (!child.visible)
                continue;
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
