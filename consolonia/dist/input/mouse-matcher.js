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
import { MatchResult } from './matcher.js';
import { mouseEvent } from './events.js';
const ESC = '\x1b';
export class MouseMatcher {
    state = 0 /* State.Idle */;
    params = '';
    result = null;
    append(char) {
        switch (this.state) {
            case 0 /* State.Idle */:
                if (char === ESC) {
                    this.state = 1 /* State.GotEsc */;
                    return MatchResult.Partial;
                }
                return MatchResult.NoMatch;
            case 1 /* State.GotEsc */:
                if (char === '[') {
                    this.state = 2 /* State.GotBracket */;
                    return MatchResult.Partial;
                }
                this.state = 0 /* State.Idle */;
                return MatchResult.NoMatch;
            case 2 /* State.GotBracket */:
                if (char === '<') {
                    this.state = 3 /* State.Reading */;
                    this.params = '';
                    return MatchResult.Partial;
                }
                this.state = 0 /* State.Idle */;
                return MatchResult.NoMatch;
            case 3 /* State.Reading */:
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
                this.state = 0 /* State.Idle */;
                this.params = '';
                return MatchResult.NoMatch;
            default:
                return MatchResult.NoMatch;
        }
    }
    flush() {
        const ev = this.result;
        this.result = null;
        return ev;
    }
    reset() {
        this.state = 0 /* State.Idle */;
        this.params = '';
        this.result = null;
    }
    finalize(isRelease) {
        this.state = 0 /* State.Idle */;
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
        let button;
        let type;
        if (highBits === 64) {
            // Wheel events
            button = 'none';
            type = buttonBits === 0 ? 'wheelup' : 'wheeldown';
        }
        else if (isRelease) {
            button = decodeButton(buttonBits);
            type = 'release';
        }
        else if (isMotion) {
            button = buttonBits === 3 ? 'none' : decodeButton(buttonBits);
            type = 'move';
        }
        else {
            button = decodeButton(buttonBits);
            type = 'press';
        }
        // Convert from 1-based to 0-based coordinates
        this.result = mouseEvent(cx - 1, cy - 1, button, type, shift, ctrl, alt);
        return MatchResult.Complete;
    }
}
function decodeButton(bits) {
    switch (bits) {
        case 0: return 'left';
        case 1: return 'middle';
        case 2: return 'right';
        default: return 'none';
    }
}
