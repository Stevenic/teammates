/**
 * Wordwheel — autocomplete dropdown engine for readline REPLs.
 *
 * Manages a list of completion candidates, keyboard navigation (up/down/tab),
 * and renders them via a Dropdown instance.
 *
 * The Wordwheel doesn't know about specific completions — you provide
 * an ItemProvider callback that returns candidates for the current input.
 */

import type { Interface as ReadlineInterface } from "node:readline";
import type { Dropdown } from "./dropdown.js";

export interface WordwheelItem {
  /** Left column display text (e.g. command name, ~14 chars). */
  label: string;
  /** Right column description text. */
  description: string;
  /** Full line content to set when this item is accepted. */
  completion: string;
}

export interface WordwheelOptions {
  /** Readline interface. */
  rl: ReadlineInterface;
  /** Dropdown to render into. */
  dropdown: Dropdown;
  /** Returns completion items for the current line/cursor state. */
  getItems: (line: string, cursor: number) => WordwheelItem[];
  /**
   * Format a highlighted item line.
   * Default: "▸ " + bold label + description
   */
  formatHighlighted?: (item: WordwheelItem) => string;
  /**
   * Format a normal item line.
   * Default: "  " + label + description
   */
  formatNormal?: (item: WordwheelItem) => string;
}

export class Wordwheel {
  items: WordwheelItem[] = [];
  index = -1;

  private rl: ReadlineInterface;
  private dropdown: Dropdown;
  private getItems: (line: string, cursor: number) => WordwheelItem[];
  private formatHighlighted: (item: WordwheelItem) => string;
  private formatNormal: (item: WordwheelItem) => string;

  constructor(options: WordwheelOptions) {
    this.rl = options.rl;
    this.dropdown = options.dropdown;
    this.getItems = options.getItems;

    this.formatHighlighted =
      options.formatHighlighted ??
      ((item) => `▸ ${item.label.padEnd(14)}${item.description}`);
    this.formatNormal =
      options.formatNormal ??
      ((item) => `  ${item.label.padEnd(14)}${item.description}`);
  }

  /** Recompute items based on current readline state. */
  update(): void {
    this.dropdown.clear();
    const line: string = (this.rl as any).line ?? "";
    const cursor: number = (this.rl as any).cursor ?? 0;

    this.items = this.getItems(line, cursor);

    if (this.items.length > 0) {
      this.index = Math.min(this.index, this.items.length - 1);
      this.render();
    } else {
      this.index = -1;
    }
  }

  /** Render the current items to the dropdown. */
  render(): void {
    const lines = this.items.map((item, i) =>
      i === this.index ? this.formatHighlighted(item) : this.formatNormal(item),
    );
    this.dropdown.render(lines);
  }

  /** Clear items and dropdown. */
  clear(): void {
    this.dropdown.clear();
    this.items = [];
    this.index = -1;
  }

  /** Move selection down. Returns true if handled. */
  moveDown(): boolean {
    if (this.items.length === 0) return false;
    this.index = Math.min(this.index + 1, this.items.length - 1);
    this.render();
    return true;
  }

  /** Move selection up. Returns true if handled. */
  moveUp(): boolean {
    if (this.items.length === 0) return false;
    this.index = Math.max(this.index - 1, -1);
    this.render();
    return true;
  }

  /**
   * Accept the currently highlighted item.
   * Sets the readline line to the item's completion text.
   * Returns the accepted item, or null if nothing was selected.
   */
  accept(): WordwheelItem | null {
    if (this.index < 0 || this.index >= this.items.length) return null;
    const item = this.items[this.index];

    this.clear();
    (this.rl as any).line = item.completion;
    (this.rl as any).cursor = item.completion.length;
    (this.rl as any)._refreshLine();

    // Recompute for next level of completion
    this.update();

    return item;
  }

  /**
   * Handle a key event. Returns true if the key was consumed.
   * Call this from your _ttyWrite override before passing to readline.
   */
  handleKey(key: { name?: string } | undefined): boolean {
    if (!key || this.items.length === 0) return false;

    if (key.name === "down") {
      this.moveDown();
      return true;
    }
    if (key.name === "up") {
      this.moveUp();
      return true;
    }
    if (key.name === "tab" && this.index >= 0) {
      this.accept();
      return true;
    }
    return false;
  }

  /**
   * Handle Enter key — accepts highlighted item into the line
   * but does NOT consume the key (caller should still pass to readline).
   */
  handleEnter(): void {
    if (this.items.length > 0 && this.index >= 0) {
      const item = this.items[this.index];
      if (item) {
        (this.rl as any).line = item.completion;
        (this.rl as any).cursor = item.completion.length;
      }
    }
    this.clear();
    (this.rl as any)._refreshLine();
  }
}
