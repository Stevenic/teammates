/**
 * Tests for the pen (styled text) API and StyledText widget.
 */

import { describe, expect, it } from "vitest";
import { DrawingContext } from "../drawing/context.js";
import { PixelBuffer } from "../pixel/buffer.js";
import { CYAN, GRAY, RED, WHITE } from "../pixel/color.js";
import { concat, isStyledSpan, pen, spanLength, spanText } from "../styled.js";
import { StyledText } from "../widgets/styled-text.js";

// ── Helpers ──────────────────────────────────────────────────────────

function charAt(buffer: PixelBuffer, x: number, y: number) {
  return buffer.get(x, y).foreground.symbol.text;
}

function fgColor(buffer: PixelBuffer, x: number, y: number) {
  return buffer.get(x, y).foreground.color;
}

function layoutAndRender(widget: StyledText, width = 40, height = 10) {
  const buffer = new PixelBuffer(width, height);
  const ctx = new DrawingContext(buffer);
  widget.measure({
    minWidth: 0,
    minHeight: 0,
    maxWidth: width,
    maxHeight: height,
  });
  widget.arrange({
    x: 0,
    y: 0,
    width,
    height: widget.desiredSize.height || height,
  });
  widget.render(ctx);
  return { buffer, ctx };
}

// ── pen API ──────────────────────────────────────────────────────────

describe("pen", () => {
  it("creates unstyled span from plain text", () => {
    const s = pen("hello");
    expect(s).toHaveLength(1);
    expect(s[0].text).toBe("hello");
    expect(s[0].style).toEqual({});
  });

  it("creates colored span", () => {
    const s = pen.cyan("hello");
    expect(s).toHaveLength(1);
    expect(s[0].text).toBe("hello");
    expect(s[0].style.fg).toEqual(CYAN);
  });

  it("chains bold + color", () => {
    const s = pen.bold.red("error");
    expect(s[0].style.bold).toBe(true);
    expect(s[0].style.fg).toEqual(RED);
  });

  it("supports background colors", () => {
    const s = pen.bgRed.white("alert");
    expect(s[0].style.bg).toEqual(RED);
    expect(s[0].style.fg).toEqual(WHITE);
  });

  it("supports gray", () => {
    const s = pen.gray("muted");
    expect(s[0].style.fg).toEqual(GRAY);
  });

  it("supports bright variants", () => {
    const s = pen.cyanBright("bright");
    expect(s[0].style.fg!.a).toBe(255);
    expect(s[0].style.fg!.r).toBe(85);
  });

  it("supports italic", () => {
    const s = pen.italic("text");
    expect(s[0].style.italic).toBe(true);
  });

  it("is a StyledSpan", () => {
    expect(isStyledSpan(pen("x"))).toBe(true);
    expect(isStyledSpan("plain")).toBe(false);
    expect(isStyledSpan([])).toBe(false);
  });
});

describe("concat", () => {
  it("joins multiple spans", () => {
    const s = concat(pen.green("✔ "), pen.white("done"));
    expect(s).toHaveLength(2);
    expect(spanText(s)).toBe("✔ done");
    expect(spanLength(s)).toBe(6);
  });

  it("accepts plain strings", () => {
    const s = concat("hello ", pen.cyan("world"));
    expect(s).toHaveLength(2);
    expect(s[0].style).toEqual({});
    expect(s[1].style.fg).toEqual(CYAN);
  });
});

// ── StyledText widget ────────────────────────────────────────────────

describe("StyledText", () => {
  it("renders plain string lines", () => {
    const widget = new StyledText({ lines: ["hello"] });
    const size = widget.measure({
      minWidth: 0,
      minHeight: 0,
      maxWidth: 40,
      maxHeight: 10,
    });
    expect(size.height).toBe(1);
    expect(size.width).toBe(5);

    const { buffer } = layoutAndRender(widget);
    expect(charAt(buffer, 0, 0)).toBe("h");
    expect(charAt(buffer, 4, 0)).toBe("o");
  });

  it("renders styled span lines with correct colors", () => {
    const line = concat(pen.red("R"), pen.green("G"));
    const widget = new StyledText({ lines: [line] });
    const { buffer } = layoutAndRender(widget);

    expect(charAt(buffer, 0, 0)).toBe("R");
    expect(fgColor(buffer, 0, 0)).toEqual(RED);
    expect(charAt(buffer, 1, 0)).toBe("G");
    // Green color check
    expect(fgColor(buffer, 1, 0).g).toBe(255);
  });

  it("applies defaultStyle to plain string lines", () => {
    const widget = new StyledText({
      lines: ["text"],
      defaultStyle: { fg: CYAN },
    });
    const { buffer } = layoutAndRender(widget);
    expect(fgColor(buffer, 0, 0)).toEqual(CYAN);
  });

  it("measures multiple lines", () => {
    const widget = new StyledText({ lines: ["line1", "line2", "line3"] });
    const size = widget.measure({
      minWidth: 0,
      minHeight: 0,
      maxWidth: 40,
      maxHeight: 10,
    });
    expect(size.height).toBe(3);
  });

  it("wraps long lines when wrap is true", () => {
    const widget = new StyledText({
      lines: ["abcdefghij"],
      wrap: true,
    });
    const size = widget.measure({
      minWidth: 0,
      minHeight: 0,
      maxWidth: 5,
      maxHeight: 10,
    });
    expect(size.height).toBe(2); // "abcde" + "fghij"
  });
});
