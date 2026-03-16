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

/** Wrap text to fit within a given width, breaking at word boundaries. */
function wrapText(text: string, width: number): string[] {
  if (width <= 0) return [text];
  if (text.length <= width) return [text];

  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (current.length === 0) {
      // Force-break words longer than width
      if (word.length > width) {
        for (let i = 0; i < word.length; i += width) {
          lines.push(word.slice(i, i + width));
        }
        current = "";
        // Last chunk becomes current line if it didn't fill the width
        if (lines.length > 0 && lines[lines.length - 1].length < width) {
          current = lines.pop()!;
        }
      } else {
        current = word;
      }
    } else if (current.length + 1 + word.length <= width) {
      current += " " + word;
    } else {
      lines.push(current);
      // Force-break words longer than width
      if (word.length > width) {
        for (let i = 0; i < word.length; i += width) {
          lines.push(word.slice(i, i + width));
        }
        current = "";
        if (lines.length > 0 && lines[lines.length - 1].length < width) {
          current = lines.pop()!;
        }
      } else {
        current = word;
      }
    }
  }
  if (current.length > 0) lines.push(current);

  return lines.length > 0 ? lines : [""];
}

function renderTable(table: ParsedTable, maxWidth?: number): string {
  const { headers, alignments, rows } = table;
  const colCount = headers.length;
  const termWidth = maxWidth ?? (process.stdout.columns || 80);

  // Calculate natural column widths (max of header + all rows, + 2 for padding)
  const naturalWidths: number[] = [];
  for (let c = 0; c < colCount; c++) {
    let max = headers[c].length;
    for (const row of rows) {
      if (row[c] && row[c].length > max) max = row[c].length;
    }
    naturalWidths.push(max + 2); // 1 space padding each side
  }

  // Total width = sum of column widths + (colCount + 1) border characters
  const borderChars = colCount + 1;
  const totalNatural = naturalWidths.reduce((a, b) => a + b, 0) + borderChars;

  let widths: number[];
  if (totalNatural <= termWidth) {
    widths = naturalWidths;
  } else {
    // Shrink columns proportionally to fit terminal width
    const available = termWidth - borderChars;
    const minColWidth = 4; // minimum: 2 padding + 2 chars

    // First pass: give each column at least minColWidth, then distribute remaining proportionally
    const totalContent = naturalWidths.reduce((a, b) => a + b, 0);
    widths = naturalWidths.map((w) => {
      const share = Math.floor((w / totalContent) * available);
      return Math.max(share, minColWidth);
    });

    // Adjust rounding: distribute any leftover space to wider columns
    let used = widths.reduce((a, b) => a + b, 0);
    let idx = 0;
    while (used < available && idx < colCount) {
      widths[idx]++;
      used++;
      idx++;
    }
    // If we overshot, trim from the widest columns
    while (used > available) {
      let maxIdx = 0;
      for (let c = 1; c < colCount; c++) {
        if (widths[c] > widths[maxIdx]) maxIdx = c;
      }
      if (widths[maxIdx] <= minColWidth) break;
      widths[maxIdx]--;
      used--;
    }
  }

  const hLine = (left: string, mid: string, right: string) =>
    left + widths.map((w) => BOX.horizontal.repeat(w)).join(mid) + right;

  /** Render a row that may have multi-line wrapped cells. */
  const renderRow = (cells: string[], bold: boolean): string[] => {
    // Wrap each cell
    const wrapped: string[][] = cells.map((cell, i) =>
      wrapText(cell, widths[i] - 2),
    );
    const maxLines = Math.max(...wrapped.map((w) => w.length));

    // Pad each cell's wrapped lines to have the same count
    const lines: string[] = [];
    for (let line = 0; line < maxLines; line++) {
      const parts = cells.map((_, i) => {
        const text = wrapped[i][line] || "";
        const padded = padCell(text, widths[i] - 2, alignments[i]);
        return bold ? ` ${chalk.bold(padded)} ` : ` ${padded} `;
      });
      lines.push(
        chalk.gray(BOX.vertical) +
          parts.join(chalk.gray(BOX.vertical)) +
          chalk.gray(BOX.vertical),
      );
    }
    return lines;
  };

  const out: string[] = [];

  // Top border
  out.push(chalk.gray(hLine(BOX.topLeft, BOX.teeDown, BOX.topRight)));

  // Header row (with wrapping)
  out.push(...renderRow(headers, true));

  // Header separator
  out.push(chalk.gray(hLine(BOX.teeRight, BOX.cross, BOX.teeLeft)));

  // Data rows (with wrapping)
  for (const row of rows) {
    out.push(...renderRow(row, false));
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
export function renderMarkdownTables(text: string, maxWidth?: number): string {
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
        result.push(renderTable(table, maxWidth));
        i = j;
        continue;
      }
    }

    result.push(lines[i]);
    i++;
  }

  return result.join("\n");
}
