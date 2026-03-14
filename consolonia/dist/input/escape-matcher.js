/**
 * Parses ANSI escape sequences into KeyEvents.
 * Handles CSI sequences, SS3 sequences, and alt+char combinations.
 */
import { MatchResult } from './matcher.js';
import { keyEvent } from './events.js';
const ESC = '\x1b';
/** Decode the xterm modifier parameter (1-based) into shift/alt/ctrl flags. */
function decodeModifier(mod) {
    // modifier = 1 + (shift ? 1 : 0) + (alt ? 2 : 0) + (ctrl ? 4 : 0)
    const m = mod - 1;
    return {
        shift: (m & 1) !== 0,
        alt: (m & 2) !== 0,
        ctrl: (m & 4) !== 0,
    };
}
/**
 * Map CSI final byte to key name for cursor/editing keys.
 * Final byte is the letter that terminates the sequence.
 */
const CSI_FINAL_KEYS = {
    A: 'up',
    B: 'down',
    C: 'right',
    D: 'left',
    H: 'home',
    F: 'end',
    Z: 'tab', // shift+tab (backtab) produces CSI Z
};
/**
 * Map CSI numeric code (before ~) to key name.
 * These are the "tilde" sequences like \x1b[3~.
 */
const CSI_TILDE_KEYS = {
    1: 'home',
    2: 'insert',
    3: 'delete',
    4: 'end',
    5: 'pageup',
    6: 'pagedown',
    // Function keys (F5-F12)
    15: 'f5',
    17: 'f6',
    18: 'f7',
    19: 'f8',
    20: 'f9',
    21: 'f10',
    23: 'f11',
    24: 'f12',
};
/** SS3 final bytes map to F1-F4. */
const SS3_KEYS = {
    P: 'f1',
    Q: 'f2',
    R: 'f3',
    S: 'f4',
};
/** Control character code points mapped to key names. */
const CTRL_KEYS = {
    0: { key: 'space', char: '', ctrl: true }, // Ctrl+Space / Ctrl+@
    8: { key: 'backspace', char: '', ctrl: false }, // Ctrl+H (some terminals)
    9: { key: 'tab', char: '\t', ctrl: false },
    10: { key: 'enter', char: '\n', ctrl: false }, // Ctrl+J
    13: { key: 'enter', char: '\r', ctrl: false },
    127: { key: 'backspace', char: '', ctrl: false },
};
export class EscapeMatcher {
    state = 0 /* State.Idle */;
    /** Accumulated parameter bytes for CSI sequences (digits and semicolons). */
    params = '';
    /** The completed event ready for flushing. */
    result = null;
    append(char) {
        const code = char.charCodeAt(0);
        switch (this.state) {
            case 0 /* State.Idle */:
                if (char === ESC) {
                    this.state = 1 /* State.GotEsc */;
                    return MatchResult.Partial;
                }
                // Handle control characters (Ctrl+A through Ctrl+Z, etc.)
                if (code < 32 || code === 127) {
                    return this.handleControlChar(code);
                }
                return MatchResult.NoMatch;
            case 1 /* State.GotEsc */:
                return this.handleAfterEsc(char, code);
            case 2 /* State.Csi */:
                return this.handleCsi(char, code);
            case 3 /* State.Ss3 */:
                return this.handleSs3(char);
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
    /**
     * Called externally when an ESC timeout fires — emit the standalone
     * escape key event if we are still in the GotEsc state.
     */
    flushEscapeTimeout() {
        if (this.state === 1 /* State.GotEsc */) {
            this.state = 0 /* State.Idle */;
            this.params = '';
            return keyEvent('escape', '', false, false, false);
        }
        return null;
    }
    handleControlChar(code) {
        const mapped = CTRL_KEYS[code];
        if (mapped) {
            this.result = keyEvent(mapped.key, mapped.char, false, mapped.ctrl, false);
            return MatchResult.Complete;
        }
        // Ctrl+A (1) through Ctrl+Z (26)
        if (code >= 1 && code <= 26) {
            const letter = String.fromCharCode(code + 96); // 1 -> 'a', 2 -> 'b', etc.
            this.result = keyEvent(letter, '', false, true, false);
            return MatchResult.Complete;
        }
        // Other control chars (28-31)
        this.result = keyEvent(`ctrl-${code}`, '', false, true, false);
        return MatchResult.Complete;
    }
    handleAfterEsc(char, code) {
        if (char === '[') {
            this.state = 2 /* State.Csi */;
            this.params = '';
            return MatchResult.Partial;
        }
        if (char === 'O') {
            this.state = 3 /* State.Ss3 */;
            return MatchResult.Partial;
        }
        if (char === ESC) {
            // Double ESC — emit first escape and stay in GotEsc for the second
            this.result = keyEvent('escape', '', false, false, false);
            this.state = 1 /* State.GotEsc */;
            return MatchResult.Complete;
        }
        // Alt+char
        this.state = 0 /* State.Idle */;
        if (code < 32 || code === 127) {
            // Alt+control char, e.g. Alt+Enter = \x1b\r
            const mapped = CTRL_KEYS[code];
            if (mapped) {
                this.result = keyEvent(mapped.key, mapped.char, false, mapped.ctrl, true);
                return MatchResult.Complete;
            }
        }
        // Alt + printable character
        const isUpper = code >= 65 && code <= 90;
        const key = char.toLowerCase() || char;
        this.result = keyEvent(key, char, isUpper, false, true);
        return MatchResult.Complete;
    }
    handleCsi(char, code) {
        // Parameter bytes: digits, semicolons, and '<' (for SGR mouse, but
        // mouse-matcher handles that — if we see '<' at start, bail out so
        // mouse-matcher can handle it)
        if (this.params.length === 0 && char === '<') {
            // This is the start of an SGR mouse sequence; we should not match it.
            this.state = 0 /* State.Idle */;
            this.params = '';
            return MatchResult.NoMatch;
        }
        if ((code >= 0x30 && code <= 0x3b) /* 0-9, :, ; */) {
            this.params += char;
            return MatchResult.Partial;
        }
        // Final byte — the actual command character
        this.state = 0 /* State.Idle */;
        if (char === '~') {
            return this.handleTildeSequence();
        }
        const keyName = CSI_FINAL_KEYS[char];
        if (keyName) {
            const mods = this.parseModifier();
            // CSI Z (shift+tab/backtab) always implies shift
            const shift = char === 'Z' ? true : mods.shift;
            this.params = '';
            this.result = keyEvent(keyName, '', shift, mods.ctrl, mods.alt);
            return MatchResult.Complete;
        }
        // Unrecognized CSI sequence — discard
        this.params = '';
        return MatchResult.NoMatch;
    }
    handleTildeSequence() {
        const parts = this.params.split(';');
        const num = parseInt(parts[0], 10);
        this.params = '';
        const keyName = CSI_TILDE_KEYS[num];
        if (!keyName) {
            return MatchResult.NoMatch;
        }
        const mods = parts.length >= 2 ? decodeModifier(parseInt(parts[1], 10)) : { shift: false, ctrl: false, alt: false };
        this.result = keyEvent(keyName, '', mods.shift, mods.ctrl, mods.alt);
        return MatchResult.Complete;
    }
    handleSs3(char) {
        this.state = 0 /* State.Idle */;
        const keyName = SS3_KEYS[char];
        if (keyName) {
            this.result = keyEvent(keyName, '', false, false, false);
            return MatchResult.Complete;
        }
        // Some terminals send SS3 A/B/C/D for arrow keys
        const arrowKey = CSI_FINAL_KEYS[char];
        if (arrowKey) {
            this.result = keyEvent(arrowKey, '', false, false, false);
            return MatchResult.Complete;
        }
        return MatchResult.NoMatch;
    }
    parseModifier() {
        if (!this.params) {
            return { shift: false, ctrl: false, alt: false };
        }
        const parts = this.params.split(';');
        if (parts.length >= 2) {
            const mod = parseInt(parts[1], 10);
            if (!isNaN(mod)) {
                return decodeModifier(mod);
            }
        }
        return { shift: false, ctrl: false, alt: false };
    }
}
