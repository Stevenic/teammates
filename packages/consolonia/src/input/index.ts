/**
 * Raw terminal input system.
 *
 * Provides escape sequence parsing, mouse tracking, bracketed paste
 * detection, and a unified InputProcessor pipeline.
 */

export { EscapeMatcher } from "./escape-matcher.js";
export type {
  InputEvent,
  KeyEvent,
  MouseEvent,
  PasteEvent,
} from "./events.js";
export {
  keyEvent,
  mouseEvent,
  pasteEvent,
  resizeEvent,
} from "./events.js";

export { type IMatcher, MatchResult } from "./matcher.js";
export { MouseMatcher } from "./mouse-matcher.js";
export { PasteMatcher } from "./paste-matcher.js";
export { createInputProcessor, InputProcessor } from "./processor.js";
export { disableRawMode, enableRawMode } from "./raw-mode.js";
export { TextMatcher } from "./text-matcher.js";
