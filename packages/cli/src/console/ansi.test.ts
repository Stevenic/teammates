import { describe, expect, it } from "vitest";
import { cursorDown, cursorToCol, cursorUp } from "./ansi.js";

describe("cursorUp", () => {
  it("produces correct escape for n=1", () => {
    expect(cursorUp(1)).toBe("\x1b[1A");
  });

  it("produces correct escape for n=5", () => {
    expect(cursorUp(5)).toBe("\x1b[5A");
  });

  it("uses default n=1 when called with no arguments", () => {
    expect(cursorUp()).toBe("\x1b[1A");
  });

  it("handles n=0", () => {
    expect(cursorUp(0)).toBe("\x1b[0A");
  });

  it("handles large n", () => {
    expect(cursorUp(100)).toBe("\x1b[100A");
  });
});

describe("cursorDown", () => {
  it("produces correct escape for n=1", () => {
    expect(cursorDown(1)).toBe("\x1b[1B");
  });

  it("produces correct escape for n=3", () => {
    expect(cursorDown(3)).toBe("\x1b[3B");
  });

  it("uses default n=1 when called with no arguments", () => {
    expect(cursorDown()).toBe("\x1b[1B");
  });

  it("handles n=0", () => {
    expect(cursorDown(0)).toBe("\x1b[0B");
  });

  it("handles large n", () => {
    expect(cursorDown(500)).toBe("\x1b[500B");
  });
});

describe("cursorToCol", () => {
  it("produces correct escape for col=1", () => {
    expect(cursorToCol(1)).toBe("\x1b[1G");
  });

  it("produces correct escape for col=10", () => {
    expect(cursorToCol(10)).toBe("\x1b[10G");
  });

  it("handles col=0", () => {
    expect(cursorToCol(0)).toBe("\x1b[0G");
  });

  it("handles large col", () => {
    expect(cursorToCol(999)).toBe("\x1b[999G");
  });
});
