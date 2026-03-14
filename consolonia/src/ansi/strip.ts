/**
 * Functions for stripping and measuring ANSI-escaped strings.
 */

/**
 * Regex matching all common ANSI escape sequences:
 * - CSI sequences: ESC [ ... <letter>
 * - OSC sequences: ESC ] ... BEL/ST
 * - Simple two-byte escapes: ESC <char>
 */
const ANSI_RE =
  // eslint-disable-next-line no-control-regex
  /\x1b(?:\[[0-9;?]*[A-Za-z]|\][^\x07]*\x07|[()#][A-Za-z0-9]|[A-Za-z])/g;

/**
 * Strip all ANSI escape codes from a string, returning only visible characters.
 */
export function stripAnsi(str: string): string {
  return str.replace(ANSI_RE, "");
}

/**
 * Get the visible (non-ANSI) length of a string.
 */
export function visibleLength(str: string): number {
  return stripAnsi(str).length;
}

/**
 * Truncate a string containing ANSI codes to a maximum number of visible characters.
 * ANSI sequences are preserved up to the cut-off point.
 */
export function truncateAnsi(str: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";

  let visible = 0;
  let i = 0;

  while (i < str.length && visible < maxWidth) {
    // Check for ESC
    if (str.charCodeAt(i) === 0x1b) {
      // Try to match a CSI sequence: ESC [ ... letter
      if (i + 1 < str.length && str.charCodeAt(i + 1) === 0x5b) {
        // 0x5b = '['
        let j = i + 2;
        while (j < str.length && str.charCodeAt(j) >= 0x20 && str.charCodeAt(j) <= 0x3f) {
          j++;
        }
        if (j < str.length) {
          j++; // consume the final letter
        }
        i = j;
        continue;
      }
      // Try to match an OSC sequence: ESC ] ... BEL
      if (i + 1 < str.length && str.charCodeAt(i + 1) === 0x5d) {
        // 0x5d = ']'
        let j = i + 2;
        while (j < str.length && str.charCodeAt(j) !== 0x07) {
          j++;
        }
        if (j < str.length) {
          j++; // consume BEL
        }
        i = j;
        continue;
      }
      // Simple two-byte escape
      i += 2;
      continue;
    }

    // Visible character
    visible++;
    i++;
  }

  return str.slice(0, i);
}
