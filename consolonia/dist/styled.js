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
import { BLACK, RED, GREEN, YELLOW, BLUE, MAGENTA, CYAN, WHITE, BLACK_BRIGHT, RED_BRIGHT, GREEN_BRIGHT, YELLOW_BRIGHT, BLUE_BRIGHT, MAGENTA_BRIGHT, CYAN_BRIGHT, WHITE_BRIGHT, GRAY, DARK_GRAY, LIGHT_GRAY, } from "./pixel/color.js";
/** Create a StyledSpan from segments. */
function span(segments) {
    const arr = segments;
    arr.__brand = "StyledSpan";
    return arr;
}
/** Check if a value is a StyledSpan. */
export function isStyledSpan(v) {
    return Array.isArray(v) && v.__brand === "StyledSpan";
}
/** Concatenate styled spans and/or plain strings. */
export function concat(...parts) {
    const segments = [];
    for (const part of parts) {
        if (typeof part === "string") {
            segments.push({ text: part, style: {} });
        }
        else {
            segments.push(...part);
        }
    }
    return span(segments);
}
/** Get the visible (unstyled) text from a StyledSpan. */
export function spanText(s) {
    return s.map((seg) => seg.text).join("");
}
/** Get the visible length of a StyledSpan. */
export function spanLength(s) {
    return s.reduce((len, seg) => len + seg.text.length, 0);
}
// ── Named colors ─────────────────────────────────────────────────
//
// Maps match chalk's naming conventions exactly.
const FG_COLORS = {
    // Standard (chalk: black, red, green, yellow, blue, magenta, cyan, white)
    black: BLACK,
    red: RED,
    green: GREEN,
    yellow: YELLOW,
    blue: BLUE,
    magenta: MAGENTA,
    cyan: CYAN,
    white: WHITE,
    // Bright (chalk: blackBright … whiteBright)
    blackBright: BLACK_BRIGHT,
    redBright: RED_BRIGHT,
    greenBright: GREEN_BRIGHT,
    yellowBright: YELLOW_BRIGHT,
    blueBright: BLUE_BRIGHT,
    magentaBright: MAGENTA_BRIGHT,
    cyanBright: CYAN_BRIGHT,
    whiteBright: WHITE_BRIGHT,
    // Aliases (chalk: gray = grey = blackBright)
    gray: GRAY,
    grey: GRAY,
    // Extra consolonia aliases
    darkGray: DARK_GRAY,
    lightGray: LIGHT_GRAY,
};
const BG_COLORS = {
    // Standard
    bgBlack: BLACK,
    bgRed: RED,
    bgGreen: GREEN,
    bgYellow: YELLOW,
    bgBlue: BLUE,
    bgMagenta: MAGENTA,
    bgCyan: CYAN,
    bgWhite: WHITE,
    // Bright
    bgBlackBright: BLACK_BRIGHT,
    bgRedBright: RED_BRIGHT,
    bgGreenBright: GREEN_BRIGHT,
    bgYellowBright: YELLOW_BRIGHT,
    bgBlueBright: BLUE_BRIGHT,
    bgMagentaBright: MAGENTA_BRIGHT,
    bgCyanBright: CYAN_BRIGHT,
    bgWhiteBright: WHITE_BRIGHT,
    // Aliases (chalk: bgGray = bgGrey = bgBlackBright)
    bgGray: BLACK_BRIGHT,
    bgGrey: BLACK_BRIGHT,
};
// Style flag names
const STYLE_FLAGS = {
    bold: "bold",
    italic: "italic",
    underline: "underline",
    strikethrough: "strikethrough",
    dim: "bold", // dim maps to non-bold (handled specially)
};
function createPen(accumulated) {
    const callable = (text) => {
        return span([{ text, style: { ...accumulated } }]);
    };
    return new Proxy(callable, {
        get(_target, prop) {
            // Arbitrary foreground: pen.fg(color)
            if (prop === "fg") {
                return (c) => createPen({ ...accumulated, fg: c });
            }
            // Arbitrary background: pen.bg(color)
            if (prop === "bg") {
                return (c) => createPen({ ...accumulated, bg: c });
            }
            // Named foreground colors
            if (prop in FG_COLORS) {
                return createPen({ ...accumulated, fg: FG_COLORS[prop] });
            }
            // Named background colors
            if (prop in BG_COLORS) {
                return createPen({ ...accumulated, bg: BG_COLORS[prop] });
            }
            // Style flags
            if (prop in STYLE_FLAGS) {
                if (prop === "dim") {
                    // dim is represented as gray foreground if no fg set
                    return createPen({
                        ...accumulated,
                        fg: accumulated.fg ?? GRAY,
                    });
                }
                return createPen({
                    ...accumulated,
                    [STYLE_FLAGS[prop]]: true,
                });
            }
            return undefined;
        },
    });
}
/**
 * The default pen — starting point for building styled text.
 *
 * Usage:
 *   pen("plain text")
 *   pen.cyan("colored")
 *   pen.bold.red("bold red")
 *   pen.bgBlue.white("white on blue")
 */
export const pen = createPen({});
