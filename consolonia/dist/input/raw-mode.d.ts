/**
 * Functions to enable and disable raw terminal mode on stdin.
 */
/**
 * Enable raw mode: disables line buffering and echo so we receive
 * every keystroke as it arrives.
 */
export declare function enableRawMode(): void;
/**
 * Disable raw mode: restores normal line-buffered terminal input
 * and pauses stdin so the process can exit cleanly.
 */
export declare function disableRawMode(): void;
