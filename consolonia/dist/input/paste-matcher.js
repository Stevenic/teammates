/**
 * Detects bracketed paste mode sequences and collects pasted text.
 *
 * Start marker: \x1b[200~
 * End marker:   \x1b[201~
 * Everything between the markers is emitted as a single PasteEvent.
 */
import { MatchResult } from './matcher.js';
import { pasteEvent } from './events.js';
/** The start marker as an array of characters. */
const PASTE_START = '\x1b[200~'.split('');
/** The end marker as an array of characters. */
const PASTE_END = '\x1b[201~'.split('');
export class PasteMatcher {
    state = 0 /* State.Idle */;
    /** How many characters of the start marker have been matched. */
    startPos = 0;
    /** How many characters of the end marker have been matched. */
    endPos = 0;
    /** Accumulated paste text. */
    buffer = '';
    /** Completed event ready for flushing. */
    result = null;
    append(char) {
        switch (this.state) {
            case 0 /* State.Idle */:
                if (char === PASTE_START[0]) {
                    this.state = 1 /* State.MatchingStart */;
                    this.startPos = 1;
                    return MatchResult.Partial;
                }
                return MatchResult.NoMatch;
            case 1 /* State.MatchingStart */:
                if (char === PASTE_START[this.startPos]) {
                    this.startPos++;
                    if (this.startPos === PASTE_START.length) {
                        // Full start marker matched — begin collecting.
                        this.state = 2 /* State.Collecting */;
                        this.buffer = '';
                        this.endPos = 0;
                    }
                    return MatchResult.Partial;
                }
                // Mismatch — not a paste start sequence.
                this.state = 0 /* State.Idle */;
                this.startPos = 0;
                return MatchResult.NoMatch;
            case 2 /* State.Collecting */:
                if (char === PASTE_END[0]) {
                    this.state = 3 /* State.MatchingEnd */;
                    this.endPos = 1;
                    return MatchResult.Partial;
                }
                this.buffer += char;
                return MatchResult.Partial;
            case 3 /* State.MatchingEnd */:
                if (char === PASTE_END[this.endPos]) {
                    this.endPos++;
                    if (this.endPos === PASTE_END.length) {
                        // Full end marker matched — paste is complete.
                        this.state = 0 /* State.Idle */;
                        this.result = pasteEvent(this.buffer);
                        this.buffer = '';
                        this.endPos = 0;
                        return MatchResult.Complete;
                    }
                    return MatchResult.Partial;
                }
                // End marker mismatch — the partially-matched end marker chars
                // are actually part of the paste text.
                const partial = PASTE_END.slice(0, this.endPos).join('');
                this.buffer += partial + char;
                this.state = 2 /* State.Collecting */;
                this.endPos = 0;
                return MatchResult.Partial;
            default:
                return MatchResult.NoMatch;
        }
    }
    flush() {
        const ev = this.result;
        this.result = null;
        return ev;
    }
    reset() {
        this.state = 0 /* State.Idle */;
        this.startPos = 0;
        this.endPos = 0;
        this.buffer = '';
        this.result = null;
    }
}
