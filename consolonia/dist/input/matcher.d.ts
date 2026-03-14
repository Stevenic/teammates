/**
 * Base matcher interface for the input processing pipeline.
 * Inspired by Consolonia's InputProcessor matcher chain.
 */
import type { InputEvent } from './events.js';
/** Result of feeding a character to a matcher. */
export declare enum MatchResult {
    /** This character is not part of a sequence this matcher handles. */
    NoMatch = 0,
    /** This character continues a partial sequence; more input needed. */
    Partial = 1,
    /** This character completes a recognized sequence; call flush(). */
    Complete = 2
}
/** A matcher consumes characters and produces InputEvents. */
export interface IMatcher {
    /** Feed a character to the matcher. Returns the match state. */
    append(char: string): MatchResult;
    /** Get the matched event and reset. Only valid after Complete. */
    flush(): InputEvent | null;
    /** Reset matcher state, discarding any partial sequence. */
    reset(): void;
}
