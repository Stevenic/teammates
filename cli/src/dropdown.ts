/**
 * Dropdown — renders lines below the readline prompt.
 *
 * Hooks _refreshLine:
 *   1. origRefresh runs: clears screen, writes prompt, positions cursor
 *   2. We append dropdown lines with \n
 *   3. We adjust prevRows so the NEXT _refreshLine's moveCursor(0, -prevRows)
 *      moves the cursor back up past the dropdown lines to the prompt
 */

import type { Interface as ReadlineInterface } from "node:readline";

/** Truncate a string with ANSI codes to `max` visible characters. */
function truncateAnsi(str: string, max: number): string {
  let visible = 0;
  let i = 0;
  while (i < str.length && visible < max) {
    if (str[i] === "\x1b") {
      // Skip ANSI sequence
      const end = str.indexOf("m", i);
      if (end !== -1) { i = end + 1; continue; }
    }
    visible++;
    i++;
  }
  return str.slice(0, i);
}

export class Dropdown {
  private lines: string[] = [];
  private out = process.stdout;
  private refreshing = false; // guard against recursion

  constructor(private rl: ReadlineInterface) {
    this.installHook();
  }

  get rendered(): number {
    return this.lines.length;
  }

  /** Set dropdown content. Triggers _refreshLine to display. */
  render(newLines: string[]): void {
    this.lines = newLines;
    (this.rl as any)._refreshLine();
  }

  /** Clear dropdown. Next _refreshLine won't append anything. */
  clear(): void {
    this.lines = [];
  }

  private installHook(): void {
    const origRefresh = (this.rl as any)._refreshLine.bind(this.rl);

    (this.rl as any)._refreshLine = () => {
      // Guard: render() calls _refreshLine, which must not recurse
      if (this.refreshing) {
        origRefresh();
        return;
      }
      this.refreshing = true;

      // 1. Run the original: clears below, writes prompt, positions cursor
      origRefresh();

      // 2. Append dropdown lines below the prompt (truncated to prevent wrapping)
      if (this.lines.length > 0) {
        const cols = this.out.columns || 120;
        let buf = "";
        for (const line of this.lines) {
          buf += "\n" + truncateAnsi(line, cols - 1);
        }
        this.out.write(buf);

        // 3. Move cursor back up to the prompt line and restore column.
        //    Don't touch prevRows — cursor IS on the prompt line after this.
        const n = this.lines.length;
        this.out.write(`\x1b[${n}A`);
        const promptText: string = (this.rl as any)._prompt ?? "";
        const promptLen = promptText.replace(/\x1b\[[0-9;]*m/g, "").length;
        const cursor: number = (this.rl as any).cursor ?? 0;
        this.out.write(`\x1b[${promptLen + cursor + 1}G`);
      }

      this.refreshing = false;
    };
  }
}
