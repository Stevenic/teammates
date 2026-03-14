/**
 * Input event type definitions for the raw terminal input system.
 * Mirrors Consolonia's RawConsoleInputEventArgs and related types.
 */
/** Keyboard event produced by key presses and escape sequences. */
export interface KeyEvent {
    /** Logical key name: 'a', 'A', 'enter', 'backspace', 'up', 'f1', etc. */
    key: string;
    /** The actual character produced, empty string for non-printable keys. */
    char: string;
    shift: boolean;
    ctrl: boolean;
    alt: boolean;
}
/** Mouse event produced by SGR extended mouse tracking. */
export interface MouseEvent {
    /** 0-based column. */
    x: number;
    /** 0-based row. */
    y: number;
    button: 'left' | 'middle' | 'right' | 'none';
    type: 'press' | 'release' | 'move' | 'wheelup' | 'wheeldown';
    shift: boolean;
    ctrl: boolean;
    alt: boolean;
}
/** Bracketed paste event containing the pasted text. */
export interface PasteEvent {
    text: string;
}
/** Discriminated union of all input events. */
export type InputEvent = {
    type: 'key';
    event: KeyEvent;
} | {
    type: 'mouse';
    event: MouseEvent;
} | {
    type: 'paste';
    event: PasteEvent;
} | {
    type: 'resize';
    width: number;
    height: number;
};
export declare function keyEvent(key: string, char?: string, shift?: boolean, ctrl?: boolean, alt?: boolean): InputEvent;
export declare function mouseEvent(x: number, y: number, button: MouseEvent['button'], type: MouseEvent['type'], shift?: boolean, ctrl?: boolean, alt?: boolean): InputEvent;
export declare function pasteEvent(text: string): InputEvent;
export declare function resizeEvent(width: number, height: number): InputEvent;
