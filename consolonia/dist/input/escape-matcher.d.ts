/**
 * Parses ANSI escape sequences into KeyEvents.
 * Handles CSI sequences, SS3 sequences, and alt+char combinations.
 */
import { MatchResult, type IMatcher } from './matcher.js';
import { type InputEvent } from './events.js';
export declare class EscapeMatcher implements IMatcher {
    private state;
    /** Accumulated parameter bytes for CSI sequences (digits and semicolons). */
    private params;
    /** The completed event ready for flushing. */
    private result;
    append(char: string): MatchResult;
    flush(): InputEvent | null;
    reset(): void;
    /**
     * Called externally when an ESC timeout fires — emit the standalone
     * escape key event if we are still in the GotEsc state.
     */
    flushEscapeTimeout(): InputEvent | null;
    private handleControlChar;
    private handleAfterEsc;
    private handleCsi;
    private handleTildeSequence;
    private handleSs3;
    private parseModifier;
}
