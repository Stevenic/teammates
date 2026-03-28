import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildConversationContext,
  buildSummarizationPrompt,
  type ConversationEntry,
  cleanResponseBody,
  compressConversationEntries,
  findAtMention,
  findSummarizationSplit,
  formatConversationEntry,
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

// ── cleanResponseBody ──────────────────────────────────────────────

describe("cleanResponseBody", () => {
  it("strips TO: header", () => {
    const raw = "TO: user\n# Subject\n\nBody text here";
    expect(cleanResponseBody(raw)).toBe("# Subject\n\nBody text here");
  });

  it("strips TO: header case-insensitively", () => {
    const raw = "to: User\n# Subject\n\nBody text here";
    expect(cleanResponseBody(raw)).toBe("# Subject\n\nBody text here");
  });

  it("strips handoff blocks", () => {
    const raw =
      "Some text\n\n```handoff\n@scribe\nDo this task\n```\n\nMore text";
    expect(cleanResponseBody(raw)).toContain("Some text");
    expect(cleanResponseBody(raw)).toContain("More text");
    expect(cleanResponseBody(raw)).not.toContain("handoff");
    expect(cleanResponseBody(raw)).not.toContain("@scribe");
  });

  it("strips multiple handoff blocks", () => {
    const raw =
      "Text\n```handoff\n@scribe\ntask1\n```\nmiddle\n```handoff\n@beacon\ntask2\n```\nend";
    expect(cleanResponseBody(raw)).toBe("Text\n\nmiddle\n\nend");
  });

  it("strips trailing JSON blocks", () => {
    const raw = 'Body text\n\n```json\n{ "summary": "done" }\n```';
    expect(cleanResponseBody(raw)).toBe("Body text");
  });

  it("strips all protocol artifacts together", () => {
    const raw =
      'TO: user\n# Done\n\nI finished the task.\n\n```handoff\n@pipeline\nDeploy it\n```\n\n```json\n{ "summary": "Done" }\n```';
    expect(cleanResponseBody(raw)).toBe("# Done\n\nI finished the task.");
  });

  it("returns empty string for empty input", () => {
    expect(cleanResponseBody("")).toBe("");
  });

  it("returns body unchanged when no protocol artifacts exist", () => {
    expect(cleanResponseBody("Just a plain message")).toBe(
      "Just a plain message",
    );
  });

  it("trims surrounding whitespace", () => {
    expect(cleanResponseBody("  \n  Hello  \n  ")).toBe("Hello");
  });
});

// ── formatConversationEntry ────────────────────────────────────────

describe("formatConversationEntry", () => {
  it("formats single-line text inline", () => {
    expect(formatConversationEntry("scribe", "Task completed")).toBe(
      "**scribe:** Task completed\n",
    );
  });

  it("formats multi-line text with body on next line", () => {
    expect(formatConversationEntry("beacon", "Line 1\nLine 2")).toBe(
      "**beacon:**\nLine 1\nLine 2\n",
    );
  });

  it("treats single line with no newline as inline", () => {
    expect(formatConversationEntry("user", "hello")).toBe("**user:** hello\n");
  });
});

// ── buildConversationContext ────────────────────────────────────────

describe("buildConversationContext", () => {
  it("returns empty string for empty history and no summary", () => {
    expect(buildConversationContext([], "", 1000)).toBe("");
  });

  it("includes summary when present", () => {
    const result = buildConversationContext(
      [],
      "Previous topics discussed",
      1000,
    );
    expect(result).toContain("## Conversation History");
    expect(result).toContain("### Previous Conversation Summary");
    expect(result).toContain("Previous topics discussed");
  });

  it("includes all entries when within budget", () => {
    const history: ConversationEntry[] = [
      { role: "stevenic", text: "Hello" },
      { role: "scribe", text: "Hi there" },
      { role: "stevenic", text: "Do the thing" },
    ];
    const result = buildConversationContext(history, "", 10_000);
    expect(result).toContain("**stevenic:** Hello");
    expect(result).toContain("**scribe:** Hi there");
    expect(result).toContain("**stevenic:** Do the thing");
  });

  it("drops oldest entries when over budget", () => {
    const history: ConversationEntry[] = [
      { role: "old", text: "A".repeat(500) },
      { role: "mid", text: "B".repeat(500) },
      { role: "new", text: "C".repeat(500) },
    ];
    // Budget enough for ~2 entries but not 3
    const budget = 1100;
    const result = buildConversationContext(history, "", budget);
    expect(result).not.toContain("**old:**");
    expect(result).toContain("**new:**");
  });

  it("always includes at least the newest entry even if over budget", () => {
    const history: ConversationEntry[] = [
      { role: "beacon", text: "A".repeat(2000) },
    ];
    const result = buildConversationContext(history, "", 100);
    expect(result).toContain("**beacon:**");
  });

  it("formats multi-line entries with body on next line", () => {
    const history: ConversationEntry[] = [
      { role: "scribe", text: "Line 1\nLine 2\nLine 3" },
    ];
    const result = buildConversationContext(history, "", 10_000);
    expect(result).toContain("**scribe:**\nLine 1\nLine 2\nLine 3");
  });

  it("includes both summary and entries", () => {
    const history: ConversationEntry[] = [
      { role: "stevenic", text: "Latest message" },
    ];
    const result = buildConversationContext(
      history,
      "Earlier we discussed X",
      10_000,
    );
    expect(result).toContain("### Previous Conversation Summary");
    expect(result).toContain("Earlier we discussed X");
    expect(result).toContain("**stevenic:** Latest message");
  });
});

// ── findSummarizationSplit ─────────────────────────────────────────

describe("findSummarizationSplit", () => {
  it("returns 0 when everything fits in budget", () => {
    const history: ConversationEntry[] = [
      { role: "a", text: "short" },
      { role: "b", text: "also short" },
    ];
    expect(findSummarizationSplit(history, 10_000)).toBe(0);
  });

  it("returns 0 for empty history", () => {
    expect(findSummarizationSplit([], 1000)).toBe(0);
  });

  it("returns split index when history exceeds budget", () => {
    const history: ConversationEntry[] = [
      { role: "old1", text: "A".repeat(400) },
      { role: "old2", text: "B".repeat(400) },
      { role: "new1", text: "C".repeat(400) },
      { role: "new2", text: "D".repeat(400) },
    ];
    // Budget fits ~2 entries (~430 chars each with formatting)
    const budget = 900;
    const split = findSummarizationSplit(history, budget);
    expect(split).toBeGreaterThan(0);
    expect(split).toBeLessThan(history.length);
  });

  it("keeps newest entries and pushes oldest out", () => {
    const history: ConversationEntry[] = [
      { role: "oldest", text: "X".repeat(300) },
      { role: "middle", text: "Y".repeat(300) },
      { role: "newest", text: "Z".repeat(300) },
    ];
    // Budget fits 1 entry
    const budget = 350;
    const split = findSummarizationSplit(history, budget);
    // Split should be 2 — entries 0 and 1 get summarized, entry 2 (newest) stays
    expect(split).toBe(2);
  });

  it("returns 0 when single entry fits", () => {
    const history: ConversationEntry[] = [{ role: "a", text: "hello" }];
    expect(findSummarizationSplit(history, 10_000)).toBe(0);
  });
});

// ── buildSummarizationPrompt ───────────────────────────────────────

describe("buildSummarizationPrompt", () => {
  const entries: ConversationEntry[] = [
    { role: "stevenic", text: "Build the feature" },
    { role: "beacon", text: "Done, here's what I did" },
  ];

  it("builds a fresh summarization prompt when no existing summary", () => {
    const prompt = buildSummarizationPrompt(entries, "");
    expect(prompt).toContain("Summarize the conversation entries below");
    expect(prompt).toContain("**stevenic:** Build the feature");
    expect(prompt).toContain("**beacon:** Done, here's what I did");
    expect(prompt).not.toContain("Current Summary");
  });

  it("builds an update prompt when existing summary is present", () => {
    const prompt = buildSummarizationPrompt(entries, "Previously discussed X");
    expect(prompt).toContain("Update the existing summary");
    expect(prompt).toContain("## Current Summary");
    expect(prompt).toContain("Previously discussed X");
    expect(prompt).toContain("## New Entries to Incorporate");
  });

  it("includes instruction constraints", () => {
    const prompt = buildSummarizationPrompt(entries, "");
    expect(prompt).toContain("Stay under 2000 characters");
    expect(prompt).toContain("Do NOT include any output protocol");
  });

  it("formats multi-line entries correctly", () => {
    const multiLine: ConversationEntry[] = [
      { role: "scribe", text: "Line 1\nLine 2" },
    ];
    const prompt = buildSummarizationPrompt(multiLine, "");
    expect(prompt).toContain("**scribe:**\nLine 1\nLine 2");
  });
});

// ── compressConversationEntries ──────────────────────────────────────

describe("compressConversationEntries", () => {
  it("compresses entries into bullet summaries", () => {
    const entries: ConversationEntry[] = [
      { role: "stevenic", text: "Build the feature" },
      { role: "beacon", text: "Done, here's what I did" },
    ];
    const result = compressConversationEntries(entries, "");
    expect(result).toContain("- **stevenic:** Build the feature");
    expect(result).toContain("- **beacon:** Done, here's what I did");
  });

  it("truncates long text at 150 chars with ellipsis", () => {
    const entries: ConversationEntry[] = [
      { role: "scribe", text: "A".repeat(200) },
    ];
    const result = compressConversationEntries(entries, "");
    expect(result).toContain("A".repeat(150));
    expect(result).toContain("…");
    expect(result).not.toContain("A".repeat(151));
  });

  it("adds ellipsis for multi-line text even if short", () => {
    const entries: ConversationEntry[] = [
      { role: "beacon", text: "Line 1\nLine 2" },
    ];
    const result = compressConversationEntries(entries, "");
    expect(result).toContain("- **beacon:** Line 1…");
  });

  it("prepends existing summary with compressed section", () => {
    const entries: ConversationEntry[] = [
      { role: "stevenic", text: "Do the thing" },
    ];
    const result = compressConversationEntries(entries, "Earlier context here");
    expect(result).toContain("Earlier context here");
    expect(result).toContain("### Compressed");
    expect(result).toContain("- **stevenic:** Do the thing");
  });

  it("returns plain bullets when no existing summary", () => {
    const entries: ConversationEntry[] = [{ role: "user", text: "Hello" }];
    const result = compressConversationEntries(entries, "");
    expect(result).not.toContain("### Compressed");
    expect(result).toBe("- **user:** Hello");
  });

  it("handles empty entries array", () => {
    const result = compressConversationEntries([], "");
    expect(result).toBe("");
  });
});
