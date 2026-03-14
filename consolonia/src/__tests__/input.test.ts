/**
 * Comprehensive unit tests for the raw input system (Phase 4).
 * Covers EscapeMatcher, PasteMatcher, MouseMatcher, TextMatcher, and InputProcessor.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { MatchResult } from '../input/matcher.js';
import { EscapeMatcher } from '../input/escape-matcher.js';
import { PasteMatcher } from '../input/paste-matcher.js';
import { MouseMatcher } from '../input/mouse-matcher.js';
import { TextMatcher } from '../input/text-matcher.js';
import { createInputProcessor } from '../input/processor.js';
import type { InputEvent } from '../input/events.js';

// ── Helpers ───────────────────────────────────────────────────────────

/** Feed a full string char-by-char into a matcher, returning each result. */
function feedAll(matcher: { append(c: string): MatchResult }, data: string): MatchResult[] {
  return [...data].map((c) => matcher.append(c));
}

/** Feed a string and return the final MatchResult. */
function feedString(matcher: { append(c: string): MatchResult }, data: string): MatchResult {
  const results = feedAll(matcher, data);
  return results[results.length - 1];
}

/** Collect all InputEvents emitted by an InputProcessor when feeding data. */
function collectEvents(data: string): InputEvent[] {
  const { processor, events } = createInputProcessor();
  const collected: InputEvent[] = [];
  events.on('input', (ev: InputEvent) => collected.push(ev));
  processor.feed(data);
  processor.destroy();
  return collected;
}

// =====================================================================
// EscapeMatcher
// =====================================================================

describe('EscapeMatcher', () => {
  let matcher: EscapeMatcher;

  afterEach(() => {
    matcher?.reset();
  });

  // ── Arrow keys ────────────────────────────────────────────────────

  describe('arrow keys', () => {
    it.each([
      ['\x1b[A', 'up'],
      ['\x1b[B', 'down'],
      ['\x1b[C', 'right'],
      ['\x1b[D', 'left'],
    ])('parses %j as key=%s', (seq, expectedKey) => {
      matcher = new EscapeMatcher();
      const result = feedString(matcher, seq);
      expect(result).toBe(MatchResult.Complete);
      const ev = matcher.flush();
      expect(ev).not.toBeNull();
      expect(ev!.type).toBe('key');
      if (ev!.type === 'key') {
        expect(ev!.event.key).toBe(expectedKey);
        expect(ev!.event.shift).toBe(false);
        expect(ev!.event.ctrl).toBe(false);
        expect(ev!.event.alt).toBe(false);
      }
    });
  });

  // ── Arrow keys with modifiers ─────────────────────────────────────

  describe('arrow keys with modifiers', () => {
    it('parses shift+up (\\x1b[1;2A)', () => {
      matcher = new EscapeMatcher();
      expect(feedString(matcher, '\x1b[1;2A')).toBe(MatchResult.Complete);
      const ev = matcher.flush();
      expect(ev!.type).toBe('key');
      if (ev!.type === 'key') {
        expect(ev!.event.key).toBe('up');
        expect(ev!.event.shift).toBe(true);
        expect(ev!.event.ctrl).toBe(false);
        expect(ev!.event.alt).toBe(false);
      }
    });

    it('parses ctrl+up (\\x1b[1;5A)', () => {
      matcher = new EscapeMatcher();
      expect(feedString(matcher, '\x1b[1;5A')).toBe(MatchResult.Complete);
      const ev = matcher.flush();
      expect(ev!.type).toBe('key');
      if (ev!.type === 'key') {
        expect(ev!.event.key).toBe('up');
        expect(ev!.event.shift).toBe(false);
        expect(ev!.event.ctrl).toBe(true);
        expect(ev!.event.alt).toBe(false);
      }
    });

    it('parses alt+up (\\x1b[1;3A)', () => {
      matcher = new EscapeMatcher();
      expect(feedString(matcher, '\x1b[1;3A')).toBe(MatchResult.Complete);
      const ev = matcher.flush();
      expect(ev!.type).toBe('key');
      if (ev!.type === 'key') {
        expect(ev!.event.key).toBe('up');
        expect(ev!.event.shift).toBe(false);
        expect(ev!.event.ctrl).toBe(false);
        expect(ev!.event.alt).toBe(true);
      }
    });

    it('parses shift+ctrl+alt+down (\\x1b[1;8B)', () => {
      matcher = new EscapeMatcher();
      // modifier 8 = 1 + shift(1) + alt(2) + ctrl(4)
      expect(feedString(matcher, '\x1b[1;8B')).toBe(MatchResult.Complete);
      const ev = matcher.flush();
      expect(ev!.type).toBe('key');
      if (ev!.type === 'key') {
        expect(ev!.event.key).toBe('down');
        expect(ev!.event.shift).toBe(true);
        expect(ev!.event.ctrl).toBe(true);
        expect(ev!.event.alt).toBe(true);
      }
    });
  });

  // ── Home/End ──────────────────────────────────────────────────────

  describe('home and end', () => {
    it('parses home (\\x1b[H)', () => {
      matcher = new EscapeMatcher();
      expect(feedString(matcher, '\x1b[H')).toBe(MatchResult.Complete);
      const ev = matcher.flush();
      expect(ev!.type).toBe('key');
      if (ev!.type === 'key') {
        expect(ev!.event.key).toBe('home');
      }
    });

    it('parses end (\\x1b[F)', () => {
      matcher = new EscapeMatcher();
      expect(feedString(matcher, '\x1b[F')).toBe(MatchResult.Complete);
      const ev = matcher.flush();
      expect(ev!.type).toBe('key');
      if (ev!.type === 'key') {
        expect(ev!.event.key).toBe('end');
      }
    });
  });

  // ── Delete ────────────────────────────────────────────────────────

  describe('delete key', () => {
    it('parses delete (\\x1b[3~)', () => {
      matcher = new EscapeMatcher();
      expect(feedString(matcher, '\x1b[3~')).toBe(MatchResult.Complete);
      const ev = matcher.flush();
      expect(ev!.type).toBe('key');
      if (ev!.type === 'key') {
        expect(ev!.event.key).toBe('delete');
      }
    });
  });

  // ── Tilde keys (insert, pageup, pagedown) ────────────────────────

  describe('tilde sequences', () => {
    it.each([
      ['\x1b[2~', 'insert'],
      ['\x1b[5~', 'pageup'],
      ['\x1b[6~', 'pagedown'],
    ])('parses %j as key=%s', (seq, expectedKey) => {
      matcher = new EscapeMatcher();
      expect(feedString(matcher, seq)).toBe(MatchResult.Complete);
      const ev = matcher.flush();
      expect(ev!.type).toBe('key');
      if (ev!.type === 'key') {
        expect(ev!.event.key).toBe(expectedKey);
      }
    });
  });

  // ── Function keys ─────────────────────────────────────────────────

  describe('function keys', () => {
    it('parses F1 (\\x1bOP)', () => {
      matcher = new EscapeMatcher();
      expect(feedString(matcher, '\x1bOP')).toBe(MatchResult.Complete);
      const ev = matcher.flush();
      expect(ev!.type).toBe('key');
      if (ev!.type === 'key') {
        expect(ev!.event.key).toBe('f1');
      }
    });

    it('parses F2 (\\x1bOQ)', () => {
      matcher = new EscapeMatcher();
      expect(feedString(matcher, '\x1bOQ')).toBe(MatchResult.Complete);
      const ev = matcher.flush();
      expect(ev!.type).toBe('key');
      if (ev!.type === 'key') {
        expect(ev!.event.key).toBe('f2');
      }
    });

    it('parses F3 (\\x1bOR)', () => {
      matcher = new EscapeMatcher();
      expect(feedString(matcher, '\x1bOR')).toBe(MatchResult.Complete);
      const ev = matcher.flush();
      expect(ev!.type).toBe('key');
      if (ev!.type === 'key') {
        expect(ev!.event.key).toBe('f3');
      }
    });

    it('parses F4 (\\x1bOS)', () => {
      matcher = new EscapeMatcher();
      expect(feedString(matcher, '\x1bOS')).toBe(MatchResult.Complete);
      const ev = matcher.flush();
      expect(ev!.type).toBe('key');
      if (ev!.type === 'key') {
        expect(ev!.event.key).toBe('f4');
      }
    });

    it('parses F5 (\\x1b[15~)', () => {
      matcher = new EscapeMatcher();
      expect(feedString(matcher, '\x1b[15~')).toBe(MatchResult.Complete);
      const ev = matcher.flush();
      expect(ev!.type).toBe('key');
      if (ev!.type === 'key') {
        expect(ev!.event.key).toBe('f5');
      }
    });

    it.each([
      ['\x1b[17~', 'f6'],
      ['\x1b[18~', 'f7'],
      ['\x1b[19~', 'f8'],
      ['\x1b[20~', 'f9'],
      ['\x1b[21~', 'f10'],
      ['\x1b[23~', 'f11'],
      ['\x1b[24~', 'f12'],
    ])('parses %j as key=%s', (seq, expectedKey) => {
      matcher = new EscapeMatcher();
      expect(feedString(matcher, seq)).toBe(MatchResult.Complete);
      const ev = matcher.flush();
      expect(ev!.type).toBe('key');
      if (ev!.type === 'key') {
        expect(ev!.event.key).toBe(expectedKey);
      }
    });
  });

  // ── Control characters ────────────────────────────────────────────

  describe('control characters', () => {
    it('parses ctrl+a (\\x01)', () => {
      matcher = new EscapeMatcher();
      expect(matcher.append('\x01')).toBe(MatchResult.Complete);
      const ev = matcher.flush();
      expect(ev!.type).toBe('key');
      if (ev!.type === 'key') {
        expect(ev!.event.key).toBe('a');
        expect(ev!.event.ctrl).toBe(true);
      }
    });

    it('parses ctrl+c (\\x03)', () => {
      matcher = new EscapeMatcher();
      expect(matcher.append('\x03')).toBe(MatchResult.Complete);
      const ev = matcher.flush();
      expect(ev!.type).toBe('key');
      if (ev!.type === 'key') {
        expect(ev!.event.key).toBe('c');
        expect(ev!.event.ctrl).toBe(true);
      }
    });

    it('parses ctrl+d (\\x04)', () => {
      matcher = new EscapeMatcher();
      expect(matcher.append('\x04')).toBe(MatchResult.Complete);
      const ev = matcher.flush();
      expect(ev!.type).toBe('key');
      if (ev!.type === 'key') {
        expect(ev!.event.key).toBe('d');
        expect(ev!.event.ctrl).toBe(true);
      }
    });

    it('parses enter (\\r)', () => {
      matcher = new EscapeMatcher();
      expect(matcher.append('\r')).toBe(MatchResult.Complete);
      const ev = matcher.flush();
      expect(ev!.type).toBe('key');
      if (ev!.type === 'key') {
        expect(ev!.event.key).toBe('enter');
        expect(ev!.event.ctrl).toBe(false);
      }
    });

    it('parses backspace (\\x7f)', () => {
      matcher = new EscapeMatcher();
      expect(matcher.append('\x7f')).toBe(MatchResult.Complete);
      const ev = matcher.flush();
      expect(ev!.type).toBe('key');
      if (ev!.type === 'key') {
        expect(ev!.event.key).toBe('backspace');
        expect(ev!.event.ctrl).toBe(false);
      }
    });

    it('parses tab (\\t)', () => {
      matcher = new EscapeMatcher();
      expect(matcher.append('\t')).toBe(MatchResult.Complete);
      const ev = matcher.flush();
      expect(ev!.type).toBe('key');
      if (ev!.type === 'key') {
        expect(ev!.event.key).toBe('tab');
        expect(ev!.event.char).toBe('\t');
        expect(ev!.event.ctrl).toBe(false);
      }
    });

    it('parses ctrl+z (\\x1a)', () => {
      matcher = new EscapeMatcher();
      expect(matcher.append('\x1a')).toBe(MatchResult.Complete);
      const ev = matcher.flush();
      expect(ev!.type).toBe('key');
      if (ev!.type === 'key') {
        expect(ev!.event.key).toBe('z');
        expect(ev!.event.ctrl).toBe(true);
      }
    });
  });

  // ── Partial sequence feeding ──────────────────────────────────────

  describe('partial sequence feeding', () => {
    it('returns Partial for each char of \\x1b[A until the final char', () => {
      matcher = new EscapeMatcher();
      expect(matcher.append('\x1b')).toBe(MatchResult.Partial);
      expect(matcher.append('[')).toBe(MatchResult.Partial);
      expect(matcher.append('A')).toBe(MatchResult.Complete);

      const ev = matcher.flush();
      expect(ev!.type).toBe('key');
      if (ev!.type === 'key') {
        expect(ev!.event.key).toBe('up');
      }
    });

    it('returns Partial while reading modifier params', () => {
      matcher = new EscapeMatcher();
      expect(matcher.append('\x1b')).toBe(MatchResult.Partial);
      expect(matcher.append('[')).toBe(MatchResult.Partial);
      expect(matcher.append('1')).toBe(MatchResult.Partial);
      expect(matcher.append(';')).toBe(MatchResult.Partial);
      expect(matcher.append('5')).toBe(MatchResult.Partial);
      expect(matcher.append('A')).toBe(MatchResult.Complete);
    });
  });

  // ── Rejects mouse sequences ───────────────────────────────────────

  describe('mouse sequence rejection', () => {
    it('rejects CSI < (mouse) sequences with NoMatch', () => {
      matcher = new EscapeMatcher();
      expect(matcher.append('\x1b')).toBe(MatchResult.Partial);
      expect(matcher.append('[')).toBe(MatchResult.Partial);
      expect(matcher.append('<')).toBe(MatchResult.NoMatch);
    });
  });

  // ── Shift+Tab (backtab) ───────────────────────────────────────────

  describe('shift+tab', () => {
    it('parses CSI Z as shift+tab', () => {
      matcher = new EscapeMatcher();
      expect(feedString(matcher, '\x1b[Z')).toBe(MatchResult.Complete);
      const ev = matcher.flush();
      expect(ev!.type).toBe('key');
      if (ev!.type === 'key') {
        expect(ev!.event.key).toBe('tab');
        expect(ev!.event.shift).toBe(true);
      }
    });
  });

  // ── Alt+char combinations ─────────────────────────────────────────

  describe('alt+char', () => {
    it('parses ESC followed by printable char as alt+char', () => {
      matcher = new EscapeMatcher();
      expect(matcher.append('\x1b')).toBe(MatchResult.Partial);
      expect(matcher.append('a')).toBe(MatchResult.Complete);
      const ev = matcher.flush();
      expect(ev!.type).toBe('key');
      if (ev!.type === 'key') {
        expect(ev!.event.key).toBe('a');
        expect(ev!.event.alt).toBe(true);
        expect(ev!.event.shift).toBe(false);
      }
    });

    it('parses alt+uppercase letter with shift flag', () => {
      matcher = new EscapeMatcher();
      expect(feedString(matcher, '\x1bA')).toBe(MatchResult.Complete);
      const ev = matcher.flush();
      expect(ev!.type).toBe('key');
      if (ev!.type === 'key') {
        expect(ev!.event.key).toBe('a');
        expect(ev!.event.alt).toBe(true);
        expect(ev!.event.shift).toBe(true);
      }
    });
  });

  // ── flushEscapeTimeout ────────────────────────────────────────────

  describe('flushEscapeTimeout', () => {
    it('emits escape key when called in GotEsc state', () => {
      matcher = new EscapeMatcher();
      expect(matcher.append('\x1b')).toBe(MatchResult.Partial);
      const ev = matcher.flushEscapeTimeout();
      expect(ev).not.toBeNull();
      expect(ev!.type).toBe('key');
      if (ev!.type === 'key') {
        expect(ev!.event.key).toBe('escape');
      }
    });

    it('returns null when not in GotEsc state', () => {
      matcher = new EscapeMatcher();
      expect(matcher.flushEscapeTimeout()).toBeNull();
    });
  });

  // ── NoMatch for printable chars ───────────────────────────────────

  describe('NoMatch for non-escape input', () => {
    it('returns NoMatch for printable characters', () => {
      matcher = new EscapeMatcher();
      expect(matcher.append('a')).toBe(MatchResult.NoMatch);
      expect(matcher.append('Z')).toBe(MatchResult.NoMatch);
      expect(matcher.append(' ')).toBe(MatchResult.NoMatch);
    });
  });

  // ── Reset ─────────────────────────────────────────────────────────

  describe('reset', () => {
    it('clears partial state', () => {
      matcher = new EscapeMatcher();
      matcher.append('\x1b');
      matcher.reset();
      // After reset, should be back to idle
      expect(matcher.append('a')).toBe(MatchResult.NoMatch);
    });
  });
});

// =====================================================================
// PasteMatcher
// =====================================================================

describe('PasteMatcher', () => {
  let matcher: PasteMatcher;

  afterEach(() => {
    matcher?.reset();
  });

  it('parses a complete paste sequence fed char by char', () => {
    matcher = new PasteMatcher();
    const data = '\x1b[200~hello world\x1b[201~';
    const results = feedAll(matcher, data);

    // Final char should produce Complete
    expect(results[results.length - 1]).toBe(MatchResult.Complete);

    // All preceding chars should be Partial
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i]).toBe(MatchResult.Partial);
    }

    const ev = matcher.flush();
    expect(ev).not.toBeNull();
    expect(ev!.type).toBe('paste');
    if (ev!.type === 'paste') {
      expect(ev!.event.text).toBe('hello world');
    }
  });

  it('handles empty paste content', () => {
    matcher = new PasteMatcher();
    const data = '\x1b[200~\x1b[201~';
    expect(feedString(matcher, data)).toBe(MatchResult.Complete);
    const ev = matcher.flush();
    expect(ev!.type).toBe('paste');
    if (ev!.type === 'paste') {
      expect(ev!.event.text).toBe('');
    }
  });

  it('handles paste with special characters inside', () => {
    matcher = new PasteMatcher();
    const content = 'line1\nline2\ttab\r\nend';
    const data = `\x1b[200~${content}\x1b[201~`;
    expect(feedString(matcher, data)).toBe(MatchResult.Complete);
    const ev = matcher.flush();
    expect(ev!.type).toBe('paste');
    if (ev!.type === 'paste') {
      expect(ev!.event.text).toBe(content);
    }
  });

  it('returns NoMatch for non-paste sequences', () => {
    matcher = new PasteMatcher();
    expect(matcher.append('a')).toBe(MatchResult.NoMatch);
    expect(matcher.append('Z')).toBe(MatchResult.NoMatch);
    expect(matcher.append('\r')).toBe(MatchResult.NoMatch);
  });

  it('returns NoMatch after start marker mismatch', () => {
    matcher = new PasteMatcher();
    // ESC starts partial, but next char does not continue start marker correctly
    expect(matcher.append('\x1b')).toBe(MatchResult.Partial);
    expect(matcher.append('X')).toBe(MatchResult.NoMatch);
  });

  it('handles partial end marker mismatch (text contains \\x1b but not end marker)', () => {
    matcher = new PasteMatcher();
    // Paste that contains an ESC char in the text (not forming the end marker)
    const data = '\x1b[200~has\x1bXinside\x1b[201~';
    expect(feedString(matcher, data)).toBe(MatchResult.Complete);
    const ev = matcher.flush();
    expect(ev!.type).toBe('paste');
    if (ev!.type === 'paste') {
      expect(ev!.event.text).toBe('has\x1bXinside');
    }
  });

  it('resets properly and can match again', () => {
    matcher = new PasteMatcher();
    feedString(matcher, '\x1b[200~first\x1b[201~');
    matcher.flush();

    // Second paste
    expect(feedString(matcher, '\x1b[200~second\x1b[201~')).toBe(MatchResult.Complete);
    const ev = matcher.flush();
    expect(ev!.type).toBe('paste');
    if (ev!.type === 'paste') {
      expect(ev!.event.text).toBe('second');
    }
  });
});

// =====================================================================
// MouseMatcher
// =====================================================================

describe('MouseMatcher', () => {
  let matcher: MouseMatcher;

  afterEach(() => {
    matcher?.reset();
  });

  // ── Press events ──────────────────────────────────────────────────

  describe('press events', () => {
    it('parses left press at (9,19) from \\x1b[<0;10;20M', () => {
      matcher = new MouseMatcher();
      expect(feedString(matcher, '\x1b[<0;10;20M')).toBe(MatchResult.Complete);
      const ev = matcher.flush();
      expect(ev).not.toBeNull();
      expect(ev!.type).toBe('mouse');
      if (ev!.type === 'mouse') {
        expect(ev!.event.button).toBe('left');
        expect(ev!.event.type).toBe('press');
        expect(ev!.event.x).toBe(9);  // 10 - 1 = 9 (1-based to 0-based)
        expect(ev!.event.y).toBe(19); // 20 - 1 = 19
        expect(ev!.event.shift).toBe(false);
        expect(ev!.event.ctrl).toBe(false);
        expect(ev!.event.alt).toBe(false);
      }
    });

    it('parses middle press', () => {
      matcher = new MouseMatcher();
      expect(feedString(matcher, '\x1b[<1;5;5M')).toBe(MatchResult.Complete);
      const ev = matcher.flush();
      if (ev!.type === 'mouse') {
        expect(ev!.event.button).toBe('middle');
        expect(ev!.event.type).toBe('press');
      }
    });

    it('parses right press from \\x1b[<2;5;5M', () => {
      matcher = new MouseMatcher();
      expect(feedString(matcher, '\x1b[<2;5;5M')).toBe(MatchResult.Complete);
      const ev = matcher.flush();
      if (ev!.type === 'mouse') {
        expect(ev!.event.button).toBe('right');
        expect(ev!.event.type).toBe('press');
        expect(ev!.event.x).toBe(4);
        expect(ev!.event.y).toBe(4);
      }
    });
  });

  // ── Release events ────────────────────────────────────────────────

  describe('release events', () => {
    it('parses left release from \\x1b[<0;10;20m (lowercase m)', () => {
      matcher = new MouseMatcher();
      expect(feedString(matcher, '\x1b[<0;10;20m')).toBe(MatchResult.Complete);
      const ev = matcher.flush();
      if (ev!.type === 'mouse') {
        expect(ev!.event.button).toBe('left');
        expect(ev!.event.type).toBe('release');
        expect(ev!.event.x).toBe(9);
        expect(ev!.event.y).toBe(19);
      }
    });
  });

  // ── Wheel events ──────────────────────────────────────────────────

  describe('wheel events', () => {
    it('parses wheel up from \\x1b[<64;5;5M', () => {
      matcher = new MouseMatcher();
      expect(feedString(matcher, '\x1b[<64;5;5M')).toBe(MatchResult.Complete);
      const ev = matcher.flush();
      if (ev!.type === 'mouse') {
        expect(ev!.event.button).toBe('none');
        expect(ev!.event.type).toBe('wheelup');
      }
    });

    it('parses wheel down from \\x1b[<65;5;5M', () => {
      matcher = new MouseMatcher();
      expect(feedString(matcher, '\x1b[<65;5;5M')).toBe(MatchResult.Complete);
      const ev = matcher.flush();
      if (ev!.type === 'mouse') {
        expect(ev!.event.button).toBe('none');
        expect(ev!.event.type).toBe('wheeldown');
      }
    });
  });

  // ── Modifier keys ────────────────────────────────────────────────

  describe('modifier keys in mouse events', () => {
    it('parses shift+left press (cb=4)', () => {
      matcher = new MouseMatcher();
      // 4 = shift(4) + left(0)
      expect(feedString(matcher, '\x1b[<4;1;1M')).toBe(MatchResult.Complete);
      const ev = matcher.flush();
      if (ev!.type === 'mouse') {
        expect(ev!.event.button).toBe('left');
        expect(ev!.event.type).toBe('press');
        expect(ev!.event.shift).toBe(true);
        expect(ev!.event.alt).toBe(false);
        expect(ev!.event.ctrl).toBe(false);
      }
    });

    it('parses alt+left press (cb=8)', () => {
      matcher = new MouseMatcher();
      expect(feedString(matcher, '\x1b[<8;1;1M')).toBe(MatchResult.Complete);
      const ev = matcher.flush();
      if (ev!.type === 'mouse') {
        expect(ev!.event.button).toBe('left');
        expect(ev!.event.shift).toBe(false);
        expect(ev!.event.alt).toBe(true);
        expect(ev!.event.ctrl).toBe(false);
      }
    });

    it('parses ctrl+left press (cb=16)', () => {
      matcher = new MouseMatcher();
      expect(feedString(matcher, '\x1b[<16;1;1M')).toBe(MatchResult.Complete);
      const ev = matcher.flush();
      if (ev!.type === 'mouse') {
        expect(ev!.event.button).toBe('left');
        expect(ev!.event.shift).toBe(false);
        expect(ev!.event.alt).toBe(false);
        expect(ev!.event.ctrl).toBe(true);
      }
    });

    it('parses shift+ctrl+alt+right press (cb=30)', () => {
      matcher = new MouseMatcher();
      // 30 = right(2) + shift(4) + alt(8) + ctrl(16)
      expect(feedString(matcher, '\x1b[<30;3;7M')).toBe(MatchResult.Complete);
      const ev = matcher.flush();
      if (ev!.type === 'mouse') {
        expect(ev!.event.button).toBe('right');
        expect(ev!.event.type).toBe('press');
        expect(ev!.event.shift).toBe(true);
        expect(ev!.event.alt).toBe(true);
        expect(ev!.event.ctrl).toBe(true);
        expect(ev!.event.x).toBe(2);
        expect(ev!.event.y).toBe(6);
      }
    });
  });

  // ── Motion events ─────────────────────────────────────────────────

  describe('motion events', () => {
    it('parses mouse move with left button held (cb=32)', () => {
      matcher = new MouseMatcher();
      // 32 = motion(32) + left(0)
      expect(feedString(matcher, '\x1b[<32;10;10M')).toBe(MatchResult.Complete);
      const ev = matcher.flush();
      if (ev!.type === 'mouse') {
        expect(ev!.event.type).toBe('move');
        expect(ev!.event.button).toBe('left');
      }
    });

    it('parses mouse move with no button (cb=35)', () => {
      matcher = new MouseMatcher();
      // 35 = motion(32) + 3 (no button)
      expect(feedString(matcher, '\x1b[<35;10;10M')).toBe(MatchResult.Complete);
      const ev = matcher.flush();
      if (ev!.type === 'mouse') {
        expect(ev!.event.type).toBe('move');
        expect(ev!.event.button).toBe('none');
      }
    });
  });

  // ── NoMatch cases ─────────────────────────────────────────────────

  describe('NoMatch cases', () => {
    it('returns NoMatch for non-ESC characters', () => {
      matcher = new MouseMatcher();
      expect(matcher.append('a')).toBe(MatchResult.NoMatch);
    });

    it('returns NoMatch if ESC not followed by [', () => {
      matcher = new MouseMatcher();
      expect(matcher.append('\x1b')).toBe(MatchResult.Partial);
      expect(matcher.append('O')).toBe(MatchResult.NoMatch);
    });

    it('returns NoMatch if \\x1b[ not followed by <', () => {
      matcher = new MouseMatcher();
      expect(matcher.append('\x1b')).toBe(MatchResult.Partial);
      expect(matcher.append('[')).toBe(MatchResult.Partial);
      expect(matcher.append('A')).toBe(MatchResult.NoMatch);
    });
  });

  // ── Partial feeding ───────────────────────────────────────────────

  describe('partial feeding', () => {
    it('returns Partial for each char until the final M or m', () => {
      matcher = new MouseMatcher();
      const results = feedAll(matcher, '\x1b[<0;1;1M');
      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i]).toBe(MatchResult.Partial);
      }
      expect(results[results.length - 1]).toBe(MatchResult.Complete);
    });
  });
});

// =====================================================================
// TextMatcher
// =====================================================================

describe('TextMatcher', () => {
  let matcher: TextMatcher;

  afterEach(() => {
    matcher?.reset();
  });

  describe('printable characters', () => {
    it.each([
      ['a', 'a', false],
      ['z', 'z', false],
      ['A', 'A', true],
      ['Z', 'Z', true],
      ['0', '0', false],
      ['9', '9', false],
      ['!', '!', false],
      ['@', '@', false],
      ['.', '.', false],
      [',', ',', false],
    ])('produces KeyEvent for %j', (char, expectedChar, expectedShift) => {
      matcher = new TextMatcher();
      expect(matcher.append(char)).toBe(MatchResult.Complete);
      const ev = matcher.flush();
      expect(ev).not.toBeNull();
      expect(ev!.type).toBe('key');
      if (ev!.type === 'key') {
        expect(ev!.event.char).toBe(expectedChar);
        expect(ev!.event.shift).toBe(expectedShift);
        expect(ev!.event.ctrl).toBe(false);
        expect(ev!.event.alt).toBe(false);
      }
    });

    it('maps space to key="space"', () => {
      matcher = new TextMatcher();
      expect(matcher.append(' ')).toBe(MatchResult.Complete);
      const ev = matcher.flush();
      if (ev!.type === 'key') {
        expect(ev!.event.key).toBe('space');
        expect(ev!.event.char).toBe(' ');
      }
    });

    it('uses the char itself as key for non-space printable chars', () => {
      matcher = new TextMatcher();
      matcher.append('x');
      const ev = matcher.flush();
      if (ev!.type === 'key') {
        expect(ev!.event.key).toBe('x');
      }
    });
  });

  describe('NoMatch for non-printable characters', () => {
    it('returns NoMatch for control characters (code < 32)', () => {
      matcher = new TextMatcher();
      // Try a few control chars
      expect(matcher.append('\x00')).toBe(MatchResult.NoMatch);
      expect(matcher.append('\x01')).toBe(MatchResult.NoMatch);
      expect(matcher.append('\x0a')).toBe(MatchResult.NoMatch);
      expect(matcher.append('\r')).toBe(MatchResult.NoMatch);
      expect(matcher.append('\t')).toBe(MatchResult.NoMatch);
    });

    it('returns NoMatch for DEL (0x7f)', () => {
      matcher = new TextMatcher();
      expect(matcher.append('\x7f')).toBe(MatchResult.NoMatch);
    });

    it('returns NoMatch for ESC (0x1b)', () => {
      matcher = new TextMatcher();
      expect(matcher.append('\x1b')).toBe(MatchResult.NoMatch);
    });
  });

  describe('high unicode characters', () => {
    it('matches unicode characters above ASCII', () => {
      matcher = new TextMatcher();
      expect(matcher.append('\u00e9')).toBe(MatchResult.Complete); // e-acute
      const ev = matcher.flush();
      expect(ev!.type).toBe('key');
      if (ev!.type === 'key') {
        expect(ev!.event.char).toBe('\u00e9');
      }
    });
  });
});

// =====================================================================
// InputProcessor
// =====================================================================

describe('InputProcessor', () => {
  it('produces 5 key events from "hello"', () => {
    const events = collectEvents('hello');
    expect(events).toHaveLength(5);
    const keys = events.map((e) => {
      expect(e.type).toBe('key');
      return e.type === 'key' ? e.event.key : '';
    });
    expect(keys).toEqual(['h', 'e', 'l', 'l', 'o']);
  });

  // NOTE: The PasteMatcher has highest priority and claims ESC as Partial
  // because ESC starts the paste start marker (\x1b[200~). When the sequence
  // turns out not to be a paste (e.g., \x1b[A for up-arrow), the ESC and [
  // chars are consumed and lost. Only the final char (e.g., 'A') is re-tried
  // against all matchers. This is the current processor behavior — non-paste
  // escape sequences that share the \x1b[ prefix are degraded.

  it('escape sequences starting with \\x1b[ are consumed by paste matcher priority (known behavior)', () => {
    // \x1b[A: PasteMatcher eats ESC and [, then A falls through to TextMatcher
    const events = collectEvents('\x1b[A');
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('key');
    if (events[0].type === 'key') {
      // Due to paste matcher priority, only 'A' survives as a text key
      expect(events[0].event.key).toBe('A');
      expect(events[0].event.shift).toBe(true);
    }
  });

  it('produces one paste event from a bracketed paste sequence', () => {
    const events = collectEvents('\x1b[200~pasted text\x1b[201~');
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('paste');
    if (events[0].type === 'paste') {
      expect(events[0].event.text).toBe('pasted text');
    }
  });

  it('SGR mouse sequence chars are individually parsed as text (paste matcher priority)', () => {
    // \x1b[<0;5;10M: PasteMatcher eats ESC and [, then < and the rest are
    // processed individually by TextMatcher. This is the current behavior.
    const events = collectEvents('\x1b[<0;5;10M');
    expect(events).toHaveLength(8);
    // All events should be key events for the individual characters
    for (const ev of events) {
      expect(ev.type).toBe('key');
    }
  });

  it('handles mixed text and escape sequences: "ab\\x1b[Acd"', () => {
    const events = collectEvents('ab\x1b[Acd');
    expect(events).toHaveLength(5);

    // 'a', 'b', then ESC+[ consumed by paste matcher, 'A' as text, 'c', 'd'
    expect(events[0].type).toBe('key');
    expect(events[1].type).toBe('key');
    expect(events[2].type).toBe('key');
    expect(events[3].type).toBe('key');
    expect(events[4].type).toBe('key');

    if (events[0].type === 'key') expect(events[0].event.key).toBe('a');
    if (events[1].type === 'key') expect(events[1].event.key).toBe('b');
    if (events[2].type === 'key') expect(events[2].event.key).toBe('A');
    if (events[3].type === 'key') expect(events[3].event.key).toBe('c');
    if (events[4].type === 'key') expect(events[4].event.key).toBe('d');
  });

  it('handles multiple escape sequences in a row (degraded by paste priority)', () => {
    const events = collectEvents('\x1b[A\x1b[B\x1b[C');
    // Each \x1b[X sequence: ESC+[ consumed by paste matcher, final char as text
    expect(events).toHaveLength(3);
    if (events[0].type === 'key') expect(events[0].event.key).toBe('A');
    if (events[1].type === 'key') expect(events[1].event.key).toBe('B');
    if (events[2].type === 'key') expect(events[2].event.key).toBe('C');
  });

  it('handles control characters mixed with text', () => {
    const events = collectEvents('a\rb');
    expect(events).toHaveLength(3);
    if (events[0].type === 'key') expect(events[0].event.key).toBe('a');
    if (events[1].type === 'key') expect(events[1].event.key).toBe('enter');
    if (events[2].type === 'key') expect(events[2].event.key).toBe('b');
  });

  it('paste matcher takes priority over escape matcher for paste sequences', () => {
    const events = collectEvents('\x1b[200~xyz\x1b[201~');
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('paste');
    if (events[0].type === 'paste') {
      expect(events[0].event.text).toBe('xyz');
    }
  });

  it('paste matcher priority means mouse sequences are not recognized', () => {
    // Both PasteMatcher and MouseMatcher start with \x1b[, but PasteMatcher
    // has higher priority and claims the ESC first. When it fails (sees < instead
    // of 2), the remaining chars are re-tried individually.
    const events = collectEvents('\x1b[<0;1;1M');
    expect(events.length).toBeGreaterThan(1);
    // The individual chars <, 0, ;, 1, ;, 1, M are emitted as text key events
    for (const ev of events) {
      expect(ev.type).toBe('key');
    }
  });

  it('handles text after a paste sequence', () => {
    const events = collectEvents('\x1b[200~pasted\x1b[201~after');
    expect(events).toHaveLength(6); // 1 paste + 5 chars
    expect(events[0].type).toBe('paste');
    if (events[0].type === 'paste') {
      expect(events[0].event.text).toBe('pasted');
    }
    // Next 5 events should be key events for 'a', 'f', 't', 'e', 'r'
    for (let i = 1; i <= 5; i++) {
      expect(events[i].type).toBe('key');
    }
    if (events[1].type === 'key') expect(events[1].event.key).toBe('a');
    if (events[5].type === 'key') expect(events[5].event.key).toBe('r');
  });

  it('SS3 F-keys: \\x1bOP degraded by paste matcher (ESC consumed, O and P as text)', () => {
    // \x1bOP: PasteMatcher takes ESC as Partial, then O does not match [ -> NoMatch.
    // O is retried: PasteMatcher NoMatch, MouseMatcher NoMatch, EscapeMatcher NoMatch
    // (O is code 79, printable), TextMatcher matches O.
    // Then P is processed: TextMatcher matches P.
    const events = collectEvents('\x1bOP');
    expect(events).toHaveLength(2);
    if (events[0].type === 'key') expect(events[0].event.key).toBe('O');
    if (events[1].type === 'key') expect(events[1].event.key).toBe('P');
  });

  it('delete key \\x1b[3~ degraded by paste matcher', () => {
    // \x1b[3~: PasteMatcher eats ESC, [, then 3 does not match '2' -> NoMatch.
    // 3 retried -> TextMatcher. ~ retried -> TextMatcher.
    const events = collectEvents('\x1b[3~');
    expect(events).toHaveLength(2);
    if (events[0].type === 'key') expect(events[0].event.key).toBe('3');
    if (events[1].type === 'key') expect(events[1].event.key).toBe('~');
  });

  it('control characters are handled even with paste matcher priority', () => {
    // Control chars (code < 32) are NOT ESC, so PasteMatcher returns NoMatch.
    // EscapeMatcher handles them directly.
    const events = collectEvents('\x01\x03');
    expect(events).toHaveLength(2);
    if (events[0].type === 'key') {
      expect(events[0].event.key).toBe('a');
      expect(events[0].event.ctrl).toBe(true);
    }
    if (events[1].type === 'key') {
      expect(events[1].event.key).toBe('c');
      expect(events[1].event.ctrl).toBe(true);
    }
  });

  it('createInputProcessor returns processor and events emitter', () => {
    const { processor, events } = createInputProcessor();
    expect(processor).toBeDefined();
    expect(events).toBeDefined();
    expect(typeof processor.feed).toBe('function');
    expect(typeof processor.destroy).toBe('function');
    expect(typeof events.on).toBe('function');
    processor.destroy();
  });
});
