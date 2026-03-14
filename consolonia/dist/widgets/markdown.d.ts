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
import type { TextStyle } from "../drawing/context.js";
import { type SyntaxTheme } from "./syntax.js";
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
export declare function renderMarkdown(source: string, options?: MarkdownOptions): Line[];
export {};
