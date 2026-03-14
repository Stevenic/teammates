/**
 * Tests for Phase 6: Layout Engine (Control, Box, Row, Column, Stack).
 */
import { describe, it, expect, vi } from "vitest";
import { Control } from "../layout/control.js";
import { Box } from "../layout/box.js";
import { Row } from "../layout/row.js";
import { Column } from "../layout/column.js";
import { Stack } from "../layout/stack.js";
import { keyEvent } from "../input/events.js";
// ── Helpers ──────────────────────────────────────────────────────────
/** Unconstrained constraint for measuring. */
const UNCONSTRAINED = {
    minWidth: 0,
    minHeight: 0,
    maxWidth: Infinity,
    maxHeight: Infinity,
};
/** Create a constraint with specific max bounds. */
function maxConstraint(maxWidth, maxHeight) {
    return { minWidth: 0, minHeight: 0, maxWidth, maxHeight };
}
/**
 * Concrete Control subclass that returns a fixed size and tracks render calls.
 */
class TestControl extends Control {
    fixedWidth;
    fixedHeight;
    renderCalled = false;
    renderCount = 0;
    constructor(width = 0, height = 0) {
        super();
        this.fixedWidth = width;
        this.fixedHeight = height;
    }
    measure(constraint) {
        const size = {
            width: Math.max(constraint.minWidth, Math.min(this.fixedWidth, constraint.maxWidth)),
            height: Math.max(constraint.minHeight, Math.min(this.fixedHeight, constraint.maxHeight)),
        };
        this.desiredSize = size;
        return size;
    }
    render(_ctx) {
        this.renderCalled = true;
        this.renderCount++;
    }
}
/**
 * Focusable TestControl.
 */
class FocusableControl extends TestControl {
    constructor(width = 0, height = 0) {
        super(width, height);
        this.focusable = true;
    }
}
// ═══════════════════════════════════════════════════════════════════════
// Control base class
// ═══════════════════════════════════════════════════════════════════════
describe("Control", () => {
    describe("addChild / removeChild", () => {
        it("addChild sets parent and adds to children", () => {
            const parent = new TestControl();
            const child = new TestControl();
            parent.addChild(child);
            expect(child.parent).toBe(parent);
            expect(parent.children).toContain(child);
            expect(parent.children.length).toBe(1);
        });
        it("addChild removes child from previous parent", () => {
            const parent1 = new TestControl();
            const parent2 = new TestControl();
            const child = new TestControl();
            parent1.addChild(child);
            parent2.addChild(child);
            expect(child.parent).toBe(parent2);
            expect(parent1.children.length).toBe(0);
            expect(parent2.children.length).toBe(1);
        });
        it("removeChild clears parent and removes from children", () => {
            const parent = new TestControl();
            const child = new TestControl();
            parent.addChild(child);
            parent.removeChild(child);
            expect(child.parent).toBeNull();
            expect(parent.children.length).toBe(0);
        });
        it("removeChild on non-child is a no-op", () => {
            const parent = new TestControl();
            const other = new TestControl();
            // Should not throw
            parent.removeChild(other);
            expect(parent.children.length).toBe(0);
        });
    });
    describe("invalidate / dirty tracking", () => {
        it("invalidate sets dirty=true", () => {
            const ctrl = new TestControl();
            ctrl.dirty = false;
            ctrl.invalidate();
            expect(ctrl.dirty).toBe(true);
        });
        it("invalidate propagates to parent", () => {
            const parent = new TestControl();
            const child = new TestControl();
            parent.addChild(child);
            // Reset dirty flags
            parent.dirty = false;
            child.dirty = false;
            child.invalidate();
            expect(child.dirty).toBe(true);
            expect(parent.dirty).toBe(true);
        });
        it("invalidate propagates all the way to root", () => {
            const root = new TestControl();
            const mid = new TestControl();
            const leaf = new TestControl();
            root.addChild(mid);
            mid.addChild(leaf);
            root.dirty = false;
            mid.dirty = false;
            leaf.dirty = false;
            leaf.invalidate();
            expect(leaf.dirty).toBe(true);
            expect(mid.dirty).toBe(true);
            expect(root.dirty).toBe(true);
        });
        it("invalidate does not propagate if already dirty", () => {
            const parent = new TestControl();
            const child = new TestControl();
            parent.addChild(child);
            // child is already dirty from addChild
            // Reset parent dirty, keep child dirty
            parent.dirty = false;
            child.dirty = true;
            // Since child is already dirty, invalidate should not propagate
            child.invalidate();
            expect(parent.dirty).toBe(false);
        });
    });
    describe("event system (on/off/emit)", () => {
        it("on registers handler that receives emitted events", () => {
            const ctrl = new TestControl();
            const handler = vi.fn();
            ctrl.on("test", handler);
            ctrl.emit("test", "arg1", 42);
            expect(handler).toHaveBeenCalledOnce();
            expect(handler).toHaveBeenCalledWith("arg1", 42);
        });
        it("multiple handlers are all called", () => {
            const ctrl = new TestControl();
            const h1 = vi.fn();
            const h2 = vi.fn();
            ctrl.on("click", h1);
            ctrl.on("click", h2);
            ctrl.emit("click");
            expect(h1).toHaveBeenCalledOnce();
            expect(h2).toHaveBeenCalledOnce();
        });
        it("off removes handler", () => {
            const ctrl = new TestControl();
            const handler = vi.fn();
            ctrl.on("test", handler);
            ctrl.off("test", handler);
            ctrl.emit("test");
            expect(handler).not.toHaveBeenCalled();
        });
        it("off with non-registered handler is a no-op", () => {
            const ctrl = new TestControl();
            const handler = vi.fn();
            ctrl.off("test", handler); // should not throw
        });
        it("emit with no listeners is a no-op", () => {
            const ctrl = new TestControl();
            // Should not throw
            ctrl.emit("nonexistent");
        });
    });
    describe("handleInput", () => {
        it("routes to focused child", () => {
            const parent = new TestControl();
            const child = new FocusableControl();
            parent.addChild(child);
            child.onFocus();
            const inputHandler = vi.fn().mockReturnValue(true);
            child.handleInput = inputHandler;
            const event = keyEvent("a", "a");
            const consumed = parent.handleInput(event);
            expect(inputHandler).toHaveBeenCalledWith(event);
            expect(consumed).toBe(true);
        });
        it("Tab key cycles focus via focusNext", () => {
            const root = new TestControl();
            const a = new FocusableControl();
            const b = new FocusableControl();
            root.addChild(a);
            root.addChild(b);
            // Initially nothing is focused; Tab should focus first
            const tabEvent = keyEvent("tab", "", false, false, false);
            root.handleInput(tabEvent);
            expect(a.focused).toBe(true);
            expect(b.focused).toBe(false);
            root.handleInput(tabEvent);
            expect(a.focused).toBe(false);
            expect(b.focused).toBe(true);
        });
        it("Shift+Tab cycles focus via focusPrev", () => {
            const root = new TestControl();
            const a = new FocusableControl();
            const b = new FocusableControl();
            const c = new FocusableControl();
            root.addChild(a);
            root.addChild(b);
            root.addChild(c);
            // Focus the second item first
            a.onFocus();
            a.onBlur();
            b.onFocus();
            const shiftTabEvent = keyEvent("tab", "", true, false, false);
            root.handleInput(shiftTabEvent);
            // Should go back to a
            expect(a.focused).toBe(true);
            expect(b.focused).toBe(false);
        });
    });
    describe("focus cycling", () => {
        it("focusNext cycles through focusable controls", () => {
            const root = new TestControl();
            const a = new FocusableControl();
            const b = new FocusableControl();
            const c = new FocusableControl();
            root.addChild(a);
            root.addChild(b);
            root.addChild(c);
            root.focusNext(); // -> a
            expect(a.focused).toBe(true);
            root.focusNext(); // -> b
            expect(a.focused).toBe(false);
            expect(b.focused).toBe(true);
            root.focusNext(); // -> c
            expect(b.focused).toBe(false);
            expect(c.focused).toBe(true);
            root.focusNext(); // -> wraps to a
            expect(c.focused).toBe(false);
            expect(a.focused).toBe(true);
        });
        it("focusPrev cycles in reverse", () => {
            const root = new TestControl();
            const a = new FocusableControl();
            const b = new FocusableControl();
            root.addChild(a);
            root.addChild(b);
            // focusPrev with nothing focused -> last item
            root.focusPrev();
            expect(b.focused).toBe(true);
            root.focusPrev();
            expect(a.focused).toBe(true);
            expect(b.focused).toBe(false);
            root.focusPrev(); // wrap to last
            expect(b.focused).toBe(true);
            expect(a.focused).toBe(false);
        });
        it("focusNext with no focusable controls is a no-op", () => {
            const root = new TestControl();
            const child = new TestControl(); // not focusable
            root.addChild(child);
            // Should not throw
            root.focusNext();
            expect(child.focused).toBe(false);
        });
        it("focusNext skips invisible controls", () => {
            const root = new TestControl();
            const a = new FocusableControl();
            const b = new FocusableControl();
            const c = new FocusableControl();
            root.addChild(a);
            root.addChild(b);
            root.addChild(c);
            b.visible = false;
            root.focusNext(); // -> a
            expect(a.focused).toBe(true);
            root.focusNext(); // -> c (skips invisible b)
            expect(c.focused).toBe(true);
            expect(a.focused).toBe(false);
        });
        it("onFocus/onBlur emit focus and blur events", () => {
            const ctrl = new FocusableControl();
            const focusSpy = vi.fn();
            const blurSpy = vi.fn();
            ctrl.on("focus", focusSpy);
            ctrl.on("blur", blurSpy);
            ctrl.onFocus();
            expect(focusSpy).toHaveBeenCalledOnce();
            expect(ctrl.focused).toBe(true);
            ctrl.onBlur();
            expect(blurSpy).toHaveBeenCalledOnce();
            expect(ctrl.focused).toBe(false);
        });
    });
    describe("measure default", () => {
        it("base Control.measure returns (0,0) clamped to constraints", () => {
            // We need a non-abstract subclass that calls super.measure
            class DefaultControl extends Control {
                render(_ctx) { }
            }
            const ctrl = new DefaultControl();
            const size = ctrl.measure({ minWidth: 5, minHeight: 3, maxWidth: 100, maxHeight: 100 });
            expect(size).toEqual({ width: 5, height: 3 });
        });
    });
    describe("arrange default", () => {
        it("base Control.arrange sets bounds", () => {
            const ctrl = new TestControl();
            const rect = { x: 10, y: 20, width: 30, height: 40 };
            ctrl.arrange(rect);
            expect(ctrl.bounds).toEqual(rect);
        });
    });
});
// ═══════════════════════════════════════════════════════════════════════
// Box
// ═══════════════════════════════════════════════════════════════════════
describe("Box", () => {
    describe("measure", () => {
        it("adds padding to child's desired size", () => {
            const child = new TestControl(10, 5);
            const box = new Box({ child, padding: 2 });
            const size = box.measure(UNCONSTRAINED);
            // 10 + 2 + 2 = 14 width, 5 + 2 + 2 = 9 height
            expect(size.width).toBe(14);
            expect(size.height).toBe(9);
        });
        it("per-side padding", () => {
            const child = new TestControl(10, 5);
            const box = new Box({
                child,
                paddingTop: 1,
                paddingRight: 2,
                paddingBottom: 3,
                paddingLeft: 4,
            });
            const size = box.measure(UNCONSTRAINED);
            // width: 10 + 4 + 2 = 16
            // height: 5 + 1 + 3 = 9
            expect(size.width).toBe(16);
            expect(size.height).toBe(9);
        });
        it("with no child, returns just padding size", () => {
            const box = new Box({ padding: 3 });
            const size = box.measure(UNCONSTRAINED);
            // 0 + 3 + 3 = 6 each
            expect(size.width).toBe(6);
            expect(size.height).toBe(6);
        });
        it("respects constraints", () => {
            const child = new TestControl(100, 100);
            const box = new Box({ child, padding: 2 });
            const size = box.measure(maxConstraint(20, 15));
            expect(size.width).toBeLessThanOrEqual(20);
            expect(size.height).toBeLessThanOrEqual(15);
        });
    });
    describe("arrange", () => {
        it("child gets inner rect (inset by padding)", () => {
            const child = new TestControl(10, 5);
            const box = new Box({ child, padding: 2 });
            box.measure(UNCONSTRAINED);
            box.arrange({ x: 0, y: 0, width: 14, height: 9 });
            expect(child.bounds).toEqual({
                x: 2,
                y: 2,
                width: 10,
                height: 5,
            });
        });
        it("per-side padding arrange", () => {
            const child = new TestControl(10, 5);
            const box = new Box({
                child,
                paddingTop: 1,
                paddingRight: 2,
                paddingBottom: 3,
                paddingLeft: 4,
            });
            box.measure(UNCONSTRAINED);
            box.arrange({ x: 0, y: 0, width: 16, height: 9 });
            expect(child.bounds.x).toBe(4); // paddingLeft
            expect(child.bounds.y).toBe(1); // paddingTop
            expect(child.bounds.width).toBe(10); // 16 - 4 - 2
            expect(child.bounds.height).toBe(5); // 9 - 1 - 3
        });
        it("sets own bounds", () => {
            const box = new Box({ padding: 2 });
            const rect = { x: 5, y: 10, width: 20, height: 15 };
            box.arrange(rect);
            expect(box.bounds).toEqual(rect);
        });
    });
    describe("child property", () => {
        it("get child returns first child or null", () => {
            const box = new Box();
            expect(box.child).toBeNull();
            const child = new TestControl();
            box.addChild(child);
            expect(box.child).toBe(child);
        });
        it("set child replaces existing child", () => {
            const child1 = new TestControl();
            const child2 = new TestControl();
            const box = new Box({ child: child1 });
            box.child = child2;
            expect(box.children.length).toBe(1);
            expect(box.child).toBe(child2);
            expect(child1.parent).toBeNull();
        });
        it("set child to null removes child", () => {
            const child = new TestControl();
            const box = new Box({ child });
            box.child = null;
            expect(box.children.length).toBe(0);
            expect(box.child).toBeNull();
        });
    });
});
// ═══════════════════════════════════════════════════════════════════════
// Row
// ═══════════════════════════════════════════════════════════════════════
describe("Row", () => {
    describe("measure", () => {
        it("sum of children widths, max height", () => {
            const a = new TestControl(10, 5);
            const b = new TestControl(20, 8);
            const c = new TestControl(15, 3);
            const row = new Row({ children: [a, b, c] });
            const size = row.measure(UNCONSTRAINED);
            expect(size.width).toBe(45); // 10 + 20 + 15
            expect(size.height).toBe(8); // max(5, 8, 3)
        });
        it("no children returns zero", () => {
            const row = new Row();
            const size = row.measure(UNCONSTRAINED);
            expect(size.width).toBe(0);
            expect(size.height).toBe(0);
        });
        it("gap spacing included in width", () => {
            const a = new TestControl(10, 5);
            const b = new TestControl(20, 5);
            const c = new TestControl(15, 5);
            const row = new Row({ children: [a, b, c], gap: 2 });
            const size = row.measure(UNCONSTRAINED);
            // 10 + 20 + 15 + 2 * 2(gaps) = 49
            expect(size.width).toBe(49);
        });
        it("invisible children are ignored", () => {
            const a = new TestControl(10, 5);
            const b = new TestControl(20, 8);
            b.visible = false;
            const row = new Row({ children: [a, b] });
            const size = row.measure(UNCONSTRAINED);
            expect(size.width).toBe(10);
            expect(size.height).toBe(5);
        });
    });
    describe("arrange", () => {
        it("children laid out left-to-right", () => {
            const a = new TestControl(10, 5);
            const b = new TestControl(20, 5);
            const c = new TestControl(15, 5);
            const row = new Row({ children: [a, b, c] });
            row.measure(UNCONSTRAINED);
            row.arrange({ x: 0, y: 0, width: 45, height: 10 });
            expect(a.bounds.x).toBe(0);
            expect(a.bounds.width).toBe(10);
            expect(b.bounds.x).toBe(10);
            expect(b.bounds.width).toBe(20);
            expect(c.bounds.x).toBe(30);
            expect(c.bounds.width).toBe(15);
        });
        it("gap spacing between children", () => {
            const a = new TestControl(10, 5);
            const b = new TestControl(20, 5);
            const row = new Row({ children: [a, b], gap: 3 });
            row.measure(UNCONSTRAINED);
            row.arrange({ x: 0, y: 0, width: 33, height: 10 });
            expect(a.bounds.x).toBe(0);
            expect(a.bounds.width).toBe(10);
            expect(b.bounds.x).toBe(13); // 10 + 3 gap
            expect(b.bounds.width).toBe(20);
        });
        it("children get full height of the row", () => {
            const a = new TestControl(10, 5);
            const b = new TestControl(20, 3);
            const row = new Row({ children: [a, b] });
            row.measure(UNCONSTRAINED);
            row.arrange({ x: 0, y: 0, width: 30, height: 12 });
            expect(a.bounds.height).toBe(12);
            expect(b.bounds.height).toBe(12);
        });
        it("sets own bounds", () => {
            const row = new Row();
            const rect = { x: 5, y: 10, width: 100, height: 50 };
            row.arrange(rect);
            expect(row.bounds).toEqual(rect);
        });
        it("proportionally scales when overflowing", () => {
            const a = new TestControl(60, 5);
            const b = new TestControl(40, 5);
            const row = new Row({ children: [a, b] });
            row.measure(UNCONSTRAINED);
            // Only 50 available, but children want 100
            row.arrange({ x: 0, y: 0, width: 50, height: 10 });
            // a wants 60% of 100, gets 60% of 50 = 30
            expect(a.bounds.width).toBe(30);
            // b wants 40% of 100, gets 40% of 50 = 20
            expect(b.bounds.width).toBe(20);
        });
    });
});
// ═══════════════════════════════════════════════════════════════════════
// Column
// ═══════════════════════════════════════════════════════════════════════
describe("Column", () => {
    describe("measure", () => {
        it("max width, sum of children heights", () => {
            const a = new TestControl(10, 5);
            const b = new TestControl(20, 8);
            const c = new TestControl(15, 3);
            const col = new Column({ children: [a, b, c] });
            const size = col.measure(UNCONSTRAINED);
            expect(size.width).toBe(20); // max(10, 20, 15)
            expect(size.height).toBe(16); // 5 + 8 + 3
        });
        it("no children returns zero", () => {
            const col = new Column();
            const size = col.measure(UNCONSTRAINED);
            expect(size.width).toBe(0);
            expect(size.height).toBe(0);
        });
        it("gap spacing included in height", () => {
            const a = new TestControl(10, 5);
            const b = new TestControl(10, 8);
            const c = new TestControl(10, 3);
            const col = new Column({ children: [a, b, c], gap: 2 });
            const size = col.measure(UNCONSTRAINED);
            // 5 + 8 + 3 + 2 * 2(gaps) = 20
            expect(size.height).toBe(20);
        });
        it("invisible children are ignored", () => {
            const a = new TestControl(10, 5);
            const b = new TestControl(20, 8);
            b.visible = false;
            const col = new Column({ children: [a, b] });
            const size = col.measure(UNCONSTRAINED);
            expect(size.width).toBe(10);
            expect(size.height).toBe(5);
        });
    });
    describe("arrange", () => {
        it("children laid out top-to-bottom", () => {
            const a = new TestControl(10, 5);
            const b = new TestControl(10, 8);
            const c = new TestControl(10, 3);
            const col = new Column({ children: [a, b, c] });
            col.measure(UNCONSTRAINED);
            col.arrange({ x: 0, y: 0, width: 20, height: 16 });
            expect(a.bounds.y).toBe(0);
            expect(a.bounds.height).toBe(5);
            expect(b.bounds.y).toBe(5);
            expect(b.bounds.height).toBe(8);
            expect(c.bounds.y).toBe(13);
            expect(c.bounds.height).toBe(3);
        });
        it("gap spacing between children", () => {
            const a = new TestControl(10, 5);
            const b = new TestControl(10, 8);
            const col = new Column({ children: [a, b], gap: 3 });
            col.measure(UNCONSTRAINED);
            col.arrange({ x: 0, y: 0, width: 20, height: 16 });
            expect(a.bounds.y).toBe(0);
            expect(a.bounds.height).toBe(5);
            expect(b.bounds.y).toBe(8); // 5 + 3 gap
            expect(b.bounds.height).toBe(8);
        });
        it("children get full width of the column", () => {
            const a = new TestControl(5, 10);
            const b = new TestControl(3, 10);
            const col = new Column({ children: [a, b] });
            col.measure(UNCONSTRAINED);
            col.arrange({ x: 0, y: 0, width: 30, height: 20 });
            expect(a.bounds.width).toBe(30);
            expect(b.bounds.width).toBe(30);
        });
        it("sets own bounds", () => {
            const col = new Column();
            const rect = { x: 5, y: 10, width: 100, height: 50 };
            col.arrange(rect);
            expect(col.bounds).toEqual(rect);
        });
        it("proportionally scales when overflowing", () => {
            const a = new TestControl(10, 60);
            const b = new TestControl(10, 40);
            const col = new Column({ children: [a, b] });
            col.measure(UNCONSTRAINED);
            // Only 50 available, but children want 100
            col.arrange({ x: 0, y: 0, width: 20, height: 50 });
            expect(a.bounds.height).toBe(30); // 60/100 * 50
            expect(b.bounds.height).toBe(20); // 40/100 * 50
        });
    });
});
// ═══════════════════════════════════════════════════════════════════════
// Stack
// ═══════════════════════════════════════════════════════════════════════
describe("Stack", () => {
    describe("measure", () => {
        it("max width, max height of all children", () => {
            const a = new TestControl(10, 5);
            const b = new TestControl(20, 8);
            const c = new TestControl(15, 3);
            const stack = new Stack({ children: [a, b, c] });
            const size = stack.measure(UNCONSTRAINED);
            expect(size.width).toBe(20); // max(10, 20, 15)
            expect(size.height).toBe(8); // max(5, 8, 3)
        });
        it("no children returns zero", () => {
            const stack = new Stack();
            const size = stack.measure(UNCONSTRAINED);
            expect(size.width).toBe(0);
            expect(size.height).toBe(0);
        });
        it("invisible children are ignored", () => {
            const a = new TestControl(10, 5);
            const b = new TestControl(20, 8);
            b.visible = false;
            const stack = new Stack({ children: [a, b] });
            const size = stack.measure(UNCONSTRAINED);
            expect(size.width).toBe(10);
            expect(size.height).toBe(5);
        });
        it("respects constraints", () => {
            const a = new TestControl(100, 100);
            const stack = new Stack({ children: [a] });
            const size = stack.measure(maxConstraint(30, 20));
            expect(size.width).toBeLessThanOrEqual(30);
            expect(size.height).toBeLessThanOrEqual(20);
        });
    });
    describe("arrange", () => {
        it("all children get full rect", () => {
            const a = new TestControl(10, 5);
            const b = new TestControl(20, 8);
            const c = new TestControl(15, 3);
            const stack = new Stack({ children: [a, b, c] });
            stack.measure(UNCONSTRAINED);
            stack.arrange({ x: 0, y: 0, width: 50, height: 40 });
            for (const child of [a, b, c]) {
                expect(child.bounds).toEqual({
                    x: 0,
                    y: 0,
                    width: 50,
                    height: 40,
                });
            }
        });
        it("invisible children are skipped in arrange", () => {
            const a = new TestControl(10, 5);
            const b = new TestControl(20, 8);
            b.visible = false;
            const stack = new Stack({ children: [a, b] });
            stack.measure(UNCONSTRAINED);
            stack.arrange({ x: 0, y: 0, width: 50, height: 40 });
            expect(a.bounds).toEqual({ x: 0, y: 0, width: 50, height: 40 });
            // b is invisible, so its bounds should remain at default
            expect(b.bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
        });
        it("sets own bounds", () => {
            const stack = new Stack();
            const rect = { x: 5, y: 10, width: 100, height: 50 };
            stack.arrange(rect);
            expect(stack.bounds).toEqual(rect);
        });
    });
});
