/**
 * InputProcessor — the central input pipeline.
 * Port of Consolonia's InputProcessor.cs.
 *
 * All matchers run in parallel on each character. When multiple matchers
 * return Partial, all of them continue receiving input. The first matcher
 * (by priority order) to return Complete wins, and the others are reset.
 *
 * Matcher priority order: PasteMatcher > MouseMatcher > EscapeMatcher > TextMatcher
 *
 * The escape key requires special handling: a lone ESC (\x1b) could be
 * the start of an escape sequence or the escape key itself. We use a
 * short timeout (50ms) to distinguish — if no follow-up character
 * arrives within the timeout, we emit an escape key event.
 */
import { EventEmitter } from 'node:events';
export declare class InputProcessor {
    private readonly matchers;
    private readonly escapeMatcher;
    private readonly emitter;
    /** Which matchers are still active (Partial or not yet tried) for the current sequence. */
    private active;
    /** Timer for the escape key timeout. */
    private escTimer;
    constructor(emitter: EventEmitter);
    /**
     * Feed a chunk of raw stdin data into the processor.
     * Characters are dispatched one at a time through the matcher chain.
     */
    feed(data: string): void;
    /** Destroy timers and clean up. */
    destroy(): void;
    private feedChar;
    /** Reset all matchers and re-activate them. */
    private resetAll;
    /**
     * If the escape matcher is active and holding a partial \x1b,
     * schedule a timeout to emit the escape key event.
     */
    private scheduleEscTimeoutIfNeeded;
    private clearEscTimer;
    private emit;
}
/**
 * Create an InputProcessor wired to a fresh EventEmitter.
 * Listen on the returned emitter's 'input' event to receive InputEvents.
 */
export declare function createInputProcessor(): {
    processor: InputProcessor;
    events: EventEmitter;
};
