/**
 * Pure utility functions extracted from cli.ts for testability.
 */

/** Convert a Date to a human-readable relative time string. */
export function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

/** Word-wrap text to maxWidth, returning an array of lines. */
export function wrapLine(text: string, maxWidth: number): string[] {
  if (text.length <= maxWidth) return [text];
  const lines: string[] = [];
  let remaining = text;
  while (remaining.length > maxWidth) {
    let breakAt = remaining.lastIndexOf(" ", maxWidth);
    if (breakAt <= 0) breakAt = maxWidth;
    lines.push(remaining.slice(0, breakAt));
    remaining = remaining.slice(breakAt + (remaining[breakAt] === " " ? 1 : 0));
  }
  if (remaining) lines.push(remaining);
  return lines;
}

/**
 * Find an @mention at the given cursor position in a line.
 * Returns the partial text after '@', the position of '@', and the text before it,
 * or null if no valid @mention is found.
 */
export function findAtMention(
  line: string,
  cursor: number,
): { before: string; partial: string; atPos: number } | null {
  // Walk backward from cursor to find the nearest unescaped '@'
  const left = line.slice(0, cursor);
  const atPos = left.lastIndexOf("@");
  if (atPos < 0) return null;
  // '@' must be at start of line or preceded by whitespace
  if (atPos > 0 && !/\s/.test(line[atPos - 1])) return null;
  const partial = left.slice(atPos + 1);
  // Partial must be a single token (no spaces)
  if (/\s/.test(partial)) return null;
  return { before: line.slice(0, atPos), partial, atPos };
}

/** Set of recognized image file extensions. */
export const IMAGE_EXTS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".webp",
  ".svg",
  ".ico",
]);

/** Check if a string looks like an image file path. */
export function isImagePath(text: string): boolean {
  // Must look like a file path (contains slash or backslash, or starts with drive letter)
  if (!/[/\\]/.test(text) && !/^[a-zA-Z]:/.test(text)) return false;
  // Must not contain newlines
  if (/\n/.test(text)) return false;
  const ext = text.slice(text.lastIndexOf(".")).toLowerCase();
  return IMAGE_EXTS.has(ext);
}
