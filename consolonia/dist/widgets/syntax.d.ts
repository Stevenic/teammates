/**
 * Syntax highlighting — plugin-driven tokenizer for code blocks.
 *
 * Each language plugin implements `SyntaxHighlighter` which splits a
 * line of source code into `SyntaxToken[]`. The markdown renderer
 * maps token types to `TextStyle` via `SyntaxTheme`.
 *
 * Built-in plugins: JavaScript/TypeScript, Python, C#.
 *
 * Register custom languages:
 *   import { registerHighlighter } from "@teammates/consolonia";
 *   registerHighlighter({ name: "ruby", aliases: ["rb"], tokenize: ... });
 */
import type { TextStyle } from "../drawing/context.js";
/** Semantic token types produced by highlighters. */
export type SyntaxTokenType = "keyword" | "string" | "number" | "comment" | "operator" | "punctuation" | "type" | "function" | "variable" | "constant" | "decorator" | "attribute" | "text";
export interface SyntaxToken {
    text: string;
    type: SyntaxTokenType;
}
/** Maps token types to text styles. */
export type SyntaxTheme = Record<SyntaxTokenType, TextStyle>;
export declare const DEFAULT_SYNTAX_THEME: SyntaxTheme;
export interface SyntaxHighlighter {
    /** Canonical language name. */
    name: string;
    /** Language aliases (e.g. ["js", "jsx", "ts", "tsx"]). */
    aliases: string[];
    /** Tokenize a single line of source code. */
    tokenize(line: string): SyntaxToken[];
}
/** Register a syntax highlighter for one or more language aliases. */
export declare function registerHighlighter(highlighter: SyntaxHighlighter): void;
/** Look up a highlighter by language name/alias. Returns null if not found. */
export declare function getHighlighter(lang: string): SyntaxHighlighter | null;
/** Tokenize a line using the registered highlighter for the given language. */
export declare function highlightLine(lang: string, line: string): SyntaxToken[];
