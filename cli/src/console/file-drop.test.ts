import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileDropHandler } from "./file-drop.js";

let handler: FileDropHandler;
let testDir: string;
let testFile: string;
let testImage: string;

beforeEach(() => {
  handler = new FileDropHandler();
  testDir = join(
    tmpdir(),
    `file-drop-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(testDir, { recursive: true });
  testFile = join(testDir, "example.txt");
  testImage = join(testDir, "photo.png");
  writeFileSync(testFile, "hello world");
  writeFileSync(testImage, "fake png data");
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("detectFilePath", () => {
  it("detects a valid absolute path", () => {
    const result = handler.detectFilePath(testFile);
    expect(result).toBe(testFile);
  });

  it("detects a quoted absolute path", () => {
    const result = handler.detectFilePath(`"${testFile}"`);
    expect(result).toBe(testFile);
  });

  it("detects a single-quoted absolute path", () => {
    const result = handler.detectFilePath(`'${testFile}'`);
    expect(result).toBe(testFile);
  });

  it("returns null for relative paths", () => {
    const result = handler.detectFilePath("relative/path.txt");
    expect(result).toBeNull();
  });

  it("returns null for URLs", () => {
    expect(handler.detectFilePath("https://example.com/file.txt")).toBeNull();
    expect(handler.detectFilePath("http://localhost:3000")).toBeNull();
  });

  it("returns null for empty strings", () => {
    expect(handler.detectFilePath("")).toBeNull();
    expect(handler.detectFilePath("   ")).toBeNull();
  });

  it("returns null for paths with newlines", () => {
    expect(handler.detectFilePath("/some/path\nwith\nnewlines")).toBeNull();
  });

  it("returns null for non-existent files", () => {
    const result = handler.detectFilePath(join(testDir, "nonexistent.txt"));
    expect(result).toBeNull();
  });
});

describe("processInput", () => {
  it("detects a single file path", () => {
    const result = handler.processInput(testFile);
    expect(result.filesDetected).toBe(true);
    expect(result.text).toContain("[File #1]");
  });

  it("detects an image file", () => {
    const result = handler.processInput(testImage);
    expect(result.filesDetected).toBe(true);
    expect(result.text).toContain("[Image #1]");
  });

  it("passes through non-file text", () => {
    const result = handler.processInput("just some regular text");
    expect(result.filesDetected).toBe(false);
    expect(result.text).toBe("just some regular text");
  });

  it("does not re-add the same file twice", () => {
    handler.processInput(testFile);
    handler.processInput(testFile);
    const all = handler.getAll();
    expect(all).toHaveLength(1);
  });
});

describe("expandTags", () => {
  it("expands [File #N] tags to paths", () => {
    handler.processInput(testFile);
    const { text, attachments } = handler.expandTags("Please review [File #1]");
    expect(text).toContain(testFile);
    expect(text).not.toContain("[File #1]");
    expect(attachments).toHaveLength(1);
    expect(attachments[0].path).toBe(testFile);
  });

  it("expands [Image #N] tags to paths", () => {
    handler.processInput(testImage);
    const { text, attachments } = handler.expandTags("Look at [Image #1]");
    expect(text).toContain(testImage);
    expect(text).not.toContain("[Image #1]");
    expect(attachments).toHaveLength(1);
    expect(attachments[0].isImage).toBe(true);
  });

  it("leaves unknown tags untouched", () => {
    const { text } = handler.expandTags("Check [File #999]");
    expect(text).toBe("Check [File #999]");
  });
});

describe("formatTag", () => {
  it("formats a file attachment as [File #N]", () => {
    handler.processInput(testFile);
    const attachment = handler.get(1)!;
    expect(handler.formatTag(attachment)).toBe("[File #1]");
  });

  it("formats an image attachment as [Image #N]", () => {
    handler.processInput(testImage);
    const attachment = handler.get(1)!;
    expect(handler.formatTag(attachment)).toBe("[Image #1]");
  });
});

describe("formatSummary", () => {
  it("produces a human-readable summary for a file", () => {
    handler.processInput(testFile);
    const attachment = handler.get(1)!;
    const summary = handler.formatSummary(attachment);
    expect(summary).toContain("File #1");
    expect(summary).toContain("example.txt");
    expect(summary).toContain("KB");
  });

  it("produces a human-readable summary for an image", () => {
    handler.processInput(testImage);
    const attachment = handler.get(1)!;
    const summary = handler.formatSummary(attachment);
    expect(summary).toContain("Image #1");
    expect(summary).toContain("photo.png");
    expect(summary).toContain("KB");
  });
});

describe("attachment management", () => {
  it("get() returns undefined for missing IDs", () => {
    expect(handler.get(999)).toBeUndefined();
  });

  it("remove() deletes an attachment", () => {
    handler.processInput(testFile);
    expect(handler.remove(1)).toBe(true);
    expect(handler.get(1)).toBeUndefined();
  });

  it("clear() removes all attachments", () => {
    handler.processInput(testFile);
    handler.processInput(testImage);
    handler.clear();
    expect(handler.getAll()).toHaveLength(0);
  });
});
