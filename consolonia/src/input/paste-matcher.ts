/**
 * Detects bracketed paste mode sequences and collects pasted text.
 *
 * Start marker: \x1b[200~
 * End marker:   \x1b[201~
 * Everything between the markers is emitted as a single PasteEvent.
 */

import { MatchResult, type IMatcher } from './matcher.js';
import { pasteEvent, type InputEvent } from './events.js';

/** The start marker as an array of characters. */
const PASTE_START = '\x1b[200~'.split('');
/** The end marker as an array of characters. */
const PASTE_END = '\x1b[201~'.split('');

const enum State {
  /** Waiting for the first character of the start marker. */
  Idle,
  /** Matching characters of the start marker. */
  MatchingStart,
  /** Inside the paste — collecting text. */
  Collecting,
  /** Matching characters of the end marker. */
  MatchingEnd,
}

export class PasteMatcher implements IMatcher {
  private state: State = State.Idle;
  /** How many characters of the start marker have been matched. */
  private startPos: number = 0;
  /** How many characters of the end marker have been matched. */
  private endPos: number = 0;
  /** Accumulated paste text. */
  private buffer: string = '';
  /** Completed event ready for flushing. */
  private result: InputEvent | null = null;

  append(char: string): MatchResult {
    switch (this.state) {
      case State.Idle:
        if (char === PASTE_START[0]) {
          this.state = State.MatchingStart;
          this.startPos = 1;
          return MatchResult.Partial;
        }
        return MatchResult.NoMatch;

      case State.MatchingStart:
        if (char === PASTE_START[this.startPos]) {
          this.startPos++;
          if (this.startPos === PASTE_START.length) {
            // Full start marker matched — begin collecting.
            this.state = State.Collecting;
            this.buffer = '';
            this.endPos = 0;
          }
          return MatchResult.Partial;
        }
        // Mismatch — not a paste start sequence.
        this.state = State.Idle;
        this.startPos = 0;
        return MatchResult.NoMatch;

      case State.Collecting:
        if (char === PASTE_END[0]) {
          this.state = State.MatchingEnd;
          this.endPos = 1;
          return MatchResult.Partial;
        }
        this.buffer += char;
        return MatchResult.Partial;

      case State.MatchingEnd:
        if (char === PASTE_END[this.endPos]) {
          this.endPos++;
          if (this.endPos === PASTE_END.length) {
            // Full end marker matched — paste is complete.
            this.state = State.Idle;
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
        this.state = State.Collecting;
        this.endPos = 0;
        return MatchResult.Partial;

      default:
        return MatchResult.NoMatch;
    }
  }

  flush(): InputEvent | null {
    const ev = this.result;
    this.result = null;
    return ev;
  }

  reset(): void {
    this.state = State.Idle;
    this.startPos = 0;
    this.endPos = 0;
    this.buffer = '';
    this.result = null;
  }
}
