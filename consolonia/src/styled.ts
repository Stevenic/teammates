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
import {
  BLACK,
  RED,
  GREEN,
  YELLOW,
  BLUE,
  MAGENTA,
  CYAN,
  WHITE,
  BLACK_BRIGHT,
  RED_BRIGHT,
  GREEN_BRIGHT,
  YELLOW_BRIGHT,
  BLUE_BRIGHT,
  MAGENTA_BRIGHT,
  CYAN_BRIGHT,
  WHITE_BRIGHT,
  GRAY,
  DARK_GRAY,
  LIGHT_GRAY,
} from "./pixel/color.js";

// ── Segment type ─────────────────────────────────────────────────

/** A piece of text with an associated style. */
export interface StyledSegment {
  text: string;
  style: TextStyle;
}

/**
 * An array of styled segments that supports + concatenation with
 * other StyledSpan values or plain strings.
 */
export type StyledSpan = StyledSegment[] & { __brand: "StyledSpan" };

/** Create a StyledSpan from segments. */
function span(segments: StyledSegment[]): StyledSpan {
  const arr = segments as StyledSpan;
  arr.__brand = "StyledSpan";
  return arr;
}

/** Check if a value is a StyledSpan. */
export function isStyledSpan(v: unknown): v is StyledSpan {
  return Array.isArray(v) && (v as any).__brand === "StyledSpan";
}

/** Concatenate styled spans and/or plain strings. */
export function concat(...parts: (StyledSpan | string)[]): StyledSpan {
  const segments: StyledSegment[] = [];
  for (const part of parts) {
    if (typeof part === "string") {
      segments.push({ text: part, style: {} });
    } else {
      segments.push(...part);
    }
  }
  return span(segments);
}

/** Get the visible (unstyled) text from a StyledSpan. */
export function spanText(s: StyledSpan): string {
  return s.map((seg) => seg.text).join("");
}

/** Get the visible length of a StyledSpan. */
export function spanLength(s: StyledSpan): number {
  return s.reduce((len, seg) => len + seg.text.length, 0);
}

// ── Named colors ─────────────────────────────────────────────────
//
// Maps match chalk's naming conventions exactly.

const FG_COLORS: Record<string, Color> = {
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

const BG_COLORS: Record<string, Color> = {
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
const STYLE_FLAGS: Record<string, keyof TextStyle> = {
  bold: "bold",
  italic: "italic",
  underline: "underline",
  strikethrough: "strikethrough",
  dim: "bold", // dim maps to non-bold (handled specially)
};

// ── Pen builder ──────────────────────────────────────────────────

interface PenCallable {
  /** Create an unstyled span from a plain string. */
  (text: string): StyledSpan;
}

type Pen = PenCallable & {
  // Standard foreground colors
  readonly black: Pen;
  readonly red: Pen;
  readonly green: Pen;
  readonly yellow: Pen;
  readonly blue: Pen;
  readonly magenta: Pen;
  readonly cyan: Pen;
  readonly white: Pen;

  // Bright foreground colors
  readonly blackBright: Pen;
  readonly redBright: Pen;
  readonly greenBright: Pen;
  readonly yellowBright: Pen;
  readonly blueBright: Pen;
  readonly magentaBright: Pen;
  readonly cyanBright: Pen;
  readonly whiteBright: Pen;

  // Foreground aliases
  readonly gray: Pen;
  readonly grey: Pen;
  readonly darkGray: Pen;
  readonly lightGray: Pen;

  // Standard background colors
  readonly bgBlack: Pen;
  readonly bgRed: Pen;
  readonly bgGreen: Pen;
  readonly bgYellow: Pen;
  readonly bgBlue: Pen;
  readonly bgMagenta: Pen;
  readonly bgCyan: Pen;
  readonly bgWhite: Pen;

  // Bright background colors
  readonly bgBlackBright: Pen;
  readonly bgRedBright: Pen;
  readonly bgGreenBright: Pen;
  readonly bgYellowBright: Pen;
  readonly bgBlueBright: Pen;
  readonly bgMagentaBright: Pen;
  readonly bgCyanBright: Pen;
  readonly bgWhiteBright: Pen;

  // Background aliases
  readonly bgGray: Pen;
  readonly bgGrey: Pen;

  // Arbitrary RGB colors
  /** Set foreground to an arbitrary Color. */
  readonly fg: (c: Color) => Pen;
  /** Set background to an arbitrary Color. */
  readonly bg: (c: Color) => Pen;

  // Style flags
  readonly bold: Pen;
  readonly italic: Pen;
  readonly underline: Pen;
  readonly strikethrough: Pen;
  readonly dim: Pen;
};

function createPen(accumulated: TextStyle): Pen {
  const callable = (text: string): StyledSpan => {
    return span([{ text, style: { ...accumulated } }]);
  };

  return new Proxy(callable as Pen, {
    get(_target, prop: string) {
      // Arbitrary foreground: pen.fg(color)
      if (prop === "fg") {
        return (c: Color) => createPen({ ...accumulated, fg: c });
      }
      // Arbitrary background: pen.bg(color)
      if (prop === "bg") {
        return (c: Color) => createPen({ ...accumulated, bg: c });
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
export const pen: Pen = createPen({});
