/**
 * Parses SGR extended mouse tracking sequences.
 *
 * Format: \x1b[<Cb;Cx;CyM  (press/motion)
 *         \x1b[<Cb;Cx;Cym  (release)
 *
 * Cb encodes button and modifiers:
 *   bits 0-1: 0=left, 1=middle, 2=right
 *   bit 5 (+32): motion event
 *   bits 6-7: 64=wheel up, 65=wheel down
 *   bit 2 (+4): shift
 *   bit 3 (+8): alt/meta
 *   bit 4 (+16): ctrl
 *
 * Cx, Cy are 1-based coordinates.
 */

import { MatchResult, type IMatcher } from './matcher.js';
import { mouseEvent, type InputEvent, type MouseEvent } from './events.js';

const ESC = '\x1b';

const enum State {
  Idle,
  /** Got \x1b */
  GotEsc,
  /** Got \x1b[ */
  GotBracket,
  /** Got \x1b[< — now reading params until M or m */
  Reading,
}

export class MouseMatcher implements IMatcher {
  private state: State = State.Idle;
  private params: string = '';
  private result: InputEvent | null = null;

  append(char: string): MatchResult {
    switch (this.state) {
      case State.Idle:
        if (char === ESC) {
          this.state = State.GotEsc;
          return MatchResult.Partial;
        }
        return MatchResult.NoMatch;

      case State.GotEsc:
        if (char === '[') {
          this.state = State.GotBracket;
          return MatchResult.Partial;
        }
        this.state = State.Idle;
        return MatchResult.NoMatch;

      case State.GotBracket:
        if (char === '<') {
          this.state = State.Reading;
          this.params = '';
          return MatchResult.Partial;
        }
        this.state = State.Idle;
        return MatchResult.NoMatch;

      case State.Reading:
        if (char === 'M' || char === 'm') {
          return this.finalize(char === 'm');
        }
        // Valid param chars: digits and semicolons
        const code = char.charCodeAt(0);
        if ((code >= 0x30 && code <= 0x39) || char === ';') {
          this.params += char;
          return MatchResult.Partial;
        }
        // Unexpected character — abort
        this.state = State.Idle;
        this.params = '';
        return MatchResult.NoMatch;

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
    this.params = '';
    this.result = null;
  }

  private finalize(isRelease: boolean): MatchResult {
    this.state = State.Idle;

    const parts = this.params.split(';');
    this.params = '';

    if (parts.length !== 3) {
      return MatchResult.NoMatch;
    }

    const cb = parseInt(parts[0], 10);
    const cx = parseInt(parts[1], 10);
    const cy = parseInt(parts[2], 10);

    if (isNaN(cb) || isNaN(cx) || isNaN(cy)) {
      return MatchResult.NoMatch;
    }

    // Decode modifiers from cb
    const shift = (cb & 4) !== 0;
    const alt = (cb & 8) !== 0;
    const ctrl = (cb & 16) !== 0;
    const isMotion = (cb & 32) !== 0;

    // Decode button from low bits (masking out modifier/motion bits)
    const buttonBits = cb & 3;
    const highBits = cb & (64 | 128);

    let button: MouseEvent['button'];
    let type: MouseEvent['type'];

    if (highBits === 64) {
      // Wheel events
      button = 'none';
      type = buttonBits === 0 ? 'wheelup' : 'wheeldown';
    } else if (isRelease) {
      button = decodeButton(buttonBits);
      type = 'release';
    } else if (isMotion) {
      button = buttonBits === 3 ? 'none' : decodeButton(buttonBits);
      type = 'move';
    } else {
      button = decodeButton(buttonBits);
      type = 'press';
    }

    // Convert from 1-based to 0-based coordinates
    this.result = mouseEvent(cx - 1, cy - 1, button, type, shift, ctrl, alt);
    return MatchResult.Complete;
  }
}

function decodeButton(bits: number): MouseEvent['button'] {
  switch (bits) {
    case 0: return 'left';
    case 1: return 'middle';
    case 2: return 'right';
    default: return 'none';
  }
}
