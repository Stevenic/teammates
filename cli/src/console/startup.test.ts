import { describe, expect, it } from "vitest";
import { buildTitle } from "./startup.js";

describe("buildTitle", () => {
  it("produces two-line output for known characters", () => {
    const [top, bot] = buildTitle("team");
    // "t", "e", "a", "m" are all known glyphs
    expect(top.length).toBeGreaterThan(0);
    expect(bot.length).toBeGreaterThan(0);
    // Should contain glyph fragments
    expect(top).toContain("▀");
    expect(bot).toContain("█");
  });

  it("renders a single character", () => {
    const [top, bot] = buildTitle("t");
    expect(top).toBe("▀█▀");
    expect(bot).toBe(" █ ");
  });

  it("renders a multi-character word with spaces between glyphs", () => {
    const [top, bot] = buildTitle("te");
    // "t" top = "▀█▀", "e" top = "█▀▀" => joined with space
    expect(top).toBe("▀█▀ █▀▀");
    expect(bot).toBe(" █  ██▄");
  });

  it("returns empty strings for an empty input", () => {
    const [top, bot] = buildTitle("");
    expect(top).toBe("");
    expect(bot).toBe("");
  });

  it("skips unknown characters", () => {
    const [top, bot] = buildTitle("z");
    // "z" is not in the GLYPHS map
    expect(top).toBe("");
    expect(bot).toBe("");
  });

  it("handles mixed known and unknown characters", () => {
    const [top, bot] = buildTitle("txe");
    // "x" is unknown, so only "t" and "e" glyphs appear
    expect(top).toBe("▀█▀ █▀▀");
    expect(bot).toBe(" █  ██▄");
  });
});
