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
import type { FeedAdapter } from "./feed-adapter.js";
import type { StatusTracker } from "./status-tracker.js";
import { theme } from "./theme.js";
import type { ShiftCallback, ThreadContainer } from "./thread-container.js";
import type { ActivityEvent, QueueEntry } from "./types.js";

// ─── Dependency interface ────────────────────────────────────────────

export interface ActivityManagerDeps {
  readonly chatView: ChatView;
  readonly selfName: string;
  readonly adapterName: string;
  readonly statusTracker: StatusTracker;
  agentActive: Map<string, QueueEntry>;
  containers: Map<number, ThreadContainer>;
  getAdapter(threadId: number): FeedAdapter | undefined;
  getShiftCallback(threadId: number): ShiftCallback;
  makeSpan(...segs: { text: string; style: { fg?: Color } }[]): StyledSpan;
  refreshView(): void;
  feedLine(text?: string | StyledSpan): void;
}

// ─── ActivityManager ─────────────────────────────────────────────────

export class ActivityManager {
  /**
   * All activity state is keyed by queue entry ID (taskId) — NOT teammate —
   * because per-tab queues allow the same teammate to run concurrent tasks
   * in different tabs. Keying by teammate would cause buffers, line indices,
   * and "shown" state to collide across tabs.
   */
  /** Buffered activity events per task. */
  readonly buffers: Map<string, ActivityEvent[]> = new Map();
  /** Whether the activity feed is toggled on for a given task. */
  readonly shown: Map<string, boolean> = new Map();
  /** Feed line indices for activity lines per task. */
  readonly lineIndices: Map<string, number[]> = new Map();
  /** Thread ID associated with a given task's activity (for container lookup). */
  readonly threadIds: Map<string, number> = new Map();
  /** Trailing blank line index per task (inserted after the activity block). */
  readonly blankIdx: Map<string, number> = new Map();

  private readonly deps: ActivityManagerDeps;

  constructor(deps: ActivityManagerDeps) {
    this.deps = deps;
  }

  /** Handle incoming activity events from an agent's debug log watcher. */
  handleActivityEvents(taskId: string, events: ActivityEvent[]): void {
    const buf = this.buffers.get(taskId);
    if (!buf) return;
    buf.push(...events);

    // If activity view is toggled on, re-render the collapsed view
    if (this.shown.get(taskId)) {
      this.rerenderActivityLines(taskId);
      this.deps.refreshView();
    }
  }

  /** Hide existing activity lines and re-insert the collapsed view. */
  rerenderActivityLines(taskId: string): void {
    const threadId = this.threadIds.get(taskId);
    const adapter =
      threadId != null ? this.deps.getAdapter(threadId) : undefined;
    // Hide existing activity lines (except the header)
    const indices = this.lineIndices.get(taskId) ?? [];
    for (let i = 1; i < indices.length; i++) {
      adapter?.setFeedLineHidden(indices[i], true);
    }
    // Keep only the header index; we'll insert fresh collapsed lines after it
    const headerIdx = indices.length > 0 ? indices[0] : undefined;
    if (headerIdx != null) {
      this.lineIndices.set(taskId, [headerIdx]);
    }

    const buf = this.buffers.get(taskId) ?? [];
    const collapsed = collapseActivityEvents(buf);
    if (collapsed.length > 0) {
      this.insertActivityLines(taskId, collapsed);
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
    const adapter = this.deps.getAdapter(threadId);
    if (!adapter) return;
    const taskId = queueId;
    const isShown = this.shown.get(taskId) ?? false;
    if (isShown) {
      // Hide all activity lines + trailing blank
      const indices = this.lineIndices.get(taskId) ?? [];
      for (const idx of indices) {
        adapter.setFeedLineHidden(idx, true);
      }
      const bi = this.blankIdx.get(taskId);
      if (bi != null) adapter.setFeedLineHidden(bi, true);
      this.shown.set(taskId, false);
      this.updatePlaceholderVerb(
        queueId,
        teammate,
        threadId,
        "[show activity]",
      );
    } else {
      // Show existing activity lines (or insert them if first time)
      const indices = this.lineIndices.get(taskId) ?? [];
      if (indices.length > 0) {
        for (const idx of indices) {
          adapter.setFeedLineHidden(idx, false);
        }
        const bi = this.blankIdx.get(taskId);
        if (bi != null) adapter.setFeedLineHidden(bi, false);
      } else {
        this.insertActivityHeader(taskId);
        const buf = this.buffers.get(taskId) ?? [];
        const collapsed = collapseActivityEvents(buf);
        if (collapsed.length > 0) {
          this.insertActivityLines(taskId, collapsed);
        }
      }
      this.shown.set(taskId, true);
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
  insertActivityHeader(taskId: string): void {
    const threadId = this.threadIds.get(taskId);
    if (threadId == null) return;
    const container = this.deps.containers.get(threadId);
    const adapter = this.deps.getAdapter(threadId);
    if (!container || !adapter) return;
    const activeEntry = [...this.deps.agentActive.values()].find(
      (e) => e.id === taskId,
    );
    if (!activeEntry) return;

    const t = theme();
    const indices = this.lineIndices.get(taskId) ?? [];
    const placeholderIdx = container.getPlaceholderIndex(activeEntry.id);
    if (placeholderIdx == null) return;
    const shift = this.deps.getShiftCallback(threadId);

    // Insert "Activity" header in accent color
    const insertAt = placeholderIdx + 1 + indices.length;
    const headerLine = this.deps.makeSpan({
      text: "    Activity",
      style: { fg: t.accent },
    });
    adapter.insertStyledToFeed(insertAt, headerLine);
    shift(insertAt, 1);
    indices.push(insertAt);
    this.lineIndices.set(taskId, indices);

    // Insert trailing blank line after activity block
    const blankAt = insertAt + 1;
    adapter.insertStyledToFeed(
      blankAt,
      this.deps.makeSpan({ text: "", style: {} }),
    );
    shift(blankAt, 1);
    this.blankIdx.set(taskId, blankAt);
  }

  /** Insert activity event lines into the thread container below the placeholder. */
  insertActivityLines(taskId: string, events: ActivityEvent[]): void {
    const threadId = this.threadIds.get(taskId);
    if (threadId == null) return;
    const container = this.deps.containers.get(threadId);
    const adapter = this.deps.getAdapter(threadId);
    if (!container || !adapter) return;
    const activeEntry = [...this.deps.agentActive.values()].find(
      (e) => e.id === taskId,
    );
    if (!activeEntry) return;

    const t = theme();
    const indices = this.lineIndices.get(taskId) ?? [];
    const placeholderIdx = container.getPlaceholderIndex(activeEntry.id);
    if (placeholderIdx == null) return;
    const shift = this.deps.getShiftCallback(threadId);

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

      adapter.insertStyledToFeed(insertAt, line);
      shift(insertAt, 1);
      indices.push(insertAt);
    }
    this.lineIndices.set(taskId, indices);
  }

  /** Hide all activity lines and clean up activity state for a task. */
  cleanupActivityLines(taskId: string): void {
    const threadId = this.threadIds.get(taskId);
    const adapter =
      threadId != null ? this.deps.getAdapter(threadId) : undefined;
    const indices = this.lineIndices.get(taskId) ?? [];
    if (indices.length > 0 && adapter) {
      for (const idx of indices) {
        adapter.setFeedLineHidden(idx, true);
      }
    }
    const bi = this.blankIdx.get(taskId);
    if (bi != null && adapter) {
      adapter.setFeedLineHidden(bi, true);
    }
    this.buffers.delete(taskId);
    this.shown.delete(taskId);
    this.lineIndices.delete(taskId);
    this.threadIds.delete(taskId);
    this.blankIdx.delete(taskId);
  }

  /** Update the [show activity]/[hide activity] verb text on a working placeholder. */
  updatePlaceholderVerb(
    queueId: string,
    teammate: string,
    threadId: number,
    label: string,
  ): void {
    const container = this.deps.containers.get(threadId);
    const adapter = this.deps.getAdapter(threadId);
    if (!container || !adapter) return;
    const placeholderIdx = container.getPlaceholderIndex(queueId);
    if (placeholderIdx == null) return;

    const t = theme();
    const displayName =
      teammate === this.deps.selfName ? this.deps.adapterName : teammate;
    const activityId = `activity-${queueId}`;
    const cancelId = `cancel-${queueId}`;
    adapter.updateActionList(placeholderIdx, [
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

  /** Initialize activity tracking state for a new task (keyed by task ID
   *  so two concurrent tasks for the same teammate don't collide). */
  initForTask(taskId: string, threadId?: number): void {
    this.buffers.set(taskId, []);
    this.shown.set(taskId, false);
    this.lineIndices.set(taskId, []);
    if (threadId != null) this.threadIds.set(taskId, threadId);
  }
}
