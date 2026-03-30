/**
 * FeedRenderer — Extracted feed rendering utilities for the Teammates REPL.
 *
 * Contains: feedLine, feedMarkdown, feedUserLine, printUserMessage,
 * makeSpan, wordWrap, displayTaskResult, displayFlatResult, displayThreadedResult.
 */

import {
  type ChatView,
  type Color,
  concat,
  pen,
  renderMarkdown,
  type StyledSpan,
  stripAnsi,
} from "@teammates/consolonia";
import chalk from "chalk";
import { wrapLine } from "./cli-utils.js";
import type { HandoffManager } from "./handoff-manager.js";
import { theme, tp } from "./theme.js";
import type { ThreadManager } from "./thread-manager.js";
import type { TaskResult } from "./types.js";

// ─── Dependency interface ─────────────────────────────────────────────

export interface FeedRendererDeps {
  readonly chatView: ChatView | undefined;
  readonly app: { refresh(): void } | undefined;
  readonly input: { activate(): void; deactivateAndErase(): void } | undefined;
  readonly selfName: string;
  readonly adapterName: string;
  readonly threadManager: ThreadManager;
  readonly handoffManager: HandoffManager;
  readonly _replyContexts: Map<
    string,
    { teammate: string; message: string; threadId?: number }
  >;
  readonly _copyContexts: Map<string, string>;
  lastCleanedOutput: string;
  refreshTeammates(): void;
  showPrompt(): void;
}

// ─── FeedRenderer ─────────────────────────────────────────────────────

export class FeedRenderer {
  constructor(private deps: FeedRendererDeps) {}

  // ── Core feed methods ──────────────────────────────────────────────

  /** Write a line to the chat feed. Accepts a plain string or StyledSpan. */
  feedLine(text: string | StyledSpan = ""): void {
    const { chatView } = this.deps;
    if (chatView) {
      if (typeof text === "string") {
        chatView.appendToFeed(text);
      } else {
        chatView.appendStyledToFeed(text);
      }
      return;
    }
    if (typeof text !== "string") {
      console.log(text.map((s) => s.text).join(""));
    } else {
      console.log(text);
    }
  }

  /** Render markdown text to the feed using the consolonia renderer. */
  feedMarkdown(source: string): void {
    const t = theme();
    const width = process.stdout.columns || 80;
    const lines = renderMarkdown(source, {
      width: width - 3,
      indent: "  ",
      theme: {
        text: { fg: t.textMuted },
        bold: { fg: t.text, bold: true },
        italic: { fg: t.textMuted, italic: true },
        boldItalic: { fg: t.text, bold: true, italic: true },
        code: { fg: t.accentDim },
        h1: { fg: t.accent, bold: true },
        h2: { fg: t.accent, bold: true },
        h3: { fg: t.accent },
        codeBlockChrome: { fg: t.textDim },
        codeBlock: { fg: t.success },
        blockquote: { fg: t.textMuted, italic: true },
        listMarker: { fg: t.accent },
        tableBorder: { fg: t.textDim },
        tableHeader: { fg: t.text, bold: true },
        hr: { fg: t.textDim },
        link: { fg: t.accent, underline: true },
        linkUrl: { fg: t.textMuted },
        strikethrough: { fg: t.textMuted, strikethrough: true },
        checkbox: { fg: t.accent },
      },
    });

    for (const line of lines) {
      const styledSpan = line.map((seg) => ({
        text: seg.text,
        style: seg.style,
      })) as StyledSpan;
      (styledSpan as any).__brand = "StyledSpan";
      this.feedLine(styledSpan);
    }
  }

  /** Feed a line with the user message background, padded to full width. */
  private readonly _userBg: Color = { r: 25, g: 25, b: 25, a: 255 };

  feedUserLine(spans: StyledSpan): void {
    const { chatView } = this.deps;
    if (!chatView) return;
    const termW = (process.stdout.columns || 80) - 1;
    let len = 0;
    for (const seg of spans) len += seg.text.length;
    const pad = Math.max(0, termW - len);
    const padded = concat(
      spans,
      pen.fg(this._userBg).bg(this._userBg)(" ".repeat(pad)),
    );
    chatView.appendStyledToFeed(padded);
  }

  get userBg(): Color {
    return this._userBg;
  }

  /** Create a branded StyledSpan from segments. */
  makeSpan(
    ...segs: { text: string; style: { fg?: Color; bg?: Color } }[]
  ): StyledSpan {
    const s = segs as unknown as StyledSpan;
    (s as any).__brand = "StyledSpan";
    return s;
  }

  /** Word-wrap a string to fit within maxWidth. */
  wordWrap(text: string, maxWidth: number): string[] {
    const words = text.split(" ");
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      if (current.length === 0) {
        current = word;
      } else if (current.length + 1 + word.length <= maxWidth) {
        current += ` ${word}`;
      } else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
    return lines.length > 0 ? lines : [""];
  }

  // ── User message rendering ─────────────────────────────────────────

  printUserMessage(text: string): void {
    const { chatView } = this.deps;
    if (chatView) {
      const bg = this._userBg;
      const t = theme();
      const termW = (process.stdout.columns || 80) - 1;
      const allLines = text.split("\n");

      const rendered: { type: "text" | "quote"; content: string }[] = [];
      let inQuote = false;
      for (const line of allLines) {
        const isQuote = line.startsWith("> ") || line === ">";
        if (isQuote && !inQuote) {
          rendered.push({ type: "text", content: "" });
          inQuote = true;
        } else if (!isQuote && inQuote) {
          rendered.push({ type: "text", content: "" });
          inQuote = false;
        }
        if (isQuote) {
          rendered.push({
            type: "quote",
            content: line.startsWith("> ") ? line.slice(2) : "",
          });
        } else {
          rendered.push({ type: "text", content: line });
        }
      }

      const label = `${this.deps.selfName}: `;
      const first = rendered.shift();
      if (first) {
        if (first.type === "text") {
          const firstWrapW = termW - label.length;
          const firstWrapped = wrapLine(first.content, firstWrapW);
          const seg0 = firstWrapped.shift() ?? "";
          const pad0 = Math.max(0, termW - label.length - seg0.length);
          chatView.appendStyledToFeed(
            concat(
              pen.fg(t.accent).bg(bg)(label),
              pen.fg(t.text).bg(bg)(seg0 + " ".repeat(pad0)),
            ),
          );
          for (const wl of firstWrapped) {
            this.feedUserLine(concat(pen.fg(t.text).bg(bg)(wl)));
          }
        } else {
          const pad = Math.max(0, termW - label.length);
          chatView.appendStyledToFeed(
            concat(pen.fg(t.accent).bg(bg)(label + " ".repeat(pad))),
          );
          rendered.unshift(first);
        }
      }

      for (const entry of rendered) {
        if (entry.type === "quote") {
          const prefix = "│ ";
          const wrapWidth = termW - prefix.length;
          const wrapped = wrapLine(entry.content, wrapWidth);
          for (const wl of wrapped) {
            const pad = Math.max(0, termW - prefix.length - wl.length);
            chatView.appendStyledToFeed(
              concat(
                pen.fg(t.textDim).bg(bg)(prefix),
                pen.fg(t.textMuted).bg(bg)(wl + " ".repeat(pad)),
              ),
            );
          }
        } else {
          const wrapWidth = termW;
          const wrapped = wrapLine(entry.content, wrapWidth);
          for (const wl of wrapped) {
            this.feedUserLine(concat(pen.fg(t.text).bg(bg)(wl)));
          }
        }
      }

      this.deps.app!.refresh();
      return;
    }

    const termWidth = process.stdout.columns || 100;
    const maxWidth = Math.min(termWidth - 4, 80);
    const lines = text.split("\n");

    console.log();
    for (const line of lines) {
      const display =
        line.length > maxWidth ? `${line.slice(0, maxWidth - 1)}…` : line;
      const padded =
        display + " ".repeat(Math.max(0, maxWidth - stripAnsi(display).length));
      console.log(`  ${chalk.bgGray.white(` ${padded} `)}`);
    }
    console.log();
  }

  // ── Task result display ────────────────────────────────────────────

  /**
   * Render a task result to the feed. Called from drainAgentQueue() AFTER
   * the defensive retry so the user sees the final (possibly retried) output.
   */
  displayTaskResult(
    result: TaskResult,
    entryType: string,
    threadId?: number,
    placeholderId?: string,
  ): void {
    if (entryType === "summarize") return;

    if (!this.deps.chatView) this.deps.input!.deactivateAndErase();

    const raw = result.rawOutput ?? "";
    const cleaned = raw
      .replace(/^TO:\s*\S+\s*\n/im, "")
      .replace(/^#\s+.+\n*/m, "")
      .replace(/```handoff\s*\n@\w+\s*\n[\s\S]*?```/g, "")
      .replace(/```json\s*\n\s*\{[\s\S]*?\}\s*\n\s*```\s*$/g, "")
      .trim();

    this.deps.lastCleanedOutput = cleaned;

    const container =
      threadId != null
        ? this.deps.threadManager.containers.get(threadId)
        : undefined;
    if (container && this.deps.chatView) {
      this.deps.threadManager.displayThreadedResult(
        result,
        cleaned,
        threadId!,
        container,
        placeholderId ?? result.teammate,
      );
    } else {
      this.displayFlatResult(result, cleaned, entryType, threadId);
    }

    this.deps.refreshTeammates();
    this.deps.showPrompt();
  }

  /** Render a task result as a flat (non-threaded) entry in the feed. */
  private displayFlatResult(
    result: TaskResult,
    cleaned: string,
    _entryType: string,
    threadId?: number,
  ): void {
    const subject = result.summary || "Task completed";
    const displayTeammate =
      result.teammate === this.deps.selfName
        ? this.deps.adapterName
        : result.teammate;
    this.feedLine(concat(tp.accent(`${displayTeammate}: `), tp.text(subject)));

    if (cleaned) {
      this.feedMarkdown(cleaned);
    } else if (result.changedFiles.length > 0 || result.summary) {
      const syntheticLines: string[] = [];
      if (result.summary) syntheticLines.push(result.summary);
      if (result.changedFiles.length > 0) {
        syntheticLines.push("", "**Files changed:**");
        for (const f of result.changedFiles) syntheticLines.push(`- ${f}`);
      }
      this.feedMarkdown(syntheticLines.join("\n"));
    } else {
      this.feedLine(
        tp.muted(
          "  (no response text — the agent may have only performed tool actions)",
        ),
      );
      this.feedLine(
        tp.muted(`  Use /debug ${result.teammate} to view full output`),
      );
      const diag = result.diagnostics;
      if (diag) {
        if (diag.exitCode !== 0 && diag.exitCode !== null) {
          this.feedLine(
            tp.warning(`  ⚠  Process exited with code ${diag.exitCode}`),
          );
        }
        if (diag.signal) {
          this.feedLine(
            tp.warning(`  ⚠  Process killed by signal: ${diag.signal}`),
          );
        }
        if (diag.debugFile) {
          this.feedLine(tp.muted(`  Debug log: ${diag.debugFile}`));
        }
      }
    }

    if (result.handoffs.length > 0) {
      this.deps.handoffManager.renderHandoffs(
        result.teammate,
        result.handoffs,
        threadId,
      );
    }

    if (this.deps.chatView && cleaned) {
      const t = theme();
      const ts = Date.now();
      const replyId = `reply-${result.teammate}-${ts}`;
      const copyId = `copy-${result.teammate}-${ts}`;
      this.deps._replyContexts.set(replyId, {
        teammate: result.teammate,
        message: cleaned,
        threadId,
      });
      this.deps._copyContexts.set(copyId, cleaned);
      this.deps.chatView.appendActionList([
        {
          id: replyId,
          normalStyle: this.makeSpan({
            text: "  [reply]",
            style: { fg: t.textDim },
          }),
          hoverStyle: this.makeSpan({
            text: "  [reply]",
            style: { fg: t.accent },
          }),
        },
        {
          id: copyId,
          normalStyle: this.makeSpan({
            text: " [copy]",
            style: { fg: t.textDim },
          }),
          hoverStyle: this.makeSpan({
            text: " [copy]",
            style: { fg: t.accent },
          }),
        },
      ]);
    }
    this.feedLine();
  }
}
