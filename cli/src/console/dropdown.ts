/**
 * Dropdown — renders lines below the readline prompt without disrupting input.
 *
 * Hooks readline's internal _refreshLine to append dropdown content below
 * the prompt, then repositions the cursor back to the input line.
 *
 * Works on both Windows and macOS terminals.
 */

import type { Interface as ReadlineInterface } from "node:readline";
import { cursorUp, cursorToCol, truncateAnsi, stripAnsi } from "./ansi.js";

export class Dropdown {
  private lines: string[] = [];
  private out = process.stdout;
  private refreshing = false;

  constructor(private rl: ReadlineInterface) {
    this.installHook();
  }

  /** Number of lines currently rendered below the prompt. */
  get rendered(): number {
    return this.lines.length;
  }

  /** Set dropdown content and trigger a re-render. */
  render(newLines: string[]): void {
    this.lines = newLines;
    (this.rl as any)._refreshLine();
  }

  /** Clear dropdown content. Next _refreshLine won't append anything. */
  clear(): void {
    this.lines = [];
  }

  private installHook(): void {
    const origRefresh = (this.rl as any)._refreshLine.bind(this.rl);

    (this.rl as any)._refreshLine = () => {
      if (this.refreshing) {
        origRefresh();
        return;
      }
      this.refreshing = true;

      // Run original: clears below, writes prompt, positions cursor
      origRefresh();

      // Append dropdown lines below the prompt
      if (this.lines.length > 0) {
        const cols = this.out.columns || 120;
        let buf = "";
        for (const line of this.lines) {
          buf += "\n" + truncateAnsi(line, cols - 1);
        }
        this.out.write(buf);

        // Move cursor back to the prompt line
        const n = this.lines.length;
        this.out.write(cursorUp(n));

        // Restore cursor column position
        const promptText: string = (this.rl as any)._prompt ?? "";
        const promptLen = stripAnsi(promptText).length;
        const cursor: number = (this.rl as any).cursor ?? 0;
        this.out.write(cursorToCol(promptLen + cursor + 1));
      }

      this.refreshing = false;
    };
  }
}
