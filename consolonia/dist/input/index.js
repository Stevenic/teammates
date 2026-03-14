/**
 * Raw terminal input system.
 *
 * Provides escape sequence parsing, mouse tracking, bracketed paste
 * detection, and a unified InputProcessor pipeline.
 */
export { keyEvent, mouseEvent, pasteEvent, resizeEvent, } from './events.js';
export { enableRawMode, disableRawMode } from './raw-mode.js';
export { MatchResult } from './matcher.js';
export { EscapeMatcher } from './escape-matcher.js';
export { PasteMatcher } from './paste-matcher.js';
export { MouseMatcher } from './mouse-matcher.js';
export { TextMatcher } from './text-matcher.js';
export { InputProcessor, createInputProcessor } from './processor.js';
