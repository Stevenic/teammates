/**
 * Matches printable text characters — anything with char code >= 32
 * that is not DEL (0x7f) and not ESC (0x1b).
 *
 * Emits a KeyEvent for each printable character.
 */
import { MatchResult, type IMatcher } from './matcher.js';
import { type InputEvent } from './events.js';
export declare class TextMatcher implements IMatcher {
    private result;
    append(char: string): MatchResult;
    flush(): InputEvent | null;
    reset(): void;
}
