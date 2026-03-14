/**
 * Comprehensive unit tests for Phase 7 widgets:
 * Text, Border, Panel, TextInput, ScrollView
 */

import { describe, it, expect, vi } from "vitest";
import { Text } from "../widgets/text.js";
import { Border } from "../widgets/border.js";
import { Panel } from "../widgets/panel.js";
import { TextInput } from "../widgets/text-input.js";
import { ScrollView } from "../widgets/scroll-view.js";
import { PixelBuffer } from "../pixel/buffer.js";
import { DrawingContext } from "../drawing/context.js";
import { keyEvent, pasteEvent, mouseEvent } from "../input/events.js";
import type { Constraint, Rect } from "../layout/types.js";
import { color, TRANSPARENT, WHITE, RED, BLUE } from "../pixel/color.js";

// ── Helpers ──────────────────────────────────────────────────────────

/** Create an unconstrained constraint (large max). */
function unconstrainedConstraint(
  maxWidth = 80,
  maxHeight = 24,
): Constraint {
  return { minWidth: 0, minHeight: 0, maxWidth, maxHeight };
}

/** Create a PixelBuffer and DrawingContext for rendering tests. */
function createRenderTarget(width = 40, height = 10) {
  const buffer = new PixelBuffer(width, height);
  const ctx = new DrawingContext(buffer);
  return { buffer, ctx };
}

/** Helper: measure a control and arrange it at (0,0) with its desired size. */
function layoutControl(
  ctrl: { measure(c: Constraint): any; arrange(r: Rect): void; desiredSize: any },
  maxWidth = 80,
  maxHeight = 24,
) {
  const size = ctrl.measure(unconstrainedConstraint(maxWidth, maxHeight));
  ctrl.desiredSize = size;
  ctrl.arrange({ x: 0, y: 0, width: size.width, height: size.height });
  return size;
}

/** Read the character at (x, y) from the buffer. */
function charAtBuffer(buffer: PixelBuffer, x: number, y: number): string {
  return buffer.get(x, y).foreground.symbol.text;
}

/** Read a row of characters from the buffer as a string. */
function rowText(buffer: PixelBuffer, y: number, x0 = 0, x1?: number): string {
  const end = x1 ?? buffer.width;
  let s = "";
  for (let x = x0; x < end; x++) {
    s += charAtBuffer(buffer, x, y);
  }
  return s;
}

// ══════════════════════════════════════════════════════════════════════
//  TEXT WIDGET
// ══════════════════════════════════════════════════════════════════════

describe("Text widget", () => {
  describe("measure", () => {
    it("returns correct size for single-line text", () => {
      const t = new Text({ text: "Hello" });
      const size = t.measure(unconstrainedConstraint());
      expect(size.width).toBe(5);
      expect(size.height).toBe(1);
    });

    it("returns correct size for multi-line text (split by \\n)", () => {
      const t = new Text({ text: "abc\ndefgh\nij" });
      const size = t.measure(unconstrainedConstraint());
      expect(size.width).toBe(5); // "defgh" is the longest line
      expect(size.height).toBe(3);
    });

    it("returns (0,0) for empty text", () => {
      const t = new Text({ text: "" });
      const size = t.measure(unconstrainedConstraint());
      expect(size.width).toBe(0);
      expect(size.height).toBe(0);
    });

    it("clamps width to maxWidth constraint", () => {
      const t = new Text({ text: "Hello, world!" });
      const size = t.measure(unconstrainedConstraint(5, 24));
      expect(size.width).toBe(5);
    });

    it("clamps height to maxHeight constraint", () => {
      const t = new Text({ text: "a\nb\nc\nd\ne" });
      const size = t.measure(unconstrainedConstraint(80, 3));
      expect(size.height).toBe(3);
    });
  });

  describe("word wrap", () => {
    it("breaks lines at spaces within maxWidth constraint", () => {
      const t = new Text({ text: "hello world foo", wrap: true });
      const size = t.measure(unconstrainedConstraint(10, 24));
      // "hello" (5), "world foo" is 9 which fits in 10
      expect(size.height).toBe(2);
      expect(size.width).toBeLessThanOrEqual(10);
    });

    it("hard-breaks words longer than maxWidth", () => {
      const t = new Text({ text: "abcdefghij", wrap: true });
      const size = t.measure(unconstrainedConstraint(4, 24));
      // "abcdefghij" (10 chars) wrapped at 4: "abcd", "efgh", "ij"
      expect(size.height).toBe(3);
      expect(size.width).toBeLessThanOrEqual(4);
    });

    it("wraps multiple words correctly", () => {
      const t = new Text({ text: "aa bb cc dd", wrap: true });
      const size = t.measure(unconstrainedConstraint(5, 24));
      // "aa bb" fits in 5, "cc dd" fits in 5
      expect(size.height).toBe(2);
    });

    it("preserves explicit newlines during wrapping", () => {
      const t = new Text({ text: "ab\ncd", wrap: true });
      const size = t.measure(unconstrainedConstraint(10, 24));
      expect(size.height).toBe(2);
    });

    it("returns 0 size when maxWidth is 0", () => {
      const t = new Text({ text: "hello", wrap: true });
      const size = t.measure(unconstrainedConstraint(0, 24));
      expect(size.width).toBe(0);
      expect(size.height).toBe(0);
    });
  });

  describe("alignment", () => {
    it("left (default) aligns text at x=0 offset", () => {
      const t = new Text({ text: "Hi", align: "left" });
      const size = t.measure(unconstrainedConstraint());
      t.arrange({ x: 0, y: 0, width: 10, height: 1 });

      const { buffer, ctx } = createRenderTarget(10, 1);
      t.render(ctx);

      expect(charAtBuffer(buffer, 0, 0)).toBe("H");
      expect(charAtBuffer(buffer, 1, 0)).toBe("i");
    });

    it("center aligns text in the middle of available width", () => {
      const t = new Text({ text: "Hi", align: "center" });
      t.measure(unconstrainedConstraint());
      t.arrange({ x: 0, y: 0, width: 10, height: 1 });

      const { buffer, ctx } = createRenderTarget(10, 1);
      t.render(ctx);

      // "Hi" is 2 chars in 10 width => offset = floor((10 - 2) / 2) = 4
      expect(charAtBuffer(buffer, 4, 0)).toBe("H");
      expect(charAtBuffer(buffer, 5, 0)).toBe("i");
    });

    it("right aligns text at the end of available width", () => {
      const t = new Text({ text: "Hi", align: "right" });
      t.measure(unconstrainedConstraint());
      t.arrange({ x: 0, y: 0, width: 10, height: 1 });

      const { buffer, ctx } = createRenderTarget(10, 1);
      t.render(ctx);

      // "Hi" is 2 chars in 10 width => offset = 10 - 2 = 8
      expect(charAtBuffer(buffer, 8, 0)).toBe("H");
      expect(charAtBuffer(buffer, 9, 0)).toBe("i");
    });
  });

  describe("invalidation", () => {
    it("setting text property triggers invalidate (dirty becomes true)", () => {
      const t = new Text({ text: "old" });
      t.dirty = false; // reset dirty
      t.text = "new";
      expect(t.dirty).toBe(true);
    });

    it("does not invalidate if text is set to the same value", () => {
      const t = new Text({ text: "same" });
      t.dirty = false;
      t.text = "same";
      expect(t.dirty).toBe(false);
    });

    it("setting wrap triggers invalidate", () => {
      const t = new Text({ text: "hi" });
      t.dirty = false;
      t.wrap = true;
      expect(t.dirty).toBe(true);
    });

    it("setting align triggers invalidate", () => {
      const t = new Text({ text: "hi" });
      t.dirty = false;
      t.align = "center";
      expect(t.dirty).toBe(true);
    });

    it("setting style triggers invalidate", () => {
      const t = new Text({ text: "hi" });
      t.dirty = false;
      t.style = { bold: true };
      expect(t.dirty).toBe(true);
    });
  });

  describe("render", () => {
    it("draws text at correct position in buffer", () => {
      const t = new Text({ text: "ABC" });
      t.measure(unconstrainedConstraint());
      t.arrange({ x: 2, y: 3, width: 3, height: 1 });

      const { buffer, ctx } = createRenderTarget(10, 10);
      t.render(ctx);

      expect(charAtBuffer(buffer, 2, 3)).toBe("A");
      expect(charAtBuffer(buffer, 3, 3)).toBe("B");
      expect(charAtBuffer(buffer, 4, 3)).toBe("C");
      // Other positions should remain space
      expect(charAtBuffer(buffer, 1, 3)).toBe(" ");
      expect(charAtBuffer(buffer, 5, 3)).toBe(" ");
    });

    it("renders multi-line text on consecutive rows", () => {
      const t = new Text({ text: "AB\nCD" });
      t.measure(unconstrainedConstraint());
      t.arrange({ x: 0, y: 0, width: 2, height: 2 });

      const { buffer, ctx } = createRenderTarget(10, 10);
      t.render(ctx);

      expect(charAtBuffer(buffer, 0, 0)).toBe("A");
      expect(charAtBuffer(buffer, 1, 0)).toBe("B");
      expect(charAtBuffer(buffer, 0, 1)).toBe("C");
      expect(charAtBuffer(buffer, 1, 1)).toBe("D");
    });

    it("does not render if bounds are not set (null check)", () => {
      const t = new Text({ text: "test" });
      // Don't call measure/arrange — bounds remains default {0,0,0,0}
      // but we override bounds to ensure the check
      (t as any).bounds = undefined;
      const { buffer, ctx } = createRenderTarget(10, 1);
      // Should not throw
      t.render(ctx);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════
//  BORDER WIDGET
// ══════════════════════════════════════════════════════════════════════

describe("Border widget", () => {
  describe("measure", () => {
    it("adds 2 to child size (1 cell border on each side)", () => {
      const child = new Text({ text: "Hi" });
      child.desiredSize = { width: 2, height: 1 };
      const border = new Border({ child });

      const size = border.measure(unconstrainedConstraint());
      expect(size.width).toBe(4); // 2 + 2
      expect(size.height).toBe(3); // 1 + 2
    });

    it("returns 2x2 with no child (just corners)", () => {
      const border = new Border();
      const size = border.measure(unconstrainedConstraint());
      expect(size.width).toBe(2);
      expect(size.height).toBe(2);
    });
  });

  describe("arrange", () => {
    it("gives child the inner rect (inset by 1)", () => {
      const child = new Text({ text: "X" });
      const border = new Border({ child });

      border.arrange({ x: 5, y: 3, width: 10, height: 8 });

      expect(child.bounds).toEqual({
        x: 6,
        y: 4,
        width: 8,
        height: 6,
      });
    });

    it("child rect width/height never go negative", () => {
      const child = new Text({ text: "X" });
      const border = new Border({ child });

      border.arrange({ x: 0, y: 0, width: 1, height: 1 });

      expect(child.bounds.width).toBe(0);
      expect(child.bounds.height).toBe(0);
    });
  });

  describe("render", () => {
    it("draws box-drawing characters at edges", () => {
      const border = new Border();
      border.arrange({ x: 0, y: 0, width: 5, height: 3 });
      border.bounds = { x: 0, y: 0, width: 5, height: 3 };

      const { buffer, ctx } = createRenderTarget(10, 5);
      border.render(ctx);

      // Corners should be box-drawing characters (not spaces)
      const topLeft = charAtBuffer(buffer, 0, 0);
      const topRight = charAtBuffer(buffer, 4, 0);
      const botLeft = charAtBuffer(buffer, 0, 2);
      const botRight = charAtBuffer(buffer, 4, 2);

      // These should be box-drawing chars, not regular spaces
      expect(topLeft).not.toBe(" ");
      expect(topRight).not.toBe(" ");
      expect(botLeft).not.toBe(" ");
      expect(botRight).not.toBe(" ");

      // Top edge (between corners) should be horizontal box char
      const topEdge = charAtBuffer(buffer, 2, 0);
      expect(topEdge).not.toBe(" ");

      // Left edge (between corners) should be vertical box char
      const leftEdge = charAtBuffer(buffer, 0, 1);
      expect(leftEdge).not.toBe(" ");
    });

    it("renders title in top border", () => {
      const border = new Border({ title: "Test" });
      border.arrange({ x: 0, y: 0, width: 20, height: 5 });
      border.bounds = { x: 0, y: 0, width: 20, height: 5 };

      const { buffer, ctx } = createRenderTarget(20, 5);
      border.render(ctx);

      // Title "Test" should appear in the top border row.
      // Format is: corner, edge, then "┤ Test ├" starting at x=2
      // So at x=2 we get "┤", x=3 " ", x=4..7 "Test", x=8 " ", x=9 "├"
      const row0 = rowText(buffer, 0, 0, 20);
      expect(row0).toContain("Test");
    });

    it("renders empty bordered box with no child", () => {
      const border = new Border();
      border.bounds = { x: 0, y: 0, width: 4, height: 3 };

      const { buffer, ctx } = createRenderTarget(10, 5);
      border.render(ctx);

      // Interior (1,1) and (2,1) should still be space
      expect(charAtBuffer(buffer, 1, 1)).toBe(" ");
      expect(charAtBuffer(buffer, 2, 1)).toBe(" ");

      // But border edges should be drawn
      expect(charAtBuffer(buffer, 0, 0)).not.toBe(" ");
    });

    it("does not render title if box is too small", () => {
      const border = new Border({ title: "VeryLongTitle" });
      border.bounds = { x: 0, y: 0, width: 4, height: 3 };

      const { buffer, ctx } = createRenderTarget(10, 5);
      // Should not throw
      border.render(ctx);
    });
  });

  describe("child management", () => {
    it("setting child removes old child and adds new one", () => {
      const child1 = new Text({ text: "A" });
      const child2 = new Text({ text: "B" });
      const border = new Border({ child: child1 });

      expect(border.children).toContain(child1);

      border.child = child2;
      expect(border.children).not.toContain(child1);
      expect(border.children).toContain(child2);
    });

    it("setting child to null removes existing child", () => {
      const child = new Text({ text: "A" });
      const border = new Border({ child });

      border.child = null;
      expect(border.children.length).toBe(0);
      expect(border.child).toBeNull();
    });
  });
});

// ══════════════════════════════════════════════════════════════════════
//  PANEL WIDGET
// ══════════════════════════════════════════════════════════════════════

describe("Panel widget", () => {
  it("extends Border", () => {
    const panel = new Panel();
    expect(panel).toBeInstanceOf(Border);
  });

  it("has background fill property with default TRANSPARENT", () => {
    const panel = new Panel();
    expect(panel.background).toEqual(TRANSPARENT);
  });

  it("accepts background color in constructor", () => {
    const bg = color(100, 150, 200, 255);
    const panel = new Panel({ background: bg });
    expect(panel.background).toEqual(bg);
  });

  it("render fills interior with background color before drawing border", () => {
    const bg = color(50, 100, 150, 255);
    const panel = new Panel({ background: bg });
    panel.bounds = { x: 0, y: 0, width: 5, height: 3 };

    const { buffer, ctx } = createRenderTarget(10, 5);

    // Spy on fillRect and drawBox order
    const callOrder: string[] = [];
    const origFillRect = ctx.fillRect.bind(ctx);
    const origDrawBox = ctx.drawBox.bind(ctx);
    vi.spyOn(ctx, "fillRect").mockImplementation((...args) => {
      callOrder.push("fillRect");
      return origFillRect(...args);
    });
    vi.spyOn(ctx, "drawBox").mockImplementation((...args) => {
      callOrder.push("drawBox");
      return origDrawBox(...args);
    });

    panel.render(ctx);

    // fillRect should be called before drawBox
    expect(callOrder.indexOf("fillRect")).toBeLessThan(
      callOrder.indexOf("drawBox"),
    );
  });

  it("does not fill if background alpha is 0", () => {
    const panel = new Panel({ background: TRANSPARENT });
    panel.bounds = { x: 0, y: 0, width: 5, height: 3 };

    const { buffer, ctx } = createRenderTarget(10, 5);
    const fillSpy = vi.spyOn(ctx, "fillRect");

    panel.render(ctx);

    expect(fillSpy).not.toHaveBeenCalled();
  });

  it("setting background triggers invalidate", () => {
    const panel = new Panel();
    panel.dirty = false;
    panel.background = color(255, 0, 0, 255);
    expect(panel.dirty).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════
//  TEXTINPUT WIDGET
// ══════════════════════════════════════════════════════════════════════

describe("TextInput widget", () => {
  describe("basic properties", () => {
    it("focusable is true", () => {
      const input = new TextInput();
      expect(input.focusable).toBe(true);
    });

    it("starts with empty value and cursor at 0", () => {
      const input = new TextInput();
      expect(input.value).toBe("");
      expect(input.cursor).toBe(0);
    });

    it("initializes with provided value and cursor at end", () => {
      const input = new TextInput({ value: "hello" });
      expect(input.value).toBe("hello");
      expect(input.cursor).toBe(5);
    });
  });

  describe("handleInput - printable characters", () => {
    it("inserts printable char at cursor", () => {
      const input = new TextInput();
      input.handleInput(keyEvent("a", "a"));
      expect(input.value).toBe("a");
      expect(input.cursor).toBe(1);
    });

    it("inserts at current cursor position (middle of text)", () => {
      const input = new TextInput({ value: "ac" });
      input.cursor = 1;
      input.handleInput(keyEvent("b", "b"));
      expect(input.value).toBe("abc");
      expect(input.cursor).toBe(2);
    });

    it("inserts multiple characters sequentially", () => {
      const input = new TextInput();
      input.handleInput(keyEvent("h", "h"));
      input.handleInput(keyEvent("i", "i"));
      expect(input.value).toBe("hi");
      expect(input.cursor).toBe(2);
    });
  });

  describe("handleInput - backspace", () => {
    it("deletes character before cursor", () => {
      const input = new TextInput({ value: "abc" });
      // cursor starts at 3 (end)
      input.handleInput(keyEvent("backspace"));
      expect(input.value).toBe("ab");
      expect(input.cursor).toBe(2);
    });

    it("does nothing when cursor is at start", () => {
      const input = new TextInput({ value: "abc" });
      input.cursor = 0;
      input.handleInput(keyEvent("backspace"));
      expect(input.value).toBe("abc");
      expect(input.cursor).toBe(0);
    });

    it("deletes from middle of text", () => {
      const input = new TextInput({ value: "abc" });
      input.cursor = 2;
      input.handleInput(keyEvent("backspace"));
      expect(input.value).toBe("ac");
      expect(input.cursor).toBe(1);
    });
  });

  describe("handleInput - delete key", () => {
    it("deletes character at cursor", () => {
      const input = new TextInput({ value: "abc" });
      input.cursor = 0;
      input.handleInput(keyEvent("delete"));
      expect(input.value).toBe("bc");
      expect(input.cursor).toBe(0);
    });

    it("does nothing when cursor is at end", () => {
      const input = new TextInput({ value: "abc" });
      // cursor at 3 (end)
      input.handleInput(keyEvent("delete"));
      expect(input.value).toBe("abc");
      expect(input.cursor).toBe(3);
    });

    it("deletes from middle of text", () => {
      const input = new TextInput({ value: "abc" });
      input.cursor = 1;
      input.handleInput(keyEvent("delete"));
      expect(input.value).toBe("ac");
      expect(input.cursor).toBe(1);
    });
  });

  describe("handleInput - cursor movement", () => {
    it("left arrow moves cursor left", () => {
      const input = new TextInput({ value: "abc" });
      input.handleInput(keyEvent("left"));
      expect(input.cursor).toBe(2);
    });

    it("left arrow does not go below 0", () => {
      const input = new TextInput({ value: "abc" });
      input.cursor = 0;
      input.handleInput(keyEvent("left"));
      expect(input.cursor).toBe(0);
    });

    it("right arrow moves cursor right", () => {
      const input = new TextInput({ value: "abc" });
      input.cursor = 0;
      input.handleInput(keyEvent("right"));
      expect(input.cursor).toBe(1);
    });

    it("right arrow does not go beyond text length", () => {
      const input = new TextInput({ value: "abc" });
      // cursor at 3 (end)
      input.handleInput(keyEvent("right"));
      expect(input.cursor).toBe(3);
    });

    it("home moves cursor to start", () => {
      const input = new TextInput({ value: "abc" });
      input.handleInput(keyEvent("home"));
      expect(input.cursor).toBe(0);
    });

    it("end moves cursor to end", () => {
      const input = new TextInput({ value: "abc" });
      input.cursor = 0;
      input.handleInput(keyEvent("end"));
      expect(input.cursor).toBe(3);
    });
  });

  describe("handleInput - enter (submit)", () => {
    it("emits submit event with current value", () => {
      const input = new TextInput({ value: "hello" });
      const submitted: string[] = [];
      input.on("submit", (val: string) => submitted.push(val));

      input.handleInput(keyEvent("enter"));

      expect(submitted).toEqual(["hello"]);
    });

    it("clears value after submit", () => {
      const input = new TextInput({ value: "hello" });
      input.handleInput(keyEvent("enter"));
      expect(input.value).toBe("");
      expect(input.cursor).toBe(0);
    });

    it("adds non-empty value to history", () => {
      const input = new TextInput();
      input.setValue("cmd1");
      input.handleInput(keyEvent("enter"));
      expect(input.history).toContain("cmd1");
    });

    it("does not add empty value to history", () => {
      const input = new TextInput();
      const initialLen = input.history.length;
      input.handleInput(keyEvent("enter"));
      expect(input.history.length).toBe(initialLen);
    });

    it("does not add duplicate of last history entry", () => {
      const input = new TextInput({ history: ["cmd1"] });
      input.setValue("cmd1");
      input.handleInput(keyEvent("enter"));
      expect(input.history.length).toBe(1);
    });
  });

  describe("handleInput - escape (cancel)", () => {
    it("emits cancel event", () => {
      const input = new TextInput();
      let cancelled = false;
      input.on("cancel", () => {
        cancelled = true;
      });

      input.handleInput(keyEvent("escape"));
      expect(cancelled).toBe(true);
    });
  });

  describe("handleInput - ctrl+u (clear line)", () => {
    it("clears text before cursor", () => {
      const input = new TextInput({ value: "abcdef" });
      // cursor at 6 (end)
      input.handleInput(keyEvent("u", "", false, true));
      expect(input.value).toBe("");
      expect(input.cursor).toBe(0);
    });

    it("clears only text before cursor when cursor is in middle", () => {
      const input = new TextInput({ value: "abcdef" });
      input.cursor = 3; // cursor at "d"
      input.handleInput(keyEvent("u", "", false, true));
      expect(input.value).toBe("def");
      expect(input.cursor).toBe(0);
    });
  });

  describe("history navigation", () => {
    it("up arrow navigates to most recent history entry", () => {
      const input = new TextInput({ history: ["first", "second", "third"] });
      input.handleInput(keyEvent("up"));
      expect(input.value).toBe("third");
    });

    it("multiple up arrows navigate backwards through history", () => {
      const input = new TextInput({ history: ["first", "second", "third"] });
      input.handleInput(keyEvent("up")); // third
      input.handleInput(keyEvent("up")); // second
      expect(input.value).toBe("second");
      input.handleInput(keyEvent("up")); // first
      expect(input.value).toBe("first");
    });

    it("up arrow at oldest entry stays at oldest", () => {
      const input = new TextInput({ history: ["first", "second"] });
      input.handleInput(keyEvent("up")); // second
      input.handleInput(keyEvent("up")); // first
      input.handleInput(keyEvent("up")); // still first
      expect(input.value).toBe("first");
    });

    it("down arrow after up restores to later entries", () => {
      const input = new TextInput({ history: ["first", "second", "third"] });
      input.handleInput(keyEvent("up")); // third
      input.handleInput(keyEvent("up")); // second
      input.handleInput(keyEvent("down")); // third
      expect(input.value).toBe("third");
    });

    it("down arrow past newest restores saved input", () => {
      const input = new TextInput({ history: ["first", "second"] });
      input.setValue("current");
      input.handleInput(keyEvent("up")); // second (saves "current")
      input.handleInput(keyEvent("down")); // restores "current"
      expect(input.value).toBe("current");
    });

    it("up arrow with no history does nothing", () => {
      const input = new TextInput({ value: "test" });
      input.handleInput(keyEvent("up"));
      expect(input.value).toBe("test");
    });

    it("cursor moves to end after history navigation", () => {
      const input = new TextInput({ history: ["longcommand"] });
      input.handleInput(keyEvent("up"));
      expect(input.cursor).toBe("longcommand".length);
    });
  });

  describe("paste event", () => {
    it("inserts pasted text at cursor", () => {
      const input = new TextInput({ value: "ac" });
      input.cursor = 1;
      input.handleInput(pasteEvent("bb"));
      expect(input.value).toBe("abbc");
      expect(input.cursor).toBe(3);
    });

    it("strips newlines from pasted text", () => {
      const input = new TextInput();
      input.handleInput(pasteEvent("line1\nline2\rline3"));
      expect(input.value).toBe("line1line2line3");
    });

    it("emits paste event", () => {
      const input = new TextInput();
      let pasted = "";
      input.on("paste", (text: string) => {
        pasted = text;
      });
      input.handleInput(pasteEvent("data"));
      expect(pasted).toBe("data");
    });

    it("handles empty paste (no change)", () => {
      const input = new TextInput({ value: "test" });
      input.handleInput(pasteEvent(""));
      expect(input.value).toBe("test");
    });
  });

  describe("clear()", () => {
    it("resets value and cursor", () => {
      const input = new TextInput({ value: "hello" });
      input.clear();
      expect(input.value).toBe("");
      expect(input.cursor).toBe(0);
    });

    it("emits change event", () => {
      const input = new TextInput({ value: "hello" });
      let changed = false;
      input.on("change", () => {
        changed = true;
      });
      input.clear();
      expect(changed).toBe(true);
    });
  });

  describe("setValue()", () => {
    it("sets value and moves cursor to end", () => {
      const input = new TextInput();
      input.setValue("world");
      expect(input.value).toBe("world");
      expect(input.cursor).toBe(5);
    });

    it("emits change event", () => {
      const input = new TextInput();
      let changedValue = "";
      input.on("change", (v: string) => {
        changedValue = v;
      });
      input.setValue("test");
      expect(changedValue).toBe("test");
    });
  });

  describe("cursor position validation", () => {
    it("cursor stays valid after backspace at end", () => {
      const input = new TextInput({ value: "ab" });
      input.handleInput(keyEvent("backspace"));
      expect(input.cursor).toBeLessThanOrEqual(input.value.length);
      expect(input.cursor).toBeGreaterThanOrEqual(0);
    });

    it("cursor is clamped when value is set shorter", () => {
      const input = new TextInput({ value: "abcdef" });
      // cursor at 6
      input.value = "ab";
      expect(input.cursor).toBeLessThanOrEqual(2);
    });

    it("cursor setter clamps to valid range", () => {
      const input = new TextInput({ value: "abc" });
      input.cursor = 100;
      expect(input.cursor).toBe(3);
      input.cursor = -5;
      expect(input.cursor).toBe(0);
    });
  });

  describe("measure", () => {
    it("always returns height 1", () => {
      const input = new TextInput();
      const size = input.measure(unconstrainedConstraint(50, 10));
      expect(size.height).toBe(1);
    });

    it("takes full available width", () => {
      const input = new TextInput();
      const size = input.measure(unconstrainedConstraint(50, 10));
      expect(size.width).toBe(50);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════
//  SCROLLVIEW WIDGET
// ══════════════════════════════════════════════════════════════════════

describe("ScrollView widget", () => {
  /** Create a dummy child with a known desiredSize. */
  function makeTallChild(height: number, width = 20): Text {
    // Create lines of text to get the desired height
    const lines = Array.from({ length: height }, (_, i) => `line ${i}`);
    const child = new Text({ text: lines.join("\n") });
    child.desiredSize = { width, height };
    return child;
  }

  /**
   * Helper: set up a ScrollView with proper bounds.
   * ScrollView.arrange() does not call super.arrange(), so we need
   * to explicitly set bounds on the ScrollView itself.
   */
  function setupScrollView(
    child: Text,
    maxHeight: number,
    width = 20,
  ): ScrollView {
    const sv = new ScrollView({ child, maxHeight });
    sv.measure(unconstrainedConstraint());
    const rect = { x: 0, y: 0, width, height: maxHeight };
    sv.bounds = rect;
    sv.arrange(rect);
    return sv;
  }

  describe("measure", () => {
    it("clamps height to maxHeight", () => {
      const child = makeTallChild(50);
      const sv = new ScrollView({ child, maxHeight: 10 });

      const size = sv.measure(unconstrainedConstraint(80, 100));
      expect(size.height).toBe(10);
    });

    it("uses child height if less than maxHeight", () => {
      const child = makeTallChild(5, 10);
      const sv = new ScrollView({ child, maxHeight: 20 });

      const size = sv.measure(unconstrainedConstraint(80, 100));
      expect(size.height).toBe(5);
    });

    it("clamps height to constraint maxHeight", () => {
      const child = makeTallChild(50, 10);
      const sv = new ScrollView({ child, maxHeight: 100 });

      const size = sv.measure(unconstrainedConstraint(80, 15));
      expect(size.height).toBe(15);
    });

    it("returns (0,0) with no child", () => {
      const sv = new ScrollView();
      const size = sv.measure(unconstrainedConstraint());
      expect(size.width).toBe(0);
      expect(size.height).toBe(0);
    });
  });

  describe("scrollOffset", () => {
    it("starts at 0", () => {
      const sv = new ScrollView();
      expect(sv.scrollOffset).toBe(0);
    });

    it("can be set via the setter", () => {
      const child = makeTallChild(50);
      const sv = new ScrollView({ child, maxHeight: 10 });
      sv.measure(unconstrainedConstraint());
      sv.arrange({ x: 0, y: 0, width: 20, height: 10 });

      sv.scrollOffset = 5;
      expect(sv.scrollOffset).toBe(5);
    });

    it("clamping prevents negative offset", () => {
      const child = makeTallChild(50);
      const sv = new ScrollView({ child, maxHeight: 10 });
      sv.measure(unconstrainedConstraint());
      sv.arrange({ x: 0, y: 0, width: 20, height: 10 });

      sv.scrollOffset = -5;
      expect(sv.scrollOffset).toBe(0);
    });
  });

  describe("wheel events", () => {
    it("wheeldown increases scrollOffset", () => {
      const sv = setupScrollView(makeTallChild(50), 10);

      const handled = sv.handleInput(
        mouseEvent(0, 0, "none", "wheeldown"),
      );
      expect(handled).toBe(true);
      expect(sv.scrollOffset).toBe(3);
    });

    it("wheelup decreases scrollOffset", () => {
      const sv = setupScrollView(makeTallChild(50), 10);

      sv.scrollOffset = 10;
      sv.handleInput(mouseEvent(0, 0, "none", "wheelup"));
      expect(sv.scrollOffset).toBe(7);
    });

    it("wheelup does not go below 0", () => {
      const sv = setupScrollView(makeTallChild(50), 10);

      sv.scrollOffset = 1;
      sv.handleInput(mouseEvent(0, 0, "none", "wheelup"));
      expect(sv.scrollOffset).toBe(0);
    });
  });

  describe("scrollTo", () => {
    it("scrolls down to make a y position visible", () => {
      const sv = setupScrollView(makeTallChild(50), 10);

      sv.scrollTo(15);
      // y=15 should now be visible; scrollOffset should be 15 - 10 + 1 = 6
      expect(sv.scrollOffset).toBe(6);
    });

    it("scrolls up to make a y position visible", () => {
      const sv = setupScrollView(makeTallChild(50), 10);

      sv.scrollOffset = 20;
      sv.scrollTo(5);
      expect(sv.scrollOffset).toBe(5);
    });

    it("does not change offset if position already visible", () => {
      const sv = setupScrollView(makeTallChild(50), 10);

      sv.scrollOffset = 5;
      sv.scrollTo(7); // 7 is within [5, 15) range
      expect(sv.scrollOffset).toBe(5);
    });
  });

  describe("contentHeight", () => {
    it("returns child's full height after measure", () => {
      const child = makeTallChild(42);
      const sv = new ScrollView({ child, maxHeight: 10 });
      sv.measure(unconstrainedConstraint());
      expect(sv.contentHeight).toBe(42);
    });

    it("returns 0 with no child", () => {
      const sv = new ScrollView();
      sv.measure(unconstrainedConstraint());
      expect(sv.contentHeight).toBe(0);
    });
  });

  describe("visibleRange", () => {
    it("returns correct top/bottom", () => {
      const sv = setupScrollView(makeTallChild(50), 10);

      sv.scrollOffset = 5;
      const range = sv.visibleRange;
      expect(range.top).toBe(5);
      expect(range.bottom).toBe(15); // 5 + 10
    });

    it("starts at 0 initially", () => {
      const sv = setupScrollView(makeTallChild(50), 10);

      const range = sv.visibleRange;
      expect(range.top).toBe(0);
      expect(range.bottom).toBe(10);
    });
  });

  describe("arrange", () => {
    it("gives child its full content height", () => {
      const child = makeTallChild(50, 20);
      const sv = setupScrollView(child, 10);

      expect(child.bounds.height).toBe(50);
      expect(child.bounds.width).toBe(20);
    });

    it("offsets child y by negative scrollOffset", () => {
      const child = makeTallChild(50, 20);
      const sv = new ScrollView({ child, maxHeight: 10 });
      sv.measure(unconstrainedConstraint());
      sv.bounds = { x: 0, y: 0, width: 20, height: 10 };
      sv.scrollOffset = 5;
      sv.arrange({ x: 0, y: 0, width: 20, height: 10 });

      expect(child.bounds.y).toBe(-5);
    });
  });

  describe("child management", () => {
    it("setting child resets scrollOffset to 0", () => {
      const sv = setupScrollView(makeTallChild(50), 10);
      sv.scrollOffset = 15;

      const child2 = makeTallChild(30);
      sv.child = child2;
      expect(sv.scrollOffset).toBe(0);
    });

    it("setting child to null clears children list", () => {
      const child = makeTallChild(20);
      const sv = new ScrollView({ child });
      sv.child = null;
      expect(sv.children.length).toBe(0);
    });
  });

  describe("keyboard scrolling", () => {
    it("down arrow scrolls down by 1", () => {
      const sv = setupScrollView(makeTallChild(50), 10);

      sv.handleInput(keyEvent("down"));
      expect(sv.scrollOffset).toBe(1);
    });

    it("up arrow scrolls up by 1", () => {
      const sv = setupScrollView(makeTallChild(50), 10);

      sv.scrollOffset = 5;
      sv.handleInput(keyEvent("up"));
      expect(sv.scrollOffset).toBe(4);
    });

    it("pagedown scrolls by visible height", () => {
      const sv = setupScrollView(makeTallChild(50), 10);

      sv.handleInput(keyEvent("pagedown"));
      expect(sv.scrollOffset).toBe(10);
    });

    it("pageup scrolls up by visible height", () => {
      const sv = setupScrollView(makeTallChild(50), 10);

      sv.scrollOffset = 20;
      sv.handleInput(keyEvent("pageup"));
      expect(sv.scrollOffset).toBe(10);
    });
  });

  describe("render", () => {
    it("renders without errors", () => {
      const child = new Text({ text: "Hello\nWorld" });
      child.desiredSize = { width: 5, height: 2 };
      const sv = new ScrollView({ child, maxHeight: 5 });
      sv.measure(unconstrainedConstraint());
      sv.arrange({ x: 0, y: 0, width: 20, height: 2 });
      sv.bounds = { x: 0, y: 0, width: 20, height: 2 };

      const { buffer, ctx } = createRenderTarget(20, 5);
      // Should not throw
      sv.render(ctx);
    });

    it("does not render without bounds", () => {
      const child = new Text({ text: "Hi" });
      child.desiredSize = { width: 2, height: 1 };
      const sv = new ScrollView({ child });
      (sv as any).bounds = undefined;

      const { ctx } = createRenderTarget(10, 5);
      // Should not throw
      sv.render(ctx);
    });
  });
});
