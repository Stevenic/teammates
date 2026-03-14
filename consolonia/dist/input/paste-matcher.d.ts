/**
 * Detects bracketed paste mode sequences and collects pasted text.
 *
 * Start marker: \x1b[200~
 * End marker:   \x1b[201~
 * Everything between the markers is emitted as a single PasteEvent.
 */
import { MatchResult, type IMatcher } from './matcher.js';
import { type InputEvent } from './events.js';
export declare class PasteMatcher implements IMatcher {
    private state;
    /** How many characters of the start marker have been matched. */
    private startPos;
    /** How many characters of the end marker have been matched. */
    private endPos;
    /** Accumulated paste text. */
    private buffer;
    /** Completed event ready for flushing. */
    private result;
    append(char: string): MatchResult;
    flush(): InputEvent | null;
    reset(): void;
}
