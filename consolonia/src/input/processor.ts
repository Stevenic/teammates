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
import { type IMatcher, MatchResult } from './matcher.js';
import { type InputEvent } from './events.js';
import { PasteMatcher } from './paste-matcher.js';
import { MouseMatcher } from './mouse-matcher.js';
import { EscapeMatcher } from './escape-matcher.js';
import { TextMatcher } from './text-matcher.js';

/** Duration in ms to wait for a follow-up character after a lone ESC. */
const ESC_TIMEOUT_MS = 50;

export class InputProcessor {
  private readonly matchers: IMatcher[];
  private readonly escapeMatcher: EscapeMatcher;
  private readonly emitter: EventEmitter;

  /** Which matchers are still active (Partial or not yet tried) for the current sequence. */
  private active: boolean[];
  /** Timer for the escape key timeout. */
  private escTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(emitter: EventEmitter) {
    this.emitter = emitter;
    this.escapeMatcher = new EscapeMatcher();

    // Priority order — first matcher to complete wins.
    this.matchers = [
      new PasteMatcher(),
      new MouseMatcher(),
      this.escapeMatcher,
      new TextMatcher(),
    ];
    this.active = this.matchers.map(() => true);
  }

  /**
   * Feed a chunk of raw stdin data into the processor.
   * Characters are dispatched one at a time through the matcher chain.
   */
  feed(data: string): void {
    for (let i = 0; i < data.length; i++) {
      this.feedChar(data[i]);
    }
  }

  /** Destroy timers and clean up. */
  destroy(): void {
    this.clearEscTimer();
  }

  private feedChar(char: string): void {
    // Cancel any pending ESC timeout — we got more input.
    this.clearEscTimer();

    let completed = -1;

    // Feed the character to ALL active matchers in priority order.
    for (let i = 0; i < this.matchers.length; i++) {
      if (!this.active[i]) continue;

      const result = this.matchers[i].append(char);

      if (result === MatchResult.Complete) {
        completed = i;
        break; // Highest-priority complete wins
      }

      if (result === MatchResult.NoMatch) {
        this.matchers[i].reset();
        this.active[i] = false;
      }
      // Partial: matcher stays active
    }

    if (completed >= 0) {
      const ev = this.matchers[completed].flush();
      // Reset all matchers EXCEPT the completed one (it manages its own state,
      // e.g. EscapeMatcher stays in GotEsc after double-ESC).
      for (let i = 0; i < this.matchers.length; i++) {
        if (i !== completed) {
          this.matchers[i].reset();
        }
        this.active[i] = true;
      }
      if (ev) {
        this.emit(ev);
      }
      this.scheduleEscTimeoutIfNeeded();
      return;
    }

    // Check if any matcher is still active (in Partial state).
    const anyActive = this.active.some(a => a);
    if (!anyActive) {
      // No matcher claimed this sequence. Reset all for next input.
      this.resetAll();
      return;
    }

    // Some matchers still in Partial state — check for ESC timeout.
    this.scheduleEscTimeoutIfNeeded();
  }

  /** Reset all matchers and re-activate them. */
  private resetAll(): void {
    for (let i = 0; i < this.matchers.length; i++) {
      this.matchers[i].reset();
      this.active[i] = true;
    }
  }

  /**
   * If the escape matcher is active and holding a partial \x1b,
   * schedule a timeout to emit the escape key event.
   */
  private scheduleEscTimeoutIfNeeded(): void {
    const escIdx = this.matchers.indexOf(this.escapeMatcher);
    if (escIdx < 0 || !this.active[escIdx]) return;

    this.escTimer = setTimeout(() => {
      this.escTimer = null;
      const ev = this.escapeMatcher.flushEscapeTimeout();
      if (ev) {
        this.resetAll();
        this.emit(ev);
      }
    }, ESC_TIMEOUT_MS);
  }

  private clearEscTimer(): void {
    if (this.escTimer !== null) {
      clearTimeout(this.escTimer);
      this.escTimer = null;
    }
  }

  private emit(event: InputEvent): void {
    this.emitter.emit('input', event);
  }
}

// ── Convenience factory ───────────────────────────────────────────────

/**
 * Create an InputProcessor wired to a fresh EventEmitter.
 * Listen on the returned emitter's 'input' event to receive InputEvents.
 */
export function createInputProcessor(): {
  processor: InputProcessor;
  events: EventEmitter;
} {
  const events = new EventEmitter();
  const processor = new InputProcessor(events);
  return { processor, events };
}
