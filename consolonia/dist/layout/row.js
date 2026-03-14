/**
 * Row — horizontal layout container.
 *
 * Children are laid out left to right. If total desired widths exceed
 * the available width, children are proportionally scaled down.
 */
import { Control, clampSize } from './control.js';
export class Row extends Control {
    gap;
    constructor(options = {}) {
        super();
        this.gap = options.gap ?? 0;
        if (options.children) {
            for (const child of options.children) {
                this.addChild(child);
            }
        }
    }
    // ── Layout ────────────────────────────────────────────────────────
    measure(constraint) {
        const visible = this.children.filter(c => c.visible);
        if (visible.length === 0) {
            const size = clampSize({ width: 0, height: 0 }, constraint);
            this.desiredSize = size;
            return size;
        }
        const totalGap = this.gap * (visible.length - 1);
        let totalWidth = 0;
        let maxHeight = 0;
        for (const child of visible) {
            // Each child is measured with the full available height but
            // unconstrained width (up to remaining space).
            const childConstraint = {
                minWidth: 0,
                minHeight: constraint.minHeight,
                maxWidth: Math.max(0, constraint.maxWidth - totalGap),
                maxHeight: constraint.maxHeight,
            };
            const childSize = child.measure(childConstraint);
            totalWidth += childSize.width;
            maxHeight = Math.max(maxHeight, childSize.height);
        }
        const size = clampSize({ width: totalWidth + totalGap, height: maxHeight }, constraint);
        this.desiredSize = size;
        return size;
    }
    arrange(rect) {
        this.bounds = rect;
        const visible = this.children.filter(c => c.visible);
        if (visible.length === 0)
            return;
        const totalGap = this.gap * (visible.length - 1);
        const availableWidth = Math.max(0, rect.width - totalGap);
        // Sum of children's desired widths
        const totalDesired = visible.reduce((s, c) => s + c.desiredSize.width, 0);
        let x = 0;
        for (let i = 0; i < visible.length; i++) {
            const child = visible[i];
            let childWidth;
            if (totalDesired <= availableWidth || totalDesired === 0) {
                // Enough space — give each child its desired width
                childWidth = child.desiredSize.width;
            }
            else {
                // Proportionally scale down
                childWidth = Math.floor((child.desiredSize.width / totalDesired) * availableWidth);
            }
            child.arrange({
                x,
                y: 0,
                width: childWidth,
                height: rect.height,
            });
            x += childWidth + this.gap;
        }
    }
    // ── Render ────────────────────────────────────────────────────────
    render(ctx) {
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
