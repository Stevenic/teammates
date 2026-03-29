/**
 * Handoff rendering, approval/rejection, and cross-folder violation auditing.
 */

import { execSync } from "node:child_process";
import { resolve } from "node:path";
import type {
  ChatView,
  Color,
  FeedActionItem,
  StyledSpan,
} from "@teammates/consolonia";
import { theme, tp } from "./theme.js";
import type { HandoffEnvelope, QueueEntry, TaskThread } from "./types.js";

export interface HandoffView {
  chatView: ChatView;
  feedLine(text?: string | StyledSpan): void;
  refreshView(): void;
  makeSpan(...segs: { text: string; style: { fg?: Color } }[]): StyledSpan;
  wordWrap(text: string, maxWidth: number): string[];
  listTeammates(): string[];
  getThread(id: number): TaskThread | undefined;
  makeQueueEntryId(): string;
  taskQueue: QueueEntry[];
  kickDrain(): void;
  teammatesDir: string;
}

export interface PendingHandoff {
  id: string;
  envelope: HandoffEnvelope;
  approveIdx: number;
  rejectIdx: number;
  threadId?: number;
}

export interface PendingViolation {
  id: string;
  teammate: string;
  files: string[];
  actionIdx: number;
}

/**
 * Optional thread container context for rendering handoffs inside a thread.
 * When provided, handoff lines are inserted via the container instead of
 * appended to the global feed — keeping them inside the thread range.
 */
export interface HandoffContainerCtx {
  insertLine(text: string | StyledSpan): void;
  insertActions(actions: FeedActionItem[]): number;
}

export class HandoffManager {
  pendingHandoffs: PendingHandoff[] = [];
  pendingViolations: PendingViolation[] = [];
  autoApproveHandoffs = false;

  private view: HandoffView;

  constructor(view: HandoffView) {
    this.view = view;
  }

  /** Render handoff blocks with approve/reject actions.
   *  When `containerCtx` is provided, lines are inserted into the thread
   *  container instead of appended to the global feed — keeping handoffs
   *  inside the thread range so [reply] [copy thread] stays at the bottom.
   */
  renderHandoffs(
    _from: string,
    handoffs: HandoffEnvelope[],
    threadId?: number,
    containerCtx?: HandoffContainerCtx,
  ): void {
    const t = theme();
    const names = this.view.listTeammates();
    const avail = (process.stdout.columns || 80) - 4;
    const boxW = Math.max(40, Math.round(avail * 0.6));
    const innerW = boxW - 4;

    // Use container-aware insert when inside a thread, global feedLine otherwise
    const emit = containerCtx
      ? (text?: string | StyledSpan) => containerCtx.insertLine(text ?? "")
      : (text?: string | StyledSpan) => this.view.feedLine(text);

    for (let i = 0; i < handoffs.length; i++) {
      const h = handoffs[i];
      const isValid = names.includes(h.to);
      const handoffId = `handoff-${Date.now()}-${i}`;
      const chrome = isValid ? t.accentDim : t.error;

      emit();
      const label = ` handoff → @${h.to} `;
      const topFill = Math.max(0, boxW - 2 - label.length);
      emit(
        this.view.makeSpan({
          text: `  ┌${label}${"─".repeat(topFill)}┐`,
          style: { fg: chrome },
        }),
      );

      for (const rawLine of h.task.split("\n")) {
        const wrapped =
          rawLine.length === 0 ? [""] : this.view.wordWrap(rawLine, innerW);
        for (const wl of wrapped) {
          const pad = Math.max(0, innerW - wl.length);
          emit(
            this.view.makeSpan(
              { text: "  │ ", style: { fg: chrome } },
              { text: wl + " ".repeat(pad), style: { fg: t.textMuted } },
              { text: " │", style: { fg: chrome } },
            ),
          );
        }
      }

      emit(
        this.view.makeSpan({
          text: `  └${"─".repeat(Math.max(0, boxW - 2))}┘`,
          style: { fg: chrome },
        }),
      );

      if (!isValid) {
        emit(tp.error(`  ✖  Unknown teammate: @${h.to}`));
      } else if (this.autoApproveHandoffs) {
        const entryId = this.view.makeQueueEntryId();
        this.view.taskQueue.push({
          id: entryId,
          type: "agent",
          teammate: h.to,
          task: h.task,
          threadId,
        });
        if (threadId != null) {
          const thread = this.view.getThread(threadId);
          if (thread) thread.pendingTasks.add(entryId);
        }
        emit(tp.muted("  automatically approved"));
        this.view.kickDrain();
      } else if (this.view.chatView) {
        const actions = [
          {
            id: `approve-${handoffId}`,
            normalStyle: this.view.makeSpan({
              text: "  [approve]",
              style: { fg: t.textDim },
            }),
            hoverStyle: this.view.makeSpan({
              text: "  [approve]",
              style: { fg: t.accent },
            }),
          },
          {
            id: `reject-${handoffId}`,
            normalStyle: this.view.makeSpan({
              text: " [reject]",
              style: { fg: t.textDim },
            }),
            hoverStyle: this.view.makeSpan({
              text: " [reject]",
              style: { fg: t.accent },
            }),
          },
        ];
        const actionIdx = containerCtx
          ? containerCtx.insertActions(actions)
          : (() => {
              const idx = this.view.chatView.feedLineCount;
              this.view.chatView.appendActionList(actions);
              return idx;
            })();
        this.pendingHandoffs.push({
          id: handoffId,
          envelope: h,
          approveIdx: actionIdx,
          rejectIdx: actionIdx,
          threadId,
        });
      }
    }

    this.showHandoffDropdown();
    this.view.refreshView();
  }

  /** Show/hide the handoff approval dropdown based on pending handoffs. */
  showHandoffDropdown(): void {
    if (!this.view.chatView) return;
    if (this.pendingHandoffs.length > 0) {
      const items: {
        label: string;
        description: string;
        completion: string;
      }[] = [];
      if (this.pendingHandoffs.length === 1) {
        items.push({
          label: "approve",
          description: `approve handoff to @${this.pendingHandoffs[0].envelope.to}`,
          completion: "/approve",
        });
      } else {
        items.push({
          label: "approve",
          description: `approve ${this.pendingHandoffs.length} handoffs`,
          completion: "/approve",
        });
      }
      items.push({
        label: "always approve",
        description: "auto-approve future handoffs",
        completion: "/always-approve",
      });
      if (this.pendingHandoffs.length === 1) {
        items.push({
          label: "reject",
          description: `reject handoff to @${this.pendingHandoffs[0].envelope.to}`,
          completion: "/reject",
        });
      } else {
        items.push({
          label: "reject",
          description: `reject ${this.pendingHandoffs.length} handoffs`,
          completion: "/reject",
        });
      }
      this.view.chatView.showDropdown(items);
    } else {
      this.view.chatView.hideDropdown();
    }
    this.view.refreshView();
  }

  /** Handle handoff approve/reject actions. */
  handleHandoffAction(actionId: string): void {
    const approveMatch = actionId.match(/^approve-(.+)$/);
    if (approveMatch) {
      const hId = approveMatch[1];
      const idx = this.pendingHandoffs.findIndex((h) => h.id === hId);
      if (idx >= 0 && this.view.chatView) {
        const h = this.pendingHandoffs.splice(idx, 1)[0];
        const entryId = this.view.makeQueueEntryId();
        this.view.taskQueue.push({
          id: entryId,
          type: "agent",
          teammate: h.envelope.to,
          task: h.envelope.task,
          threadId: h.threadId,
        });
        if (h.threadId != null) {
          const thread = this.view.getThread(h.threadId);
          if (thread) thread.pendingTasks.add(entryId);
        }
        this.view.chatView.updateFeedLine(
          h.approveIdx,
          this.view.makeSpan({
            text: "  approved",
            style: { fg: theme().success },
          }),
        );
        this.view.kickDrain();
        this.showHandoffDropdown();
      }
      return;
    }

    const rejectMatch = actionId.match(/^reject-(.+)$/);
    if (rejectMatch) {
      const hId = rejectMatch[1];
      const idx = this.pendingHandoffs.findIndex((h) => h.id === hId);
      if (idx >= 0 && this.view.chatView) {
        const h = this.pendingHandoffs.splice(idx, 1)[0];
        this.view.chatView.updateFeedLine(
          h.approveIdx,
          this.view.makeSpan({
            text: "  rejected",
            style: { fg: theme().error },
          }),
        );
        this.showHandoffDropdown();
      }
      return;
    }
  }

  /** Handle bulk handoff actions. */
  handleBulkHandoff(action: string): void {
    if (!this.view.chatView) return;
    const t = theme();
    const isApprove = action === "Approve all" || action === "Always approve";

    if (action === "Always approve") {
      this.autoApproveHandoffs = true;
    }

    for (const h of this.pendingHandoffs) {
      if (isApprove) {
        const entryId = this.view.makeQueueEntryId();
        this.view.taskQueue.push({
          id: entryId,
          type: "agent",
          teammate: h.envelope.to,
          task: h.envelope.task,
          threadId: h.threadId,
        });
        if (h.threadId != null) {
          const thread = this.view.getThread(h.threadId);
          if (thread) thread.pendingTasks.add(entryId);
        }
        const label =
          action === "Always approve"
            ? "  automatically approved"
            : "  approved";
        this.view.chatView.updateFeedLine(
          h.approveIdx,
          this.view.makeSpan({ text: label, style: { fg: t.success } }),
        );
      } else {
        this.view.chatView.updateFeedLine(
          h.approveIdx,
          this.view.makeSpan({ text: "  rejected", style: { fg: t.error } }),
        );
      }
    }
    this.pendingHandoffs = [];
    if (isApprove) this.view.kickDrain();
    this.showHandoffDropdown();
  }

  /**
   * Audit a task result for cross-folder writes.
   * Returns violating file paths (relative), or empty array if clean.
   */
  auditCrossFolderWrites(teammate: string, changedFiles: string[]): string[] {
    const tmPrefix = ".teammates/";
    const ownPrefix = `${tmPrefix}${teammate}/`;

    return changedFiles.filter((f) => {
      const normalized = f.replace(/\\/g, "/");
      if (!normalized.startsWith(tmPrefix)) return false;
      if (normalized.startsWith(ownPrefix)) return false;
      const subPath = normalized.slice(tmPrefix.length);
      if (subPath.startsWith("_")) return false;
      if (subPath.startsWith(".")) return false;
      if (!subPath.includes("/")) return false;
      return true;
    });
  }

  /** Show cross-folder violation warning with [revert] / [allow] actions. */
  showViolationWarning(teammate: string, violations: string[]): void {
    const t = theme();
    this.view.feedLine(
      tp.warning(`  ⚠  @${teammate} wrote to another teammate's folder:`),
    );
    for (const f of violations) {
      this.view.feedLine(tp.muted(`     ${f}`));
    }

    if (this.view.chatView) {
      const violationId = `violation-${Date.now()}`;
      const actionIdx = this.view.chatView.feedLineCount;
      this.view.chatView.appendActionList([
        {
          id: `revert-${violationId}`,
          normalStyle: this.view.makeSpan({
            text: "  [revert]",
            style: { fg: t.error },
          }),
          hoverStyle: this.view.makeSpan({
            text: "  [revert]",
            style: { fg: t.accent },
          }),
        },
        {
          id: `allow-${violationId}`,
          normalStyle: this.view.makeSpan({
            text: " [allow]",
            style: { fg: t.textDim },
          }),
          hoverStyle: this.view.makeSpan({
            text: " [allow]",
            style: { fg: t.accent },
          }),
        },
      ]);
      this.pendingViolations.push({
        id: violationId,
        teammate,
        files: violations,
        actionIdx,
      });
    }
  }

  /** Handle revert/allow actions for cross-folder violations. */
  handleViolationAction(actionId: string): void {
    const revertMatch = actionId.match(/^revert-(violation-.+)$/);
    if (revertMatch) {
      const vId = revertMatch[1];
      const idx = this.pendingViolations.findIndex((v) => v.id === vId);
      if (idx >= 0 && this.view.chatView) {
        const v = this.pendingViolations.splice(idx, 1)[0];
        for (const f of v.files) {
          try {
            execSync(`git checkout -- "${f}"`, {
              cwd: resolve(this.view.teammatesDir, ".."),
              stdio: "pipe",
            });
          } catch {
            try {
              execSync(`git rm -f "${f}"`, {
                cwd: resolve(this.view.teammatesDir, ".."),
                stdio: "pipe",
              });
            } catch {
              // Best effort
            }
          }
        }
        this.view.chatView.updateFeedLine(
          v.actionIdx,
          this.view.makeSpan({
            text: `  reverted ${v.files.length} file(s)`,
            style: { fg: theme().success },
          }),
        );
        this.view.refreshView();
      }
      return;
    }

    const allowMatch = actionId.match(/^allow-(violation-.+)$/);
    if (allowMatch) {
      const vId = allowMatch[1];
      const idx = this.pendingViolations.findIndex((v) => v.id === vId);
      if (idx >= 0 && this.view.chatView) {
        const v = this.pendingViolations.splice(idx, 1)[0];
        this.view.chatView.updateFeedLine(
          v.actionIdx,
          this.view.makeSpan({
            text: "  allowed",
            style: { fg: theme().textDim },
          }),
        );
        this.view.refreshView();
      }
      return;
    }
  }

  /** Reset all pending state. */
  clear(): void {
    this.pendingHandoffs = [];
    this.pendingViolations = [];
    this.autoApproveHandoffs = false;
  }
}
