/**
 * Markdown table → box-drawing renderer.
 *
 * Parses markdown pipe tables from text and replaces them with
 * Unicode box-drawing equivalents:
 *
 *   ┌──────┬───────┐
 *   │ Name │ Role  │
 *   ├──────┼───────┤
 *   │ alice│ dev   │
 *   └──────┴───────┘
 */

import chalk from "chalk";
import { stripAnsi } from "./ansi.js";

// ── Box-drawing characters ──────────────────────────────────────

const BOX = {
  topLeft: "┌",
  topRight: "┐",
  bottomLeft: "└",
  bottomRight: "┘",
  horizontal: "─",
  vertical: "│",
  teeDown: "┬",
  teeUp: "┴",
  teeRight: "├",
  teeLeft: "┤",
  cross: "┼",
};

// ── Alignment ───────────────────────────────────────────────────

type Align = "left" | "center" | "right";

function parseAlignment(sep: string): Align {
  const trimmed = sep.trim();
  const left = trimmed.startsWith(":");
  const right = trimmed.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  return "left";
}

function padCell(text: string, width: number, align: Align): string {
  const len = text.length;
  const diff = width - len;
  if (diff <= 0) return text;
  switch (align) {
    case "right":
      return " ".repeat(diff) + text;
    case "center": {
      const left = Math.floor(diff / 2);
      return " ".repeat(left) + text + " ".repeat(diff - left);
    }
    default:
      return text + " ".repeat(diff);
  }
}

// ── Parsing ─────────────────────────────────────────────────────

/** Parse a pipe-delimited row into trimmed cell strings. */
function parseRow(line: string): string[] {
  // Strip leading/trailing pipe and split
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

/** Check if a line is a separator row (e.g. |---|---:|:---:|). */
function isSeparatorRow(line: string): boolean {
  return /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line.trim());
}

/** Check if a line looks like a table row (has pipes). */
function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.includes("|") && !trimmed.startsWith("```");
}

// ── Rendering ───────────────────────────────────────────────────

interface ParsedTable {
  headers: string[];
  alignments: Align[];
  rows: string[][];
}

function parseTable(lines: string[]): ParsedTable | null {
  if (lines.length < 2) return null;

  const headerLine = lines[0];
  const sepLine = lines[1];

  if (!isTableRow(headerLine) || !isSeparatorRow(sepLine)) return null;

  const headers = parseRow(headerLine);
  const seps = parseRow(sepLine);
  const alignments = seps.map(parseAlignment);

  // Pad alignments to match header count
  while (alignments.length < headers.length) alignments.push("left");

  const rows: string[][] = [];
  for (let i = 2; i < lines.length; i++) {
    if (!isTableRow(lines[i])) break;
    if (isSeparatorRow(lines[i])) continue;
    const cells = parseRow(lines[i]);
    // Pad to header count
    while (cells.length < headers.length) cells.push("");
    rows.push(cells.slice(0, headers.length));
  }

  return { headers, alignments, rows };
}

function renderTable(table: ParsedTable): string {
  const { headers, alignments, rows } = table;
  const colCount = headers.length;

  // Calculate column widths (max of header + all rows, + 2 for padding)
  const widths: number[] = [];
  for (let c = 0; c < colCount; c++) {
    let max = headers[c].length;
    for (const row of rows) {
      if (row[c] && row[c].length > max) max = row[c].length;
    }
    widths.push(max + 2); // 1 space padding each side
  }

  const hLine = (left: string, mid: string, right: string) =>
    left +
    widths.map((w) => BOX.horizontal.repeat(w)).join(mid) +
    right;

  const dataLine = (cells: string[]) =>
    BOX.vertical +
    cells
      .map((cell, i) => " " + padCell(cell, widths[i] - 2, alignments[i]) + " ")
      .join(BOX.vertical) +
    BOX.vertical;

  const out: string[] = [];

  // Top border
  out.push(chalk.gray(hLine(BOX.topLeft, BOX.teeDown, BOX.topRight)));

  // Header row
  out.push(
    chalk.gray(BOX.vertical) +
    headers
      .map((h, i) => " " + chalk.bold(padCell(h, widths[i] - 2, alignments[i])) + " ")
      .join(chalk.gray(BOX.vertical)) +
    chalk.gray(BOX.vertical)
  );

  // Header separator
  out.push(chalk.gray(hLine(BOX.teeRight, BOX.cross, BOX.teeLeft)));

  // Data rows
  for (const row of rows) {
    out.push(
      chalk.gray(BOX.vertical) +
      row
        .map((cell, i) => " " + padCell(cell, widths[i] - 2, alignments[i]) + " ")
        .join(chalk.gray(BOX.vertical)) +
      chalk.gray(BOX.vertical)
    );
  }

  // Bottom border
  out.push(chalk.gray(hLine(BOX.bottomLeft, BOX.teeUp, BOX.bottomRight)));

  return out.join("\n");
}

// ── Public API ──────────────────────────────────────────────────

/**
 * Find and replace all markdown tables in a block of text with
 * box-drawing rendered versions.
 */
export function renderMarkdownTables(text: string): string {
  const lines = text.split("\n");
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    // Look for a table start: a pipe row followed by a separator row
    if (
      i + 1 < lines.length &&
      isTableRow(lines[i]) &&
      isSeparatorRow(lines[i + 1])
    ) {
      // Collect all contiguous table lines
      const tableLines: string[] = [lines[i], lines[i + 1]];
      let j = i + 2;
      while (j < lines.length && isTableRow(lines[j])) {
        tableLines.push(lines[j]);
        j++;
      }

      const table = parseTable(tableLines);
      if (table) {
        result.push(renderTable(table));
        i = j;
        continue;
      }
    }

    result.push(lines[i]);
    i++;
  }

  return result.join("\n");
}
