/**
 * Thread management — data model, feed rendering, and thread-specific operations.
 * Extracted from cli.ts to reduce file size.
 */

import type { ChatView, Color, StyledSpan } from "@teammates/consolonia";
import { concat, pen, renderMarkdown } from "@teammates/consolonia";
import { wrapLine } from "./cli-utils.js";
import type { HandoffContainerCtx } from "./handoff-manager.js";
import { theme, tp } from "./theme.js";
import { type ShiftCallback, ThreadContainer } from "./thread-container.js";
import type { HandoffEnvelope, TaskThread, ThreadEntry } from "./types.js";

// ── View interface ──────────────────────────────────────────────────

export interface ThreadManagerView {
  chatView: ChatView;
  feedLine(text?: string | StyledSpan): void;
  feedUserLine(spans: StyledSpan): void;
  feedMarkdown(source: string): void;
  refreshView(): void;
  makeSpan(...segs: { text: string; style: { fg?: Color } }[]): StyledSpan;
  renderHandoffs(
    from: string,
    handoffs: HandoffEnvelope[],
    threadId?: number,
    containerCtx?: HandoffContainerCtx,
  ): void;
  doCopy(content?: string): void;
  get selfName(): string;
  get adapterName(): string;
  get userBg(): Color;
  get defaultFooterRight(): StyledSpan | null;
}

// ── ThreadManager class ─────────────────────────────────────────────

export class ThreadManager {
  /** All task threads, keyed by numeric thread ID. */
  threads: Map<number, TaskThread> = new Map();
  /** Auto-incrementing thread ID counter (session-scoped). */
  nextThreadId = 1;
  /** Currently focused thread ID (for default routing and rendering). */
  focusedThreadId: number | null = null;
  /** Thread containers keyed by thread ID — each manages its own feed indices. */
  containers: Map<number, ThreadContainer> = new Map();
  /** Maps copy action IDs to cleaned output text. */
  private _copyContexts: Map<string, string>;
  /** Shift callback for all containers. */
  shiftAllContainers: ShiftCallback;
  /** Pending handoffs reference (for shifting). */
  private pendingHandoffs: { approveIdx: number; rejectIdx: number }[];

  private view: ThreadManagerView;

  constructor(
    view: ThreadManagerView,
    copyContexts: Map<string, string>,
    pendingHandoffs: { approveIdx: number; rejectIdx: number }[],
  ) {
    this.view = view;
    this._copyContexts = copyContexts;
    this.pendingHandoffs = pendingHandoffs;

    this.shiftAllContainers = (atIndex: number, delta: number) => {
      for (const container of this.containers.values()) {
        container.shiftIndices(atIndex, delta);
      }
      for (const h of this.pendingHandoffs) {
        if (h.approveIdx >= atIndex) h.approveIdx += delta;
        if (h.rejectIdx >= atIndex) h.rejectIdx += delta;
      }
    };
  }

  /** Create a new thread and return it. */
  createThread(originMessage: string): TaskThread {
    const id = this.nextThreadId++;
    const thread: TaskThread = {
      id,
      originMessage,
      originTimestamp: Date.now(),
      entries: [],
      pendingTasks: new Set(),
      collapsed: false,
      collapsedEntries: new Set(),
      focusedAt: Date.now(),
    };
    this.threads.set(id, thread);
    this.focusedThreadId = id;
    this.updateFooterHint();
    return thread;
  }

  /**
   * Update the footer right hint to show the focused thread.
   * Shows "replying to task #N" when a thread is focused, or "? /help" otherwise.
   */
  updateFooterHint(): void {
    if (!this.view.chatView) return;
    if (this.focusedThreadId != null && this.getThread(this.focusedThreadId)) {
      this.view.chatView.setFooterRight(
        tp.muted(`replying to task #${this.focusedThreadId} `),
      );
    } else if (this.view.defaultFooterRight) {
      this.view.chatView.setFooterRight(this.view.defaultFooterRight);
    }
  }

  /** Find a thread by its numeric ID. */
  getThread(id: number): TaskThread | undefined {
    return this.threads.get(id);
  }

  /** Build plain-text representation of a thread for clipboard copy. */
  buildThreadClipboardText(threadId: number): string {
    const thread = this.threads.get(threadId);
    if (!thread) return "";
    const lines: string[] = [];
    for (const entry of thread.entries) {
      if (entry.type === "user") {
        lines.push(`${this.view.selfName}: ${entry.content}`);
      } else {
        const name = entry.teammate || "unknown";
        if (entry.subject) lines.push(`${name}: ${entry.subject}`);
        if (entry.content) lines.push(entry.content);
      }
      lines.push("");
    }
    return lines.join("\n").trimEnd();
  }

  /** Add an entry to a thread. */
  appendThreadEntry(threadId: number, entry: ThreadEntry): void {
    const thread = this.threads.get(threadId);
    if (!thread) return;
    thread.entries.push(entry);
  }

  // ── Thread feed rendering ───────────────────────────────────────

  /**
   * Insert markdown content into a thread's feed range with extra indentation.
   */
  threadFeedMarkdown(threadId: number, source: string): void {
    const container = this.containers.get(threadId);
    if (!container || !this.view.chatView) {
      this.view.feedMarkdown(source);
      return;
    }
    const t = theme();
    const width = process.stdout.columns || 80;
    const lines = renderMarkdown(source, {
      width: width - 5, // -4 for indent, -1 for scrollbar
      indent: "    ",
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
      container.insertLine(
        this.view.chatView,
        styledSpan,
        this.shiftAllContainers,
      );
    }
  }

  /** Render the thread dispatch line as part of the user message block. */
  renderThreadHeader(thread: TaskThread, targetNames: string[]): void {
    if (!this.view.chatView) return;
    const t = theme();
    const bg = this.view.userBg;
    const headerIdx = this.view.chatView.feedLineCount;

    const displayNames = targetNames.map((n) =>
      n === this.view.selfName ? this.view.adapterName : n,
    );
    const namesText = displayNames.join(", ");

    // Render as a user-styled line (dark bg) so it looks like part of the user's message
    this.view.feedUserLine(
      concat(
        pen.fg(t.textDim).bg(bg)(`#${thread.id} → `),
        pen.fg(t.accent).bg(bg)(namesText),
      ),
    );

    // Create container for this thread
    const container = new ThreadContainer(thread.id, headerIdx, targetNames);
    this.containers.set(thread.id, container);
  }

  /** Update the thread header to reflect current collapse state. */
  updateThreadHeader(threadId: number): void {
    const container = this.containers.get(threadId);
    const thread = this.getThread(threadId);
    if (!container || !thread || !this.view.chatView) return;
    const t = theme();
    const bg = this.view.userBg;
    const displayNames = container.targetNames.map((n) =>
      n === this.view.selfName ? this.view.adapterName : n,
    );
    const namesText = displayNames.join(", ");
    const arrow = thread.collapsed ? "▶ " : "";

    // Update as user-styled line (dark bg)
    const termW = (process.stdout.columns || 80) - 1;
    const content = concat(
      pen.fg(t.textDim).bg(bg)(`${arrow}#${threadId} → `),
      pen.fg(t.accent).bg(bg)(namesText),
    );
    let len = 0;
    for (const seg of content) len += seg.text.length;
    const pad = Math.max(0, termW - len);
    const padded = concat(content, pen.fg(bg).bg(bg)(" ".repeat(pad)));
    this.view.chatView.updateFeedLine(container.headerIdx, padded);
  }

  /**
   * Render a user reply message inside a thread container, including a dispatch line.
   * Used when a user sends a reply to an existing thread (vs. creating a new thread).
   */
  renderThreadReply(
    threadId: number,
    displayText: string,
    targetNames: string[],
  ): void {
    if (!this.view.chatView) return;
    const container = this.containers.get(threadId);
    if (!container) return;
    const t = theme();
    const bg = this.view.userBg;
    const termW = (process.stdout.columns || 80) - 1;

    // Blank line separator before the reply block
    container.insertLine(this.view.chatView, "", this.shiftAllContainers);

    // Render user message lines inside the thread (user-styled, indented)
    // All content indented 2 spaces with bg color
    const indent = "  ";
    const label = `${indent}${this.view.selfName}: `;
    const wrapW = termW - indent.length;
    const lines = displayText.split("\n");
    const first = lines.shift() ?? "";
    const firstWrapW = termW - label.length;
    const firstWrapped = wrapLine(first, firstWrapW);
    const seg0 = firstWrapped.shift() ?? "";
    const pad0 = Math.max(0, termW - label.length - seg0.length);
    container.insertLine(
      this.view.chatView,
      concat(
        pen.fg(t.accent).bg(bg)(label),
        pen.fg(t.text).bg(bg)(seg0 + " ".repeat(pad0)),
      ),
      this.shiftAllContainers,
    );
    for (const wl of firstWrapped) {
      const padWl = Math.max(0, termW - indent.length - wl.length);
      container.insertLine(
        this.view.chatView,
        concat(
          pen.fg(t.text).bg(bg)(indent),
          pen.fg(t.text).bg(bg)(wl + " ".repeat(padWl)),
        ),
        this.shiftAllContainers,
      );
    }
    for (const line of lines) {
      const wrapped = wrapLine(line, wrapW);
      for (const wl of wrapped) {
        const padWl = Math.max(0, termW - indent.length - wl.length);
        container.insertLine(
          this.view.chatView,
          concat(
            pen.fg(t.text).bg(bg)(indent),
            pen.fg(t.text).bg(bg)(wl + " ".repeat(padWl)),
          ),
          this.shiftAllContainers,
        );
      }
    }

    // Render dispatch line inside the thread (user-styled, like the original header)
    const displayNames = targetNames.map((n) =>
      n === this.view.selfName ? this.view.adapterName : n,
    );
    const namesText = displayNames.join(", ");
    const dispatchContent = concat(
      pen.fg(t.textDim).bg(bg)(`${indent}→ `),
      pen.fg(t.accent).bg(bg)(namesText),
    );
    let dispLen = 0;
    for (const seg of dispatchContent) dispLen += seg.text.length;
    const dispPad = Math.max(0, termW - dispLen);
    container.insertLine(
      this.view.chatView,
      concat(dispatchContent, pen.fg(bg).bg(bg)(" ".repeat(dispPad))),
      this.shiftAllContainers,
    );

    // Blank line between dispatch and working placeholders
    container.insertLine(this.view.chatView, "", this.shiftAllContainers);

    // Clear insert override so placeholders use normal insert point
    container.clearInsertAt();
  }

  /** Render a queued or working placeholder for an agent in a thread. */
  renderTaskPlaceholder(
    threadId: number,
    placeholderId: string,
    teammate: string,
    state: "queued" | "working",
  ): void {
    if (!this.view.chatView) return;
    const container = this.containers.get(threadId);
    if (!container) return;
    const t = theme();
    const displayName =
      teammate === this.view.selfName ? this.view.adapterName : teammate;
    const activityId = `activity-${placeholderId}`;
    const cancelId = `cancel-${placeholderId}`;
    const statusText = state === "queued" ? "queued..." : "working...";
    const actions =
      state === "queued"
        ? [
            {
              id: cancelId,
              normalStyle: this.view.makeSpan(
                { text: `  ${displayName}: `, style: { fg: t.accent } },
                { text: statusText, style: { fg: t.textDim } },
                { text: "  [cancel]", style: { fg: t.textDim } },
              ),
              hoverStyle: this.view.makeSpan(
                { text: `  ${displayName}: `, style: { fg: t.accent } },
                { text: statusText, style: { fg: t.textDim } },
                { text: "  [cancel]", style: { fg: t.accent } },
              ),
            },
          ]
        : [
            {
              id: activityId,
              normalStyle: this.view.makeSpan(
                { text: `  ${displayName}: `, style: { fg: t.accent } },
                { text: statusText, style: { fg: t.textDim } },
                { text: "  [show activity]", style: { fg: t.textDim } },
              ),
              hoverStyle: this.view.makeSpan(
                { text: `  ${displayName}: `, style: { fg: t.accent } },
                { text: statusText, style: { fg: t.textDim } },
                { text: "  [show activity]", style: { fg: t.accent } },
              ),
            },
            {
              id: cancelId,
              normalStyle: this.view.makeSpan({
                text: " [cancel]",
                style: { fg: t.textDim },
              }),
              hoverStyle: this.view.makeSpan({
                text: " [cancel]",
                style: { fg: t.accent },
              }),
            },
          ];
    container.addPlaceholder(
      this.view.chatView,
      placeholderId,
      actions,
      this.shiftAllContainers,
    );
  }

  /** Toggle collapse/expand for an entire thread. */
  toggleThreadCollapse(threadId: number): void {
    const thread = this.getThread(threadId);
    const container = this.containers.get(threadId);
    if (!thread || !container || !this.view.chatView) return;

    thread.collapsed = !thread.collapsed;
    container.toggleCollapse(this.view.chatView, thread.collapsed);

    // Update header arrow
    this.updateThreadHeader(threadId);
    this.view.refreshView();
  }

  /** Toggle collapse/expand for an individual reply within a thread. */
  toggleReplyCollapse(threadId: number, replyKey: string): void {
    const container = this.containers.get(threadId);
    if (!container || !this.view.chatView) return;
    container.toggleReplyCollapse(this.view.chatView, replyKey);
    // Update the action text to show [show] or [hide] based on new state
    const item = container.items.find((i) => i.key === replyKey);
    if (item?.displayName) {
      const t = theme();
      const label = item.collapsed ? "[show]" : "[hide]";
      const collapseId = `reply-collapse-${replyKey}`;
      const actions = [
        {
          id: collapseId,
          normalStyle: this.view.makeSpan(
            { text: `  ${item.displayName}: `, style: { fg: t.accent } },
            { text: item.subject || "completed", style: { fg: t.text } },
            { text: `  ${label}`, style: { fg: t.textDim } },
          ),
          hoverStyle: this.view.makeSpan(
            { text: `  ${item.displayName}: `, style: { fg: t.accent } },
            { text: item.subject || "completed", style: { fg: t.text } },
            { text: `  ${label}`, style: { fg: t.accent } },
          ),
        },
        {
          id: item.copyActionId || `copy-${replyKey}`,
          normalStyle: this.view.makeSpan({
            text: " [copy]",
            style: { fg: t.textDim },
          }),
          hoverStyle: this.view.makeSpan({
            text: " [copy]",
            style: { fg: t.accent },
          }),
        },
      ];
      this.view.chatView.updateActionList(item.subjectLineIndex, actions);
    }
    this.view.refreshView();
  }

  /** Render a task result indented inside a thread, replacing the working placeholder in-place. */
  displayThreadedResult(
    result: {
      teammate: string;
      summary: string;
      rawOutput?: string;
      changedFiles: string[];
      handoffs: HandoffEnvelope[];
    },
    cleaned: string,
    threadId: number,
    container: ThreadContainer,
    placeholderId: string,
  ): void {
    const t = theme();
    const subject = result.summary || "Task completed";

    // Hide the original working placeholder (don't update in-place)
    // and insert the completed response at the reply insert point
    // (before remaining working placeholders) so completed replies float up.
    if (this.view.chatView) {
      container.hidePlaceholder(this.view.chatView, placeholderId);
    }

    // Track reply key for individual collapse
    const thread = this.getThread(threadId);
    const replyIndex = thread
      ? thread.entries.filter((e) => e.type !== "user").length
      : 0;
    const replyKey = `${threadId}-${replyIndex}`;
    const ts = Date.now();
    const collapseId = `reply-collapse-${replyKey}`;
    const copyId = `copy-${result.teammate}-${ts}`;
    const displayName =
      result.teammate === this.view.selfName
        ? this.view.adapterName
        : result.teammate;

    // Store copy context for [copy] action (include teammate: subject header)
    if (cleaned) {
      this._copyContexts.set(
        copyId,
        `${displayName}: ${subject}\n\n${cleaned}`,
      );
    }

    // Insert subject line as action list with inline [hide] [copy]
    const subjectActions = [
      {
        id: collapseId,
        normalStyle: this.view.makeSpan(
          { text: `  ${displayName}: `, style: { fg: t.accent } },
          { text: subject, style: { fg: t.text } },
          { text: "  [hide]", style: { fg: t.textDim } },
        ),
        hoverStyle: this.view.makeSpan(
          { text: `  ${displayName}: `, style: { fg: t.accent } },
          { text: subject, style: { fg: t.text } },
          { text: "  [hide]", style: { fg: t.accent } },
        ),
      },
      {
        id: copyId,
        normalStyle: this.view.makeSpan({
          text: " [copy]",
          style: { fg: t.textDim },
        }),
        hoverStyle: this.view.makeSpan({
          text: " [copy]",
          style: { fg: t.accent },
        }),
      },
    ];
    const headerIdx = container.insertActions(
      this.view.chatView,
      subjectActions,
      this.shiftAllContainers,
    );

    // Set insert position to right after the subject line
    container.setInsertAt(headerIdx + 1);

    // Track body start for individual collapse (peek — don't consume a position)
    const bodyStartIdx = container.peekInsertPoint();

    if (cleaned) {
      this.threadFeedMarkdown(threadId, cleaned);
    } else if (result.changedFiles.length > 0 || result.summary) {
      const syntheticLines: string[] = [];
      if (result.summary) syntheticLines.push(result.summary);
      if (result.changedFiles.length > 0) {
        syntheticLines.push("", "**Files changed:**");
        for (const f of result.changedFiles) syntheticLines.push(`- ${f}`);
      }
      this.threadFeedMarkdown(threadId, syntheticLines.join("\n"));
    } else {
      container.insertLine(
        this.view.chatView,
        tp.muted(
          "    (no response text — the agent may have only performed tool actions)",
        ),
        this.shiftAllContainers,
      );
    }

    // Track body end for individual collapse (peek — don't consume a position)
    const bodyEndIdx = container.peekInsertPoint();
    container.trackReplyBody(
      replyKey,
      headerIdx,
      bodyStartIdx,
      bodyEndIdx,
      displayName,
      subject,
      copyId,
    );

    // Render handoffs inside thread (using container insert so they stay
    // within the thread range, before the [reply] [copy thread] verbs)
    if (result.handoffs.length > 0) {
      const containerCtx: HandoffContainerCtx = {
        insertLine: (text) =>
          container.insertLine(
            this.view.chatView,
            text,
            this.shiftAllContainers,
          ),
        insertActions: (actions) =>
          container.insertActions(
            this.view.chatView,
            actions,
            this.shiftAllContainers,
          ),
      };
      this.view.renderHandoffs(
        result.teammate,
        result.handoffs,
        threadId,
        containerCtx,
      );
    }

    // Blank line after reply
    container.insertLine(this.view.chatView, "", this.shiftAllContainers);

    // Clear insert position override
    container.clearInsertAt();

    // Insert thread-level [reply] [copy thread] verbs (once, shifts automatically)
    if (this.view.chatView) {
      const threadReplyId = `thread-reply-${threadId}`;
      const threadCopyId = `thread-copy-${threadId}`;
      container.insertThreadActions(
        this.view.chatView,
        [
          {
            id: threadReplyId,
            normalStyle: this.view.makeSpan({
              text: "  [reply]",
              style: { fg: t.textDim },
            }),
            hoverStyle: this.view.makeSpan({
              text: "  [reply]",
              style: { fg: t.accent },
            }),
          },
          {
            id: threadCopyId,
            normalStyle: this.view.makeSpan({
              text: " [copy thread]",
              style: { fg: t.textDim },
            }),
            hoverStyle: this.view.makeSpan({
              text: " [copy thread]",
              style: { fg: t.accent },
            }),
          },
        ],
        this.shiftAllContainers,
      );

      // Show/hide thread-level actions based on whether work is still in progress
      if (container.placeholderCount === 0) {
        container.showThreadActions(this.view.chatView);
      } else {
        container.hideThreadActions(this.view.chatView);
      }
    }

    // Update thread header
    this.updateThreadHeader(threadId);
  }

  /** Reset all thread state — called by /clear. */
  clear(): void {
    this.threads.clear();
    this.nextThreadId = 1;
    this.focusedThreadId = null;
    this.containers.clear();
    this.updateFooterHint();
  }
}
