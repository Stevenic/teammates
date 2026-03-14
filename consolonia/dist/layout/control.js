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
// ── Helpers ─────────────────────────────────────────────────────────
/** Clamp a measured size to the constraint bounds. */
function clampSize(size, c) {
    return {
        width: Math.max(c.minWidth, Math.min(size.width, c.maxWidth)),
        height: Math.max(c.minHeight, Math.min(size.height, c.maxHeight)),
    };
}
/** Collect all focusable controls in depth-first order. */
function collectFocusable(root) {
    const result = [];
    const walk = (ctrl) => {
        if (!ctrl.visible)
            return;
        if (ctrl.focusable)
            result.push(ctrl);
        for (const child of ctrl.children) {
            walk(child);
        }
    };
    walk(root);
    return result;
}
/** Walk up to the root of the tree. */
function root(ctrl) {
    let c = ctrl;
    while (c.parent)
        c = c.parent;
    return c;
}
// ── Control ─────────────────────────────────────────────────────────
export class Control {
    // --- Tree ---
    parent = null;
    children = [];
    // --- Layout state ---
    desiredSize = { width: 0, height: 0 };
    bounds = { x: 0, y: 0, width: 0, height: 0 };
    // --- Focus ---
    focusable = false;
    focused = false;
    // --- Visibility ---
    visible = true;
    // --- Dirty tracking ---
    dirty = true;
    // --- Event emitter storage ---
    _listeners = new Map();
    // ── Layout lifecycle ──────────────────────────────────────────────
    /**
     * Measure: determine desired size given constraints.
     * Override in subclasses. Default returns (0,0) clamped to constraints.
     */
    measure(constraint) {
        const size = clampSize({ width: 0, height: 0 }, constraint);
        this.desiredSize = size;
        return size;
    }
    /**
     * Arrange: position this control within the given rect.
     * Override in subclasses. Default sets this.bounds = rect.
     */
    arrange(rect) {
        this.bounds = rect;
    }
    // ── Event handling ────────────────────────────────────────────────
    /**
     * Handle an input event. Return true if consumed.
     *
     * Default behaviour:
     *  1. If this is a Tab key event, cycle focus and consume.
     *  2. Route to the focused child (depth-first) — if it consumes, return true.
     *  3. Otherwise return false so the event bubbles up.
     */
    handleInput(event) {
        // Tab focus cycling at root or any level
        if (event.type === 'key') {
            const ke = event.event;
            if (ke.key === 'tab' || ke.key === 'Tab') {
                if (ke.shift) {
                    this.focusPrev();
                }
                else {
                    this.focusNext();
                }
                return true;
            }
        }
        // Route to focused child
        for (const child of this.children) {
            if (!child.visible)
                continue;
            if (child.focused || this._hasFocusedDescendant(child)) {
                if (child.handleInput(event))
                    return true;
            }
        }
        return false;
    }
    /** Check whether any descendant of the given control has focus. */
    _hasFocusedDescendant(ctrl) {
        for (const child of ctrl.children) {
            if (child.focused)
                return true;
            if (this._hasFocusedDescendant(child))
                return true;
        }
        return false;
    }
    /** Called when this control gains focus. */
    onFocus() {
        this.focused = true;
        this.invalidate();
        this.emit('focus');
    }
    /** Called when this control loses focus. */
    onBlur() {
        this.focused = false;
        this.invalidate();
        this.emit('blur');
    }
    // ── Focus management ──────────────────────────────────────────────
    /** Move focus to the next focusable control in depth-first order. */
    focusNext() {
        const r = root(this);
        const list = collectFocusable(r);
        if (list.length === 0)
            return;
        const currentIndex = list.findIndex(c => c.focused);
        // Blur current
        if (currentIndex >= 0)
            list[currentIndex].onBlur();
        const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % list.length;
        list[nextIndex].onFocus();
    }
    /** Move focus to the previous focusable control in depth-first order. */
    focusPrev() {
        const r = root(this);
        const list = collectFocusable(r);
        if (list.length === 0)
            return;
        const currentIndex = list.findIndex(c => c.focused);
        if (currentIndex >= 0)
            list[currentIndex].onBlur();
        const prevIndex = currentIndex <= 0 ? list.length - 1 : currentIndex - 1;
        list[prevIndex].onFocus();
    }
    // ── Children management ───────────────────────────────────────────
    addChild(child) {
        if (child.parent) {
            child.parent.removeChild(child);
        }
        child.parent = this;
        this.children.push(child);
        this.invalidate();
    }
    removeChild(child) {
        const idx = this.children.indexOf(child);
        if (idx >= 0) {
            this.children.splice(idx, 1);
            child.parent = null;
            this.invalidate();
        }
    }
    // ── Dirty tracking ───────────────────────────────────────────────
    /** Mark this control as needing re-render. Propagates up to the root. */
    invalidate() {
        if (this.dirty)
            return; // already dirty, no need to propagate again
        this.dirty = true;
        if (this.parent) {
            this.parent.invalidate();
        }
    }
    // ── Inline event emitter ──────────────────────────────────────────
    on(event, handler) {
        let handlers = this._listeners.get(event);
        if (!handlers) {
            handlers = [];
            this._listeners.set(event, handlers);
        }
        handlers.push(handler);
    }
    off(event, handler) {
        const handlers = this._listeners.get(event);
        if (!handlers)
            return;
        const idx = handlers.indexOf(handler);
        if (idx >= 0)
            handlers.splice(idx, 1);
        if (handlers.length === 0)
            this._listeners.delete(event);
    }
    emit(event, ...args) {
        const handlers = this._listeners.get(event);
        if (!handlers)
            return;
        // Iterate over a copy so handlers can safely remove themselves
        for (const h of [...handlers]) {
            h(...args);
        }
    }
}
export { clampSize, collectFocusable };
