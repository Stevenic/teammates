/**
 * Raw terminal input system.
 *
 * Provides escape sequence parsing, mouse tracking, bracketed paste
 * detection, and a unified InputProcessor pipeline.
 */

export type {
  KeyEvent,
  MouseEvent,
  PasteEvent,
  InputEvent,
} from './events.js';

export {
  keyEvent,
  mouseEvent,
  pasteEvent,
  resizeEvent,
} from './events.js';

export { enableRawMode, disableRawMode } from './raw-mode.js';

export { MatchResult, type IMatcher } from './matcher.js';

export { EscapeMatcher } from './escape-matcher.js';
export { PasteMatcher } from './paste-matcher.js';
export { MouseMatcher } from './mouse-matcher.js';
export { TextMatcher } from './text-matcher.js';

export { InputProcessor, createInputProcessor } from './processor.js';
