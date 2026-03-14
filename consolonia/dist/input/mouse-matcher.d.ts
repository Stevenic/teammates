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
import { type InputEvent } from './events.js';
export declare class MouseMatcher implements IMatcher {
    private state;
    private params;
    private result;
    append(char: string): MatchResult;
    flush(): InputEvent | null;
    reset(): void;
    private finalize;
}
