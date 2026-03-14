/**
 * InputProcessor — the central input pipeline.
 * Port of Consolonia's InputProcessor.cs.
 *
 * Maintains an ordered list of matchers. Raw stdin data is fed character
 * by character through the matcher chain. When a matcher completes a
 * sequence, the corresponding InputEvent is emitted.
 *
 * Matcher priority order: PasteMatcher > MouseMatcher > EscapeMatcher > TextMatcher
 *
 * The escape key requires special handling: a lone ESC (\x1b) could be
 * the start of an escape sequence or the escape key itself. We use a
 * short timeout (50ms) to distinguish — if no follow-up character
 * arrives within the timeout, we emit an escape key event.
 */
import { EventEmitter } from 'node:events';
import { MatchResult } from './matcher.js';
import { PasteMatcher } from './paste-matcher.js';
import { MouseMatcher } from './mouse-matcher.js';
import { EscapeMatcher } from './escape-matcher.js';
import { TextMatcher } from './text-matcher.js';
/** Duration in ms to wait for a follow-up character after a lone ESC. */
const ESC_TIMEOUT_MS = 50;
export class InputProcessor {
    matchers;
    escapeMatcher;
    emitter;
    /** Index of the matcher currently holding a partial match, or -1. */
    activeIndex = -1;
    /** Timer for the escape key timeout. */
    escTimer = null;
    constructor(emitter) {
        this.emitter = emitter;
        this.escapeMatcher = new EscapeMatcher();
        // Priority order — first matcher to claim a sequence wins.
        this.matchers = [
            new PasteMatcher(),
            new MouseMatcher(),
            this.escapeMatcher,
            new TextMatcher(),
        ];
    }
    /**
     * Feed a chunk of raw stdin data into the processor.
     * Characters are dispatched one at a time through the matcher chain.
     */
    feed(data) {
        for (let i = 0; i < data.length; i++) {
            this.feedChar(data[i]);
        }
    }
    /** Destroy timers and clean up. */
    destroy() {
        this.clearEscTimer();
    }
    feedChar(char) {
        // Cancel any pending ESC timeout — we got more input.
        this.clearEscTimer();
        // If a matcher is actively consuming a partial sequence, try it first.
        if (this.activeIndex >= 0) {
            const matcher = this.matchers[this.activeIndex];
            const result = matcher.append(char);
            if (result === MatchResult.Complete) {
                const ev = matcher.flush();
                this.activeIndex = -1;
                if (ev) {
                    this.emit(ev);
                }
                this.scheduleEscTimeoutIfNeeded();
                return;
            }
            if (result === MatchResult.Partial) {
                this.scheduleEscTimeoutIfNeeded();
                return;
            }
            // NoMatch from the active matcher — it failed to continue.
            // Reset it and fall through to try all matchers from scratch.
            matcher.reset();
            this.activeIndex = -1;
        }
        // Try each matcher in priority order.
        for (let i = 0; i < this.matchers.length; i++) {
            const matcher = this.matchers[i];
            const result = matcher.append(char);
            if (result === MatchResult.Complete) {
                const ev = matcher.flush();
                if (ev) {
                    this.emit(ev);
                }
                this.scheduleEscTimeoutIfNeeded();
                return;
            }
            if (result === MatchResult.Partial) {
                this.activeIndex = i;
                this.scheduleEscTimeoutIfNeeded();
                return;
            }
            // NoMatch — try next matcher
        }
        // No matcher claimed this character. Silently discard.
    }
    /**
     * If the escape matcher is currently the active matcher (holding a
     * partial \x1b), schedule a timeout to emit the escape key event.
     */
    scheduleEscTimeoutIfNeeded() {
        if (this.activeIndex < 0)
            return;
        const activeMatcher = this.matchers[this.activeIndex];
        if (activeMatcher !== this.escapeMatcher)
            return;
        this.escTimer = setTimeout(() => {
            this.escTimer = null;
            const ev = this.escapeMatcher.flushEscapeTimeout();
            if (ev) {
                this.activeIndex = -1;
                this.emit(ev);
            }
        }, ESC_TIMEOUT_MS);
    }
    clearEscTimer() {
        if (this.escTimer !== null) {
            clearTimeout(this.escTimer);
            this.escTimer = null;
        }
    }
    emit(event) {
        this.emitter.emit('input', event);
    }
}
// ── Convenience factory ───────────────────────────────────────────────
/**
 * Create an InputProcessor wired to a fresh EventEmitter.
 * Listen on the returned emitter's 'input' event to receive InputEvents.
 */
export function createInputProcessor() {
    const events = new EventEmitter();
    const processor = new InputProcessor(events);
    return { processor, events };
}
