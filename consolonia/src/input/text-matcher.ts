/**
 * Matches printable text characters — anything with char code >= 32
 * that is not DEL (0x7f) and not ESC (0x1b).
 *
 * Emits a KeyEvent for each printable character.
 */

import { type InputEvent, keyEvent } from "./events.js";
import { type IMatcher, MatchResult } from "./matcher.js";

export class TextMatcher implements IMatcher {
  private result: InputEvent | null = null;

  append(char: string): MatchResult {
    const code = char.charCodeAt(0);

    // Printable: code >= 32, not DEL (127), not ESC (27).
    // Also accept high-Unicode characters (surrogate pairs, emoji, etc.)
    if (code >= 32 && code !== 127 && code !== 27) {
      const isUpper = code >= 65 && code <= 90;
      const key = char === " " ? "space" : char;
      const charValue = char;
      this.result = keyEvent(key, charValue, isUpper, false, false);
      return MatchResult.Complete;
    }

    return MatchResult.NoMatch;
  }

  flush(): InputEvent | null {
    const ev = this.result;
    this.result = null;
    return ev;
  }

  reset(): void {
    this.result = null;
  }
}
