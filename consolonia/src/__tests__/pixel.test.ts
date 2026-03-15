import { describe, expect, it } from "vitest";
// ── background.ts ───────────────────────────────────────────────────
import {
  background,
  blendBackground,
  EMPTY_BACKGROUND,
} from "../pixel/background.js";

// ── box-pattern.ts ──────────────────────────────────────────────────
import {
  BOX_CHARS,
  BOX_NONE,
  boxChar,
  DOWN,
  LEFT,
  mergeBoxPatterns,
  RIGHT,
  UP,
} from "../pixel/box-pattern.js";
// ── buffer.ts ───────────────────────────────────────────────────────
import { PixelBuffer } from "../pixel/buffer.js";
// ── color.ts ────────────────────────────────────────────────────────
import {
  BLACK,
  BLUE,
  CYAN,
  color,
  colorBlend,
  colorBrighten,
  colorShade,
  DARK_GRAY,
  GRAY,
  GREEN,
  LIGHT_GRAY,
  MAGENTA,
  RED,
  TRANSPARENT,
  WHITE,
  YELLOW,
} from "../pixel/color.js";
// ── foreground.ts ───────────────────────────────────────────────────
import {
  blendForeground,
  EMPTY_FOREGROUND,
  foreground,
} from "../pixel/foreground.js";

// ── pixel.ts ────────────────────────────────────────────────────────
import { blendPixel, PIXEL_EMPTY, PIXEL_SPACE, pixel } from "../pixel/pixel.js";
// ── symbol.ts ───────────────────────────────────────────────────────
import { charWidth, EMPTY_SYMBOL, sym } from "../pixel/symbol.js";

// ═══════════════════════════════════════════════════════════════════
//  COLOR
// ═══════════════════════════════════════════════════════════════════

describe("color", () => {
  describe("color() factory", () => {
    it("creates an RGBA color with explicit alpha", () => {
      const c = color(10, 20, 30, 128);
      expect(c).toEqual({ r: 10, g: 20, b: 30, a: 128 });
    });

    it("defaults alpha to 255 when omitted", () => {
      const c = color(100, 150, 200);
      expect(c).toEqual({ r: 100, g: 150, b: 200, a: 255 });
    });

    it("allows zero values for all channels", () => {
      expect(color(0, 0, 0, 0)).toEqual(TRANSPARENT);
    });
  });

  describe("color constants", () => {
    it("TRANSPARENT has all zeros", () => {
      expect(TRANSPARENT).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    });

    it("BLACK is opaque black", () => {
      expect(BLACK).toEqual({ r: 0, g: 0, b: 0, a: 255 });
    });

    it("WHITE is opaque white", () => {
      expect(WHITE).toEqual({ r: 255, g: 255, b: 255, a: 255 });
    });

    it("primary colors have correct channels", () => {
      expect(RED).toEqual({ r: 255, g: 0, b: 0, a: 255 });
      expect(GREEN).toEqual({ r: 0, g: 255, b: 0, a: 255 });
      expect(BLUE).toEqual({ r: 0, g: 0, b: 255, a: 255 });
    });

    it("secondary colors have correct channels", () => {
      expect(YELLOW).toEqual({ r: 255, g: 255, b: 0, a: 255 });
      expect(CYAN).toEqual({ r: 0, g: 255, b: 255, a: 255 });
      expect(MAGENTA).toEqual({ r: 255, g: 0, b: 255, a: 255 });
    });

    it("gray variants have correct values", () => {
      expect(GRAY).toEqual({ r: 128, g: 128, b: 128, a: 255 });
      expect(DARK_GRAY).toEqual({ r: 64, g: 64, b: 64, a: 255 });
      expect(LIGHT_GRAY).toEqual({ r: 192, g: 192, b: 192, a: 255 });
    });
  });

  describe("colorBlend", () => {
    it("fully opaque source replaces target entirely", () => {
      expect(colorBlend(BLACK, RED)).toEqual(RED);
      expect(colorBlend(WHITE, BLUE)).toEqual(BLUE);
    });

    it("fully transparent source returns target unchanged", () => {
      expect(colorBlend(RED, TRANSPARENT)).toEqual(RED);
      expect(colorBlend(BLUE, TRANSPARENT)).toEqual(BLUE);
    });

    it("transparent target returns source", () => {
      expect(colorBlend(TRANSPARENT, RED)).toEqual(RED);
    });

    it("both transparent returns target (transparent)", () => {
      expect(colorBlend(TRANSPARENT, TRANSPARENT)).toEqual(TRANSPARENT);
    });

    it("50% alpha source blends correctly over opaque target", () => {
      const halfRed = color(255, 0, 0, 128);
      const result = colorBlend(WHITE, halfRed);
      // Porter-Duff over: sa=128/255~0.502, ta=1.0
      // outA = 0.502 + 1*(1-0.502) = 1.0
      // outR = (255*0.502 + 255*1*0.498) / 1.0 = 255
      // outG = (0*0.502 + 255*1*0.498) / 1.0 ~ 127
      // outB = (0*0.502 + 255*1*0.498) / 1.0 ~ 127
      expect(result.a).toBe(255);
      expect(result.r).toBe(255);
      expect(result.g).toBeGreaterThanOrEqual(125);
      expect(result.g).toBeLessThanOrEqual(129);
      expect(result.b).toBeGreaterThanOrEqual(125);
      expect(result.b).toBeLessThanOrEqual(129);
    });

    it("50% alpha source over opaque black", () => {
      const halfGreen = color(0, 255, 0, 128);
      const result = colorBlend(BLACK, halfGreen);
      // outA = 1.0
      // outR = 0, outG = 128ish, outB = 0
      expect(result.a).toBe(255);
      expect(result.r).toBe(0);
      expect(result.g).toBeGreaterThanOrEqual(126);
      expect(result.g).toBeLessThanOrEqual(130);
      expect(result.b).toBe(0);
    });

    it("two semi-transparent colors blend together", () => {
      const a = color(255, 0, 0, 128);
      const b = color(0, 0, 255, 128);
      const result = colorBlend(b, a);
      // Both semi-transparent; result should be partially transparent
      expect(result.a).toBeGreaterThan(128);
      expect(result.a).toBeLessThanOrEqual(255);
      expect(result.r).toBeGreaterThan(0);
      expect(result.b).toBeGreaterThan(0);
    });
  });

  describe("colorBrighten", () => {
    it("factor 0 returns the original color", () => {
      const result = colorBrighten(RED, 0);
      expect(result).toEqual(RED);
    });

    it("factor 1 returns white (preserving alpha)", () => {
      const result = colorBrighten(BLACK, 1);
      expect(result).toEqual({ r: 255, g: 255, b: 255, a: 255 });
    });

    it("factor 0.5 brightens toward white", () => {
      const result = colorBrighten(BLACK, 0.5);
      expect(result.r).toBe(128);
      expect(result.g).toBe(128);
      expect(result.b).toBe(128);
      expect(result.a).toBe(255);
    });

    it("preserves alpha channel", () => {
      const c = color(100, 100, 100, 64);
      const result = colorBrighten(c, 0.5);
      expect(result.a).toBe(64);
    });

    it("clamps factor above 1 to 1", () => {
      const result = colorBrighten(BLACK, 5);
      expect(result).toEqual({ r: 255, g: 255, b: 255, a: 255 });
    });

    it("clamps factor below 0 to 0", () => {
      const result = colorBrighten(RED, -1);
      expect(result).toEqual(RED);
    });
  });

  describe("colorShade", () => {
    it("factor 0 returns the original color", () => {
      const result = colorShade(WHITE, 0);
      expect(result).toEqual(WHITE);
    });

    it("factor 1 returns black (preserving alpha)", () => {
      const result = colorShade(WHITE, 1);
      expect(result).toEqual({ r: 0, g: 0, b: 0, a: 255 });
    });

    it("factor 0.5 darkens by half", () => {
      const result = colorShade(WHITE, 0.5);
      expect(result.r).toBe(128);
      expect(result.g).toBe(128);
      expect(result.b).toBe(128);
    });

    it("preserves alpha channel", () => {
      const c = color(200, 200, 200, 100);
      const result = colorShade(c, 0.5);
      expect(result.a).toBe(100);
    });

    it("clamps factor above 1 to 1", () => {
      const result = colorShade(WHITE, 5);
      expect(result).toEqual({ r: 0, g: 0, b: 0, a: 255 });
    });

    it("clamps factor below 0 to 0", () => {
      const result = colorShade(WHITE, -1);
      expect(result).toEqual(WHITE);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
//  BOX PATTERN
// ═══════════════════════════════════════════════════════════════════

describe("box-pattern", () => {
  describe("direction constants", () => {
    it("has correct bit values", () => {
      expect(UP).toBe(0x1);
      expect(RIGHT).toBe(0x2);
      expect(DOWN).toBe(0x4);
      expect(LEFT).toBe(0x8);
    });

    it("BOX_NONE is zero", () => {
      expect(BOX_NONE).toBe(0);
    });
  });

  describe("BOX_CHARS lookup table", () => {
    it("has exactly 16 entries", () => {
      expect(BOX_CHARS).toHaveLength(16);
    });

    it("index 0 (none) is a space", () => {
      expect(BOX_CHARS[0]).toBe(" ");
    });

    it("UP (0x1) and UP+DOWN (0x5) are vertical bar", () => {
      expect(BOX_CHARS[UP]).toBe("\u2502"); // │
      expect(BOX_CHARS[UP | DOWN]).toBe("\u2502"); // │
    });

    it("RIGHT (0x2), LEFT (0x8), and RIGHT+LEFT (0xA) are horizontal bar", () => {
      expect(BOX_CHARS[RIGHT]).toBe("\u2500"); // ─
      expect(BOX_CHARS[LEFT]).toBe("\u2500"); // ─
      expect(BOX_CHARS[RIGHT | LEFT]).toBe("\u2500"); // ─
    });

    it("corners are correct", () => {
      expect(BOX_CHARS[UP | RIGHT]).toBe("\u2514"); // └
      expect(BOX_CHARS[DOWN | RIGHT]).toBe("\u250C"); // ┌
      expect(BOX_CHARS[UP | LEFT]).toBe("\u2518"); // ┘
      expect(BOX_CHARS[DOWN | LEFT]).toBe("\u2510"); // ┐
    });

    it("T-junctions are correct", () => {
      expect(BOX_CHARS[UP | DOWN | RIGHT]).toBe("\u251C"); // ├
      expect(BOX_CHARS[UP | DOWN | LEFT]).toBe("\u2524"); // ┤
      expect(BOX_CHARS[DOWN | RIGHT | LEFT]).toBe("\u252C"); // ┬
      expect(BOX_CHARS[UP | RIGHT | LEFT]).toBe("\u2534"); // ┴
    });

    it("all four directions is a cross", () => {
      expect(BOX_CHARS[UP | RIGHT | DOWN | LEFT]).toBe("\u253C"); // ┼
    });
  });

  describe("boxChar()", () => {
    it("returns the correct character for each pattern", () => {
      expect(boxChar(0)).toBe(" ");
      expect(boxChar(UP | DOWN)).toBe("\u2502"); // │
      expect(boxChar(LEFT | RIGHT)).toBe("\u2500"); // ─
      expect(boxChar(UP | RIGHT | DOWN | LEFT)).toBe("\u253C"); // ┼
    });

    it("masks to 4 bits, ignoring higher bits", () => {
      // Pattern 0x13 = 0x10 | 0x3 => should mask to 0x3 = UP|RIGHT = └
      expect(boxChar(0x13)).toBe(boxChar(UP | RIGHT));
    });
  });

  describe("mergeBoxPatterns()", () => {
    it("ORs two patterns together", () => {
      expect(mergeBoxPatterns(UP, DOWN)).toBe(UP | DOWN);
      expect(mergeBoxPatterns(LEFT, RIGHT)).toBe(LEFT | RIGHT);
    });

    it("horizontal + vertical = cross", () => {
      const horiz = LEFT | RIGHT;
      const vert = UP | DOWN;
      const merged = mergeBoxPatterns(horiz, vert);
      expect(merged).toBe(UP | RIGHT | DOWN | LEFT);
      expect(boxChar(merged)).toBe("\u253C"); // ┼
    });

    it("merging with BOX_NONE is identity", () => {
      expect(mergeBoxPatterns(UP | RIGHT, BOX_NONE)).toBe(UP | RIGHT);
      expect(mergeBoxPatterns(BOX_NONE, DOWN | LEFT)).toBe(DOWN | LEFT);
    });

    it("merging a pattern with itself is idempotent", () => {
      const p = UP | RIGHT | DOWN;
      expect(mergeBoxPatterns(p, p)).toBe(p);
    });

    it("masks result to 4 bits", () => {
      expect(mergeBoxPatterns(0xff, 0x00)).toBe(0x0f);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
//  SYMBOL
// ═══════════════════════════════════════════════════════════════════

describe("symbol", () => {
  describe("charWidth()", () => {
    it("ASCII characters are width 1", () => {
      expect(charWidth("A".codePointAt(0)!)).toBe(1);
      expect(charWidth(" ".codePointAt(0)!)).toBe(1);
      expect(charWidth("~".codePointAt(0)!)).toBe(1);
      expect(charWidth("0".codePointAt(0)!)).toBe(1);
    });

    it("CJK Unified Ideographs are width 2", () => {
      // U+4E00 (first CJK Unified Ideograph)
      expect(charWidth(0x4e00)).toBe(2);
      // U+9FFF (last CJK Unified Ideograph)
      expect(charWidth(0x9fff)).toBe(2);
    });

    it("Hiragana characters are width 2", () => {
      // U+3042 = あ
      expect(charWidth(0x3042)).toBe(2);
    });

    it("Katakana characters are width 2", () => {
      // U+30A2 = ア
      expect(charWidth(0x30a2)).toBe(2);
    });

    it("Hangul syllables are width 2", () => {
      // U+AC00 = 가
      expect(charWidth(0xac00)).toBe(2);
    });

    it("Fullwidth forms are width 2", () => {
      // U+FF01 = ！ (fullwidth exclamation mark)
      expect(charWidth(0xff01)).toBe(2);
    });

    it("CJK Extension B characters are width 2", () => {
      expect(charWidth(0x20000)).toBe(2);
    });

    it("Latin Extended characters are width 1", () => {
      // U+00E9 = é
      expect(charWidth(0x00e9)).toBe(1);
    });

    it("Emoji (outside CJK ranges) default to width 1", () => {
      // U+1F600 = grinning face (not in covered CJK ranges)
      expect(charWidth(0x1f600)).toBe(1);
    });
  });

  describe("sym() factory", () => {
    it("creates a symbol with auto-detected width 1 for ASCII", () => {
      const s = sym("A");
      expect(s.text).toBe("A");
      expect(s.width).toBe(1);
      expect(s.pattern).toBe(0);
    });

    it("creates a symbol with auto-detected width 2 for CJK", () => {
      const s = sym("\u4E00"); // 一
      expect(s.text).toBe("\u4E00");
      expect(s.width).toBe(2);
      expect(s.pattern).toBe(0);
    });

    it("creates a symbol with a box pattern", () => {
      const s = sym("\u2500", LEFT | RIGHT);
      expect(s.text).toBe("\u2500");
      expect(s.width).toBe(1); // box patterns force width 1
      expect(s.pattern).toBe(LEFT | RIGHT);
    });

    it("forces width 1 when pattern is non-zero regardless of char", () => {
      // Even though 一 is CJK wide, a box pattern overrides to width 1
      const s = sym("\u4E00", UP);
      expect(s.width).toBe(1);
    });
  });

  describe("EMPTY_SYMBOL constant", () => {
    it("is a space with width 1 and no pattern", () => {
      expect(EMPTY_SYMBOL).toEqual({ text: " ", width: 1, pattern: 0 });
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
//  FOREGROUND
// ═══════════════════════════════════════════════════════════════════

describe("foreground", () => {
  describe("foreground() factory", () => {
    it("creates a foreground with defaults", () => {
      const fg = foreground();
      expect(fg.symbol).toBe(EMPTY_SYMBOL);
      expect(fg.color).toBe(TRANSPARENT);
      expect(fg.bold).toBe(false);
      expect(fg.italic).toBe(false);
      expect(fg.underline).toBe(false);
      expect(fg.strikethrough).toBe(false);
    });

    it("accepts a symbol and color", () => {
      const s = sym("X");
      const fg = foreground(s, RED);
      expect(fg.symbol).toBe(s);
      expect(fg.color).toBe(RED);
    });

    it("accepts style options", () => {
      const fg = foreground(sym("B"), WHITE, {
        bold: true,
        italic: true,
        underline: true,
        strikethrough: true,
      });
      expect(fg.bold).toBe(true);
      expect(fg.italic).toBe(true);
      expect(fg.underline).toBe(true);
      expect(fg.strikethrough).toBe(true);
    });

    it("partial style options default unset flags to false", () => {
      const fg = foreground(sym("X"), WHITE, { bold: true });
      expect(fg.bold).toBe(true);
      expect(fg.italic).toBe(false);
      expect(fg.underline).toBe(false);
      expect(fg.strikethrough).toBe(false);
    });
  });

  describe("EMPTY_FOREGROUND constant", () => {
    it("has empty symbol, transparent color, no styles", () => {
      expect(EMPTY_FOREGROUND.symbol).toEqual(EMPTY_SYMBOL);
      expect(EMPTY_FOREGROUND.color).toEqual(TRANSPARENT);
      expect(EMPTY_FOREGROUND.bold).toBe(false);
      expect(EMPTY_FOREGROUND.italic).toBe(false);
      expect(EMPTY_FOREGROUND.underline).toBe(false);
      expect(EMPTY_FOREGROUND.strikethrough).toBe(false);
    });
  });

  describe("blendForeground()", () => {
    it("transparent space above returns below unchanged", () => {
      const below = foreground(sym("A"), RED, { bold: true });
      const above = foreground(EMPTY_SYMBOL, TRANSPARENT);
      expect(blendForeground(above, below)).toBe(below);
    });

    it("opaque character above replaces below symbol", () => {
      const below = foreground(sym("A"), RED);
      const above = foreground(sym("B"), BLUE);
      const result = blendForeground(above, below);
      expect(result.symbol.text).toBe("B");
    });

    it("opaque space above with non-transparent color lets below symbol show through", () => {
      const below = foreground(sym("A"), RED);
      const above = foreground(EMPTY_SYMBOL, WHITE);
      const result = blendForeground(above, below);
      // Space with opaque color: below symbol shows through, colors blend
      expect(result.symbol.text).toBe("A");
    });

    it("merges box patterns when both have them", () => {
      const below = foreground(sym(boxChar(LEFT | RIGHT), LEFT | RIGHT), RED);
      const above = foreground(sym(boxChar(UP | DOWN), UP | DOWN), BLUE);
      const result = blendForeground(above, below);
      expect(result.symbol.pattern).toBe(UP | RIGHT | DOWN | LEFT);
      expect(result.symbol.text).toBe("\u253C"); // ┼
    });

    it("merges style flags via OR when both have box patterns", () => {
      const below = foreground(sym(boxChar(LEFT | RIGHT), LEFT | RIGHT), RED, {
        bold: true,
      });
      const above = foreground(sym(boxChar(UP | DOWN), UP | DOWN), BLUE, {
        italic: true,
      });
      const result = blendForeground(above, below);
      expect(result.bold).toBe(true);
      expect(result.italic).toBe(true);
    });

    it("non-space above takes its own style flags", () => {
      const below = foreground(sym("A"), RED, { bold: true, underline: true });
      const above = foreground(sym("B"), BLUE, { italic: true });
      const result = blendForeground(above, below);
      expect(result.bold).toBe(false);
      expect(result.italic).toBe(true);
      expect(result.underline).toBe(false);
    });

    it("space above (with opaque color) takes below's style flags", () => {
      const below = foreground(sym("A"), RED, { bold: true, underline: true });
      const above = foreground(EMPTY_SYMBOL, WHITE);
      const result = blendForeground(above, below);
      expect(result.bold).toBe(true);
      expect(result.underline).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
//  BACKGROUND
// ═══════════════════════════════════════════════════════════════════

describe("background", () => {
  describe("background() factory", () => {
    it("defaults to transparent", () => {
      const bg = background();
      expect(bg.color).toEqual(TRANSPARENT);
    });

    it("accepts a color", () => {
      const bg = background(RED);
      expect(bg.color).toEqual(RED);
    });
  });

  describe("EMPTY_BACKGROUND constant", () => {
    it("has transparent color", () => {
      expect(EMPTY_BACKGROUND.color).toEqual(TRANSPARENT);
    });
  });

  describe("blendBackground()", () => {
    it("opaque above replaces below", () => {
      const result = blendBackground(background(RED), background(BLUE));
      expect(result.color).toEqual(RED);
    });

    it("transparent above returns below", () => {
      const result = blendBackground(
        background(TRANSPARENT),
        background(GREEN),
      );
      expect(result.color).toEqual(GREEN);
    });

    it("semi-transparent above blends with below", () => {
      const above = background(color(255, 0, 0, 128));
      const below = background(BLACK);
      const result = blendBackground(above, below);
      expect(result.color.a).toBe(255);
      expect(result.color.r).toBeGreaterThan(100);
      expect(result.color.g).toBe(0);
      expect(result.color.b).toBe(0);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
//  PIXEL
// ═══════════════════════════════════════════════════════════════════

describe("pixel", () => {
  describe("pixel() factory", () => {
    it("creates a pixel with defaults", () => {
      const p = pixel();
      expect(p.foreground).toBe(EMPTY_FOREGROUND);
      expect(p.background).toBe(EMPTY_BACKGROUND);
    });

    it("accepts foreground and background", () => {
      const fg = foreground(sym("X"), RED);
      const bg = background(BLUE);
      const p = pixel(fg, bg);
      expect(p.foreground).toBe(fg);
      expect(p.background).toBe(bg);
    });
  });

  describe("PIXEL_EMPTY constant", () => {
    it("has empty foreground and background", () => {
      expect(PIXEL_EMPTY.foreground).toEqual(EMPTY_FOREGROUND);
      expect(PIXEL_EMPTY.background).toEqual(EMPTY_BACKGROUND);
    });
  });

  describe("PIXEL_SPACE constant", () => {
    it("has space symbol and transparent colors", () => {
      expect(PIXEL_SPACE.foreground.symbol).toEqual(EMPTY_SYMBOL);
      expect(PIXEL_SPACE.foreground.color).toEqual(TRANSPARENT);
      expect(PIXEL_SPACE.background.color).toEqual(TRANSPARENT);
    });

    it("has no style flags set", () => {
      expect(PIXEL_SPACE.foreground.bold).toBe(false);
      expect(PIXEL_SPACE.foreground.italic).toBe(false);
      expect(PIXEL_SPACE.foreground.underline).toBe(false);
      expect(PIXEL_SPACE.foreground.strikethrough).toBe(false);
    });
  });

  describe("blendPixel()", () => {
    it("composites foreground and background independently", () => {
      const below = pixel(foreground(sym("A"), RED), background(BLUE));
      const above = pixel(
        foreground(sym("B"), GREEN),
        background(color(255, 0, 0, 128)),
      );
      const result = blendPixel(above, below);
      // Foreground: above has 'B', which should replace 'A'
      expect(result.foreground.symbol.text).toBe("B");
      // Background: semi-transparent red over opaque blue => blended
      expect(result.background.color.a).toBe(255);
    });

    it("transparent pixel over content returns content", () => {
      const below = pixel(foreground(sym("X"), WHITE), background(RED));
      const result = blendPixel(PIXEL_EMPTY, below);
      // PIXEL_EMPTY fg is transparent space, so below shows through
      expect(result.foreground.symbol.text).toBe("X");
      expect(result.background.color).toEqual(RED);
    });

    it("content pixel over empty replaces empty", () => {
      const above = pixel(foreground(sym("Z"), BLUE), background(GREEN));
      const result = blendPixel(above, PIXEL_EMPTY);
      expect(result.foreground.symbol.text).toBe("Z");
      expect(result.background.color).toEqual(GREEN);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
//  BUFFER
// ═══════════════════════════════════════════════════════════════════

describe("PixelBuffer", () => {
  describe("constructor", () => {
    it("creates a buffer with correct dimensions", () => {
      const buf = new PixelBuffer(10, 5);
      expect(buf.width).toBe(10);
      expect(buf.height).toBe(5);
    });

    it("initializes all cells to PIXEL_SPACE", () => {
      const buf = new PixelBuffer(3, 3);
      for (let y = 0; y < 3; y++) {
        for (let x = 0; x < 3; x++) {
          expect(buf.get(x, y)).toBe(PIXEL_SPACE);
        }
      }
    });
  });

  describe("get/set round-trip", () => {
    it("retrieves a previously set pixel", () => {
      const buf = new PixelBuffer(5, 5);
      const p = pixel(foreground(sym("Q"), RED), background(BLUE));
      buf.set(2, 3, p);
      expect(buf.get(2, 3)).toBe(p);
    });

    it("setting a pixel does not affect other cells", () => {
      const buf = new PixelBuffer(5, 5);
      const p = pixel(foreground(sym("Q"), RED), background(BLUE));
      buf.set(2, 3, p);
      expect(buf.get(0, 0)).toBe(PIXEL_SPACE);
      expect(buf.get(4, 4)).toBe(PIXEL_SPACE);
      expect(buf.get(2, 2)).toBe(PIXEL_SPACE);
      expect(buf.get(3, 3)).toBe(PIXEL_SPACE);
    });

    it("can overwrite a cell", () => {
      const buf = new PixelBuffer(5, 5);
      const p1 = pixel(foreground(sym("A"), RED));
      const p2 = pixel(foreground(sym("B"), BLUE));
      buf.set(1, 1, p1);
      buf.set(1, 1, p2);
      expect(buf.get(1, 1)).toBe(p2);
    });
  });

  describe("out of bounds access", () => {
    it("get returns PIXEL_SPACE for negative coordinates", () => {
      const buf = new PixelBuffer(5, 5);
      expect(buf.get(-1, 0)).toBe(PIXEL_SPACE);
      expect(buf.get(0, -1)).toBe(PIXEL_SPACE);
      expect(buf.get(-1, -1)).toBe(PIXEL_SPACE);
    });

    it("get returns PIXEL_SPACE for coordinates beyond bounds", () => {
      const buf = new PixelBuffer(5, 5);
      expect(buf.get(5, 0)).toBe(PIXEL_SPACE);
      expect(buf.get(0, 5)).toBe(PIXEL_SPACE);
      expect(buf.get(100, 100)).toBe(PIXEL_SPACE);
    });

    it("set silently ignores out-of-bounds writes", () => {
      const buf = new PixelBuffer(5, 5);
      const p = pixel(foreground(sym("X"), RED));
      // These should not throw
      buf.set(-1, 0, p);
      buf.set(0, -1, p);
      buf.set(5, 0, p);
      buf.set(0, 5, p);
      buf.set(100, 100, p);
      // Buffer should remain unchanged
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 5; x++) {
          expect(buf.get(x, y)).toBe(PIXEL_SPACE);
        }
      }
    });
  });

  describe("fill()", () => {
    it("fills a rectangular region", () => {
      const buf = new PixelBuffer(5, 5);
      const p = pixel(foreground(sym("F"), GREEN), background(RED));
      buf.fill({ x: 1, y: 1, width: 3, height: 2 }, p);

      // Inside the rect
      for (let y = 1; y <= 2; y++) {
        for (let x = 1; x <= 3; x++) {
          expect(buf.get(x, y)).toBe(p);
        }
      }
      // Outside the rect
      expect(buf.get(0, 0)).toBe(PIXEL_SPACE);
      expect(buf.get(4, 4)).toBe(PIXEL_SPACE);
      expect(buf.get(0, 1)).toBe(PIXEL_SPACE);
      expect(buf.get(4, 1)).toBe(PIXEL_SPACE);
    });

    it("clips to buffer bounds when rect extends beyond", () => {
      const buf = new PixelBuffer(3, 3);
      const p = pixel(foreground(sym("C"), BLUE));
      buf.fill({ x: -1, y: -1, width: 5, height: 5 }, p);

      // All cells should be filled since the clipped rect covers the entire buffer
      for (let y = 0; y < 3; y++) {
        for (let x = 0; x < 3; x++) {
          expect(buf.get(x, y)).toBe(p);
        }
      }
    });

    it("handles rect fully outside the buffer (no-op)", () => {
      const buf = new PixelBuffer(3, 3);
      const p = pixel(foreground(sym("X"), RED));
      buf.fill({ x: 10, y: 10, width: 5, height: 5 }, p);

      for (let y = 0; y < 3; y++) {
        for (let x = 0; x < 3; x++) {
          expect(buf.get(x, y)).toBe(PIXEL_SPACE);
        }
      }
    });

    it("handles zero-size rect (no-op)", () => {
      const buf = new PixelBuffer(3, 3);
      const p = pixel(foreground(sym("X"), RED));
      buf.fill({ x: 0, y: 0, width: 0, height: 0 }, p);

      expect(buf.get(0, 0)).toBe(PIXEL_SPACE);
    });
  });

  describe("clear()", () => {
    it("resets all cells to PIXEL_SPACE", () => {
      const buf = new PixelBuffer(3, 3);
      const p = pixel(foreground(sym("D"), MAGENTA));

      // Fill buffer with content
      for (let y = 0; y < 3; y++) {
        for (let x = 0; x < 3; x++) {
          buf.set(x, y, p);
        }
      }

      buf.clear();

      // All cells should be PIXEL_SPACE again
      for (let y = 0; y < 3; y++) {
        for (let x = 0; x < 3; x++) {
          expect(buf.get(x, y)).toBe(PIXEL_SPACE);
        }
      }
    });
  });
});
