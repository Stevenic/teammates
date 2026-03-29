/**
 * Animated status tracker — shows a spinner with teammate name and elapsed time
 * while tasks are running.
 */

import { sep } from "node:path";
import { type App, type ChatView, concat } from "@teammates/consolonia";
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
  readonly activeTasks: Map<
    string,
    { teammate: string; task: string; startTime: number }
  > = new Map();

  private statusTimer: ReturnType<typeof setInterval> | null = null;
  private statusFrame = 0;
  private statusRotateIndex = 0;
  private statusRotateTimer: ReturnType<typeof setInterval> | null = null;
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

  /** Start or update the animated status tracker above the prompt. */
  start(): void {
    if (this.statusTimer) return; // already running

    this.statusFrame = 0;
    this.statusRotateIndex = 0;
    this.renderFrame();

    this.statusTimer = setInterval(() => {
      this.statusFrame++;
      this.renderFrame();
    }, 200);

    this.statusRotateTimer = setInterval(() => {
      if (this.activeTasks.size > 1) {
        this.statusRotateIndex =
          (this.statusRotateIndex + 1) % this.activeTasks.size;
      }
    }, 3000);
  }

  /** Stop the status animation and clear the status line. */
  stop(): void {
    if (this.statusTimer) {
      clearInterval(this.statusTimer);
      this.statusTimer = null;
    }
    if (this.statusRotateTimer) {
      clearInterval(this.statusRotateTimer);
      this.statusRotateTimer = null;
    }
    if (this.view.chatView) {
      this.view.chatView.setProgress(null);
      this.view.app.refresh();
    } else {
      this.view.input.setStatus(null);
    }
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

  /** Render one frame of the status animation. */
  private renderFrame(): void {
    if (this.activeTasks.size === 0) return;

    const entries = Array.from(this.activeTasks.values());
    const total = entries.length;
    const idx = this.statusRotateIndex % total;
    const { teammate, task, startTime } = entries[idx];
    const displayName =
      teammate === this.view.selfName ? this.view.adapterName : teammate;

    const spinChar =
      StatusTracker.SPINNER[this.statusFrame % StatusTracker.SPINNER.length];
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const elapsedStr = StatusTracker.formatElapsed(elapsed);

    const tag =
      total > 1
        ? `(${idx + 1}/${total} - ${elapsedStr.slice(1, -1)})`
        : elapsedStr;

    const prefix = `${spinChar} ${displayName}... `;
    const suffix = ` ${tag}`;
    const maxTask = 80 - prefix.length - suffix.length;
    const cleanTask = task.replace(/[\r\n]+/g, " ").trim();
    const taskText =
      maxTask <= 3
        ? ""
        : cleanTask.length > maxTask
          ? `${cleanTask.slice(0, maxTask - 1)}…`
          : cleanTask;

    if (this.view.chatView) {
      this.view.chatView.setProgress(
        concat(
          tp.accent(`${spinChar} ${displayName}... `),
          tp.muted(`${taskText}${suffix}`),
        ),
      );
      this.view.app.scheduleRefresh();
    } else {
      const spinColor =
        this.statusFrame % 8 === 0 ? chalk.blue : chalk.blueBright;
      const line =
        `  ${spinColor(spinChar)} ` +
        chalk.bold(displayName) +
        chalk.gray(`... ${taskText}`) +
        chalk.gray(suffix);
      this.view.input.setStatus(line);
    }
  }
}
