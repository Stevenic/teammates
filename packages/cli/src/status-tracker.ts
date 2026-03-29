/**
 * Animated status tracker — shows a spinner with teammate name and elapsed time
 * while tasks are running. Supports one-shot notifications that cycle once then disappear.
 */

import { sep } from "node:path";
import {
  type App,
  type ChatView,
  concat,
  type StyledLine,
} from "@teammates/consolonia";
import chalk from "chalk";
import type { PromptInput } from "./console/prompt-input.js";
import { tp } from "./theme.js";

export interface StatusView {
  chatView: ChatView;
  app: App;
  input: PromptInput;
  selfName: string;
  adapterName: string;
}

export class StatusTracker {
  private tasks: Map<
    string,
    { teammate: string; task: string; startTime: number }
  > = new Map();
  private notifications: { content: StyledLine; shown: boolean }[] = [];

  private frameTimer: ReturnType<typeof setInterval> | null = null;
  private rotateTimer: ReturnType<typeof setInterval> | null = null;
  private frame = 0;
  private rotateIndex = 0;
  private view: StatusView;

  private static readonly SPINNER = [
    "⠋",
    "⠙",
    "⠹",
    "⠸",
    "⠼",
    "⠴",
    "⠦",
    "⠧",
    "⠇",
    "⠏",
  ];

  constructor(view: StatusView) {
    this.view = view;
  }

  /** Add a task to the rotation queue. Starts animation if not already running. */
  startTask(id: string, teammate: string, description: string): void {
    this.tasks.set(id, { teammate, task: description, startTime: Date.now() });
    this.ensureRunning();
  }

  /** Remove a task from the rotation queue. Stops animation if queue is empty. */
  stopTask(id: string): void {
    this.tasks.delete(id);
    if (this.tasks.size === 0 && this.notifications.length === 0) {
      this.stop();
    }
  }

  /** Add a one-shot notification that shows once in the rotation then disappears. */
  showNotification(content: StyledLine): void {
    this.notifications.push({ content, shown: false });
    this.ensureRunning();
  }

  /** True if any tasks are active. */
  get hasActiveTasks(): boolean {
    return this.tasks.size > 0;
  }

  /** Number of active tasks. */
  get taskCount(): number {
    return this.tasks.size;
  }

  /** Get a task entry by ID (for reading startTime, etc.). */
  getTask(
    id: string,
  ): { teammate: string; task: string; startTime: number } | undefined {
    return this.tasks.get(id);
  }

  /**
   * Truncate a path for display, collapsing middle segments if too long.
   * E.g. C:\source\some\deep\project → C:\source\...\project
   */
  static truncatePath(fullPath: string, maxLen = 30): string {
    if (fullPath.length <= maxLen) return fullPath;
    const parts = fullPath.split(sep);
    if (parts.length <= 2) return fullPath;
    const last = parts[parts.length - 1];
    let front = parts[0];
    for (let i = 1; i < parts.length - 1; i++) {
      const candidate = `${front + sep + parts[i] + sep}...${sep}${last}`;
      if (candidate.length > maxLen) break;
      front += sep + parts[i];
    }
    return `${front + sep}...${sep}${last}`;
  }

  /** Format elapsed seconds as (Ns), (Nm Ns), or (Nh Nm Ns). */
  static formatElapsed(totalSeconds: number): string {
    const s = totalSeconds % 60;
    const m = Math.floor(totalSeconds / 60) % 60;
    const h = Math.floor(totalSeconds / 3600);
    if (h > 0) return `(${h}h ${m}m ${s}s)`;
    if (m > 0) return `(${m}m ${s}s)`;
    return `(${s}s)`;
  }

  /** Start timers if not already running. */
  private ensureRunning(): void {
    if (this.frameTimer) return;

    this.frame = 0;
    this.rotateIndex = 0;
    this.renderFrame();

    this.frameTimer = setInterval(() => {
      this.frame++;
      this.renderFrame();
    }, 200);

    this.rotateTimer = setInterval(() => {
      this.rotate();
    }, 3000);
  }

  /** Stop the status animation and clear the status line. */
  private stop(): void {
    if (this.frameTimer) {
      clearInterval(this.frameTimer);
      this.frameTimer = null;
    }
    if (this.rotateTimer) {
      clearInterval(this.rotateTimer);
      this.rotateTimer = null;
    }
    if (this.view.chatView) {
      this.view.chatView.setProgress(null);
      this.view.app.refresh();
    } else {
      this.view.input.setStatus(null);
    }
  }

  /** Advance the rotation index. Drain shown notifications. */
  private rotate(): void {
    // Purge notifications that have been displayed
    this.notifications = this.notifications.filter((n) => !n.shown);

    const total = this.tasks.size + this.notifications.length;
    if (total > 1) {
      this.rotateIndex = (this.rotateIndex + 1) % total;
    }

    // If everything is gone, stop
    if (this.tasks.size === 0 && this.notifications.length === 0) {
      this.stop();
    }
  }

  /** Render one frame of the status animation. */
  private renderFrame(): void {
    const taskEntries = Array.from(this.tasks.values());
    const total = taskEntries.length + this.notifications.length;
    if (total === 0) return;

    const idx = this.rotateIndex % total;

    // Is this index a notification or a task?
    if (idx < taskEntries.length) {
      this.renderTaskFrame(taskEntries, idx, total);
    } else {
      const nIdx = idx - taskEntries.length;
      this.renderNotificationFrame(nIdx);
    }
  }

  /** Render a task entry frame. */
  private renderTaskFrame(
    entries: { teammate: string; task: string; startTime: number }[],
    idx: number,
    total: number,
  ): void {
    const { teammate, task, startTime } = entries[idx];
    const displayName =
      teammate === this.view.selfName ? this.view.adapterName : teammate;

    const spinChar =
      StatusTracker.SPINNER[this.frame % StatusTracker.SPINNER.length];
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const elapsedStr = StatusTracker.formatElapsed(elapsed);

    const tag =
      total > 1
        ? `(${idx + 1}/${total} - ${elapsedStr.slice(1, -1)})`
        : elapsedStr;

    const prefix = `${spinChar} ${displayName} - `;
    const suffix = ` ${tag}`;
    const cols = process.stdout.columns || 80;
    const budget = cols - prefix.length;
    const cleanTask = task.replace(/[\r\n]+/g, " ").trim();

    // If the suffix won't fit alongside even a minimal task, omit it entirely
    const useSuffix = budget - suffix.length > 3;
    const maxTask = useSuffix ? budget - suffix.length : budget;
    const taskText =
      maxTask <= 3
        ? ""
        : cleanTask.length > maxTask
          ? `${cleanTask.slice(0, maxTask - 1)}…`
          : cleanTask;
    const finalSuffix = useSuffix ? suffix : "";

    if (this.view.chatView) {
      this.view.chatView.setProgress(
        concat(
          tp.accent(`${spinChar} ${displayName} - `),
          tp.muted(`${taskText}${finalSuffix}`),
        ),
      );
      this.view.app.scheduleRefresh();
    } else {
      const spinColor = this.frame % 8 === 0 ? chalk.blue : chalk.blueBright;
      const line =
        `  ${spinColor(spinChar)} ` +
        chalk.bold(displayName) +
        chalk.gray(` - ${taskText}`) +
        chalk.gray(finalSuffix);
      this.view.input.setStatus(line);
    }
  }

  /** Render a notification frame (one-shot, marked as shown). */
  private renderNotificationFrame(nIdx: number): void {
    if (nIdx >= this.notifications.length) return;
    const notification = this.notifications[nIdx];
    notification.shown = true;

    if (this.view.chatView) {
      this.view.chatView.setProgress(notification.content);
      this.view.app.scheduleRefresh();
    } else {
      // Fallback: notifications in readline mode render as plain string
      const text =
        typeof notification.content === "string"
          ? notification.content
          : String(notification.content);
      this.view.input.setStatus(`  ${text}`);
    }
  }
}
