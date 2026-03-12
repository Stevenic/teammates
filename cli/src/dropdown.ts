/**
 * Dropdown — renders lines below the readline prompt.
 *
 * Key constraint: readline's _refreshLine() calls clearScreenDown(),
 * which erases everything below the cursor. So we NEVER call _refreshLine
 * after writing dropdown content. Instead we manually position the cursor.
 */

import type { Interface as ReadlineInterface } from "node:readline";

export class Dropdown {
  private count = 0;
  private out = process.stdout;

  constructor(private rl: ReadlineInterface) {}

  get rendered(): number {
    return this.count;
  }

  /** Show or update the dropdown. Pass [] to hide. */
  render(lines: string[]): void {
    if (lines.length === 0) {
      this.clear();
      return;
    }

    // Erase old content (if any) + write new content in one pass
    // Step 1: move down into any existing rows and erase them
    const toClear = Math.max(this.count, lines.length);
    // Make sure enough rows exist below — emit \n's then come back
    for (let i = 0; i < toClear; i++) this.out.write("\n");
    this.out.write(`\x1b[${toClear}A`);
    // Step 2: write new lines (move down with \x1b[E which goes to col 0 of next line)
    for (let i = 0; i < toClear; i++) {
      this.out.write(`\x1b[E\x1b[2K`);
      if (i < lines.length) this.out.write(lines[i]);
    }
    // Step 3: move back up and position cursor on the prompt
    this.out.write(`\x1b[${toClear}A`);
    this.restoreCursor();
    this.count = lines.length;
  }

  /** Erase all dropdown content. */
  clear(): void {
    if (this.count === 0) return;
    // Move into rows below and erase each one
    for (let i = 0; i < this.count; i++) {
      this.out.write(`\x1b[E\x1b[2K`);
    }
    this.out.write(`\x1b[${this.count}A`);
    this.restoreCursor();
    this.count = 0;
  }

  /** Position cursor on the prompt line at the right column — without _refreshLine. */
  private restoreCursor(): void {
    const promptText: string = (this.rl as any)._prompt ?? "";
    const promptLen = promptText.replace(/\x1b\[[0-9;]*m/g, "").length;
    const cursor: number = (this.rl as any).cursor ?? 0;
    const col = promptLen + cursor + 1; // 1-based
    this.out.write(`\x1b[${col}G`);
  }
}
