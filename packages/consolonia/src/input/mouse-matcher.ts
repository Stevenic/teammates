/**
 * Parses terminal mouse tracking sequences.
 *
 * Supported formats:
 *   SGR:        \x1b[<Cb;Cx;CyM  (press/motion)
 *               \x1b[<Cb;Cx;Cym  (release)
 *   SGR-Pixels: \x1b[<Cb;Cx;CyM  (same wire format as SGR, pixel coords)
 *               \x1b[<Cb;Cx;Cym
 *   X10:        \x1b[M Cb Cx Cy  (classic xterm byte encoding)
 *   UTF-8:      \x1b[M Cb Cx Cy  (same prefix as X10, UTF-8 encoded coords)
 *   URXVT:      \x1b[Cb;Cx;CyM   (decimal params, no < prefix)
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
 *
 * Note: UTF-8 mode uses the same \x1b[M prefix as X10 but encodes
 * coordinates as UTF-8 characters for values > 127. Node.js decodes
 * UTF-8 stdin automatically, so the X10 parser handles both formats.
 *
 * Note: SGR-Pixels mode uses the same wire format as SGR but reports
 * pixel coordinates instead of cell coordinates. These are passed
 * through as-is (the caller must convert to cells if needed).
 */

import { type InputEvent, type MouseEvent, mouseEvent } from "./events.js";
import { type IMatcher, MatchResult } from "./matcher.js";

const ESC = "\x1b";

enum State {
  Idle,
  /** Got \x1b */
  GotEsc,
  /** Got \x1b[ */
  GotBracket,
  /** Got \x1b[< — now reading SGR/SGR-Pixels params until M or m */
  Reading,
  /** Got \x1b[M — now reading three encoded bytes (X10 or UTF-8) */
  ReadingX10,
  /** Got \x1b[ followed by a digit — reading URXVT decimal params until M */
  ReadingUrxvt,
}

export class MouseMatcher implements IMatcher {
  private state: State = State.Idle;
  private params: string = "";
  private x10Bytes: string[] = [];
  private urxvtParams: string = "";
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
        if (char === "[") {
          this.state = State.GotBracket;
          return MatchResult.Partial;
        }
        this.state = State.Idle;
        return MatchResult.NoMatch;

      case State.GotBracket:
        if (char === "<") {
          this.state = State.Reading;
          this.params = "";
          return MatchResult.Partial;
        }
        if (char === "M") {
          this.state = State.ReadingX10;
          this.x10Bytes = [];
          return MatchResult.Partial;
        }
        // URXVT: \x1b[ followed by a digit starts decimal param reading
        if (char >= "0" && char <= "9") {
          this.state = State.ReadingUrxvt;
          this.urxvtParams = char;
          return MatchResult.Partial;
        }
        this.state = State.Idle;
        return MatchResult.NoMatch;

      case State.Reading: {
        if (char === "M" || char === "m") {
          return this.finalize(char === "m");
        }
        // Valid param chars: digits and semicolons
        const code = char.charCodeAt(0);
        if ((code >= 0x30 && code <= 0x39) || char === ";") {
          this.params += char;
          return MatchResult.Partial;
        }
        // Unexpected character — abort
        this.state = State.Idle;
        this.params = "";
        return MatchResult.NoMatch;
      }

      case State.ReadingX10:
        this.x10Bytes.push(char);
        if (this.x10Bytes.length < 3) {
          return MatchResult.Partial;
        }
        return this.finalizeX10();

      case State.ReadingUrxvt: {
        if (char === "M") {
          return this.finalizeUrxvt();
        }
        const c = char.charCodeAt(0);
        if ((c >= 0x30 && c <= 0x39) || char === ";") {
          this.urxvtParams += char;
          return MatchResult.Partial;
        }
        // Not a valid URXVT sequence — bail out
        this.state = State.Idle;
        this.urxvtParams = "";
        return MatchResult.NoMatch;
      }

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
    this.params = "";
    this.x10Bytes = [];
    this.urxvtParams = "";
    this.result = null;
  }

  private finalize(isRelease: boolean): MatchResult {
    this.state = State.Idle;

    const parts = this.params.split(";");
    this.params = "";

    if (parts.length !== 3) {
      return MatchResult.NoMatch;
    }

    const cb = parseInt(parts[0], 10);
    const cx = parseInt(parts[1], 10);
    const cy = parseInt(parts[2], 10);

    if (Number.isNaN(cb) || Number.isNaN(cx) || Number.isNaN(cy)) {
      return MatchResult.NoMatch;
    }

    if (isRelease) {
      const shift = (cb & 4) !== 0;
      const alt = (cb & 8) !== 0;
      const ctrl = (cb & 16) !== 0;
      this.result = mouseEvent(
        cx - 1,
        cy - 1,
        decodeButton(cb & 3),
        "release",
        shift,
        ctrl,
        alt,
      );
      return MatchResult.Complete;
    }

    this.result = decodeMouseEvent(cb, cx, cy, true);
    return this.result ? MatchResult.Complete : MatchResult.NoMatch;
  }

  private finalizeUrxvt(): MatchResult {
    this.state = State.Idle;

    const parts = this.urxvtParams.split(";");
    this.urxvtParams = "";

    if (parts.length !== 3) {
      return MatchResult.NoMatch;
    }

    const cb = parseInt(parts[0], 10);
    const cx = parseInt(parts[1], 10);
    const cy = parseInt(parts[2], 10);

    if (Number.isNaN(cb) || Number.isNaN(cx) || Number.isNaN(cy)) {
      return MatchResult.NoMatch;
    }

    // URXVT uses the same button encoding as X10 (button 3 = release)
    this.result = decodeMouseEvent(cb, cx, cy, true);
    return this.result ? MatchResult.Complete : MatchResult.NoMatch;
  }

  private finalizeX10(): MatchResult {
    this.state = State.Idle;

    if (this.x10Bytes.length !== 3) {
      this.x10Bytes = [];
      return MatchResult.NoMatch;
    }

    const [cbChar, cxChar, cyChar] = this.x10Bytes;
    this.x10Bytes = [];

    const cb = cbChar.charCodeAt(0) - 32;
    const cx = cxChar.charCodeAt(0) - 32;
    const cy = cyChar.charCodeAt(0) - 32;

    if (cb < 0 || cx <= 0 || cy <= 0) {
      return MatchResult.NoMatch;
    }

    this.result = decodeMouseEvent(cb, cx, cy, true);
    return this.result ? MatchResult.Complete : MatchResult.NoMatch;
  }
}

function decodeMouseEvent(
  cb: number,
  cx: number,
  cy: number,
  x10ReleaseUsesButton3: boolean,
): InputEvent | null {
  const shift = (cb & 4) !== 0;
  const alt = (cb & 8) !== 0;
  const ctrl = (cb & 16) !== 0;
  const isMotion = (cb & 32) !== 0;

  const buttonBits = cb & 3;
  const highBits = cb & (64 | 128);

  let button: MouseEvent["button"];
  let type: MouseEvent["type"];

  if (highBits === 64) {
    button = "none";
    type = buttonBits === 0 ? "wheelup" : "wheeldown";
  } else if (x10ReleaseUsesButton3 && !isMotion && buttonBits === 3) {
    button = "none";
    type = "release";
  } else if (isMotion) {
    button = buttonBits === 3 ? "none" : decodeButton(buttonBits);
    type = "move";
  } else {
    button = decodeButton(buttonBits);
    type = "press";
  }

  return mouseEvent(cx - 1, cy - 1, button, type, shift, ctrl, alt);
}

function decodeButton(bits: number): MouseEvent["button"] {
  switch (bits) {
    case 0:
      return "left";
    case 1:
      return "middle";
    case 2:
      return "right";
    default:
      return "none";
  }
}
