/**
 * InteractiveReadline — a batteries-included readline wrapper for CLI REPLs.
 *
 * Composes MutableOutput, PasteHandler, Dropdown, and Wordwheel into a
 * single cohesive readline experience with:
 *
 * - Paste detection (multi-line collapse, long single-line truncation)
 * - Autocomplete dropdown with keyboard navigation
 * - Mutable output for suppressing echo
 * - Cross-platform (Windows + macOS)
 *
 * Usage:
 *   const irl = new InteractiveReadline({
 *     prompt: "my-app> ",
 *     getItems: (line, cursor) => [...],
 *     onLine: async (input) => { ... },
 *   });
 *   await irl.start();
 */

import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import { MutableOutput } from "./mutable-output.js";
import { PasteHandler, type PasteResult } from "./paste-handler.js";
import { Dropdown } from "./dropdown.js";
import { Wordwheel, type WordwheelItem } from "./wordwheel.js";
import { eraseScreen, cursorHome } from "./ansi.js";
import type { FileAttachment } from "./file-drop.js";

export interface InteractiveReadlineOptions {
  /** Prompt string (may include ANSI color codes). */
  prompt: string;
  /** Return completion items for the current line/cursor. */
  getItems?: (line: string, cursor: number) => WordwheelItem[];
  /** Called when a line is ready to dispatch. */
  onLine: (input: string, attachments?: FileAttachment[]) => Promise<void> | void;
  /** Called when readline closes (Ctrl+D). */
  onClose?: () => void;
  /** Format a highlighted wordwheel item. */
  formatHighlighted?: (item: WordwheelItem) => string;
  /** Format a normal wordwheel item. */
  formatNormal?: (item: WordwheelItem) => string;
  /** Paste debounce timeout in ms (default: 30). */
  pasteDebounceMs?: number;
  /** Minimum chunk size to consider a single-line paste (default: 100). */
  longPasteThreshold?: number;
}

export class InteractiveReadline {
  readonly rl: ReadlineInterface;
  readonly output: MutableOutput;
  readonly dropdown: Dropdown;
  readonly wordwheel: Wordwheel;
  readonly pasteHandler: PasteHandler;

  private dispatching = false;
  private prompt: string;
  private onLine: (input: string, attachments?: FileAttachment[]) => Promise<void> | void;

  constructor(options: InteractiveReadlineOptions) {
    this.prompt = options.prompt;
    this.onLine = options.onLine;

    // 1. Create mutable output
    this.output = new MutableOutput();

    // 2. Create readline
    this.rl = createInterface({
      input: process.stdin,
      output: this.output,
      prompt: options.prompt,
      terminal: true,
    });

    // 3. Create dropdown (hooks _refreshLine)
    this.dropdown = new Dropdown(this.rl);

    // 4. Create wordwheel
    this.wordwheel = new Wordwheel({
      rl: this.rl,
      dropdown: this.dropdown,
      getItems: options.getItems ?? (() => []),
      formatHighlighted: options.formatHighlighted,
      formatNormal: options.formatNormal,
    });

    // 5. Create paste handler
    this.pasteHandler = new PasteHandler({
      rl: this.rl,
      output: this.output,
      debounceMs: options.pasteDebounceMs,
      longPasteThreshold: options.longPasteThreshold,
      formatPrompt: () => this.prompt,
      onLine: async (result) => {
        if (!result.input || this.dispatching) {
          this.rl.prompt();
          return;
        }

        this.dispatching = true;
        try {
          await this.onLine(result.input, result.attachments);
        } catch (err: any) {
          console.log(`Error: ${err.message}`);
        } finally {
          this.dispatching = false;
        }

        this.rl.prompt();
      },
    });

    // 6. Install keyboard interceptor
    this.installKeyHandler();

    // 7. Handle close
    this.rl.on("close", () => {
      options.onClose?.();
    });
  }

  /** Start the REPL — shows the prompt. */
  start(): void {
    this.rl.prompt();
  }

  /** Clear the terminal and re-show the prompt. */
  clearScreen(): void {
    process.stdout.write(eraseScreen + cursorHome);
  }

  /** Reset all state (paste buffers, wordwheel, etc.). */
  reset(): void {
    this.pasteHandler.reset();
    this.wordwheel.clear();
  }

  /** Access the current line text. */
  get line(): string {
    return (this.rl as any).line ?? "";
  }

  /** Set the current line text and cursor. */
  setLine(text: string): void {
    (this.rl as any).line = text;
    (this.rl as any).cursor = text.length;
    (this.rl as any)._refreshLine();
  }

  private installKeyHandler(): void {
    const origTtyWrite = (this.rl as any)._ttyWrite.bind(this.rl);

    (this.rl as any)._ttyWrite = (s: string, key: any) => {
      // Track keystroke timing for paste detection
      this.pasteHandler.onKeystroke();

      // Let wordwheel handle navigation keys
      if (this.wordwheel.handleKey(key)) return;

      // Enter: accept wordwheel selection first, then process normally
      if (key && key.name === "return") {
        this.wordwheel.handleEnter();
        origTtyWrite(s, key);
        return;
      }

      // All other keys: pass to readline, then update wordwheel
      this.wordwheel.clear();
      origTtyWrite(s, key);
      this.wordwheel.update();
    };
  }
}
