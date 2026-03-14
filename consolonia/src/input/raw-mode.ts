/**
 * Functions to enable and disable raw terminal mode on stdin.
 */

/**
 * Enable raw mode: disables line buffering and echo so we receive
 * every keystroke as it arrives.
 */
export function enableRawMode(): void {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
}

/**
 * Disable raw mode: restores normal line-buffered terminal input
 * and pauses stdin so the process can exit cleanly.
 */
export function disableRawMode(): void {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }
  process.stdin.pause();
}
