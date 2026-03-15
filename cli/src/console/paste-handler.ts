/**
 * PasteHandler — detects and manages pasted text in a readline REPL.
 *
 * Handles:
 * - Multi-line pastes: collapses into a numbered placeholder, expands on Enter
 * - Long single-line pastes: dispatches directly with truncated preview
 * - File drag & drop: detects pasted file paths, converts to [Image #N] / [File #N] tags
 *
 * Works on both Windows and macOS terminals.
 */

import type { Interface as ReadlineInterface } from "node:readline";
import { esc } from "@teammates/consolonia";
import { type FileAttachment, FileDropHandler } from "./file-drop.js";
import type { MutableOutput } from "./mutable-output.js";

export interface PasteResult {
  /** The final input text (with placeholders expanded). */
  input: string;
  /** Whether the input contained expanded paste placeholders. */
  hadPaste: boolean;
  /** File attachments referenced in the input. */
  attachments: FileAttachment[];
}

export interface PasteHandlerOptions {
  /** Readline interface */
  rl: ReadlineInterface;
  /** Mutable output stream for suppressing echo */
  output: MutableOutput;
  /** Debounce timeout in ms (default: 30) */
  debounceMs?: number;
  /** Minimum chunk size to consider a single-line paste (default: 100) */
  longPasteThreshold?: number;
  /** Callback when a line (or expanded paste) is ready to dispatch. */
  onLine: (result: PasteResult) => void;
  /** Optional: format the prompt string for re-rendering. */
  formatPrompt?: () => string;
  /** Optional: format a file tag for display (receives attachment, returns styled string). */
  formatFileTag?: (attachment: FileAttachment) => string;
  /** Optional: format the "file attached" hint shown after a drop. */
  formatFileHint?: (attachment: FileAttachment) => string;
}

export class PasteHandler {
  private buffer: string[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private count = 0;
  private storedTexts = new Map<number, string>();
  private prePastePrefix = "";
  private lastKeystrokeTime = 0;

  readonly fileDrop: FileDropHandler;

  private rl: ReadlineInterface;
  private output: MutableOutput;
  private debounceMs: number;
  private longPasteThreshold: number;
  private onLine: (result: PasteResult) => void;
  private formatPrompt: () => string;
  private formatFileTag: (attachment: FileAttachment) => string;
  private formatFileHint: (attachment: FileAttachment) => string;

  constructor(options: PasteHandlerOptions) {
    this.rl = options.rl;
    this.output = options.output;
    this.debounceMs = options.debounceMs ?? 30;
    this.longPasteThreshold = options.longPasteThreshold ?? 100;
    this.onLine = options.onLine;
    this.formatPrompt = options.formatPrompt ?? (() => "> ");
    this.fileDrop = new FileDropHandler();

    this.formatFileTag =
      options.formatFileTag ??
      ((a) => {
        const type = a.isImage ? "Image" : "File";
        return `[${type} #${a.id}]`;
      });

    this.formatFileHint =
      options.formatFileHint ??
      ((a) => {
        const type = a.isImage ? "Image" : "File";
        const sizeKB = (a.size / 1024).toFixed(1);
        return `  ${type}: ${a.name} (${sizeKB}KB)`;
      });

    this.installHooks();
  }

  /** Call from _ttyWrite override to track keystroke timing. */
  onKeystroke(): void {
    const now = Date.now();
    if (now - this.lastKeystrokeTime > 50) {
      this.prePastePrefix = (this.rl as any).line ?? "";
    }
    this.lastKeystrokeTime = now;
  }

  /** Clear all stored paste data (e.g. on session reset). */
  reset(): void {
    this.storedTexts.clear();
    this.fileDrop.clear();
    this.buffer = [];
    this.count = 0;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private installHooks(): void {
    // Pre-mute: detect paste from stdin chunk size/shape BEFORE readline echoes
    process.stdin.prependListener("data", (chunk: Buffer) => {
      const str = chunk.toString();
      const hasMultipleNewlines =
        str.includes("\n") && str.indexOf("\n") < str.length - 1;
      const isLongChunk = str.length > this.longPasteThreshold;
      if (hasMultipleNewlines || isLongChunk) {
        this.output.mute();
      }
    });

    // Buffer lines from readline, debounce to detect paste vs typing
    this.rl.on("line", (line: string) => {
      this.buffer.push(line);

      if (this.buffer.length === 1) {
        this.output.mute();
      }

      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => this.processPaste(), this.debounceMs);
    });
  }

  private processPaste(): void {
    this.timer = null;
    this.output.unmute();
    const lines = this.buffer;
    this.buffer = [];

    if (lines.length === 0) return;

    if (lines.length > 1) {
      // Multi-line paste — erase the first echoed line, show placeholder
      process.stdout.write(esc.moveUp(1) + esc.eraseLine);

      this.count++;
      const combined = lines.join("\n");
      const sizeKB = Buffer.byteLength(combined, "utf-8") / 1024;
      const tag = `[Pasted text #${this.count} +${lines.length} lines, ${sizeKB.toFixed(1)}KB] `;

      this.storedTexts.set(this.count, combined);

      const newLine = this.prePastePrefix + tag;
      this.prePastePrefix = "";
      (this.rl as any).line = newLine;
      (this.rl as any).cursor = newLine.length;
      this.rl.prompt(true);
      return;
    }

    // Single line
    const rawLine = lines[0];

    // ── File drop detection ──────────────────────────────────────────
    // Check if the pasted text is a file path (drag & drop).
    // The raw line may include the pre-paste prefix (e.g. "@beacon ").
    const trimmedLine = rawLine.trim();
    const detectedPath = this.fileDrop.detectFilePath(trimmedLine);

    if (detectedPath) {
      // It's a file drop — convert to an inline tag
      const { text: taggedText } = this.fileDrop.processInput(trimmedLine);
      const attachment = this.fileDrop.getAll().at(-1)!;

      // Clear the echoed path and replace with tag in the prompt line
      process.stdout.write(`\r${esc.eraseLine}`);

      const newLine = this.prePastePrefix + taggedText;
      this.prePastePrefix = "";
      (this.rl as any).line = newLine;
      (this.rl as any).cursor = newLine.length;

      // Show the file hint below
      console.log(this.formatPrompt() + newLine);
      console.log(this.formatFileHint(attachment));
      this.rl.prompt(true);
      return;
    }

    // Also check if a file path is embedded in the line (with other text)
    const { text: processedText, filesDetected } =
      this.fileDrop.processInput(rawLine);
    const effectiveLine = filesDetected ? processedText : rawLine;

    // If it was a long muted paste, show a truncated preview
    if (effectiveLine.length > this.longPasteThreshold && !filesDetected) {
      const preview = `${effectiveLine.slice(0, 80)}...`;
      process.stdout.write(`\r${esc.eraseLine}`);
      const prompt = this.formatPrompt();
      process.stdout.write(`${prompt + preview}\n`);
    }

    // If files were detected but the line has other text too, update the display
    if (filesDetected) {
      process.stdout.write(`\r${esc.eraseLine}`);
      const prompt = this.formatPrompt();
      process.stdout.write(`${prompt + processedText}\n`);
      for (const a of this.fileDrop.getAll()) {
        console.log(this.formatFileHint(a));
      }
    }

    // Expand paste placeholders from prior multi-line pastes
    const hasPaste = /\[Pasted text #\d+/.test(effectiveLine);
    const input = effectiveLine
      .replace(
        /\[Pasted text #(\d+) \+\d+ lines, [\d.]+KB\]\s*/g,
        (_match, num) => {
          const n = parseInt(num, 10);
          const text = this.storedTexts.get(n);
          if (text) {
            this.storedTexts.delete(n);
            return `${text}\n`;
          }
          return "";
        },
      )
      .trim();

    // Expand file tags to paths and collect attachments
    const { text: expandedInput, attachments } =
      this.fileDrop.expandTags(input);

    this.onLine({
      input: filesDetected ? expandedInput : input,
      hadPaste: hasPaste || filesDetected,
      attachments,
    });
  }
}
