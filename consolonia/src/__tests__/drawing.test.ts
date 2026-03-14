/**
 * Tests for Phase 5: Drawing Context (ClipStack + DrawingContext).
 */

import { describe, it, expect } from "vitest";
import { ClipStack } from "../drawing/clip.js";
import { DrawingContext } from "../drawing/context.js";
import { PixelBuffer } from "../pixel/buffer.js";
import { WHITE, RED, GREEN, BLUE, BLACK } from "../pixel/color.js";
import type { Rect } from "../layout/types.js";
import { UP, RIGHT, DOWN, LEFT, BOX_CHARS } from "../pixel/box-pattern.js";

// ── Helpers ──────────────────────────────────────────────────────────

/** Read the character text at (x, y) from a buffer. */
function charAt(buf: PixelBuffer, x: number, y: number): string {
  return buf.get(x, y).foreground.symbol.text;
}

/** Read the box pattern at (x, y) from a buffer. */
function patternAt(buf: PixelBuffer, x: number, y: number): number {
  return buf.get(x, y).foreground.symbol.pattern;
}

/** Read the background color at (x, y). */
function bgAt(buf: PixelBuffer, x: number, y: number) {
  return buf.get(x, y).background.color;
}

/** Read the foreground color at (x, y). */
function fgAt(buf: PixelBuffer, x: number, y: number) {
  return buf.get(x, y).foreground.color;
}

// ═══════════════════════════════════════════════════════════════════════
// ClipStack
// ═══════════════════════════════════════════════════════════════════════

describe("ClipStack", () => {
  it("empty stack: contains() returns true for any point", () => {
    const cs = new ClipStack();
    expect(cs.contains(0, 0)).toBe(true);
    expect(cs.contains(100, 200)).toBe(true);
    expect(cs.contains(-5, -10)).toBe(true);
  });

  it("single push: only points inside the rect pass", () => {
    const cs = new ClipStack();
    cs.push({ x: 2, y: 3, width: 5, height: 4 });

    // Inside
    expect(cs.contains(2, 3)).toBe(true);
    expect(cs.contains(6, 6)).toBe(true);  // x=6 < 2+5=7, y=6 < 3+4=7

    // On exclusive boundary (right/bottom edge)
    expect(cs.contains(7, 3)).toBe(false);
    expect(cs.contains(2, 7)).toBe(false);

    // Outside
    expect(cs.contains(1, 3)).toBe(false);
    expect(cs.contains(2, 2)).toBe(false);
    expect(cs.contains(10, 10)).toBe(false);
  });

  it("nested push: intersection narrows the visible area", () => {
    const cs = new ClipStack();
    cs.push({ x: 0, y: 0, width: 10, height: 10 });
    cs.push({ x: 5, y: 5, width: 10, height: 10 });

    // Intersection is { x: 5, y: 5, width: 5, height: 5 }
    expect(cs.contains(5, 5)).toBe(true);
    expect(cs.contains(9, 9)).toBe(true);

    // In the first rect but not the intersection
    expect(cs.contains(0, 0)).toBe(false);
    expect(cs.contains(4, 4)).toBe(false);

    // In the second rect but not the intersection
    expect(cs.contains(10, 10)).toBe(false);
  });

  it("pop restores previous clip", () => {
    const cs = new ClipStack();
    cs.push({ x: 0, y: 0, width: 10, height: 10 });
    cs.push({ x: 5, y: 5, width: 10, height: 10 });

    // After nested push, (0,0) is clipped
    expect(cs.contains(0, 0)).toBe(false);

    cs.pop();

    // After pop, we're back to the first clip: (0,0) is visible
    expect(cs.contains(0, 0)).toBe(true);
    expect(cs.contains(9, 9)).toBe(true);

    cs.pop();

    // After popping all, everything is visible
    expect(cs.contains(0, 0)).toBe(true);
    expect(cs.contains(100, 100)).toBe(true);
  });

  it("pop on empty stack throws", () => {
    const cs = new ClipStack();
    expect(() => cs.pop()).toThrow("ClipStack underflow");
  });

  it("degenerate (zero area) clip rejects everything", () => {
    const cs = new ClipStack();
    // Push a non-overlapping rect pair to get a null intersection
    cs.push({ x: 0, y: 0, width: 5, height: 5 });
    cs.push({ x: 10, y: 10, width: 5, height: 5 });

    expect(cs.contains(0, 0)).toBe(false);
    expect(cs.contains(3, 3)).toBe(false);
    expect(cs.contains(12, 12)).toBe(false);
    expect(cs.contains(50, 50)).toBe(false);
  });

  it("zero-width rect rejects everything", () => {
    const cs = new ClipStack();
    cs.push({ x: 5, y: 5, width: 0, height: 10 });

    expect(cs.contains(5, 5)).toBe(false);
    expect(cs.contains(5, 10)).toBe(false);
  });

  it("current() returns null when empty, rect when pushed", () => {
    const cs = new ClipStack();
    expect(cs.current()).toBeNull();

    const rect: Rect = { x: 1, y: 2, width: 3, height: 4 };
    cs.push(rect);
    expect(cs.current()).toEqual(rect);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// DrawingContext
// ═══════════════════════════════════════════════════════════════════════

describe("DrawingContext", () => {
  // ── drawChar ───────────────────────────────────────────────────────

  describe("drawChar", () => {
    it("writes character to buffer at correct position", () => {
      const buf = new PixelBuffer(10, 10);
      const ctx = new DrawingContext(buf);

      ctx.drawChar(3, 4, "A", { fg: WHITE });

      expect(charAt(buf, 3, 4)).toBe("A");
      // Adjacent cell should still be default space
      expect(charAt(buf, 2, 4)).toBe(" ");
    });

    it("writes wide character with continuation in next cell", () => {
      const buf = new PixelBuffer(10, 10);
      const ctx = new DrawingContext(buf);

      // CJK character U+4E16 (world) is width 2
      ctx.drawChar(2, 1, "\u4E16", { fg: WHITE });

      expect(charAt(buf, 2, 1)).toBe("\u4E16");
      expect(buf.get(2, 1).foreground.symbol.width).toBe(2);
      // Continuation cell gets empty string
      expect(charAt(buf, 3, 1)).toBe("");
    });

    it("applies foreground color", () => {
      const buf = new PixelBuffer(10, 10);
      const ctx = new DrawingContext(buf);

      ctx.drawChar(0, 0, "X", { fg: RED });

      expect(fgAt(buf, 0, 0)).toEqual(RED);
    });

    it("applies background color", () => {
      const buf = new PixelBuffer(10, 10);
      const ctx = new DrawingContext(buf);

      ctx.drawChar(0, 0, "X", { fg: WHITE, bg: BLUE });

      expect(bgAt(buf, 0, 0)).toEqual(BLUE);
    });

    it("out-of-bounds write is silently ignored", () => {
      const buf = new PixelBuffer(5, 5);
      const ctx = new DrawingContext(buf);

      // Should not throw
      ctx.drawChar(10, 10, "X", { fg: WHITE });
      ctx.drawChar(-1, -1, "Y", { fg: WHITE });
    });
  });

  // ── drawText ──────────────────────────────────────────────────────

  describe("drawText", () => {
    it("writes string advancing by charWidth for each char", () => {
      const buf = new PixelBuffer(20, 5);
      const ctx = new DrawingContext(buf);

      ctx.drawText(1, 0, "Hello", { fg: WHITE });

      expect(charAt(buf, 1, 0)).toBe("H");
      expect(charAt(buf, 2, 0)).toBe("e");
      expect(charAt(buf, 3, 0)).toBe("l");
      expect(charAt(buf, 4, 0)).toBe("l");
      expect(charAt(buf, 5, 0)).toBe("o");
      // Before and after should be untouched
      expect(charAt(buf, 0, 0)).toBe(" ");
      expect(charAt(buf, 6, 0)).toBe(" ");
    });

    it("handles tabs as 4 spaces", () => {
      const buf = new PixelBuffer(20, 5);
      const ctx = new DrawingContext(buf);

      ctx.drawText(0, 0, "A\tB", { fg: WHITE });

      expect(charAt(buf, 0, 0)).toBe("A");
      // Tab = 4 spaces at positions 1,2,3,4
      expect(charAt(buf, 1, 0)).toBe(" ");
      expect(charAt(buf, 2, 0)).toBe(" ");
      expect(charAt(buf, 3, 0)).toBe(" ");
      expect(charAt(buf, 4, 0)).toBe(" ");
      // B at position 5
      expect(charAt(buf, 5, 0)).toBe("B");
    });

    it("handles wide characters in text", () => {
      const buf = new PixelBuffer(20, 5);
      const ctx = new DrawingContext(buf);

      // Mix of ASCII and CJK
      ctx.drawText(0, 0, "A\u4E16B", { fg: WHITE });

      expect(charAt(buf, 0, 0)).toBe("A");
      expect(charAt(buf, 1, 0)).toBe("\u4E16");    // wide char at 1
      expect(charAt(buf, 2, 0)).toBe("");           // continuation
      expect(charAt(buf, 3, 0)).toBe("B");          // B after the 2-wide char
    });

    it("skips control characters", () => {
      const buf = new PixelBuffer(20, 5);
      const ctx = new DrawingContext(buf);

      ctx.drawText(0, 0, "A\x01B", { fg: WHITE });

      expect(charAt(buf, 0, 0)).toBe("A");
      expect(charAt(buf, 1, 0)).toBe("B");
    });
  });

  // ── fillRect ──────────────────────────────────────────────────────

  describe("fillRect", () => {
    it("fills the specified rect with background color", () => {
      const buf = new PixelBuffer(10, 10);
      const ctx = new DrawingContext(buf);

      ctx.fillRect({ x: 2, y: 3, width: 3, height: 2 }, RED);

      // Inside the rect
      expect(bgAt(buf, 2, 3)).toEqual(RED);
      expect(bgAt(buf, 4, 4)).toEqual(RED);

      // Outside
      expect(bgAt(buf, 1, 3).a).toBe(0);   // transparent
      expect(bgAt(buf, 5, 3).a).toBe(0);
      expect(bgAt(buf, 2, 2).a).toBe(0);
      expect(bgAt(buf, 2, 5).a).toBe(0);
    });

    it("fills all cells in the rect", () => {
      const buf = new PixelBuffer(5, 5);
      const ctx = new DrawingContext(buf);

      ctx.fillRect({ x: 0, y: 0, width: 5, height: 5 }, GREEN);

      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 5; x++) {
          expect(bgAt(buf, x, y)).toEqual(GREEN);
        }
      }
    });
  });

  // ── drawBox ───────────────────────────────────────────────────────

  describe("drawBox", () => {
    it("creates box-drawing chars at edges with correct patterns", () => {
      const buf = new PixelBuffer(10, 10);
      const ctx = new DrawingContext(buf);

      ctx.drawBox({ x: 1, y: 1, width: 4, height: 3 });

      // Top-left corner: DOWN | RIGHT
      expect(patternAt(buf, 1, 1)).toBe(DOWN | RIGHT);
      expect(charAt(buf, 1, 1)).toBe(BOX_CHARS[DOWN | RIGHT]);

      // Top-right corner: DOWN | LEFT
      expect(patternAt(buf, 4, 1)).toBe(DOWN | LEFT);
      expect(charAt(buf, 4, 1)).toBe(BOX_CHARS[DOWN | LEFT]);

      // Bottom-left corner: UP | RIGHT
      expect(patternAt(buf, 1, 3)).toBe(UP | RIGHT);

      // Bottom-right corner: UP | LEFT
      expect(patternAt(buf, 4, 3)).toBe(UP | LEFT);

      // Top edge (horizontal): LEFT | RIGHT
      expect(patternAt(buf, 2, 1)).toBe(LEFT | RIGHT);
      expect(patternAt(buf, 3, 1)).toBe(LEFT | RIGHT);

      // Left edge (vertical): UP | DOWN
      expect(patternAt(buf, 1, 2)).toBe(UP | DOWN);

      // Right edge (vertical): UP | DOWN
      expect(patternAt(buf, 4, 2)).toBe(UP | DOWN);
    });

    it("single cell box draws a cross", () => {
      const buf = new PixelBuffer(5, 5);
      const ctx = new DrawingContext(buf);

      ctx.drawBox({ x: 2, y: 2, width: 1, height: 1 });

      expect(patternAt(buf, 2, 2)).toBe(UP | RIGHT | DOWN | LEFT);
    });

    it("single column box draws vertical line", () => {
      const buf = new PixelBuffer(5, 5);
      const ctx = new DrawingContext(buf);

      ctx.drawBox({ x: 1, y: 0, width: 1, height: 3 });

      expect(patternAt(buf, 1, 0)).toBe(DOWN);
      expect(patternAt(buf, 1, 1)).toBe(UP | DOWN);
      expect(patternAt(buf, 1, 2)).toBe(UP);
    });

    it("single row box draws horizontal line", () => {
      const buf = new PixelBuffer(5, 5);
      const ctx = new DrawingContext(buf);

      ctx.drawBox({ x: 0, y: 1, width: 3, height: 1 });

      expect(patternAt(buf, 0, 1)).toBe(RIGHT);
      expect(patternAt(buf, 1, 1)).toBe(LEFT | RIGHT);
      expect(patternAt(buf, 2, 1)).toBe(LEFT);
    });

    it("two adjacent boxes share a junction (T or cross)", () => {
      const buf = new PixelBuffer(10, 10);
      const ctx = new DrawingContext(buf);

      // Two boxes sharing an edge: box1 right edge = box2 left edge
      ctx.drawBox({ x: 0, y: 0, width: 4, height: 3 });
      ctx.drawBox({ x: 3, y: 0, width: 4, height: 3 });

      // Shared top corner (3,0): box1 has DOWN|LEFT, box2 has DOWN|RIGHT -> T junction
      expect(patternAt(buf, 3, 0)).toBe(DOWN | LEFT | RIGHT);

      // Shared middle edge (3,1): both contribute UP|DOWN -> merged vertical
      expect(patternAt(buf, 3, 1)).toBe(UP | DOWN);

      // Shared bottom corner (3,2): box1 has UP|LEFT, box2 has UP|RIGHT -> T junction
      expect(patternAt(buf, 3, 2)).toBe(UP | LEFT | RIGHT);
    });

    it("zero-size box produces no output", () => {
      const buf = new PixelBuffer(5, 5);
      const ctx = new DrawingContext(buf);

      ctx.drawBox({ x: 0, y: 0, width: 0, height: 3 });

      // All cells should remain default
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 5; x++) {
          expect(patternAt(buf, x, y)).toBe(0);
        }
      }
    });
  });

  // ── drawHLine / drawVLine ─────────────────────────────────────────

  describe("drawHLine", () => {
    it("draws horizontal line with LEFT|RIGHT pattern", () => {
      const buf = new PixelBuffer(10, 5);
      const ctx = new DrawingContext(buf);

      ctx.drawHLine(2, 1, 5);

      for (let x = 2; x < 7; x++) {
        expect(patternAt(buf, x, 1)).toBe(LEFT | RIGHT);
      }
      // Adjacent cells untouched
      expect(patternAt(buf, 1, 1)).toBe(0);
      expect(patternAt(buf, 7, 1)).toBe(0);
    });
  });

  describe("drawVLine", () => {
    it("draws vertical line with UP|DOWN pattern", () => {
      const buf = new PixelBuffer(5, 10);
      const ctx = new DrawingContext(buf);

      ctx.drawVLine(1, 2, 4);

      for (let y = 2; y < 6; y++) {
        expect(patternAt(buf, 1, y)).toBe(UP | DOWN);
      }
      // Adjacent cells untouched
      expect(patternAt(buf, 1, 1)).toBe(0);
      expect(patternAt(buf, 1, 6)).toBe(0);
    });
  });

  describe("drawHLine + drawVLine crossing produces cross pattern", () => {
    it("crossing lines merge into a cross", () => {
      const buf = new PixelBuffer(10, 10);
      const ctx = new DrawingContext(buf);

      ctx.drawHLine(0, 3, 8);
      ctx.drawVLine(4, 0, 8);

      // Intersection at (4, 3) should be a cross
      expect(patternAt(buf, 4, 3)).toBe(UP | RIGHT | DOWN | LEFT);
      expect(charAt(buf, 4, 3)).toBe(BOX_CHARS[UP | RIGHT | DOWN | LEFT]);
    });
  });

  // ── Clipping ──────────────────────────────────────────────────────

  describe("pushClip + drawText", () => {
    it("text outside clip is not written", () => {
      const buf = new PixelBuffer(20, 5);
      const ctx = new DrawingContext(buf);

      // Clip to columns 2..6 (width 5)
      ctx.pushClip({ x: 2, y: 0, width: 5, height: 5 });
      ctx.drawText(0, 0, "ABCDEFGHIJ", { fg: WHITE });
      ctx.popClip();

      // Positions 0 and 1 are outside clip -> should be untouched
      expect(charAt(buf, 0, 0)).toBe(" ");
      expect(charAt(buf, 1, 0)).toBe(" ");

      // Positions 2-6 are inside clip -> should have chars C-G
      expect(charAt(buf, 2, 0)).toBe("C");
      expect(charAt(buf, 3, 0)).toBe("D");
      expect(charAt(buf, 4, 0)).toBe("E");
      expect(charAt(buf, 5, 0)).toBe("F");
      expect(charAt(buf, 6, 0)).toBe("G");

      // Position 7+ is outside clip
      expect(charAt(buf, 7, 0)).toBe(" ");
    });
  });

  // ── Translate ─────────────────────────────────────────────────────

  describe("pushTranslate", () => {
    it("drawing at (0,0) after pushTranslate(5,3) writes to buffer at (5,3)", () => {
      const buf = new PixelBuffer(20, 20);
      const ctx = new DrawingContext(buf);

      ctx.pushTranslate(5, 3);
      ctx.drawChar(0, 0, "Z", { fg: WHITE });
      ctx.popTranslate();

      expect(charAt(buf, 5, 3)).toBe("Z");
      expect(charAt(buf, 0, 0)).toBe(" "); // original (0,0) untouched
    });

    it("nested translates accumulate", () => {
      const buf = new PixelBuffer(20, 20);
      const ctx = new DrawingContext(buf);

      ctx.pushTranslate(2, 1);
      ctx.pushTranslate(3, 4);
      ctx.drawChar(0, 0, "Q", { fg: WHITE });
      ctx.popTranslate();
      ctx.popTranslate();

      // Total offset: (2+3, 1+4) = (5, 5)
      expect(charAt(buf, 5, 5)).toBe("Q");
    });

    it("popTranslate restores previous offset", () => {
      const buf = new PixelBuffer(20, 20);
      const ctx = new DrawingContext(buf);

      ctx.pushTranslate(5, 5);
      ctx.pushTranslate(2, 2);
      ctx.popTranslate();

      // Back to (5, 5) offset
      ctx.drawChar(0, 0, "R", { fg: WHITE });
      ctx.popTranslate();

      expect(charAt(buf, 5, 5)).toBe("R");
    });
  });

  // ── Translate + Clip ──────────────────────────────────────────────

  describe("pushTranslate + pushClip: both work together", () => {
    it("clip operates in buffer (world) coordinates", () => {
      const buf = new PixelBuffer(20, 20);
      const ctx = new DrawingContext(buf);

      // Translate so local (0,0) maps to buffer (5, 5)
      ctx.pushTranslate(5, 5);

      // Clip in world coords: only buffer (5..9, 5..9) is visible
      ctx.pushClip({ x: 5, y: 5, width: 5, height: 5 });

      // Draw at local (0,0) -> buffer (5,5) -> inside clip -> visible
      ctx.drawChar(0, 0, "A", { fg: WHITE });
      // Draw at local (4,4) -> buffer (9,9) -> inside clip -> visible
      ctx.drawChar(4, 4, "B", { fg: WHITE });
      // Draw at local (5,5) -> buffer (10,10) -> outside clip -> not written
      ctx.drawChar(5, 5, "C", { fg: WHITE });

      ctx.popClip();
      ctx.popTranslate();

      expect(charAt(buf, 5, 5)).toBe("A");
      expect(charAt(buf, 9, 9)).toBe("B");
      expect(charAt(buf, 10, 10)).toBe(" "); // clipped
    });

    it("fillRect respects both translate and clip", () => {
      const buf = new PixelBuffer(20, 20);
      const ctx = new DrawingContext(buf);

      ctx.pushTranslate(3, 3);
      ctx.pushClip({ x: 3, y: 3, width: 4, height: 4 }); // world 3..6

      // Local rect (0,0,10,10) -> world (3,3,10,10), clipped to (3,3,4,4)
      ctx.fillRect({ x: 0, y: 0, width: 10, height: 10 }, RED);

      ctx.popClip();
      ctx.popTranslate();

      // Inside clipped area
      expect(bgAt(buf, 3, 3)).toEqual(RED);
      expect(bgAt(buf, 6, 6)).toEqual(RED);

      // Outside clipped area
      expect(bgAt(buf, 7, 7).a).toBe(0);
      expect(bgAt(buf, 2, 2).a).toBe(0);
    });
  });
});
