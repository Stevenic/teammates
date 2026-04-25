/**
 * Thread management — data model, per-thread feed stores, tab switching,
 * and thread-specific rendering operations.
 *
 * v2: Tab-based architecture. Each thread owns its own FeedStore and
 * FeedAdapter. Cross-thread index shifting is eliminated.
 */

import type {
  ChatView,
  Color,
  FeedActionItem,
  StyledSpan,
} from "@teammates/consolonia";
import { concat, pen, renderMarkdown } from "@teammates/consolonia";
import { wrapLine } from "./cli-utils.js";
import { FeedAdapter } from "./feed-adapter.js";
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
  /** Currently focused thread ID. */
  focusedThreadId: number | null = null;
  /** Thread containers keyed by thread ID — each manages its own feed indices. */
  containers: Map<number, ThreadContainer> = new Map();
  /** Per-thread FeedAdapters — each wraps its own FeedStore. */
  adapters: Map<number, FeedAdapter> = new Map();
  /** Maps copy action IDs to cleaned output text. */
  private _copyContexts: Map<string, string>;

  /**
   * Per-thread shift callback. In the tab model, shifts only affect the
   * single container within the active thread (no cross-thread shifting).
   */
  getShiftCallback(threadId: number): ShiftCallback {
    return (atIndex: number, delta: number) => {
      const container = this.containers.get(threadId);
      if (container) container.shiftIndices(atIndex, delta);
      // Also shift pending handoffs that are within this thread
      for (const h of this.pendingHandoffs) {
        if (h.approveIdx >= atIndex) h.approveIdx += delta;
        if (h.rejectIdx >= atIndex) h.rejectIdx += delta;
      }
    };
  }

  /**
   * Legacy shiftAllContainers — kept for ActivityManager compatibility.
   * In the tab model, this only shifts the focused thread's container.
   */
  shiftAllContainers: ShiftCallback;

  /** Pending handoffs reference (for shifting). */
  private pendingHandoffs: { approveIdx: number; rejectIdx: number }[];

  /** Callback fired when the tab bar state changes. */
  onTabsChanged?: () => void;
  /** Callback fired when thread has unread content. */
  onUnread?: (threadId: number) => void;

  private view: ThreadManagerView;

  constructor(
    view: ThreadManagerView,
    copyContexts: Map<string, string>,
    pendingHandoffs: { approveIdx: number; rejectIdx: number }[],
  ) {
    this.view = view;
    this._copyContexts = copyContexts;
    this.pendingHandoffs = pendingHandoffs;

    // Default shift callback targets focused thread
    this.shiftAllContainers = (atIndex: number, delta: number) => {
      if (this.focusedThreadId != null) {
        const container = this.containers.get(this.focusedThreadId);
        if (container) container.shiftIndices(atIndex, delta);
      }
      for (const h of this.pendingHandoffs) {
        if (h.approveIdx >= atIndex) h.approveIdx += delta;
        if (h.rejectIdx >= atIndex) h.rejectIdx += delta;
      }
    };
  }

  // ── Thread lifecycle ────────────────────────────────────────────

  /** Create a new thread with its own FeedStore. Returns the thread. */
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

    // Create a FeedAdapter + FeedStore for this thread
    const adapter = new FeedAdapter();
    adapter.bind(this.view.chatView);
    this.adapters.set(id, adapter);

    // Auto-focus the new thread
    this.switchToThread(id);

    return thread;
  }

  /** Switch the active (visible) thread. Swaps FeedStores in ChatView. */
  switchToThread(threadId: number): void {
    const targetAdapter = this.adapters.get(threadId);
    if (!targetAdapter || !this.view.chatView) return;

    // Deactivate the current thread's adapter
    if (this.focusedThreadId != null) {
      const prevAdapter = this.adapters.get(this.focusedThreadId);
      if (prevAdapter) prevAdapter.setActive(false);
    }

    // Swap the FeedStore in ChatView
    this.view.chatView.setStore(targetAdapter.store);
    targetAdapter.setActive(true);
    this.focusedThreadId = threadId;

    // Update thread focus timestamp and clear unread
    const thread = this.threads.get(threadId);
    if (thread) thread.focusedAt = Date.now();

    // Notify tab bar
    this.onTabsChanged?.();
    this.updateFooterHint();
  }

  /** Close a thread: remove its data, adapter, container, and feed. */
  closeThread(threadId: number): boolean {
    // Cannot close the last remaining tab
    if (this.threads.size <= 1) return false;

    const thread = this.threads.get(threadId);
    if (!thread) return false;

    this.threads.delete(threadId);
    this.containers.delete(threadId);
    this.adapters.delete(threadId);

    // If the closed thread was focused, switch to the nearest remaining
    if (this.focusedThreadId === threadId) {
      const remaining = [...this.threads.keys()].sort((a, b) => a - b);
      const next =
        remaining.find((id) => id > threadId) ??
        remaining[remaining.length - 1] ??
        1;
      this.switchToThread(next);
    }

    this.onTabsChanged?.();
    return true;
  }

  /** Auto-name a thread from the first message content. */
  autoNameThread(threadId: number, message: string): void {
    const thread = this.threads.get(threadId);
    if (!thread) return;
    // Extract a short name: strip @mentions, take first ~30 chars
    const cleaned = message
      .replace(/@\S+/g, "")
      .replace(/^[\s,]+/, "")
      .trim();
    thread.originMessage =
      cleaned.length > 30 ? `${cleaned.slice(0, 28)}…` : cleaned || "Thread";
    this.onTabsChanged?.();
  }

  /** Get the FeedAdapter for a thread. */
  getAdapter(threadId: number): FeedAdapter | undefined {
    return this.adapters.get(threadId);
  }

  /** Check if a thread has agents currently working. */
  isThreadWorking(threadId: number): boolean {
    const thread = this.threads.get(threadId);
    return thread ? thread.pendingTasks.size > 0 : false;
  }

  // ── Footer hint ─────────────────────────────────────────────────

  /**
   * Update the footer right hint. In tab mode, we don't show
   * "replying to task #N" — that concept is replaced by tabs.
   * Only show the hint when there are multiple threads.
   */
  updateFooterHint(): void {
    if (!this.view.chatView) return;
    if (this.view.defaultFooterRight) {
      this.view.chatView.setFooterRight(this.view.defaultFooterRight);
    }
  }

  // ── Thread data access ──────────────────────────────────────────

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

    // Mark as unread if not focused
    if (threadId !== this.focusedThreadId && entry.type === "agent") {
      this.onUnread?.(threadId);
    }
  }

  // ── Thread feed rendering ───────────────────────────────────────

  /**
   * Insert markdown content into a thread's feed.
   * Uses the thread's own FeedAdapter, not the ChatView directly.
   */
  threadFeedMarkdown(threadId: number, source: string): void {
    const container = this.containers.get(threadId);
    const adapter = this.adapters.get(threadId);
    if (!container || !adapter) {
      this.view.feedMarkdown(source);
      return;
    }
    const t = theme();
    const width = process.stdout.columns || 80;
    const lines = renderMarkdown(source, {
      width: width - 5,
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
    const shift = this.getShiftCallback(threadId);
    for (const line of lines) {
      const styledSpan = line.map((seg) => ({
        text: seg.text,
        style: seg.style,
      })) as StyledSpan;
      (styledSpan as any).__brand = "StyledSpan";
      container.insertLine(adapter, styledSpan, shift);
    }
  }

  /** Render the thread dispatch line as part of the user message block. */
  renderThreadHeader(thread: TaskThread, targetNames: string[]): void {
    const adapter = this.adapters.get(thread.id);
    if (!adapter) return;
    const t = theme();
    const bg = this.view.userBg;
    const headerIdx = adapter.feedLineCount;

    const displayNames = targetNames.map((n) =>
      n === this.view.selfName ? this.view.adapterName : n,
    );
    const namesText = displayNames.join(", ");

    // Render as a user-styled line (dark bg)
    const termW = (process.stdout.columns || 80) - 1;
    const content = concat(
      pen.fg(t.textDim).bg(bg)(`→ `),
      pen.fg(t.accent).bg(bg)(namesText),
    );
    let len = 0;
    for (const seg of content) len += seg.text.length;
    const pad = Math.max(0, termW - len);
    adapter.appendStyledToFeed(
      concat(content, pen.fg(bg).bg(bg)(" ".repeat(pad))),
    );

    // Create container for this thread
    const container = new ThreadContainer(thread.id, headerIdx, targetNames);
    this.containers.set(thread.id, container);
  }

  /** Render a user reply message inside a thread container. */
  renderThreadReply(
    threadId: number,
    displayText: string,
    targetNames: string[],
  ): void {
    const container = this.containers.get(threadId);
    const adapter = this.adapters.get(threadId);
    if (!container || !adapter) return;
    const t = theme();
    const bg = this.view.userBg;
    const termW = (process.stdout.columns || 80) - 1;
    const shift = this.getShiftCallback(threadId);

    // Blank line separator
    container.insertLine(adapter, "", shift);

    // Render user message lines
    const indent = "  ";
    const label = `${indent}${this.view.selfName}: `;
    const lines = displayText.split("\n");
    const first = lines.shift() ?? "";
    const firstWrapW = termW - label.length;
    const firstWrapped = wrapLine(first, firstWrapW);
    const seg0 = firstWrapped.shift() ?? "";
    const pad0 = Math.max(0, termW - label.length - seg0.length);
    container.insertLine(
      adapter,
      concat(
        pen.fg(t.accent).bg(bg)(label),
        pen.fg(t.text).bg(bg)(seg0 + " ".repeat(pad0)),
      ),
      shift,
    );
    for (const wl of firstWrapped) {
      const padWl = Math.max(0, termW - indent.length - wl.length);
      container.insertLine(
        adapter,
        concat(
          pen.fg(t.text).bg(bg)(indent),
          pen.fg(t.text).bg(bg)(wl + " ".repeat(padWl)),
        ),
        shift,
      );
    }
    for (const line of lines) {
      const wrapW = termW - indent.length;
      const wrapped = wrapLine(line, wrapW);
      for (const wl of wrapped) {
        const padWl = Math.max(0, termW - indent.length - wl.length);
        container.insertLine(
          adapter,
          concat(
            pen.fg(t.text).bg(bg)(indent),
            pen.fg(t.text).bg(bg)(wl + " ".repeat(padWl)),
          ),
          shift,
        );
      }
    }

    // Render dispatch line
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
      adapter,
      concat(dispatchContent, pen.fg(bg).bg(bg)(" ".repeat(dispPad))),
      shift,
    );

    // Blank line
    container.insertLine(adapter, "", shift);
    container.clearInsertAt();
  }

  /** Render a queued or working placeholder for an agent in a thread. */
  renderTaskPlaceholder(
    threadId: number,
    placeholderId: string,
    teammate: string,
    state: "queued" | "working",
  ): void {
    const container = this.containers.get(threadId);
    const adapter = this.adapters.get(threadId);
    if (!container || !adapter) return;
    const t = theme();
    const displayName =
      teammate === this.view.selfName ? this.view.adapterName : teammate;
    const activityId = `activity-${placeholderId}`;
    const cancelId = `cancel-${placeholderId}`;
    const statusText = state === "queued" ? "queued..." : "working...";
    const actions: FeedActionItem[] =
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
    const shift = this.getShiftCallback(threadId);
    container.addPlaceholder(adapter, placeholderId, actions, shift);
  }

  /** Toggle collapse/expand for an entire thread. */
  toggleThreadCollapse(threadId: number): void {
    const thread = this.getThread(threadId);
    const container = this.containers.get(threadId);
    const adapter = this.adapters.get(threadId);
    if (!thread || !container || !adapter) return;

    thread.collapsed = !thread.collapsed;
    container.toggleCollapse(adapter, thread.collapsed);
    this.view.refreshView();
  }

  /** Toggle collapse/expand for an individual reply within a thread. */
  toggleReplyCollapse(threadId: number, replyKey: string): void {
    const container = this.containers.get(threadId);
    const adapter = this.adapters.get(threadId);
    if (!container || !adapter) return;
    container.toggleReplyCollapse(adapter, replyKey);
    // Update the action text
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
      adapter.updateActionList(item.subjectLineIndex, actions);
    }
    this.view.refreshView();
  }

  /** Render a task result inside a thread. */
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
    const adapter = this.adapters.get(threadId);
    if (!adapter) return;
    const t = theme();
    const subject = result.summary || "Task completed";
    const shift = this.getShiftCallback(threadId);

    // Hide the working placeholder
    container.hidePlaceholder(adapter, placeholderId);

    // Track reply key
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

    // Store copy context
    if (cleaned) {
      this._copyContexts.set(
        copyId,
        `${displayName}: ${subject}\n\n${cleaned}`,
      );
    }

    // Insert subject line as action list
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
    const headerIdx = container.insertActions(adapter, subjectActions, shift);

    container.setInsertAt(headerIdx + 1);
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
        adapter,
        tp.muted(
          "    (no response text — the agent may have only performed tool actions)",
        ),
        shift,
      );
    }

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

    // Render handoffs inside thread
    if (result.handoffs.length > 0) {
      const containerCtx: HandoffContainerCtx = {
        insertLine: (text) => container.insertLine(adapter, text, shift),
        insertActions: (actions) =>
          container.insertActions(adapter, actions, shift),
      };
      this.view.renderHandoffs(
        result.teammate,
        result.handoffs,
        threadId,
        containerCtx,
      );
    }

    // Blank line after reply
    container.insertLine(adapter, "", shift);

    // Insert thread-level [copy thread] verb
    const threadCopyId = `thread-copy-${threadId}`;
    container.insertThreadActions(
      adapter,
      [
        {
          id: threadCopyId,
          normalStyle: this.view.makeSpan({
            text: "  [copy thread]",
            style: { fg: t.textDim },
          }),
          hoverStyle: this.view.makeSpan({
            text: "  [copy thread]",
            style: { fg: t.accent },
          }),
        },
      ],
      shift,
    );

    // Show/hide thread-level actions
    if (container.placeholderCount === 0) {
      container.showThreadActions(adapter);
    } else {
      container.hideThreadActions(adapter);
    }

    container.clearInsertAt();
  }

  /** Display a "canceled" subject line for a teammate in a thread. */
  displayCanceledInThread(
    teammate: string,
    threadId: number,
    container: ThreadContainer,
    placeholderId: string,
  ): void {
    const adapter = this.adapters.get(threadId);
    if (!adapter) return;
    const t = theme();
    const shift = this.getShiftCallback(threadId);

    container.hidePlaceholder(adapter, placeholderId);

    const displayName =
      teammate === this.view.selfName ? this.view.adapterName : teammate;

    container.insertActions(
      adapter,
      [
        {
          id: `canceled-${teammate}-${Date.now()}`,
          normalStyle: this.view.makeSpan(
            { text: `  ${displayName}: `, style: { fg: t.accent } },
            { text: "canceled", style: { fg: t.textDim } },
          ),
          hoverStyle: this.view.makeSpan(
            { text: `  ${displayName}: `, style: { fg: t.accent } },
            { text: "canceled", style: { fg: t.textDim } },
          ),
        },
      ],
      shift,
    );

    container.insertLine(adapter, "", shift);

    // Insert thread-level verbs
    const threadCopyId = `thread-copy-${threadId}`;
    container.insertThreadActions(
      adapter,
      [
        {
          id: threadCopyId,
          normalStyle: this.view.makeSpan({
            text: "  [copy thread]",
            style: { fg: t.textDim },
          }),
          hoverStyle: this.view.makeSpan({
            text: "  [copy thread]",
            style: { fg: t.accent },
          }),
        },
      ],
      shift,
    );

    if (container.placeholderCount === 0) {
      container.showThreadActions(adapter);
    } else {
      container.hideThreadActions(adapter);
    }
  }

  /** Reset all thread state — called by /clear. */
  clear(): void {
    this.threads.clear();
    this.nextThreadId = 1;
    this.focusedThreadId = null;
    this.containers.clear();
    this.adapters.clear();
    this.updateFooterHint();
    this.onTabsChanged?.();
  }

  /** Clear only the focused thread's feed content (per-thread /clear). */
  clearFocusedThread(): void {
    if (this.focusedThreadId == null) return;
    const adapter = this.adapters.get(this.focusedThreadId);
    const thread = this.threads.get(this.focusedThreadId);
    if (adapter) adapter.clear();
    if (thread) {
      thread.entries.length = 0;
      thread.collapsed = false;
      thread.collapsedEntries.clear();
    }
    // Reset the container
    this.containers.delete(this.focusedThreadId);
    this.view.refreshView();
  }
}
