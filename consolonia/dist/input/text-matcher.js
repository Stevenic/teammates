/**
 * Matches printable text characters — anything with char code >= 32
 * that is not DEL (0x7f) and not ESC (0x1b).
 *
 * Emits a KeyEvent for each printable character.
 */
import { MatchResult } from './matcher.js';
import { keyEvent } from './events.js';
export class TextMatcher {
    result = null;
    append(char) {
        const code = char.charCodeAt(0);
        // Printable: code >= 32, not DEL (127), not ESC (27).
        // Also accept high-Unicode characters (surrogate pairs, emoji, etc.)
        if (code >= 32 && code !== 127 && code !== 27) {
            const isUpper = code >= 65 && code <= 90;
            const key = char === ' ' ? 'space' : char;
            const charValue = char;
            this.result = keyEvent(key, charValue, isUpper, false, false);
            return MatchResult.Complete;
        }
        return MatchResult.NoMatch;
    }
    flush() {
        const ev = this.result;
        this.result = null;
        return ev;
    }
    reset() {
        this.result = null;
    }
}
