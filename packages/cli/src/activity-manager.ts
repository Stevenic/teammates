/**
 * Activity tracking manager — handles real-time activity event buffering,
 * display toggling, line insertion/cleanup, and task cancellation.
 *
 * Extracted from cli.ts to reduce file size for more reliable agent patching.
 */

import type { ChatView, Color, StyledSpan } from "@teammates/consolonia";
import {
  collapseActivityEvents,
  formatActivityTime,
} from "./activity-watcher.js";
import type { StatusTracker } from "./status-tracker.js";
import { theme } from "./theme.js";
import type { ThreadContainer } from "./thread-container.js";
import type { ActivityEvent, QueueEntry } from "./types.js";

// ─── Dependency interface ────────────────────────────────────────────

export interface ActivityManagerDeps {
  readonly chatView: ChatView;
  readonly selfName: string;
  readonly adapterName: string;
  readonly statusTracker: StatusTracker;
  agentActive: Map<string, QueueEntry>;
  containers: Map<number, ThreadContainer>;
  shiftAllContainers(atIndex: number, delta: number): void;
  makeSpan(...segs: { text: string; style: { fg?: Color } }[]): StyledSpan;
  refreshView(): void;
  feedLine(text?: string | StyledSpan): void;
}

// ─── ActivityManager ─────────────────────────────────────────────────

export class ActivityManager {
  /** Buffered activity events per teammate (cleared when task completes). */
  readonly buffers: Map<string, ActivityEvent[]> = new Map();
  /** Whether the activity feed is toggled on for a given teammate. */
  readonly shown: Map<string, boolean> = new Map();
  /** Feed line indices for activity lines per teammate (for hiding on toggle off). */
  readonly lineIndices: Map<string, number[]> = new Map();
  /** Thread IDs associated with activity per teammate. */
  readonly threadIds: Map<string, number> = new Map();
  /** Trailing blank line index per teammate (inserted after activity block). */
  readonly blankIdx: Map<string, number> = new Map();

  private readonly deps: ActivityManagerDeps;

  constructor(deps: ActivityManagerDeps) {
    this.deps = deps;
  }

  /** Handle incoming activity events from an agent's debug log watcher. */
  handleActivityEvents(teammate: string, events: ActivityEvent[]): void {
    const buf = this.buffers.get(teammate);
    if (!buf) return;
    buf.push(...events);

    // If activity view is toggled on, re-render the collapsed view
    if (this.shown.get(teammate)) {
      this.rerenderActivityLines(teammate);
      this.deps.refreshView();
    }
  }

  /** Hide existing activity lines and re-insert the collapsed view. */
  rerenderActivityLines(teammate: string): void {
    const chatView = this.deps.chatView;
    // Hide existing activity lines (except the header)
    const indices = this.lineIndices.get(teammate) ?? [];
    for (let i = 1; i < indices.length; i++) {
      chatView?.setFeedLineHidden(indices[i], true);
    }
    // Keep only the header index; we'll insert fresh collapsed lines after it
    const headerIdx = indices.length > 0 ? indices[0] : undefined;
    if (headerIdx != null) {
      this.lineIndices.set(teammate, [headerIdx]);
    }

    const buf = this.buffers.get(teammate) ?? [];
    const collapsed = collapseActivityEvents(buf);
    if (collapsed.length > 0) {
      this.insertActivityLines(teammate, collapsed);
    }
  }

  /** Toggle the activity view for the active queue entry on/off. */
  toggleActivity(queueId: string): void {
    const activeEntry = [...this.deps.agentActive.values()].find(
      (e) => e.id === queueId,
    );
    if (!activeEntry) return;
    const teammate = activeEntry.teammate;
    const threadId = activeEntry.threadId;
    if (threadId == null) return;
    const isShown = this.shown.get(teammate) ?? false;
    if (isShown) {
      // Hide all activity lines + trailing blank
      const indices = this.lineIndices.get(teammate) ?? [];
      for (const idx of indices) {
        this.deps.chatView?.setFeedLineHidden(idx, true);
      }
      const bi = this.blankIdx.get(teammate);
      if (bi != null) this.deps.chatView?.setFeedLineHidden(bi, true);
      this.shown.set(teammate, false);
      this.updatePlaceholderVerb(
        queueId,
        teammate,
        threadId,
        "[show activity]",
      );
    } else {
      // Show existing activity lines (or insert them if first time)
      const indices = this.lineIndices.get(teammate) ?? [];
      if (indices.length > 0) {
        // Already inserted — just unhide
        for (const idx of indices) {
          this.deps.chatView?.setFeedLineHidden(idx, false);
        }
        const bi = this.blankIdx.get(teammate);
        if (bi != null) this.deps.chatView?.setFeedLineHidden(bi, false);
      } else {
        // First time — insert "Activity" header + blank line, then collapsed events
        this.insertActivityHeader(teammate);
        const buf = this.buffers.get(teammate) ?? [];
        const collapsed = collapseActivityEvents(buf);
        if (collapsed.length > 0) {
          this.insertActivityLines(teammate, collapsed);
        }
      }
      this.shown.set(teammate, true);
      this.updatePlaceholderVerb(
        queueId,
        teammate,
        threadId,
        "[hide activity]",
      );
    }
    this.deps.refreshView();
  }

  /** Insert the "Activity" header line below the placeholder (first time showing). */
  insertActivityHeader(teammate: string): void {
    const threadId = this.threadIds.get(teammate);
    if (threadId == null) return;
    const container = this.deps.containers.get(threadId);
    const chatView = this.deps.chatView;
    if (!container || !chatView) return;
    const activeEntry = this.deps.agentActive.get(teammate);
    if (!activeEntry) return;

    const t = theme();
    const indices = this.lineIndices.get(teammate) ?? [];
    const placeholderIdx = container.getPlaceholderIndex(activeEntry.id);
    if (placeholderIdx == null) return;

    // Insert "Activity" header in accent color
    const insertAt = placeholderIdx + 1 + indices.length;
    const headerLine = this.deps.makeSpan({
      text: "    Activity",
      style: { fg: t.accent },
    });
    chatView.insertStyledToFeed(insertAt, headerLine);
    this.deps.shiftAllContainers(insertAt, 1);
    indices.push(insertAt);
    this.lineIndices.set(teammate, indices);

    // Insert trailing blank line after activity block
    const blankAt = insertAt + 1;
    chatView.insertStyledToFeed(
      blankAt,
      this.deps.makeSpan({ text: "", style: {} }),
    );
    this.deps.shiftAllContainers(blankAt, 1);
    this.blankIdx.set(teammate, blankAt);
  }

  /** Insert activity event lines into the thread container below the placeholder. */
  insertActivityLines(teammate: string, events: ActivityEvent[]): void {
    const threadId = this.threadIds.get(teammate);
    if (threadId == null) return;
    const container = this.deps.containers.get(threadId);
    const chatView = this.deps.chatView;
    if (!container || !chatView) return;
    const activeEntry = this.deps.agentActive.get(teammate);
    if (!activeEntry) return;

    const t = theme();
    const indices = this.lineIndices.get(teammate) ?? [];
    const placeholderIdx = container.getPlaceholderIndex(activeEntry.id);
    if (placeholderIdx == null) return;

    for (const ev of events) {
      const time = formatActivityTime(ev.elapsedMs);
      const fg = ev.isError ? t.error : t.textDim;

      const insertAt = placeholderIdx + 1 + indices.length;
      let line: StyledSpan;

      if (ev.tool === "Exploring") {
        line = this.deps.makeSpan(
          { text: `    ${time} `, style: { fg: t.textDim } },
          { text: "Exploring", style: { fg: t.accent } },
          {
            text: ev.detail ? ` (${ev.detail})` : "",
            style: { fg: t.textDim },
          },
        );
      } else {
        const toolText = ev.isError ? `${ev.tool} ERROR` : ev.tool;
        const detail = ev.detail ? ` ${ev.detail}` : "";
        line = this.deps.makeSpan(
          { text: `    ${time} `, style: { fg: t.textDim } },
          { text: toolText, style: { fg } },
          { text: detail, style: { fg: t.textDim } },
        );
      }

      chatView.insertStyledToFeed(insertAt, line);
      this.deps.shiftAllContainers(insertAt, 1);
      indices.push(insertAt);
    }
    this.lineIndices.set(teammate, indices);
  }

  /** Hide all activity lines and clean up activity state for a teammate. */
  cleanupActivityLines(teammate: string): void {
    const chatView = this.deps.chatView;
    const indices = this.lineIndices.get(teammate) ?? [];
    if (indices.length > 0 && chatView) {
      for (const idx of indices) {
        chatView.setFeedLineHidden(idx, true);
      }
    }
    const bi = this.blankIdx.get(teammate);
    if (bi != null && chatView) {
      chatView.setFeedLineHidden(bi, true);
    }
    this.buffers.delete(teammate);
    this.shown.delete(teammate);
    this.lineIndices.delete(teammate);
    this.threadIds.delete(teammate);
    this.blankIdx.delete(teammate);
  }

  /** Update the [show activity]/[hide activity] verb text on a working placeholder. */
  updatePlaceholderVerb(
    queueId: string,
    teammate: string,
    threadId: number,
    label: string,
  ): void {
    const container = this.deps.containers.get(threadId);
    const chatView = this.deps.chatView;
    if (!container || !chatView) return;
    const placeholderIdx = container.getPlaceholderIndex(queueId);
    if (placeholderIdx == null) return;

    const t = theme();
    const displayName =
      teammate === this.deps.selfName ? this.deps.adapterName : teammate;
    const activityId = `activity-${queueId}`;
    const cancelId = `cancel-${queueId}`;
    chatView.updateActionList(placeholderIdx, [
      {
        id: activityId,
        normalStyle: this.deps.makeSpan(
          { text: `  ${displayName}: `, style: { fg: t.accent } },
          { text: "working...", style: { fg: t.textDim } },
          { text: `  ${label}`, style: { fg: t.textDim } },
        ),
        hoverStyle: this.deps.makeSpan(
          { text: `  ${displayName}: `, style: { fg: t.accent } },
          { text: "working...", style: { fg: t.textDim } },
          { text: `  ${label}`, style: { fg: t.accent } },
        ),
      },
      {
        id: cancelId,
        normalStyle: this.deps.makeSpan({
          text: " [cancel]",
          style: { fg: t.textDim },
        }),
        hoverStyle: this.deps.makeSpan({
          text: " [cancel]",
          style: { fg: t.accent },
        }),
      },
    ]);
  }

  /** Initialize activity tracking state for a new task. */
  initForTask(teammate: string, threadId?: number): void {
    this.buffers.set(teammate, []);
    this.shown.set(teammate, false);
    this.lineIndices.set(teammate, []);
    if (threadId != null) this.threadIds.set(teammate, threadId);
  }
}
