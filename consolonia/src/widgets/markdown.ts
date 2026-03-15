/**
 * Markdown — terminal-rendered markdown widget.
 *
 * Parses markdown with marked.js and renders it to styled lines
 * that can be displayed in a consolonia terminal UI.
 *
 * Supported elements:
 *   - Headings (h1–h6)
 *   - Paragraphs with inline bold, italic, code, strikethrough
 *   - Links (shown as text + URL)
 *   - Unordered and ordered lists (nested)
 *   - Task lists (checkboxes)
 *   - Code blocks (fenced and indented)
 *   - Blockquotes (nested)
 *   - Tables (aligned columns with box-drawing borders)
 *   - Horizontal rules
 *   - Images (alt text shown)
 */

import { marked, type Token, type Tokens } from "marked";
import type { TextStyle } from "../drawing/context.js";
import { CYAN, GRAY, GREEN, WHITE, YELLOW } from "../pixel/color.js";
import {
  DEFAULT_SYNTAX_THEME,
  highlightLine,
  type SyntaxTheme,
} from "./syntax.js";

// ── Style types ──────────────────────────────────────────────────

export interface MarkdownTheme {
  /** Body text. */
  text: TextStyle;
  /** Bold text. */
  bold: TextStyle;
  /** Italic text. */
  italic: TextStyle;
  /** Bold+italic text. */
  boldItalic: TextStyle;
  /** Inline code. */
  code: TextStyle;
  /** Strikethrough text. */
  strikethrough: TextStyle;
  /** Link text. */
  link: TextStyle;
  /** Link URL (shown in parens). */
  linkUrl: TextStyle;
  /** Heading level 1. */
  h1: TextStyle;
  /** Heading level 2. */
  h2: TextStyle;
  /** Heading levels 3–6. */
  h3: TextStyle;
  /** Code block text. */
  codeBlock: TextStyle;
  /** Code block border/language label. */
  codeBlockChrome: TextStyle;
  /** Blockquote bar and text. */
  blockquote: TextStyle;
  /** List bullet/number. */
  listMarker: TextStyle;
  /** Table borders. */
  tableBorder: TextStyle;
  /** Table header text. */
  tableHeader: TextStyle;
  /** Horizontal rule. */
  hr: TextStyle;
  /** Task checkbox. */
  checkbox: TextStyle;
}

/** Segment of styled text. */
interface Seg {
  text: string;
  style: TextStyle;
}

/** A line is an array of segments. */
type Line = Seg[];

// ── Default theme ────────────────────────────────────────────────

const DEFAULT_THEME: MarkdownTheme = {
  text: { fg: WHITE },
  bold: { fg: WHITE, bold: true },
  italic: { fg: WHITE, italic: true },
  boldItalic: { fg: WHITE, bold: true, italic: true },
  code: { fg: YELLOW },
  strikethrough: { fg: GRAY, strikethrough: true },
  link: { fg: CYAN, underline: true },
  linkUrl: { fg: GRAY },
  h1: { fg: CYAN, bold: true },
  h2: { fg: CYAN, bold: true },
  h3: { fg: CYAN },
  codeBlock: { fg: GREEN },
  codeBlockChrome: { fg: GRAY },
  blockquote: { fg: GRAY, italic: true },
  listMarker: { fg: CYAN },
  tableBorder: { fg: GRAY },
  tableHeader: { fg: WHITE, bold: true },
  hr: { fg: GRAY },
  checkbox: { fg: CYAN },
};

// ── Public API ───────────────────────────────────────────────────

export interface MarkdownOptions {
  /** Maximum width for wrapping (default 80). */
  width?: number;
  /** Visual theme overrides. */
  theme?: Partial<MarkdownTheme>;
  /** Syntax highlighting theme overrides for code blocks. */
  syntaxTheme?: Partial<SyntaxTheme>;
  /** Indent string prepended to every line (default ""). */
  indent?: string;
}

/**
 * Render a markdown string to an array of styled lines.
 *
 * Each line is an array of { text, style } segments suitable for
 * DrawingContext.drawStyledText() or StyledText widget.
 *
 * This is a pure function — no widget state, no side effects.
 */
export function renderMarkdown(
  source: string,
  options: MarkdownOptions = {},
): Line[] {
  const width = options.width ?? 80;
  const theme: MarkdownTheme = { ...DEFAULT_THEME, ...options.theme };
  const synTheme: SyntaxTheme = {
    ...DEFAULT_SYNTAX_THEME,
    ...options.syntaxTheme,
  };
  const indent = options.indent ?? "";

  const tokens = marked.lexer(source);
  const lines: Line[] = [];

  renderTokens(tokens, lines, theme, synTheme, width, indent, {});
  return lines;
}

// ── Internal rendering ───────────────────────────────────────────

/** Inherited inline style context. */
interface InlineCtx {
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
}

/** Render a list of block-level tokens to lines. */
function renderTokens(
  tokens: Token[],
  lines: Line[],
  theme: MarkdownTheme,
  synTheme: SyntaxTheme,
  width: number,
  indent: string,
  ctx: InlineCtx,
): void {
  for (const token of tokens) {
    switch (token.type) {
      case "heading":
        renderHeading(token as Tokens.Heading, lines, theme, width, indent);
        break;
      case "paragraph":
        renderParagraph(
          token as Tokens.Paragraph,
          lines,
          theme,
          width,
          indent,
          ctx,
        );
        break;
      case "text": {
        // Block-level text (e.g. inside list items)
        const t = token as Tokens.Text;
        if ("tokens" in t && t.tokens) {
          const segs = inlineTokensToSegments(t.tokens, theme, ctx);
          wordWrapSegments(segs, width - indent.length, indent, theme).forEach(
            (l) => lines.push(l),
          );
        } else {
          const segs = [
            { text: t.text, style: resolveInlineStyle(theme, ctx) },
          ];
          wordWrapSegments(segs, width - indent.length, indent, theme).forEach(
            (l) => lines.push(l),
          );
        }
        break;
      }
      case "code":
        renderCodeBlock(
          token as Tokens.Code,
          lines,
          theme,
          synTheme,
          width,
          indent,
        );
        break;
      case "blockquote":
        renderBlockquote(
          token as Tokens.Blockquote,
          lines,
          theme,
          synTheme,
          width,
          indent,
        );
        break;
      case "list":
        renderList(
          token as Tokens.List,
          lines,
          theme,
          synTheme,
          width,
          indent,
          ctx,
        );
        break;
      case "table":
        renderTable(token as Tokens.Table, lines, theme, width, indent);
        break;
      case "hr":
        renderHr(lines, theme, width, indent);
        break;
      case "space":
        // Blank line between blocks
        lines.push([{ text: indent, style: theme.text }]);
        break;
      case "html":
        // Render raw HTML as plain text
        lines.push([
          { text: indent, style: theme.text },
          { text: (token as Tokens.HTML).text.trim(), style: theme.text },
        ]);
        break;
      default:
        // Unknown token — render raw text if available
        if ("text" in token && typeof (token as any).text === "string") {
          lines.push([
            { text: indent, style: theme.text },
            { text: (token as any).text, style: theme.text },
          ]);
        }
        break;
    }
  }
}

// ── Headings ─────────────────────────────────────────────────────

function renderHeading(
  token: Tokens.Heading,
  lines: Line[],
  theme: MarkdownTheme,
  width: number,
  indent: string,
): void {
  const style =
    token.depth === 1 ? theme.h1 : token.depth === 2 ? theme.h2 : theme.h3;
  const text = plainText(token.tokens);

  lines.push([
    { text: indent, style: theme.text },
    { text, style },
  ]);

  // Underline for h1 and h2
  if (token.depth === 1) {
    const rule = "═".repeat(Math.min(text.length, width - indent.length));
    lines.push([
      { text: indent, style: theme.text },
      { text: rule, style },
    ]);
  } else if (token.depth === 2) {
    const rule = "─".repeat(Math.min(text.length, width - indent.length));
    lines.push([
      { text: indent, style: theme.text },
      { text: rule, style },
    ]);
  }

  // Blank line after heading
  lines.push([{ text: indent, style: theme.text }]);
}

// ── Paragraphs ───────────────────────────────────────────────────

function renderParagraph(
  token: Tokens.Paragraph,
  lines: Line[],
  theme: MarkdownTheme,
  width: number,
  indent: string,
  ctx: InlineCtx,
): void {
  const segs = inlineTokensToSegments(token.tokens, theme, ctx);
  wordWrapSegments(segs, width - indent.length, indent, theme).forEach((l) =>
    lines.push(l),
  );
  // Blank line after paragraph
  lines.push([{ text: indent, style: theme.text }]);
}

// ── Code blocks ──────────────────────────────────────────────────

function renderCodeBlock(
  token: Tokens.Code,
  lines: Line[],
  theme: MarkdownTheme,
  synTheme: SyntaxTheme,
  width: number,
  indent: string,
): void {
  const lang = token.lang ?? "";
  const codeLines = token.text.split("\n");
  const chrome = theme.codeBlockChrome;

  // Find the longest code line
  let maxCodeLen = 0;
  for (const cl of codeLines) {
    if (cl.length > maxCodeLen) maxCodeLen = cl.length;
  }

  // Three breakpoints for box width:
  //   narrow: fits content + 4 (│ + space + content + space + │)
  //   medium: ~60% of available width
  //   full:   available width - 4 padding
  const avail = width - indent.length;
  const contentNeeded = maxCodeLen + 4; // │ + space + content + space + │
  const narrow = Math.min(contentNeeded, avail);
  const medium = Math.max(narrow, Math.min(Math.round(avail * 0.6), avail));
  const full = avail;

  // Pick the smallest breakpoint that fits
  let boxW: number;
  if (contentNeeded <= Math.round(avail * 0.4)) {
    boxW = Math.max(contentNeeded, 20); // narrow — at least 20 wide
  } else if (contentNeeded <= medium) {
    boxW = medium;
  } else {
    boxW = full;
  }
  boxW = Math.min(boxW, avail);

  const innerW = boxW - 4; // space inside │ _ content _ │

  // Top border: ┌─ lang ──────────┐
  const labelText = lang ? ` ${lang} ` : "";
  const topFill = Math.max(0, boxW - 2 - labelText.length); // -2 for ┌┐
  lines.push([
    { text: indent, style: theme.text },
    { text: `┌${labelText}${"─".repeat(topFill)}┐`, style: chrome },
  ]);

  // Code lines: │ content          │
  for (const cl of codeLines) {
    const lineSegs: Seg[] = [
      { text: indent, style: theme.text },
      { text: "│ ", style: chrome },
    ];

    // Truncate if too wide
    const displayLine = cl.length > innerW ? `${cl.slice(0, innerW - 1)}…` : cl;

    if (lang) {
      const tokens = highlightLine(lang, displayLine);
      for (const tok of tokens) {
        lineSegs.push({
          text: tok.text,
          style: synTheme[tok.type] ?? theme.codeBlock,
        });
      }
    } else {
      lineSegs.push({ text: displayLine, style: theme.codeBlock });
    }

    // Right padding + border
    const rightPad = Math.max(0, innerW - displayLine.length);
    lineSegs.push({ text: `${" ".repeat(rightPad)} │`, style: chrome });

    lines.push(lineSegs);
  }

  // Bottom border: └──────────────────┘
  lines.push([
    { text: indent, style: theme.text },
    { text: `└${"─".repeat(Math.max(0, boxW - 2))}┘`, style: chrome },
  ]);

  lines.push([{ text: indent, style: theme.text }]);
}

// ── Blockquotes ──────────────────────────────────────────────────

function renderBlockquote(
  token: Tokens.Blockquote,
  lines: Line[],
  theme: MarkdownTheme,
  synTheme: SyntaxTheme,
  width: number,
  indent: string,
): void {
  const quoteIndent = `${indent}│ `;
  const innerLines: Line[] = [];
  renderTokens(
    token.tokens,
    innerLines,
    theme,
    synTheme,
    width,
    quoteIndent,
    {},
  );

  // Apply blockquote style to all segments
  for (const line of innerLines) {
    for (const seg of line) {
      if (
        seg.text.startsWith(quoteIndent) ||
        seg.text === quoteIndent.trimEnd()
      ) {
        seg.style = theme.blockquote;
      }
    }
    lines.push(line);
  }
}

// ── Lists ────────────────────────────────────────────────────────

function renderList(
  token: Tokens.List,
  lines: Line[],
  theme: MarkdownTheme,
  synTheme: SyntaxTheme,
  width: number,
  indent: string,
  ctx: InlineCtx,
): void {
  for (let i = 0; i < token.items.length; i++) {
    const item = token.items[i];
    const marker = token.ordered ? `${(token.start || 1) + i}. ` : "• ";
    const contIndent = `${indent}  `; // 2-char continuation indent

    // Task list checkbox
    const prefix: Seg[] = [{ text: indent, style: theme.text }];
    if (item.task) {
      const check = item.checked ? "☑ " : "☐ ";
      prefix.push({ text: check, style: theme.checkbox });
    }
    prefix.push({ text: marker, style: theme.listMarker });

    // Render item content inline
    const itemTokens = item.tokens;
    let firstLine = true;

    for (const sub of itemTokens) {
      if (sub.type === "text" || sub.type === "paragraph") {
        const toks = "tokens" in sub && sub.tokens ? sub.tokens : [];
        const segs = inlineTokensToSegments(toks, theme, ctx);
        const wrapped = wordWrapSegments(
          segs,
          width - contIndent.length,
          contIndent,
          theme,
        );

        for (let w = 0; w < wrapped.length; w++) {
          if (firstLine && w === 0) {
            // Replace the indent with the bullet/number prefix
            lines.push([...prefix, ...wrapped[w].slice(1)]);
          } else {
            lines.push(wrapped[w]);
          }
        }
        firstLine = false;
      } else if (sub.type === "list") {
        renderList(
          sub as Tokens.List,
          lines,
          theme,
          synTheme,
          width,
          contIndent,
          ctx,
        );
      } else {
        const subLines: Line[] = [];
        renderTokens([sub], subLines, theme, synTheme, width, contIndent, ctx);
        if (firstLine && subLines.length > 0) {
          const first = subLines.shift()!;
          lines.push([...prefix, ...first.slice(1)]);
          firstLine = false;
        }
        subLines.forEach((l) => lines.push(l));
      }
    }
  }

  // Blank line after list
  lines.push([{ text: indent, style: theme.text }]);
}

// ── Tables ───────────────────────────────────────────────────────

function renderTable(
  token: Tokens.Table,
  lines: Line[],
  theme: MarkdownTheme,
  _width: number,
  indent: string,
): void {
  const numCols = token.header.length;

  // Compute column widths from content
  const colWidths: number[] = token.header.map(
    (h) => plainText(h.tokens).length,
  );
  for (const row of token.rows) {
    for (let c = 0; c < numCols; c++) {
      if (row[c]) {
        colWidths[c] = Math.max(colWidths[c], plainText(row[c].tokens).length);
      }
    }
  }
  // Minimum width of 3, pad by 2 for cell padding
  for (let c = 0; c < numCols; c++) {
    colWidths[c] = Math.max(3, colWidths[c]) + 2;
  }

  const border = theme.tableBorder;

  // Helper to build a horizontal rule
  const hRule = (left: string, mid: string, right: string) => {
    const parts = colWidths.map((w) => "─".repeat(w));
    return left + parts.join(mid) + right;
  };

  // Helper to build a data row
  const dataRow = (cells: Tokens.TableCell[], style: TextStyle): Line => {
    const segs: Seg[] = [
      { text: indent, style: theme.text },
      { text: "│", style: border },
    ];
    for (let c = 0; c < numCols; c++) {
      const cellText = cells[c] ? plainText(cells[c].tokens) : "";
      const align = token.header[c]?.align;
      const padded = padCell(cellText, colWidths[c], align);
      segs.push({ text: padded, style });
      segs.push({ text: "│", style: border });
    }
    return segs;
  };

  // Top border
  lines.push([
    { text: indent, style: theme.text },
    { text: hRule("┌", "┬", "┐"), style: border },
  ]);

  // Header row
  lines.push(dataRow(token.header, theme.tableHeader));

  // Header separator
  lines.push([
    { text: indent, style: theme.text },
    { text: hRule("├", "┼", "┤"), style: border },
  ]);

  // Data rows
  for (const row of token.rows) {
    lines.push(dataRow(row, theme.text));
  }

  // Bottom border
  lines.push([
    { text: indent, style: theme.text },
    { text: hRule("└", "┴", "┘"), style: border },
  ]);

  lines.push([{ text: indent, style: theme.text }]);
}

// ── Horizontal rule ──────────────────────────────────────────────

function renderHr(
  lines: Line[],
  theme: MarkdownTheme,
  width: number,
  indent: string,
): void {
  const ruleLen = Math.max(3, width - indent.length);
  lines.push([
    { text: indent, style: theme.text },
    { text: "─".repeat(ruleLen), style: theme.hr },
  ]);
  lines.push([{ text: indent, style: theme.text }]);
}

// ── Inline token → segment conversion ───────────────────────────

function inlineTokensToSegments(
  tokens: Token[],
  theme: MarkdownTheme,
  ctx: InlineCtx,
): Seg[] {
  const segs: Seg[] = [];
  for (const t of tokens) {
    switch (t.type) {
      case "text": {
        const tt = t as Tokens.Text;
        // Text tokens can contain nested tokens (e.g. from GFM autolinks)
        if ("tokens" in tt && tt.tokens && tt.tokens.length > 0) {
          segs.push(...inlineTokensToSegments(tt.tokens, theme, ctx));
        } else {
          segs.push({ text: tt.text, style: resolveInlineStyle(theme, ctx) });
        }
        break;
      }
      case "strong": {
        const st = t as Tokens.Strong;
        segs.push(
          ...inlineTokensToSegments(st.tokens, theme, { ...ctx, bold: true }),
        );
        break;
      }
      case "em": {
        const em = t as Tokens.Em;
        segs.push(
          ...inlineTokensToSegments(em.tokens, theme, { ...ctx, italic: true }),
        );
        break;
      }
      case "del": {
        const del = t as Tokens.Del;
        segs.push(
          ...inlineTokensToSegments(del.tokens, theme, {
            ...ctx,
            strikethrough: true,
          }),
        );
        break;
      }
      case "codespan": {
        const cs = t as Tokens.Codespan;
        segs.push({ text: cs.text, style: theme.code });
        break;
      }
      case "link": {
        const lk = t as Tokens.Link;
        const linkText = plainText(lk.tokens);
        segs.push({ text: linkText, style: theme.link });
        if (lk.href && lk.href !== linkText) {
          segs.push({ text: ` (${lk.href})`, style: theme.linkUrl });
        }
        break;
      }
      case "image": {
        const img = t as Tokens.Image;
        segs.push({
          text: `[image: ${img.text || img.href}]`,
          style: theme.linkUrl,
        });
        break;
      }
      case "br":
        // Soft line break — we'll handle this during wrapping
        segs.push({ text: "\n", style: theme.text });
        break;
      case "escape":
        segs.push({
          text: (t as Tokens.Escape).text,
          style: resolveInlineStyle(theme, ctx),
        });
        break;
      default:
        // Fallback: render as plain text
        if ("text" in t && typeof (t as any).text === "string") {
          segs.push({
            text: (t as any).text,
            style: resolveInlineStyle(theme, ctx),
          });
        }
        break;
    }
  }
  return segs;
}

/** Resolve the inline style from the context flags. */
function resolveInlineStyle(theme: MarkdownTheme, ctx: InlineCtx): TextStyle {
  if (ctx.strikethrough) return theme.strikethrough;
  if (ctx.bold && ctx.italic) return theme.boldItalic;
  if (ctx.bold) return theme.bold;
  if (ctx.italic) return theme.italic;
  return theme.text;
}

// ── Word wrapping ────────────────────────────────────────────────

/**
 * Word-wrap an array of segments to fit within maxWidth.
 * Returns an array of Lines, each prefixed with the indent.
 */
function wordWrapSegments(
  segs: Seg[],
  maxWidth: number,
  indent: string,
  theme: MarkdownTheme,
): Line[] {
  if (maxWidth <= 0) maxWidth = 1;

  // Flatten into a stream of { char, style } for wrapping
  const chars: { char: string; style: TextStyle }[] = [];
  for (const seg of segs) {
    for (const ch of seg.text) {
      chars.push({ char: ch, style: seg.style });
    }
  }

  const result: Line[] = [];
  let lineSegs: Seg[] = [{ text: indent, style: theme.text }];
  let col = 0;

  const flushLine = () => {
    // Coalesce adjacent segments but keep the indent as a separate first segment
    if (lineSegs.length > 1) {
      result.push([lineSegs[0], ...coalesce(lineSegs.slice(1))]);
    } else {
      result.push(lineSegs);
    }
    lineSegs = [{ text: indent, style: theme.text }];
    col = 0;
  };

  let i = 0;
  while (i < chars.length) {
    const ch = chars[i];

    // Hard line break
    if (ch.char === "\n") {
      flushLine();
      i++;
      continue;
    }

    // Check if we need to wrap — find the last space to break at
    if (col >= maxWidth) {
      // Walk back through lineSegs to find the last space
      let broke = false;
      let _backtrack = 0;
      for (let s = lineSegs.length - 1; s >= 1; s--) {
        const seg = lineSegs[s];
        const spaceIdx = seg.text.lastIndexOf(" ");
        if (spaceIdx >= 0) {
          // Split this segment at the space
          const overflow: Seg[] = [];
          if (spaceIdx + 1 < seg.text.length) {
            overflow.push({
              text: seg.text.slice(spaceIdx + 1),
              style: seg.style,
            });
          }
          // Collect all segments after s
          for (let a = s + 1; a < lineSegs.length; a++) {
            overflow.push(lineSegs[a]);
          }
          // Trim this segment and remove everything after
          seg.text = seg.text.slice(0, spaceIdx);
          lineSegs.length = s + 1;
          // Remove trailing empty segment
          if (seg.text.length === 0) lineSegs.length = s;

          flushLine();
          // Push overflow segments onto new line
          for (const o of overflow) {
            lineSegs.push(o);
            col += o.text.length;
          }
          broke = true;
          break;
        }
        _backtrack += seg.text.length;
      }
      if (!broke) {
        // No space found — hard break at maxWidth
        flushLine();
      }
    }

    // Append character to current line (never merge into the indent segment)
    const lastSeg = lineSegs.length > 1 ? lineSegs[lineSegs.length - 1] : null;
    if (lastSeg && lastSeg.style === ch.style) {
      lastSeg.text += ch.char;
    } else {
      lineSegs.push({ text: ch.char, style: ch.style });
    }
    col++;
    i++;
  }

  // Flush remaining
  if (col > 0 || lineSegs.length > 1) {
    flushLine();
  }

  if (result.length === 0) {
    result.push([{ text: indent, style: theme.text }]);
  }

  return result;
}

/** Coalesce adjacent segments that share the same style reference. */
function coalesce(segs: Seg[]): Seg[] {
  if (segs.length <= 1) return segs;
  const out: Seg[] = [segs[0]];
  for (let i = 1; i < segs.length; i++) {
    const prev = out[out.length - 1];
    if (prev.style === segs[i].style) {
      prev.text += segs[i].text;
    } else {
      out.push(segs[i]);
    }
  }
  return out;
}

// ── Helpers ──────────────────────────────────────────────────────

/** Extract plain text from inline tokens. */
function plainText(tokens: Token[]): string {
  let result = "";
  for (const t of tokens) {
    if ("tokens" in t && (t as any).tokens) {
      result += plainText((t as any).tokens);
    } else if ("text" in t) {
      result += (t as any).text;
    }
  }
  return result;
}

/** Pad a cell value to a given width with alignment. */
function padCell(
  text: string,
  width: number,
  align: "left" | "center" | "right" | null,
): string {
  const inner = width - 2; // 1 char padding each side
  const truncated = text.length > inner ? `${text.slice(0, inner - 1)}…` : text;
  const pad = inner - truncated.length;

  let content: string;
  switch (align) {
    case "right":
      content = " ".repeat(pad) + truncated;
      break;
    case "center": {
      const left = Math.floor(pad / 2);
      const right = pad - left;
      content = " ".repeat(left) + truncated + " ".repeat(right);
      break;
    }
    default:
      content = truncated + " ".repeat(pad);
      break;
  }

  return ` ${content} `;
}
