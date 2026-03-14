/**
 * Input event type definitions for the raw terminal input system.
 * Mirrors Consolonia's RawConsoleInputEventArgs and related types.
 */
// ── Factory helpers ─────────────────────────────────────────────────
export function keyEvent(key, char = '', shift = false, ctrl = false, alt = false) {
    return { type: 'key', event: { key, char, shift, ctrl, alt } };
}
export function mouseEvent(x, y, button, type, shift = false, ctrl = false, alt = false) {
    return { type: 'mouse', event: { x, y, button, type, shift, ctrl, alt } };
}
export function pasteEvent(text) {
    return { type: 'paste', event: { text } };
}
export function resizeEvent(width, height) {
    return { type: 'resize', width, height };
}
