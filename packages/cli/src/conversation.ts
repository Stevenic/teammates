/**
 * ConversationManager — Manages conversation history, summarization,
 * and pre-dispatch compression for the teammates CLI.
 */

import {
  buildConversationContext as buildConvCtx,
  buildSummarizationPrompt,
  cleanResponseBody,
  compressConversationEntries,
  findSummarizationSplit,
  formatConversationEntry,
} from "./cli-utils.js";
import type { QueueEntry, TaskResult } from "./types.js";

export interface ConversationManagerDeps {
  readonly taskQueue: QueueEntry[];
  makeQueueEntryId(): string;
  kickDrain(): void;
  readonly selfName: string;
}

export class ConversationManager {
  /** Target context window in tokens. Conversation history budget is derived from this. */
  static readonly TARGET_CONTEXT_TOKENS = 128_000;

  /** Estimated tokens used by non-conversation prompt sections. */
  private static readonly PROMPT_OVERHEAD_TOKENS = 32_000;

  /** Chars-per-token approximation (matches adapter.ts). */
  private static readonly CHARS_PER_TOKEN = 4;

  /** Character budget for conversation history = (target − overhead) × chars/token. */
  static readonly CONV_HISTORY_CHARS =
    (ConversationManager.TARGET_CONTEXT_TOKENS -
      ConversationManager.PROMPT_OVERHEAD_TOKENS) *
    ConversationManager.CHARS_PER_TOKEN;

  history: { role: string; text: string }[] = [];
  summary = "";

  constructor(private deps: ConversationManagerDeps) {}

  /** Store a task result's output in conversation history. */
  storeInHistory(result: TaskResult): void {
    const body = cleanResponseBody(result.rawOutput ?? "");
    this.history.push({
      role: result.teammate,
      text: body || result.summary,
    });
  }

  /**
   * Build conversation context string from history + summary.
   * If a snapshot is provided (for @everyone concurrent dispatch),
   * uses the snapshot instead of live state.
   */
  buildContext(
    _teammate?: string,
    snapshot?: { history: { role: string; text: string }[]; summary: string },
  ): string {
    const history = snapshot ? snapshot.history : this.history;
    const summary = snapshot ? snapshot.summary : this.summary;
    return buildConvCtx(
      history,
      summary,
      ConversationManager.CONV_HISTORY_CHARS,
    );
  }

  /**
   * Check if conversation history exceeds the token budget.
   * If so, queue a summarization task to the coding agent.
   */
  maybeQueueSummarization(): void {
    const splitIdx = findSummarizationSplit(
      this.history,
      ConversationManager.CONV_HISTORY_CHARS,
    );
    if (splitIdx === 0) return;

    const toSummarize = this.history.slice(0, splitIdx);
    const prompt = buildSummarizationPrompt(toSummarize, this.summary);

    this.history.splice(0, splitIdx);

    this.deps.taskQueue.push({
      id: this.deps.makeQueueEntryId(),
      type: "summarize",
      teammate: this.deps.selfName,
      task: prompt,
    });
    this.deps.kickDrain();
  }

  /**
   * Pre-dispatch compression: mechanically compress older entries into
   * bullet summaries BEFORE building the prompt, ensuring it always fits.
   */
  preDispatchCompress(): void {
    const totalChars = this.history.reduce(
      (sum, e) => sum + formatConversationEntry(e.role, e.text).length,
      0,
    );

    if (totalChars <= ConversationManager.CONV_HISTORY_CHARS) return;

    const splitIdx = findSummarizationSplit(
      this.history,
      ConversationManager.CONV_HISTORY_CHARS,
    );

    if (splitIdx === 0) return;

    const toCompress = this.history.slice(0, splitIdx);
    this.summary = compressConversationEntries(toCompress, this.summary);
    this.history.splice(0, splitIdx);
  }
}
