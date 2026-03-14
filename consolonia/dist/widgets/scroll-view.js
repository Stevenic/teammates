/**
 * Vertical scrollable container.
 *
 * Wraps a single child control and clips rendering to a visible
 * window. Supports mouse wheel scrolling and arrow-key scrolling
 * when the child does not consume the events.
 */
import { Control } from "../layout/control.js";
export class ScrollView extends Control {
    _child;
    _scrollOffset = 0;
    _maxHeight;
    /** The child's full measured height (updated after measure). */
    _contentHeight = 0;
    constructor(options = {}) {
        super();
        this._child = options.child ?? null;
        this._maxHeight = options.maxHeight ?? Infinity;
        if (this._child) {
            this.children.push(this._child);
        }
    }
    // ── Properties ────────────────────────────────────────────────
    get child() {
        return this._child;
    }
    set child(value) {
        if (this._child) {
            const idx = this.children.indexOf(this._child);
            if (idx >= 0)
                this.children.splice(idx, 1);
        }
        this._child = value;
        if (value) {
            this.children.push(value);
        }
        this._scrollOffset = 0;
        this.invalidate();
    }
    get scrollOffset() {
        return this._scrollOffset;
    }
    set scrollOffset(value) {
        const clamped = this._clampOffset(value);
        if (this._scrollOffset !== clamped) {
            this._scrollOffset = clamped;
            this.invalidate();
        }
    }
    get maxHeight() {
        return this._maxHeight;
    }
    set maxHeight(value) {
        if (this._maxHeight !== value) {
            this._maxHeight = value;
            this.invalidate();
        }
    }
    /** Total height of the child content. */
    get contentHeight() {
        return this._contentHeight;
    }
    /** Currently visible line range (0-based, inclusive top, exclusive bottom). */
    get visibleRange() {
        const bounds = this.bounds;
        const visibleH = bounds ? bounds.height : 0;
        return {
            top: this._scrollOffset,
            bottom: this._scrollOffset + visibleH,
        };
    }
    // ── Public methods ────────────────────────────────────────────
    /** Scroll so that the given y position (in child coordinates) is visible. */
    scrollTo(y) {
        const bounds = this.bounds;
        const visibleH = bounds ? bounds.height : 0;
        if (y < this._scrollOffset) {
            this.scrollOffset = y;
        }
        else if (y >= this._scrollOffset + visibleH) {
            this.scrollOffset = y - visibleH + 1;
        }
    }
    // ── Layout ────────────────────────────────────────────────────
    measure(constraint) {
        if (!this._child) {
            this._contentHeight = 0;
            return { width: 0, height: 0 };
        }
        // Let the child measure with unconstrained height
        const childConstraint = {
            minWidth: constraint.minWidth,
            minHeight: 0,
            maxWidth: constraint.maxWidth,
            maxHeight: Infinity,
        };
        // The child should have been measured by the layout engine;
        // we read its desired size.
        const childSize = this._child.desiredSize ?? { width: 0, height: 0 };
        this._contentHeight = childSize.height;
        const visibleHeight = Math.min(childSize.height, this._maxHeight, constraint.maxHeight);
        return {
            width: Math.min(childSize.width, constraint.maxWidth),
            height: visibleHeight,
        };
    }
    arrange(rect) {
        if (!this._child)
            return;
        // Give the child its full content height, not the clamped visible height
        this._child.arrange({
            x: rect.x,
            y: rect.y - this._scrollOffset,
            width: rect.width,
            height: this._contentHeight,
        });
        // Re-clamp scroll offset in case content height changed
        this._scrollOffset = this._clampOffset(this._scrollOffset);
    }
    render(ctx) {
        const bounds = this.bounds;
        if (!bounds || !this._child)
            return;
        // Push a clip rectangle so the child only renders within visible area
        ctx.pushClip(bounds);
        // The child was arranged with y offset accounting for scroll,
        // so it renders correctly within the clip.
        this._child.render(ctx);
        ctx.popClip();
    }
    // ── Input handling ────────────────────────────────────────────
    handleInput(event) {
        // Let child handle first
        if (this._child) {
            const childHandled = this._child.handleInput(event);
            if (childHandled)
                return true;
        }
        if (event.type === "mouse") {
            const me = event.event;
            if (me.type === "wheelup") {
                this.scrollOffset = this._scrollOffset - 3;
                return true;
            }
            if (me.type === "wheeldown") {
                this.scrollOffset = this._scrollOffset + 3;
                return true;
            }
        }
        if (event.type === "key") {
            const ke = event.event;
            if (ke.key === "up") {
                this.scrollOffset = this._scrollOffset - 1;
                return true;
            }
            if (ke.key === "down") {
                this.scrollOffset = this._scrollOffset + 1;
                return true;
            }
            if (ke.key === "pageup") {
                const bounds = this.bounds;
                const pageSize = bounds ? bounds.height : 10;
                this.scrollOffset = this._scrollOffset - pageSize;
                return true;
            }
            if (ke.key === "pagedown") {
                const bounds = this.bounds;
                const pageSize = bounds ? bounds.height : 10;
                this.scrollOffset = this._scrollOffset + pageSize;
                return true;
            }
        }
        return false;
    }
    // ── Internal helpers ──────────────────────────────────────────
    _clampOffset(offset) {
        const bounds = this.bounds;
        const visibleH = bounds ? bounds.height : 0;
        const maxOffset = Math.max(0, this._contentHeight - visibleH);
        return Math.max(0, Math.min(offset, maxOffset));
    }
}
