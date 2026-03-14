/**
 * Styled — a chalk-like fluent API for building styled text segments.
 *
 * Instead of producing ANSI escape codes (which only work on raw stdout),
 * Styled produces {text, style} segment arrays that can be rendered into
 * a pixel buffer via DrawingContext.
 *
 * Usage:
 *   import { pen } from "@teammates/consolonia";
 *
 *   // Single styled segment
 *   pen.cyan("hello")            → [{ text: "hello", style: { fg: CYAN } }]
 *
 *   // Chained styles
 *   pen.bold.red("error")        → [{ text: "error", style: { fg: RED, bold: true } }]
 *
 *   // Concatenation with +
 *   pen.green("✔ ") + pen.white("done")
 *     → [{ text: "✔ ", style: { fg: GREEN } }, { text: "done", style: { fg: WHITE } }]
 *
 *   // Mixed plain + styled
 *   pen("prefix ") + pen.cyan("@name")
 *     → [{ text: "prefix ", style: {} }, { text: "@name", style: { fg: CYAN } }]
 *
 *   // Gray is dim white (like chalk.gray)
 *   pen.gray("muted")           → [{ text: "muted", style: { fg: GRAY } }]
 */
import type { Color } from "./pixel/color.js";
import type { TextStyle } from "./drawing/context.js";
/** A piece of text with an associated style. */
export interface StyledSegment {
    text: string;
    style: TextStyle;
}
/**
 * An array of styled segments that supports + concatenation with
 * other StyledSpan values or plain strings.
 */
export type StyledSpan = StyledSegment[] & {
    __brand: "StyledSpan";
};
/** Check if a value is a StyledSpan. */
export declare function isStyledSpan(v: unknown): v is StyledSpan;
/** Concatenate styled spans and/or plain strings. */
export declare function concat(...parts: (StyledSpan | string)[]): StyledSpan;
/** Get the visible (unstyled) text from a StyledSpan. */
export declare function spanText(s: StyledSpan): string;
/** Get the visible length of a StyledSpan. */
export declare function spanLength(s: StyledSpan): number;
interface PenCallable {
    /** Create an unstyled span from a plain string. */
    (text: string): StyledSpan;
}
type Pen = PenCallable & {
    readonly black: Pen;
    readonly red: Pen;
    readonly green: Pen;
    readonly yellow: Pen;
    readonly blue: Pen;
    readonly magenta: Pen;
    readonly cyan: Pen;
    readonly white: Pen;
    readonly blackBright: Pen;
    readonly redBright: Pen;
    readonly greenBright: Pen;
    readonly yellowBright: Pen;
    readonly blueBright: Pen;
    readonly magentaBright: Pen;
    readonly cyanBright: Pen;
    readonly whiteBright: Pen;
    readonly gray: Pen;
    readonly grey: Pen;
    readonly darkGray: Pen;
    readonly lightGray: Pen;
    readonly bgBlack: Pen;
    readonly bgRed: Pen;
    readonly bgGreen: Pen;
    readonly bgYellow: Pen;
    readonly bgBlue: Pen;
    readonly bgMagenta: Pen;
    readonly bgCyan: Pen;
    readonly bgWhite: Pen;
    readonly bgBlackBright: Pen;
    readonly bgRedBright: Pen;
    readonly bgGreenBright: Pen;
    readonly bgYellowBright: Pen;
    readonly bgBlueBright: Pen;
    readonly bgMagentaBright: Pen;
    readonly bgCyanBright: Pen;
    readonly bgWhiteBright: Pen;
    readonly bgGray: Pen;
    readonly bgGrey: Pen;
    /** Set foreground to an arbitrary Color. */
    readonly fg: (c: Color) => Pen;
    /** Set background to an arbitrary Color. */
    readonly bg: (c: Color) => Pen;
    readonly bold: Pen;
    readonly italic: Pen;
    readonly underline: Pen;
    readonly strikethrough: Pen;
    readonly dim: Pen;
};
/**
 * The default pen — starting point for building styled text.
 *
 * Usage:
 *   pen("plain text")
 *   pen.cyan("colored")
 *   pen.bold.red("bold red")
 *   pen.bgBlue.white("white on blue")
 */
export declare const pen: Pen;
export {};
