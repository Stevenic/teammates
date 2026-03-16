import chalk from "chalk";
import { describe, expect, it } from "vitest";
import { renderMarkdownTables } from "./markdown-table.js";

// Force chalk color output off so we can compare raw box-drawing chars
chalk.level = 0;

describe("renderMarkdownTables", () => {
  it("renders a simple 2-column table", () => {
    const input = [
      "| Name  | Role |",
      "| ----- | ---- |",
      "| Alice | Dev  |",
      "| Bob   | PM   |",
    ].join("\n");

    const result = renderMarkdownTables(input);

    // Should contain box-drawing characters
    expect(result).toContain("┌");
    expect(result).toContain("┐");
    expect(result).toContain("└");
    expect(result).toContain("┘");
    expect(result).toContain("│");
    expect(result).toContain("─");
    expect(result).toContain("├");
    expect(result).toContain("┤");
    expect(result).toContain("┼");

    // Should contain the cell values
    expect(result).toContain("Name");
    expect(result).toContain("Role");
    expect(result).toContain("Alice");
    expect(result).toContain("Bob");
    expect(result).toContain("Dev");
    expect(result).toContain("PM");
  });

  it("renders a table with alignment markers", () => {
    const input = [
      "| Left | Center | Right |",
      "|:-----|:------:|------:|",
      "| a    |   b    |     c |",
    ].join("\n");

    const result = renderMarkdownTables(input);

    // Should still produce a box-drawn table
    expect(result).toContain("┌");
    expect(result).toContain("Left");
    expect(result).toContain("Center");
    expect(result).toContain("Right");
    expect(result).toContain("a");
    expect(result).toContain("b");
    expect(result).toContain("c");
  });

  it("renders a table with no alignment markers (default left)", () => {
    const input = [
      "| Col1 | Col2 |",
      "| ---- | ---- |",
      "| x    | y    |",
    ].join("\n");

    const result = renderMarkdownTables(input);
    expect(result).toContain("┌");
    expect(result).toContain("Col1");
    expect(result).toContain("x");
  });

  it("passes through text with no tables unchanged", () => {
    const input = "Hello world\nThis is plain text\nNo tables here";
    const result = renderMarkdownTables(input);
    expect(result).toBe(input);
  });

  it("handles mixed text and tables", () => {
    const input = [
      "Some intro text",
      "",
      "| A | B |",
      "|---|---|",
      "| 1 | 2 |",
      "",
      "Some outro text",
    ].join("\n");

    const result = renderMarkdownTables(input);

    // Non-table text should be preserved
    expect(result).toContain("Some intro text");
    expect(result).toContain("Some outro text");

    // Table should be rendered with box drawing
    expect(result).toContain("┌");
    expect(result).toContain("A");
    expect(result).toContain("1");
  });

  it("handles empty table cells", () => {
    const input = ["| H1 | H2 |", "|----|-----|", "|    | val |"].join("\n");

    const result = renderMarkdownTables(input);
    expect(result).toContain("┌");
    expect(result).toContain("H1");
    expect(result).toContain("val");
  });

  it("wraps text in columns when table exceeds maxWidth", () => {
    const input = [
      "| File | What changed |",
      "|------|-------------|",
      "| ci.yml | Added concurrency controls and security audit step and coverage reporting |",
      "| release.yml | Added validation job with lint typecheck build test |",
    ].join("\n");

    // Force narrow width
    const result = renderMarkdownTables(input, 50);

    // Should contain data (some cells may be split across lines)
    expect(result).toContain("What changed");
    expect(result).toContain("concurrency");
    // The text should be wrapped, so the table should have more visual lines than rows
    const lines = result.split("\n");
    // 2 data rows + 1 header + 3 borders = 6 minimum; wrapping adds more
    expect(lines.length).toBeGreaterThan(6);
    // No line should exceed maxWidth
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(50);
    }
  });

  it("does not wrap when table fits within maxWidth", () => {
    const input = ["| A | B |", "|---|---|", "| 1 | 2 |"].join("\n");

    const result = renderMarkdownTables(input, 120);
    const lines = result.split("\n");
    // Should be exactly 5 lines: top border, header, separator, 1 data row, bottom border
    expect(lines.length).toBe(5);
  });

  it("handles a single column table", () => {
    const input = ["| Only |", "| ---- |", "| data |"].join("\n");

    const result = renderMarkdownTables(input);
    expect(result).toContain("┌");
    expect(result).toContain("Only");
    expect(result).toContain("data");
    // Single column should not have cross or tee-down connectors
    expect(result).not.toContain("┬");
    expect(result).not.toContain("┴");
    expect(result).not.toContain("┼");
  });
});
