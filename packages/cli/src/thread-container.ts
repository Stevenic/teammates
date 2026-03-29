/**
 * ThreadContainer — Encapsulates all feed-line index management for a single thread.
 *
 * Replaces the scattered threadFeedRanges, workingPlaceholders, replyBodyRanges,
 * threadTargetNames, and _threadInsertAt maps from cli.ts.
 */

import type {
  FeedActionItem,
  StyledLine,
  StyledSpan,
} from "@teammates/consolonia";

// ── Minimal ChatView interface ──────────────────────────────────────

/** Subset of ChatView methods needed by ThreadContainer for feed mutations. */
export interface ThreadFeedView {
  readonly feedLineCount: number;
  insertToFeed(atIndex: number, text: string): void;
  insertStyledToFeed(atIndex: number, styledLine: StyledSpan): void;
  insertActionList(atIndex: number, actions: FeedActionItem[]): void;
  setFeedLineHidden(index: number, hidden: boolean): void;
  setFeedLinesHidden(startIndex: number, count: number, hidden: boolean): void;
  isFeedLineHidden(index: number): boolean;
  updateFeedLine(index: number, content: StyledLine): void;
  updateActionList(index: number, actions: FeedActionItem[]): void;
}

// ── Types ───────────────────────────────────────────────────────────

/** Callback invoked after a feed insert so all containers + global indices shift. */
export type ShiftCallback = (atIndex: number, delta: number) => void;

/** Tracking data for an individual reply within a thread. */
export interface ThreadItemEntry {
  /** Lookup key: "threadId-replyIndex". */
  key: string;
  /** Feed line index of the subject/header line. */
  subjectLineIndex: number;
  /** First feed line of the body content. */
  bodyStartIndex: number;
  /** Last feed line of the body content (exclusive). */
  bodyEndIndex: number;
  /** Whether the body is currently hidden. */
  collapsed: boolean;
  /** Display name for the teammate (used to rebuild action text on toggle). */
  displayName?: string;
  /** Subject line text (used to rebuild action text on toggle). */
  subject?: string;
  /** Copy action ID (used to rebuild action text on toggle). */
  copyActionId?: string;
}

// ── ThreadContainer ─────────────────────────────────────────────────

export class ThreadContainer {
  readonly threadId: number;

  /** Feed line index of the thread header (dispatch line). */
  headerIdx: number;
  /** End of the thread's feed range (exclusive). */
  endIdx: number;
  /** Target teammate names shown in the dispatch header. */
  targetNames: string[];
  /** Tracked reply items with body ranges for collapse. */
  items: ThreadItemEntry[] = [];
  /** Feed line index of the thread-level [reply] [copy thread] action line, or null if not yet rendered. */
  replyActionIdx: number | null = null;

  /** Maps teammate name → feed line index of the "working..." placeholder. */
  private placeholders: Map<string, number> = new Map();

  /**
   * When set, overrides getInsertPoint() to insert at this position.
   * Auto-increments after each use so sequential inserts stack correctly.
   */
  private _insertAt: number | null = null;

  constructor(threadId: number, headerIdx: number, targetNames: string[]) {
    this.threadId = threadId;
    this.headerIdx = headerIdx;
    this.endIdx = headerIdx + 1;
    this.targetNames = targetNames;
  }

  // ── Insert point management ─────────────────────────────────────

  /**
   * Find the insert point for new content in this thread.
   * Returns the position before the first working placeholder,
   * or at endIdx if there are no placeholders.
   * When _insertAt is set, uses that and auto-advances.
   */
  getInsertPoint(): number {
    if (this._insertAt != null) {
      return this._insertAt++;
    }
    let insertPoint = this.endIdx;
    // Insert before thread-level actions ([reply] [copy thread]) if present
    if (this.replyActionIdx != null && this.replyActionIdx < insertPoint) {
      insertPoint = this.replyActionIdx;
    }
    // Insert before any working placeholders
    for (const idx of this.placeholders.values()) {
      if (idx < insertPoint) insertPoint = idx;
    }
    return insertPoint;
  }

  /** Override the insert point for sequential inserts (e.g., header + body). */
  setInsertAt(idx: number): void {
    this._insertAt = idx;
  }

  /** Clear the insert point override. */
  clearInsertAt(): void {
    this._insertAt = null;
  }

  // ── Feed line insertion ─────────────────────────────────────────

  /**
   * Insert a line into the thread at the reply insert point.
   * Returns the feed line index where the line was inserted.
   */
  insertLine(
    view: ThreadFeedView,
    text: string | StyledSpan,
    onShift: ShiftCallback,
  ): number {
    const insertAt = this.getInsertPoint();
    if (typeof text === "string") {
      view.insertToFeed(insertAt, text);
    } else {
      view.insertStyledToFeed(insertAt, text);
    }
    const oldEnd = this.endIdx;
    onShift(insertAt, 1);
    // Only manually extend if shiftIndices didn't already
    // (i.e., insert was at the boundary, not inside the range).
    if (this.endIdx === oldEnd) this.endIdx++;
    return insertAt;
  }

  /**
   * Insert an action list into the thread at the reply insert point.
   * Returns the feed line index where the action was inserted.
   */
  insertActions(
    view: ThreadFeedView,
    actions: FeedActionItem[],
    onShift: ShiftCallback,
  ): number {
    const insertAt = this.getInsertPoint();
    view.insertActionList(insertAt, actions);
    const oldEnd = this.endIdx;
    onShift(insertAt, 1);
    if (this.endIdx === oldEnd) this.endIdx++;
    return insertAt;
  }

  // ── Working placeholders ────────────────────────────────────────

  /**
   * Add a working placeholder for a teammate at the end of the thread range.
   */
  addPlaceholder(
    view: ThreadFeedView,
    teammate: string,
    styledLine: StyledSpan,
    onShift: ShiftCallback,
  ): void {
    // Insert before thread-level actions ([reply] [copy thread]) if present,
    // otherwise at end of range. This ensures reply placeholders appear
    // within the thread content, not after the thread-level verbs.
    let insertAt = this.endIdx;
    if (this.replyActionIdx != null && this.replyActionIdx < insertAt) {
      insertAt = this.replyActionIdx;
    }
    view.insertStyledToFeed(insertAt, styledLine);
    const oldEnd = this.endIdx;
    onShift(insertAt, 1);
    if (this.endIdx === oldEnd) this.endIdx++;
    this.placeholders.set(teammate, insertAt);
  }

  /**
   * Hide a working placeholder and remove it from tracking.
   * Returns the placeholder's feed line index, or undefined if not found.
   */
  hidePlaceholder(view: ThreadFeedView, teammate: string): number | undefined {
    const idx = this.placeholders.get(teammate);
    if (idx != null) {
      view.setFeedLineHidden(idx, true);
      this.placeholders.delete(teammate);
    }
    return idx;
  }

  /** Check if a working placeholder exists for a teammate. */
  hasPlaceholder(teammate: string): boolean {
    return this.placeholders.has(teammate);
  }

  /** Number of active (visible) working placeholders. */
  get placeholderCount(): number {
    return this.placeholders.size;
  }

  // ── Thread-level action visibility ───────────────────────────────

  /**
   * Hide the thread-level [reply] [copy thread] action line.
   * Called when working placeholders are added to suppress verbs during work.
   */
  hideThreadActions(view: ThreadFeedView): void {
    if (this.replyActionIdx != null) {
      view.setFeedLineHidden(this.replyActionIdx, true);
    }
  }

  /**
   * Show the thread-level [reply] [copy thread] action line.
   * Called when all working placeholders are resolved.
   */
  showThreadActions(view: ThreadFeedView): void {
    if (this.replyActionIdx != null) {
      view.setFeedLineHidden(this.replyActionIdx, false);
    }
  }

  // ── Reply body tracking ─────────────────────────────────────────

  /**
   * Register a reply's body range for individual collapse.
   */
  trackReplyBody(
    key: string,
    subjectIdx: number,
    startIdx: number,
    endIdx: number,
    displayName?: string,
    subject?: string,
    copyActionId?: string,
  ): void {
    this.items.push({
      key,
      subjectLineIndex: subjectIdx,
      bodyStartIndex: startIdx,
      bodyEndIndex: endIdx,
      collapsed: false,
      displayName,
      subject,
      copyActionId,
    });
  }

  // ── Thread-level action line ───────────────────────────────────

  /**
   * Insert the thread-level [reply] [copy thread] action line.
   * Only inserts once — subsequent calls are no-ops (line shifts automatically).
   */
  insertThreadActions(
    view: ThreadFeedView,
    actions: FeedActionItem[],
    onShift: ShiftCallback,
  ): void {
    if (this.replyActionIdx != null) return; // already rendered
    const insertAt = this.getInsertPoint();
    view.insertActionList(insertAt, actions);
    const oldEnd = this.endIdx;
    onShift(insertAt, 1);
    if (this.endIdx === oldEnd) this.endIdx++;
    this.replyActionIdx = insertAt;
  }

  // ── Collapse ────────────────────────────────────────────────────

  /**
   * Toggle collapse/expand for an individual reply within this thread.
   */
  toggleReplyCollapse(view: ThreadFeedView, replyKey: string): void {
    const item = this.items.find((i) => i.key === replyKey);
    if (!item) return;
    const count = item.bodyEndIndex - item.bodyStartIndex;
    if (count > 0) {
      item.collapsed = !item.collapsed;
      view.setFeedLinesHidden(item.bodyStartIndex, count, item.collapsed);
    }
  }

  /**
   * Toggle collapse/expand for the entire thread (all content below header).
   */
  toggleCollapse(view: ThreadFeedView, collapsed: boolean): void {
    const contentStart = this.headerIdx + 1;
    const contentCount = this.endIdx - contentStart;
    if (contentCount > 0) {
      view.setFeedLinesHidden(contentStart, contentCount, collapsed);
    }
  }

  // ── Index shifting ──────────────────────────────────────────────

  /**
   * Shift this container's indices when lines are inserted/removed elsewhere.
   * Called by the global shift callback for every container.
   */
  shiftIndices(atIndex: number, delta: number): void {
    if (this.headerIdx >= atIndex) this.headerIdx += delta;
    // Use > for exclusive endIdx — insert at boundary doesn't extend range.
    if (this.endIdx > atIndex) this.endIdx += delta;

    if (this.replyActionIdx != null && this.replyActionIdx >= atIndex)
      this.replyActionIdx += delta;

    for (const [key, idx] of this.placeholders) {
      if (idx >= atIndex) this.placeholders.set(key, idx + delta);
    }

    for (const item of this.items) {
      if (item.subjectLineIndex >= atIndex) item.subjectLineIndex += delta;
      if (item.bodyStartIndex >= atIndex) item.bodyStartIndex += delta;
      if (item.bodyEndIndex > atIndex) item.bodyEndIndex += delta;
    }
  }
}
