import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_THEME,
  colorToHex,
  setTheme,
  theme,
  tp,
} from "./theme.js";

describe("theme", () => {
  afterEach(() => {
    // Restore default theme after each test
    setTheme(DEFAULT_THEME);
  });

  it("returns the default theme initially", () => {
    const t = theme();
    expect(t.accent).toEqual(DEFAULT_THEME.accent);
    expect(t.text).toEqual(DEFAULT_THEME.text);
    expect(t.success).toEqual(DEFAULT_THEME.success);
  });

  it("setTheme replaces the active theme", () => {
    const custom = {
      ...DEFAULT_THEME,
      accent: { r: 255, g: 0, b: 0 },
    };
    setTheme(custom);
    expect(theme().accent).toEqual({ r: 255, g: 0, b: 0 });
  });

  it("setTheme creates a copy (not a reference)", () => {
    const custom = { ...DEFAULT_THEME };
    setTheme(custom);
    custom.accent = { r: 0, g: 0, b: 0 };
    // Should not be affected by mutation
    expect(theme().accent).toEqual(DEFAULT_THEME.accent);
  });
});

describe("colorToHex", () => {
  it("converts RGB to uppercase hex string", () => {
    expect(colorToHex({ r: 58, g: 150, b: 221 })).toBe("#3A96DD");
  });

  it("pads single-digit hex values with zero", () => {
    expect(colorToHex({ r: 0, g: 0, b: 0 })).toBe("#000000");
  });

  it("converts white correctly", () => {
    expect(colorToHex({ r: 255, g: 255, b: 255 })).toBe("#FFFFFF");
  });

  it("converts mid-range values", () => {
    expect(colorToHex({ r: 128, g: 64, b: 32 })).toBe("#804020");
  });
});

describe("tp (themed pen shortcuts)", () => {
  // tp functions return StyledSpan (StyledSegment[] with __brand)
  // Each span contains segments with { text, style } entries

  it("accent returns a styled span with correct text", () => {
    const result = tp.accent("hello");
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("hello");
  });

  it("muted returns a styled span with correct text", () => {
    const result = tp.muted("test");
    expect(Array.isArray(result)).toBe(true);
    expect(result[0].text).toBe("test");
  });

  it("success returns a styled span with correct text", () => {
    const result = tp.success("ok");
    expect(Array.isArray(result)).toBe(true);
    expect(result[0].text).toBe("ok");
  });

  it("error returns a styled span with correct text", () => {
    const result = tp.error("fail");
    expect(Array.isArray(result)).toBe(true);
    expect(result[0].text).toBe("fail");
  });

  it("bold returns a styled span with correct text", () => {
    const result = tp.bold("strong");
    expect(Array.isArray(result)).toBe(true);
    expect(result[0].text).toBe("strong");
  });

  it("accent uses the current theme color", () => {
    const result = tp.accent("x");
    expect(result[0].style.fg).toEqual(DEFAULT_THEME.accent);
  });

  it("picks up theme changes", () => {
    const custom = { ...DEFAULT_THEME, error: { r: 1, g: 2, b: 3 } };
    setTheme(custom);
    const result = tp.error("x");
    expect(result[0].style.fg).toEqual({ r: 1, g: 2, b: 3 });
  });

  it("accentBright returns a styled span", () => {
    const result = tp.accentBright("x");
    expect(result[0].text).toBe("x");
    expect(result[0].style.fg).toEqual(DEFAULT_THEME.accentBright);
  });

  it("accentDim returns a styled span", () => {
    const result = tp.accentDim("x");
    expect(result[0].text).toBe("x");
    expect(result[0].style.fg).toEqual(DEFAULT_THEME.accentDim);
  });

  it("text returns a styled span", () => {
    const result = tp.text("x");
    expect(result[0].text).toBe("x");
    expect(result[0].style.fg).toEqual(DEFAULT_THEME.text);
  });

  it("dim returns a styled span", () => {
    const result = tp.dim("x");
    expect(result[0].text).toBe("x");
    expect(result[0].style.fg).toEqual(DEFAULT_THEME.textDim);
  });

  it("info returns a styled span", () => {
    const result = tp.info("x");
    expect(result[0].text).toBe("x");
    expect(result[0].style.fg).toEqual(DEFAULT_THEME.info);
  });

  it("warning returns a styled span", () => {
    const result = tp.warning("x");
    expect(result[0].text).toBe("x");
    expect(result[0].style.fg).toEqual(DEFAULT_THEME.warning);
  });
});
