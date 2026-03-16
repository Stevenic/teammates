import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  findAtMention,
  IMAGE_EXTS,
  isImagePath,
  relativeTime,
  wrapLine,
} from "./cli-utils.js";

// ── relativeTime ────────────────────────────────────────────────────

describe("relativeTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns seconds ago for < 60s", () => {
    vi.setSystemTime(new Date("2026-03-15T12:00:30Z"));
    const date = new Date("2026-03-15T12:00:00Z");
    expect(relativeTime(date)).toBe("30s ago");
  });

  it("returns 0s ago for just now", () => {
    const now = new Date("2026-03-15T12:00:00Z");
    vi.setSystemTime(now);
    expect(relativeTime(now)).toBe("0s ago");
  });

  it("returns minutes ago for 1-59 minutes", () => {
    vi.setSystemTime(new Date("2026-03-15T12:05:00Z"));
    const date = new Date("2026-03-15T12:00:00Z");
    expect(relativeTime(date)).toBe("5m ago");
  });

  it("returns 59m ago at the boundary", () => {
    vi.setSystemTime(new Date("2026-03-15T12:59:59Z"));
    const date = new Date("2026-03-15T12:00:00Z");
    expect(relativeTime(date)).toBe("59m ago");
  });

  it("returns hours ago for >= 60 minutes", () => {
    vi.setSystemTime(new Date("2026-03-15T15:00:00Z"));
    const date = new Date("2026-03-15T12:00:00Z");
    expect(relativeTime(date)).toBe("3h ago");
  });

  it("returns large hour counts", () => {
    vi.setSystemTime(new Date("2026-03-16T12:00:00Z"));
    const date = new Date("2026-03-15T12:00:00Z");
    expect(relativeTime(date)).toBe("24h ago");
  });
});

// ── wrapLine ────────────────────────────────────────────────────────

describe("wrapLine", () => {
  it("returns the text unchanged if it fits within maxWidth", () => {
    expect(wrapLine("hello world", 80)).toEqual(["hello world"]);
  });

  it("returns single-element array for empty string", () => {
    expect(wrapLine("", 40)).toEqual([""]);
  });

  it("wraps at the last space before maxWidth", () => {
    const result = wrapLine("hello world foo bar", 11);
    expect(result).toEqual(["hello world", "foo bar"]);
  });

  it("wraps long text into multiple lines", () => {
    const text = "one two three four five six";
    const result = wrapLine(text, 10);
    // "one two" (7) fits, "three" next
    expect(result.length).toBeGreaterThan(1);
    for (const line of result) {
      expect(line.length).toBeLessThanOrEqual(10);
    }
  });

  it("hard-breaks when no space is found", () => {
    const result = wrapLine("abcdefghij", 5);
    expect(result).toEqual(["abcde", "fghij"]);
  });

  it("handles text exactly at maxWidth", () => {
    expect(wrapLine("12345", 5)).toEqual(["12345"]);
  });

  it("handles maxWidth of 1 with spaces", () => {
    const result = wrapLine("a b", 1);
    // Each character should end up on its own line
    expect(result.length).toBeGreaterThan(1);
  });
});

// ── findAtMention ───────────────────────────────────────────────────

describe("findAtMention", () => {
  it("returns null when no @ is present", () => {
    expect(findAtMention("hello world", 5)).toBeNull();
  });

  it("finds @mention at cursor position", () => {
    const result = findAtMention("@beacon", 4);
    expect(result).toEqual({ before: "", partial: "bea", atPos: 0 });
  });

  it("finds @mention at end of input", () => {
    const result = findAtMention("@beacon", 7);
    expect(result).toEqual({ before: "", partial: "beacon", atPos: 0 });
  });

  it("finds @mention after text", () => {
    const result = findAtMention("hello @scribe", 13);
    expect(result).toEqual({ before: "hello ", partial: "scribe", atPos: 6 });
  });

  it("returns null when @ is preceded by non-whitespace", () => {
    expect(findAtMention("email@example", 13)).toBeNull();
  });

  it("returns empty partial when cursor is right after @", () => {
    const result = findAtMention("hello @", 7);
    expect(result).toEqual({ before: "hello ", partial: "", atPos: 6 });
  });

  it("returns null when partial contains spaces", () => {
    // "@ foo bar" — after @, there's a space, so partial has whitespace
    expect(findAtMention("@ foo bar", 9)).toBeNull();
  });

  it("finds mention at start of line with cursor mid-word", () => {
    const result = findAtMention("@sc", 3);
    expect(result).toEqual({ before: "", partial: "sc", atPos: 0 });
  });

  it("finds the last @ when multiple exist", () => {
    const result = findAtMention("@beacon hello @scribe", 21);
    expect(result).toEqual({
      before: "@beacon hello ",
      partial: "scribe",
      atPos: 14,
    });
  });
});

// ── isImagePath ─────────────────────────────────────────────────────

describe("isImagePath", () => {
  it("recognizes Unix-style image paths", () => {
    expect(isImagePath("/home/user/photo.png")).toBe(true);
    expect(isImagePath("/tmp/image.jpg")).toBe(true);
    expect(isImagePath("/tmp/image.jpeg")).toBe(true);
    expect(isImagePath("/tmp/image.gif")).toBe(true);
    expect(isImagePath("/tmp/image.bmp")).toBe(true);
    expect(isImagePath("/tmp/image.webp")).toBe(true);
    expect(isImagePath("/tmp/image.svg")).toBe(true);
    expect(isImagePath("/tmp/image.ico")).toBe(true);
  });

  it("recognizes Windows-style image paths", () => {
    expect(isImagePath("C:\\Users\\me\\photo.png")).toBe(true);
    expect(isImagePath("D:\\images\\test.jpg")).toBe(true);
  });

  it("recognizes drive-letter paths without backslash", () => {
    expect(isImagePath("C:photo.png")).toBe(true);
  });

  it("is case-insensitive for extensions", () => {
    expect(isImagePath("/tmp/photo.PNG")).toBe(true);
    expect(isImagePath("/tmp/photo.Jpg")).toBe(true);
  });

  it("rejects non-image extensions", () => {
    expect(isImagePath("/tmp/file.txt")).toBe(false);
    expect(isImagePath("/tmp/file.ts")).toBe(false);
    expect(isImagePath("/tmp/file.pdf")).toBe(false);
  });

  it("rejects strings without path separators or drive letters", () => {
    expect(isImagePath("photo.png")).toBe(false);
    expect(isImagePath("image.jpg")).toBe(false);
  });

  it("rejects strings with newlines", () => {
    expect(isImagePath("/tmp/photo.png\nextra")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isImagePath("")).toBe(false);
  });

  it("rejects path with no extension", () => {
    expect(isImagePath("/tmp/noext")).toBe(false);
  });
});

// ── IMAGE_EXTS ──────────────────────────────────────────────────────

describe("IMAGE_EXTS", () => {
  it("contains expected extensions", () => {
    const expected = [
      ".png",
      ".jpg",
      ".jpeg",
      ".gif",
      ".bmp",
      ".webp",
      ".svg",
      ".ico",
    ];
    for (const ext of expected) {
      expect(IMAGE_EXTS.has(ext)).toBe(true);
    }
  });

  it("has exactly 8 entries", () => {
    expect(IMAGE_EXTS.size).toBe(8);
  });
});
