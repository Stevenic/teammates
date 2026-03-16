/**
 * Interview — a modal widget that presents a sequence of questions
 * and collects answers. Designed to run inside a ChatView by replacing
 * the normal input area (via ChatView.setInputOverride).
 *
 * While active the ChatView's own input prompt is hidden; when the
 * interview completes it emits "complete" with all collected answers
 * and the caller can remove the override to restore normal input.
 *
 * Usage:
 *
 *   const interview = new Interview({
 *     title: "Quick intro",
 *     subtitle: "press Enter to skip any question",
 *     questions: [
 *       { key: "name",  prompt: "Your name" },
 *       { key: "role",  prompt: "Your role", placeholder: "e.g., senior backend engineer" },
 *     ],
 *   });
 *
 *   chatView.setInputOverride(interview);
 *
 *   interview.on("complete", (answers: Record<string, string>) => {
 *     chatView.setInputOverride(null);   // restore normal input
 *     // use answers...
 *   });
 */

import type { DrawingContext, TextStyle } from "../drawing/context.js";
import type { InputEvent } from "../input/events.js";
import { Control } from "../layout/control.js";
import type { Constraint, Size } from "../layout/types.js";
import { TextInput } from "./text-input.js";

// ── Types ───────────────────────────────────────────────────────────

export interface InterviewQuestion {
  /** Key used in the answers record. */
  key: string;
  /** Prompt label shown to the left of the input. */
  prompt: string;
  /** Placeholder hint shown when the input is empty. */
  placeholder?: string;
}

export interface InterviewOptions {
  /** Title shown above the questions. */
  title?: string;
  /** Subtitle / hint shown below the title. */
  subtitle?: string;
  /** The questions to ask, in order. */
  questions: InterviewQuestion[];
  /** Style for the question prompt label. */
  promptStyle?: TextStyle;
  /** Style for answered values. */
  answeredStyle?: TextStyle;
  /** Style for input text. */
  inputStyle?: TextStyle;
  /** Style for the cursor. */
  cursorStyle?: TextStyle;
  /** Style for the title. */
  titleStyle?: TextStyle;
  /** Style for the subtitle. */
  subtitleStyle?: TextStyle;
  /** Style for placeholder text. */
  placeholderStyle?: TextStyle;
}

// ── Interview ───────────────────────────────────────────────────────

export class Interview extends Control {
  private _title: string;
  private _subtitle: string;
  private _questions: InterviewQuestion[];
  private _answers: Map<string, string> = new Map();
  private _currentIndex: number = 0;
  private _input: TextInput;
  private _done: boolean = false;

  // Styles
  private _promptStyle: TextStyle;
  private _answeredStyle: TextStyle;
  private _titleStyle: TextStyle;
  private _subtitleStyle: TextStyle;

  constructor(options: InterviewOptions) {
    super();
    this.focusable = true;

    this._title = options.title ?? "";
    this._subtitle = options.subtitle ?? "";
    this._questions = options.questions;

    this._promptStyle = options.promptStyle ?? {};
    this._answeredStyle = options.answeredStyle ?? { italic: true };
    this._titleStyle = options.titleStyle ?? {};
    this._subtitleStyle = options.subtitleStyle ?? { italic: true };

    // Create the shared TextInput for answering
    const q = this._questions[0];
    this._input = new TextInput({
      prompt: q ? `  ${q.prompt}: ` : "",
      promptStyle: options.promptStyle ?? {},
      style: options.inputStyle ?? {},
      cursorStyle: options.cursorStyle ?? {},
      placeholder: q?.placeholder ? ` ${q.placeholder}` : "",
      placeholderStyle: options.placeholderStyle ?? { italic: true },
    });
    this._input.focusable = true;
    this._input.onFocus();
    this.addChild(this._input);

    // On submit, record answer and advance
    this._input.on("submit", (text: string) => {
      this._recordAnswer(text);
    });
  }

  // ── Public API ──────────────────────────────────────────────────

  /** Get all answers collected so far. */
  get answers(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [k, v] of this._answers) {
      result[k] = v;
    }
    return result;
  }

  /** Whether the interview has completed. */
  get completed(): boolean {
    return this._done;
  }

  /** Total number of questions. */
  get questionCount(): number {
    return this._questions.length;
  }

  /** Current question index (0-based). */
  get currentQuestionIndex(): number {
    return this._currentIndex;
  }

  // ── Internal ────────────────────────────────────────────────────

  private _recordAnswer(text: string): void {
    if (this._done) return;

    const q = this._questions[this._currentIndex];
    this._answers.set(q.key, text.trim());
    this._currentIndex++;

    if (this._currentIndex >= this._questions.length) {
      // All questions answered
      this._done = true;
      this._input.visible = false;
      this.invalidate();
      this.emit("complete", this.answers);
      return;
    }

    // Advance to next question
    const next = this._questions[this._currentIndex];
    this._input.clear();
    this._input.prompt = `  ${next.prompt}: `;
    this._input.placeholder = next.placeholder ? ` ${next.placeholder}` : "";
    this.invalidate();
  }

  // ── Input handling ──────────────────────────────────────────────

  override handleInput(event: InputEvent): boolean {
    if (this._done) return false;
    return this._input.handleInput(event);
  }

  // ── Layout ──────────────────────────────────────────────────────

  override measure(constraint: Constraint): Size {
    // Height: title(1) + subtitle(1) + answered questions + current input(1)
    let h = 0;
    if (this._title) h++; // title row
    if (this._subtitle) h++; // subtitle row
    if (this._title || this._subtitle) h++; // blank line after header

    // Answered questions
    const answeredCount = Math.min(this._currentIndex, this._questions.length);
    h += answeredCount;

    // Current input row (if not done)
    if (!this._done) {
      h++; // input row
    }

    const size: Size = {
      width: constraint.maxWidth,
      height: Math.max(1, Math.min(h, constraint.maxHeight)),
    };
    this.desiredSize = size;
    return size;
  }

  override render(ctx: DrawingContext): void {
    const b = this.bounds;
    if (!b || b.width < 1 || b.height < 1) return;

    let y = b.y;

    // Title
    if (this._title && y < b.y + b.height) {
      ctx.drawText(b.x + 2, y, this._title, this._titleStyle);
      y++;
    }

    // Subtitle
    if (this._subtitle && y < b.y + b.height) {
      ctx.drawText(b.x + 2, y, this._subtitle, this._subtitleStyle);
      y++;
    }

    // Blank line after header
    if ((this._title || this._subtitle) && y < b.y + b.height) {
      y++;
    }

    // Answered questions (dimmed)
    const answeredCount = Math.min(this._currentIndex, this._questions.length);
    for (let i = 0; i < answeredCount && y < b.y + b.height; i++) {
      const q = this._questions[i];
      const a = this._answers.get(q.key) || "";
      const display = a || "(skipped)";
      const label = `  ${q.prompt}: `;
      ctx.drawText(b.x, y, label, this._promptStyle);
      ctx.drawText(b.x + label.length, y, display, this._answeredStyle);
      y++;
    }

    // Current input
    if (!this._done && y < b.y + b.height) {
      this._input.measure({
        minWidth: 0,
        maxWidth: b.width,
        minHeight: 0,
        maxHeight: 1,
      });
      this._input.arrange({ x: b.x, y, width: b.width, height: 1 });
      this._input.render(ctx);
    }
  }
}
