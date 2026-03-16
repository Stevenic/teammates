/**
 * PromptBox — renders a fenced input box around the readline prompt.
 *
 * Draws horizontal borders above and below the input line, similar to
 * Claude Code's UI. Automatically recalculates on terminal resize.
 *
 * Layout:
 *   ────────────────────────────────────────
 *   ❯ user input here
 *   ────────────────────────────────────────
 *   (optional status / dropdown lines)
 *
 * Approach (inspired by Consolonia's dirty-region rendering):
 *   - _refreshLine hook uses esc.eraseDown to nuke everything below the
 *     prompt, then redraws the bottom border + dropdown fresh each time.
 *   - On resize, the entire prompt area (top border + prompt + bottom)
 *     is cleared and redrawn. We don't try to navigate to old content
 *     since terminal reflow makes cursor-relative positioning unreliable.
 */

import type { Interface as ReadlineInterface } from "node:readline";
import { esc, stripAnsi, truncateAnsi } from "@teammates/consolonia";
import { cursorToCol } from "./ansi.js";

export interface PromptBoxOptions {
  /** Readline interface. */
  rl: ReadlineInterface;
  /** Border character (default: "─"). */
  borderChar?: string;
  /** ANSI color wrapper for the border (default: dim/gray). */
  borderStyle?: (s: string) => string;
  /** Optional status line rendered below the bottom border. */
  getStatusLine?: () => string | null;
}

export class PromptBox {
  private rl: ReadlineInterface;
  private out = process.stdout;
  private borderChar: string;
  private borderStyle: (s: string) => string;
  private getStatusLine: () => string | null;
  private refreshing = false;
  private dropdownLines: string[] = [];
  private active = false;

  constructor(options: PromptBoxOptions) {
    this.rl = options.rl;
    this.borderChar = options.borderChar ?? "─";
    this.borderStyle = options.borderStyle ?? ((s) => `\x1b[2m${s}\x1b[0m`);
    this.getStatusLine = options.getStatusLine ?? (() => null);

    this.installHook();
    this.listenResize();
  }

  /** Set dropdown content to render below the bottom border. */
  setDropdown(lines: string[]): void {
    this.dropdownLines = lines;
    (this.rl as any)._refreshLine();
  }

  /** Clear dropdown content. */
  clearDropdown(): void {
    this.dropdownLines = [];
  }

  /**
   * Draw the top border and activate the prompt box.
   * Call before rl.prompt().
   */
  drawTopBorder(): void {
    this.out.write(`${this.buildBorder()}\n`);
    this.active = true;
  }

  /** Deactivate during dispatch so streaming output isn't corrupted. */
  deactivate(): void {
    this.active = false;
  }

  private buildBorder(): string {
    const width = this.out.columns || 80;
    return this.borderStyle(this.borderChar.repeat(width));
  }

  private installHook(): void {
    const origRefresh = (this.rl as any)._refreshLine.bind(this.rl);

    (this.rl as any)._refreshLine = () => {
      if (this.refreshing || !this.active) {
        origRefresh();
        return;
      }
      this.refreshing = true;

      // Let readline clear the prompt line and rewrite it
      origRefresh();

      // Nuke everything below the prompt line, then draw fresh.
      // This avoids stale content from previous renders at different widths.
      const cols = this.out.columns || 80;
      let buf = esc.eraseDown;
      let linesBelow = 0;

      // Bottom border
      buf += `\n${this.buildBorder()}`;
      linesBelow++;

      // Status line
      const status = this.getStatusLine();
      if (status) {
        buf += `\n${truncateAnsi(status, cols - 1)}`;
        linesBelow++;
      }

      // Dropdown lines
      for (const line of this.dropdownLines) {
        buf += `\n${truncateAnsi(line, cols - 1)}`;
        linesBelow++;
      }

      this.out.write(buf);

      // Move cursor back up to the prompt line
      this.out.write(esc.moveUp(linesBelow));

      // Restore cursor column
      const promptText: string = (this.rl as any)._prompt ?? "";
      const promptLen = stripAnsi(promptText).length;
      const cursor: number = (this.rl as any).cursor ?? 0;
      this.out.write(cursorToCol(promptLen + cursor + 1));

      this.refreshing = false;
    };
  }

  private listenResize(): void {
    this.out.on("resize", () => {
      if (!this.active) return;

      // After resize, terminal has reflowed all content. Cursor-relative
      // navigation to old content is unreliable (a 150-char border now
      // wraps to 2 lines on an 80-col terminal, etc.).
      //
      // Strategy: scroll past any reflowed junk by writing blank lines,
      // then draw a fresh prompt area. The old top border in scrollback
      // may look wrong — that's acceptable, same as any terminal app.
      this.out.write(`\n\n${esc.eraseLine}`);
      this.out.write(`${this.buildBorder()}\n`);
      this.rl.prompt();
    });
  }
}
