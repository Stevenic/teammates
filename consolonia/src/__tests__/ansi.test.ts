import { Writable } from "node:stream";
import { beforeEach, describe, expect, it } from "vitest";

import * as esc from "../ansi/esc.js";
import { AnsiOutput } from "../ansi/output.js";
import { stripAnsi, truncateAnsi, visibleLength } from "../ansi/strip.js";

// ── Helpers ────────────────────────────────────────────────────────

const ESC = "\x1b[";

/** Build a mock writable stream that accumulates output to a string. */
function mockStream(): Writable & { output: string } {
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      stream.output += chunk.toString();
      callback();
    },
  }) as Writable & { output: string };
  stream.output = "";
  return stream;
}

// ═══════════════════════════════════════════════════════════════════
// esc.ts
// ═══════════════════════════════════════════════════════════════════

describe("esc", () => {
  describe("text style sequences", () => {
    it("bold produces SGR 1", () => {
      expect(esc.bold).toBe(`${ESC}1m`);
    });

    it("dim produces SGR 2", () => {
      expect(esc.dim).toBe(`${ESC}2m`);
    });

    it("italic produces SGR 3", () => {
      expect(esc.italic).toBe(`${ESC}3m`);
    });

    it("underline produces SGR 4", () => {
      expect(esc.underline).toBe(`${ESC}4m`);
    });

    it("strikethrough produces SGR 9", () => {
      expect(esc.strikethrough).toBe(`${ESC}9m`);
    });

    it("reset produces SGR 0", () => {
      expect(esc.reset).toBe(`${ESC}0m`);
    });

    it("boldOff and dimOff both produce SGR 22", () => {
      expect(esc.boldOff).toBe(`${ESC}22m`);
      expect(esc.dimOff).toBe(`${ESC}22m`);
    });

    it("italicOff produces SGR 23", () => {
      expect(esc.italicOff).toBe(`${ESC}23m`);
    });

    it("underlineOff produces SGR 24", () => {
      expect(esc.underlineOff).toBe(`${ESC}24m`);
    });

    it("strikethroughOff produces SGR 29", () => {
      expect(esc.strikethroughOff).toBe(`${ESC}29m`);
    });
  });

  describe("color sequences", () => {
    it("fg(r,g,b) produces 24-bit foreground escape", () => {
      expect(esc.fg(255, 128, 0)).toBe(`${ESC}38;2;255;128;0m`);
    });

    it("bg(r,g,b) produces 24-bit background escape", () => {
      expect(esc.bg(0, 0, 0)).toBe(`${ESC}48;2;0;0;0m`);
    });

    it("fg with full white", () => {
      expect(esc.fg(255, 255, 255)).toBe(`${ESC}38;2;255;255;255m`);
    });

    it("bg with arbitrary values", () => {
      expect(esc.bg(12, 34, 56)).toBe(`${ESC}48;2;12;34;56m`);
    });

    it("fgDefault resets foreground", () => {
      expect(esc.fgDefault).toBe(`${ESC}39m`);
    });

    it("bgDefault resets background", () => {
      expect(esc.bgDefault).toBe(`${ESC}49m`);
    });
  });

  describe("cursor movement", () => {
    it("moveTo converts 0-based to 1-based coordinates", () => {
      expect(esc.moveTo(0, 0)).toBe(`${ESC}1;1H`);
      expect(esc.moveTo(9, 4)).toBe(`${ESC}5;10H`);
    });

    it("moveUp defaults to 1", () => {
      expect(esc.moveUp()).toBe(`${ESC}1A`);
      expect(esc.moveUp(5)).toBe(`${ESC}5A`);
    });

    it("moveDown defaults to 1", () => {
      expect(esc.moveDown()).toBe(`${ESC}1B`);
      expect(esc.moveDown(3)).toBe(`${ESC}3B`);
    });

    it("moveRight defaults to 1", () => {
      expect(esc.moveRight()).toBe(`${ESC}1C`);
      expect(esc.moveRight(10)).toBe(`${ESC}10C`);
    });

    it("moveLeft defaults to 1", () => {
      expect(esc.moveLeft()).toBe(`${ESC}1D`);
      expect(esc.moveLeft(2)).toBe(`${ESC}2D`);
    });

    it("saveCursor and restoreCursor", () => {
      expect(esc.saveCursor).toBe(`${ESC}s`);
      expect(esc.restoreCursor).toBe(`${ESC}u`);
    });

    it("hideCursor and showCursor", () => {
      expect(esc.hideCursor).toBe(`${ESC}?25l`);
      expect(esc.showCursor).toBe(`${ESC}?25h`);
    });
  });

  describe("screen control", () => {
    it("clearScreen clears entire display", () => {
      expect(esc.clearScreen).toBe(`${ESC}2J`);
    });

    it("eraseLine clears entire line", () => {
      expect(esc.eraseLine).toBe(`${ESC}2K`);
    });

    it("eraseDown erases from cursor to end of display", () => {
      expect(esc.eraseDown).toBe(`${ESC}0J`);
    });
  });

  describe("mode toggles", () => {
    it("alternateScreenOn/Off", () => {
      expect(esc.alternateScreenOn).toBe(`${ESC}?1049h`);
      expect(esc.alternateScreenOff).toBe(`${ESC}?1049l`);
    });

    it("bracketedPasteOn/Off", () => {
      expect(esc.bracketedPasteOn).toBe(`${ESC}?2004h`);
      expect(esc.bracketedPasteOff).toBe(`${ESC}?2004l`);
    });

    it("mouseTrackingOn enables button-event tracking and SGR mode", () => {
      expect(esc.mouseTrackingOn).toBe(`${ESC}?1003h${ESC}?1006h`);
    });

    it("mouseTrackingOff disables SGR mode and button-event tracking", () => {
      expect(esc.mouseTrackingOff).toBe(`${ESC}?1006l${ESC}?1003l`);
    });
  });

  describe("setTitle", () => {
    it("wraps title in OSC 0 sequence", () => {
      expect(esc.setTitle("Hello")).toBe(`\x1b]0;Hello\x07`);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// strip.ts
// ═══════════════════════════════════════════════════════════════════

describe("strip", () => {
  describe("stripAnsi", () => {
    it("returns plain text unchanged", () => {
      expect(stripAnsi("hello")).toBe("hello");
    });

    it("removes SGR sequences", () => {
      expect(stripAnsi(`${ESC}1mhello${ESC}0m`)).toBe("hello");
    });

    it("removes cursor movement sequences", () => {
      expect(stripAnsi(`${ESC}5;10Hworld`)).toBe("world");
    });

    it("removes multiple sequences", () => {
      const styled = `${ESC}1m${ESC}38;2;255;0;0mhello${ESC}0m world`;
      expect(stripAnsi(styled)).toBe("hello world");
    });

    it("removes OSC sequences", () => {
      expect(stripAnsi(`\x1b]0;Title\x07text`)).toBe("text");
    });

    it("handles empty string", () => {
      expect(stripAnsi("")).toBe("");
    });

    it("handles string that is only escape codes", () => {
      expect(stripAnsi(`${ESC}1m${ESC}0m`)).toBe("");
    });
  });

  describe("visibleLength", () => {
    it("returns correct length for plain text", () => {
      expect(visibleLength("hello")).toBe(5);
    });

    it("ignores ANSI codes in length calculation", () => {
      expect(visibleLength(`${ESC}1mhello${ESC}0m`)).toBe(5);
    });

    it("returns 0 for string with only escape codes", () => {
      expect(visibleLength(`${ESC}38;2;255;0;0m`)).toBe(0);
    });

    it("handles mixed content correctly", () => {
      const s = `${ESC}1mbold${ESC}0m and ${ESC}3mitalic${ESC}0m`;
      expect(visibleLength(s)).toBe("bold and italic".length);
    });
  });

  describe("truncateAnsi", () => {
    it("returns empty string for maxWidth 0", () => {
      expect(truncateAnsi("hello", 0)).toBe("");
    });

    it("returns empty string for negative maxWidth", () => {
      expect(truncateAnsi("hello", -1)).toBe("");
    });

    it("truncates plain text to maxWidth", () => {
      expect(truncateAnsi("hello world", 5)).toBe("hello");
    });

    it("returns full string if shorter than maxWidth", () => {
      expect(truncateAnsi("hi", 10)).toBe("hi");
    });

    it("preserves ANSI codes up to the visible cut-off", () => {
      const s = `${ESC}1mhello${ESC}0m world`;
      const result = truncateAnsi(s, 5);
      // Should contain all 5 visible chars "hello" plus the bold escape
      expect(stripAnsi(result)).toBe("hello");
      expect(result).toContain(`${ESC}1m`);
    });

    it("includes ANSI codes before any visible character", () => {
      const s = `${ESC}38;2;255;0;0m${ESC}1mAB`;
      const result = truncateAnsi(s, 1);
      expect(stripAnsi(result)).toBe("A");
      // Both escape sequences should be preserved since they precede visible chars
      expect(result).toContain(`${ESC}38;2;255;0;0m`);
      expect(result).toContain(`${ESC}1m`);
    });

    it("handles string with only escape codes", () => {
      const s = `${ESC}1m${ESC}0m`;
      const result = truncateAnsi(s, 5);
      expect(result).toBe(s);
    });

    it("handles OSC sequences in truncation", () => {
      const s = `\x1b]0;Title\x07hello`;
      const result = truncateAnsi(s, 3);
      expect(stripAnsi(result)).toBe("hel");
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// output.ts
// ═══════════════════════════════════════════════════════════════════

describe("AnsiOutput", () => {
  let stream: ReturnType<typeof mockStream>;
  let output: AnsiOutput;

  /** Create a minimal Pixel for testing. */
  function makePixel(
    char: string,
    fg: { r: number; g: number; b: number; a: number },
    bg: { r: number; g: number; b: number; a: number },
    opts: {
      bold?: boolean;
      italic?: boolean;
      underline?: boolean;
      strikethrough?: boolean;
    } = {},
  ) {
    return {
      foreground: {
        symbol: { text: char, width: 1 as const, pattern: 0 },
        color: fg,
        bold: opts.bold ?? false,
        italic: opts.italic ?? false,
        underline: opts.underline ?? false,
        strikethrough: opts.strikethrough ?? false,
      },
      background: {
        color: bg,
      },
    };
  }

  beforeEach(() => {
    stream = mockStream();
    output = new AnsiOutput(stream);
  });

  describe("buffering and flush", () => {
    it("does not write to stream until flush is called", () => {
      output.hideCursor();
      expect(stream.output).toBe("");
    });

    it("flush writes accumulated buffer to stream", () => {
      output.hideCursor();
      output.flush();
      expect(stream.output).toBe(esc.hideCursor);
    });

    it("flush clears the buffer so second flush is a no-op", () => {
      output.hideCursor();
      output.flush();
      const first = stream.output;
      output.flush();
      expect(stream.output).toBe(first);
    });

    it("empty flush does not write to stream", () => {
      output.flush();
      expect(stream.output).toBe("");
    });
  });

  describe("setCursor", () => {
    it("emits moveTo on first call", () => {
      output.setCursor(5, 3);
      output.flush();
      expect(stream.output).toBe(esc.moveTo(5, 3));
    });

    it("skips moveTo when position is already correct", () => {
      output.setCursor(5, 3);
      output.flush();
      stream.output = "";

      output.setCursor(5, 3);
      output.flush();
      expect(stream.output).toBe("");
    });

    it("emits moveTo when position changes", () => {
      output.setCursor(0, 0);
      output.flush();
      stream.output = "";

      output.setCursor(10, 5);
      output.flush();
      expect(stream.output).toBe(esc.moveTo(10, 5));
    });
  });

  describe("writePixel", () => {
    it("emits cursor position, colors, and character", () => {
      const px = makePixel(
        "A",
        { r: 255, g: 0, b: 0, a: 255 },
        { r: 0, g: 0, b: 0, a: 255 },
      );
      output.writePixel(0, 0, px);
      output.flush();

      expect(stream.output).toContain(esc.moveTo(0, 0));
      expect(stream.output).toContain(esc.fg(255, 0, 0));
      expect(stream.output).toContain(esc.bg(0, 0, 0));
      expect(stream.output).toContain("A");
    });

    it("skips cursor move for adjacent horizontal pixels", () => {
      const px1 = makePixel(
        "A",
        { r: 255, g: 0, b: 0, a: 255 },
        { r: 0, g: 0, b: 0, a: 255 },
      );
      const px2 = makePixel(
        "B",
        { r: 255, g: 0, b: 0, a: 255 },
        { r: 0, g: 0, b: 0, a: 255 },
      );

      output.writePixel(0, 0, px1);
      output.writePixel(1, 0, px2);
      output.flush();

      // Should have moveTo for (0,0) but not for (1,0) since cursor advances
      const moveToCount = (stream.output.match(/\x1b\[\d+;\d+H/g) || []).length;
      expect(moveToCount).toBe(1);
      expect(stream.output).toContain("AB");
    });

    it("emits cursor move when pixels are not adjacent", () => {
      const px1 = makePixel(
        "A",
        { r: 255, g: 0, b: 0, a: 255 },
        { r: 0, g: 0, b: 0, a: 255 },
      );
      const px2 = makePixel(
        "B",
        { r: 255, g: 0, b: 0, a: 255 },
        { r: 0, g: 0, b: 0, a: 255 },
      );

      output.writePixel(0, 0, px1);
      output.writePixel(5, 0, px2); // gap at x=5
      output.flush();

      const moveToCount = (stream.output.match(/\x1b\[\d+;\d+H/g) || []).length;
      expect(moveToCount).toBe(2);
    });

    it("does not re-emit foreground color when unchanged", () => {
      const fgColor = { r: 100, g: 200, b: 50, a: 255 };
      const bgColor = { r: 0, g: 0, b: 0, a: 255 };
      const px1 = makePixel("A", fgColor, bgColor);
      const px2 = makePixel("B", fgColor, bgColor);

      output.writePixel(0, 0, px1);
      output.writePixel(1, 0, px2);
      output.flush();

      // fg color should appear only once
      const fgSeq = esc.fg(100, 200, 50);
      const fgCount = stream.output.split(fgSeq).length - 1;
      expect(fgCount).toBe(1);
    });

    it("does not re-emit background color when unchanged", () => {
      const fgColor = { r: 255, g: 255, b: 255, a: 255 };
      const bgColor = { r: 30, g: 30, b: 30, a: 255 };
      const px1 = makePixel("X", fgColor, bgColor);
      const px2 = makePixel("Y", fgColor, bgColor);

      output.writePixel(0, 0, px1);
      output.writePixel(1, 0, px2);
      output.flush();

      const bgSeq = esc.bg(30, 30, 30);
      const bgCount = stream.output.split(bgSeq).length - 1;
      expect(bgCount).toBe(1);
    });

    it("emits new color when foreground changes", () => {
      const bg = { r: 0, g: 0, b: 0, a: 255 };
      const px1 = makePixel("A", { r: 255, g: 0, b: 0, a: 255 }, bg);
      const px2 = makePixel("B", { r: 0, g: 255, b: 0, a: 255 }, bg);

      output.writePixel(0, 0, px1);
      output.writePixel(1, 0, px2);
      output.flush();

      expect(stream.output).toContain(esc.fg(255, 0, 0));
      expect(stream.output).toContain(esc.fg(0, 255, 0));
    });

    it("emits bold on and bold off on toggle", () => {
      const fg = { r: 255, g: 255, b: 255, a: 255 };
      const bg = { r: 0, g: 0, b: 0, a: 255 };
      const px1 = makePixel("A", fg, bg, { bold: true });
      const px2 = makePixel("B", fg, bg, { bold: false });

      output.writePixel(0, 0, px1);
      output.writePixel(1, 0, px2);
      output.flush();

      expect(stream.output).toContain(esc.bold);
      expect(stream.output).toContain(esc.boldOff);
    });

    it("emits italic on and off on toggle", () => {
      const fg = { r: 255, g: 255, b: 255, a: 255 };
      const bg = { r: 0, g: 0, b: 0, a: 255 };
      const px1 = makePixel("A", fg, bg, { italic: true });
      const px2 = makePixel("B", fg, bg, { italic: false });

      output.writePixel(0, 0, px1);
      output.writePixel(1, 0, px2);
      output.flush();

      expect(stream.output).toContain(esc.italic);
      expect(stream.output).toContain(esc.italicOff);
    });

    it("emits underline on and off on toggle", () => {
      const fg = { r: 255, g: 255, b: 255, a: 255 };
      const bg = { r: 0, g: 0, b: 0, a: 255 };
      const px1 = makePixel("A", fg, bg, { underline: true });
      const px2 = makePixel("B", fg, bg, { underline: false });

      output.writePixel(0, 0, px1);
      output.writePixel(1, 0, px2);
      output.flush();

      expect(stream.output).toContain(esc.underline);
      expect(stream.output).toContain(esc.underlineOff);
    });

    it("emits strikethrough on and off on toggle", () => {
      const fg = { r: 255, g: 255, b: 255, a: 255 };
      const bg = { r: 0, g: 0, b: 0, a: 255 };
      const px1 = makePixel("A", fg, bg, { strikethrough: true });
      const px2 = makePixel("B", fg, bg, { strikethrough: false });

      output.writePixel(0, 0, px1);
      output.writePixel(1, 0, px2);
      output.flush();

      expect(stream.output).toContain(esc.strikethrough);
      expect(stream.output).toContain(esc.strikethroughOff);
    });

    it("does not re-emit style when consecutive pixels have the same style", () => {
      const fg = { r: 255, g: 255, b: 255, a: 255 };
      const bg = { r: 0, g: 0, b: 0, a: 255 };
      const px1 = makePixel("A", fg, bg, { bold: true, italic: true });
      const px2 = makePixel("B", fg, bg, { bold: true, italic: true });

      output.writePixel(0, 0, px1);
      output.writePixel(1, 0, px2);
      output.flush();

      // bold and italic should each appear exactly once
      const boldCount = stream.output.split(esc.bold).length - 1;
      const italicCount = stream.output.split(esc.italic).length - 1;
      expect(boldCount).toBe(1);
      expect(italicCount).toBe(1);
    });

    it("emits fgDefault when foreground alpha drops to 0", () => {
      const bg = { r: 0, g: 0, b: 0, a: 255 };
      const px1 = makePixel("A", { r: 255, g: 0, b: 0, a: 255 }, bg);
      const px2 = makePixel("B", { r: 0, g: 0, b: 0, a: 0 }, bg);

      output.writePixel(0, 0, px1);
      output.writePixel(1, 0, px2);
      output.flush();

      expect(stream.output).toContain(esc.fgDefault);
    });

    it("emits bgDefault when background alpha drops to 0", () => {
      const fg = { r: 255, g: 255, b: 255, a: 255 };
      const px1 = makePixel("A", fg, { r: 0, g: 0, b: 0, a: 255 });
      const px2 = makePixel("B", fg, { r: 0, g: 0, b: 0, a: 0 });

      output.writePixel(0, 0, px1);
      output.writePixel(1, 0, px2);
      output.flush();

      expect(stream.output).toContain(esc.bgDefault);
    });
  });

  describe("writeText", () => {
    it("writes text at specified position", () => {
      output.writeText(3, 2, "hello");
      output.flush();

      expect(stream.output).toContain(esc.moveTo(3, 2));
      expect(stream.output).toContain("hello");
    });

    it("applies style overrides", () => {
      output.writeText(0, 0, "bold", {
        bold: true,
        fgColor: { r: 255, g: 0, b: 0, a: 255 },
      });
      output.flush();

      expect(stream.output).toContain(esc.bold);
      expect(stream.output).toContain(esc.fg(255, 0, 0));
      expect(stream.output).toContain("bold");
    });

    it("advances cursor x by text length", () => {
      output.writeText(0, 0, "abc");
      // Now cursor should be at x=3, y=0. Writing at (3, 0) should not emit moveTo.
      output.setCursor(3, 0);
      output.flush();

      // Only one moveTo for the initial (0,0)
      const moveToCount = (stream.output.match(/\x1b\[\d+;\d+H/g) || []).length;
      expect(moveToCount).toBe(1);
    });
  });

  describe("prepareTerminal", () => {
    it("emits setup sequences and flushes immediately", () => {
      output.prepareTerminal();

      expect(stream.output).toContain(esc.alternateScreenOn);
      expect(stream.output).toContain(esc.hideCursor);
      expect(stream.output).toContain(esc.bracketedPasteOn);
      expect(stream.output).toContain(esc.mouseTrackingOn);
      expect(stream.output).toContain(esc.clearScreen);
    });
  });

  describe("restoreTerminal", () => {
    it("emits teardown sequences and flushes immediately", () => {
      output.restoreTerminal();

      expect(stream.output).toContain(esc.reset);
      expect(stream.output).toContain(esc.mouseTrackingOff);
      expect(stream.output).toContain(esc.bracketedPasteOff);
      expect(stream.output).toContain(esc.showCursor);
      expect(stream.output).toContain(esc.alternateScreenOff);
    });
  });

  describe("state reset after prepare/restore", () => {
    it("re-emits cursor position after prepareTerminal", () => {
      output.setCursor(5, 5);
      output.flush();
      stream.output = "";

      output.prepareTerminal();
      stream.output = "";

      // After prepare, state is reset, so setCursor to (5,5) should emit moveTo again
      output.setCursor(5, 5);
      output.flush();
      expect(stream.output).toContain(esc.moveTo(5, 5));
    });

    it("re-emits colors after restoreTerminal", () => {
      const fg = { r: 100, g: 100, b: 100, a: 255 };
      const bg = { r: 50, g: 50, b: 50, a: 255 };
      const px = {
        foreground: {
          symbol: { text: "A", width: 1 as const, pattern: 0 },
          color: fg,
          bold: false,
          italic: false,
          underline: false,
          strikethrough: false,
        },
        background: { color: bg },
      };

      output.writePixel(0, 0, px);
      output.flush();
      stream.output = "";

      output.restoreTerminal();
      stream.output = "";

      // After restore, tracked colors are reset so the same color is re-emitted
      output.writePixel(0, 0, px);
      output.flush();
      expect(stream.output).toContain(esc.fg(100, 100, 100));
      expect(stream.output).toContain(esc.bg(50, 50, 50));
    });
  });
});
