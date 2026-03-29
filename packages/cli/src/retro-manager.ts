/**
 * Retro proposal parsing, rendering, and approval/rejection.
 */

import {
  type ChatView,
  type Color,
  concat,
  type StyledSpan,
} from "@teammates/consolonia";
import { theme, tp } from "./theme.js";
import type { QueueEntry, TaskResult } from "./types.js";

export interface RetroView {
  chatView: ChatView;
  feedLine(text?: string | StyledSpan): void;
  refreshView(): void;
  makeSpan(...segs: { text: string; style: { fg?: Color } }[]): StyledSpan;
  taskQueue: QueueEntry[];
  kickDrain(): void;
  hasPendingHandoffs(): boolean;
}

export interface PendingRetroProposal {
  id: string;
  teammate: string;
  index: number;
  title: string;
  section: string;
  before: string;
  after: string;
  why: string;
  actionIdx: number;
}

export class RetroManager {
  pendingRetroProposals: PendingRetroProposal[] = [];

  private view: RetroView;

  constructor(view: RetroView) {
    this.view = view;
  }

  /** Parse retro proposals from agent output and render approval UI. */
  handleRetroResult(result: TaskResult): void {
    const raw = result.rawOutput ?? "";
    const proposals = this.parseRetroProposals(raw);
    if (proposals.length === 0) return;

    const t = theme();
    const teammate = result.teammate;
    const retroId = `retro-${Date.now()}`;

    this.view.feedLine();
    this.view.feedLine(
      concat(
        tp.accent(
          `  ${proposals.length} SOUL.md proposal${proposals.length > 1 ? "s" : ""}`,
        ),
        tp.muted(" — approve or reject each:"),
      ),
    );

    for (let i = 0; i < proposals.length; i++) {
      const p = proposals[i];
      const pId = `${retroId}-${i}`;

      this.view.feedLine();
      this.view.feedLine(tp.text(`  Proposal ${i + 1}: ${p.title}`));
      this.view.feedLine(tp.muted(`    Section: ${p.section}`));
      if (p.before === "(new entry)") {
        this.view.feedLine(tp.muted("    Before: (new entry)"));
      } else {
        this.view.feedLine(tp.muted(`    Before: ${p.before}`));
      }
      this.view.feedLine(concat(tp.muted("    After: "), tp.text(p.after)));
      this.view.feedLine(tp.muted(`    Why: ${p.why}`));

      if (this.view.chatView) {
        const actionIdx = this.view.chatView.feedLineCount;
        this.view.chatView.appendActionList([
          {
            id: `retro-approve-${pId}`,
            normalStyle: this.view.makeSpan({
              text: "    [approve]",
              style: { fg: t.textDim },
            }),
            hoverStyle: this.view.makeSpan({
              text: "    [approve]",
              style: { fg: t.accent },
            }),
          },
          {
            id: `retro-reject-${pId}`,
            normalStyle: this.view.makeSpan({
              text: " [reject]",
              style: { fg: t.textDim },
            }),
            hoverStyle: this.view.makeSpan({
              text: " [reject]",
              style: { fg: t.accent },
            }),
          },
        ]);
        this.pendingRetroProposals.push({
          id: pId,
          teammate,
          index: i + 1,
          title: p.title,
          section: p.section,
          before: p.before,
          after: p.after,
          why: p.why,
          actionIdx,
        });
      }
    }

    this.view.feedLine();
    this.showRetroDropdown();
    this.view.refreshView();
  }

  /** Parse Proposal N blocks from retro output. */
  parseRetroProposals(text: string): {
    title: string;
    section: string;
    before: string;
    after: string;
    why: string;
  }[] {
    const proposals: {
      title: string;
      section: string;
      before: string;
      after: string;
      why: string;
    }[] = [];
    const proposalPattern = /\*\*Proposal\s+\d+[:.]\s*(.+?)\*\*/gi;
    let match: RegExpExecArray | null;
    const positions: { title: string; start: number }[] = [];
    while ((match = proposalPattern.exec(text)) !== null) {
      positions.push({ title: match[1].trim(), start: match.index });
    }

    for (let i = 0; i < positions.length; i++) {
      const end =
        i + 1 < positions.length ? positions[i + 1].start : text.length;
      const block = text.slice(positions[i].start, end);

      const section = this.extractField(block, "Section") || "Unknown";
      const before = this.extractField(block, "Before") || "(new entry)";
      const after = this.extractField(block, "After") || "";
      const why = this.extractField(block, "Why") || "";

      if (after) {
        proposals.push({
          title: positions[i].title,
          section,
          before,
          after,
          why,
        });
      }
    }
    return proposals;
  }

  /** Extract a **Field:** value from a proposal block. */
  private extractField(block: string, field: string): string {
    const pattern = new RegExp(
      `\\*\\*${field}:\\*\\*\\s*(.+?)(?=\\n\\s*[-*]\\s*\\*\\*|\\n\\s*\\n|$)`,
      "is",
    );
    const m = block.match(pattern);
    if (!m) return "";
    return m[1].trim().replace(/^`+|`+$/g, "");
  }

  /** Show/hide the retro approval dropdown based on pending proposals. */
  showRetroDropdown(): void {
    if (!this.view.chatView) return;
    if (
      this.pendingRetroProposals.length > 0 &&
      !this.view.hasPendingHandoffs()
    ) {
      const n = this.pendingRetroProposals.length;
      const items: {
        label: string;
        description: string;
        completion: string;
      }[] = [];
      items.push({
        label: "approve all",
        description: `approve ${n} SOUL.md proposal${n > 1 ? "s" : ""}`,
        completion: "/approve-retro",
      });
      items.push({
        label: "reject all",
        description: `reject ${n} SOUL.md proposal${n > 1 ? "s" : ""}`,
        completion: "/reject-retro",
      });
      this.view.chatView.showDropdown(items);
    } else if (!this.view.hasPendingHandoffs()) {
      this.view.chatView.hideDropdown();
    }
    this.view.refreshView();
  }

  /** Handle retro approve/reject actions (individual clicks). */
  handleRetroAction(actionId: string): void {
    const approveMatch = actionId.match(/^retro-approve-(.+)$/);
    if (approveMatch) {
      const pId = approveMatch[1];
      const idx = this.pendingRetroProposals.findIndex((p) => p.id === pId);
      if (idx >= 0 && this.view.chatView) {
        const p = this.pendingRetroProposals.splice(idx, 1)[0];
        this.view.chatView.updateFeedLine(
          p.actionIdx,
          this.view.makeSpan({
            text: "    approved",
            style: { fg: theme().success },
          }),
        );
        this.queueRetroApply(p.teammate, [p]);
        this.showRetroDropdown();
      }
      return;
    }
    const rejectMatch = actionId.match(/^retro-reject-(.+)$/);
    if (rejectMatch) {
      const pId = rejectMatch[1];
      const idx = this.pendingRetroProposals.findIndex((p) => p.id === pId);
      if (idx >= 0 && this.view.chatView) {
        const p = this.pendingRetroProposals.splice(idx, 1)[0];
        this.view.chatView.updateFeedLine(
          p.actionIdx,
          this.view.makeSpan({
            text: "    rejected",
            style: { fg: theme().error },
          }),
        );
        this.showRetroDropdown();
      }
      return;
    }
  }

  /** Handle bulk retro approve/reject. */
  handleBulkRetro(action: string): void {
    if (!this.view.chatView) return;
    const t = theme();
    const isApprove = action === "Approve all";
    const grouped = new Map<string, PendingRetroProposal[]>();

    for (const p of this.pendingRetroProposals) {
      if (isApprove) {
        this.view.chatView.updateFeedLine(
          p.actionIdx,
          this.view.makeSpan({
            text: "    approved",
            style: { fg: t.success },
          }),
        );
        const list = grouped.get(p.teammate) || [];
        list.push(p);
        grouped.set(p.teammate, list);
      } else {
        this.view.chatView.updateFeedLine(
          p.actionIdx,
          this.view.makeSpan({ text: "    rejected", style: { fg: t.error } }),
        );
      }
    }

    if (isApprove) {
      for (const [teammate, proposals] of grouped) {
        this.queueRetroApply(teammate, proposals);
      }
    }

    this.pendingRetroProposals = [];
    this.showRetroDropdown();
  }

  /** Queue a follow-up task for the teammate to apply approved SOUL.md changes. */
  queueRetroApply(teammate: string, proposals: PendingRetroProposal[]): void {
    const changes = proposals
      .map(
        (p) =>
          `- **Proposal ${p.index}: ${p.title}**\n  - Section: ${p.section}\n  - Before: ${p.before}\n  - After: ${p.after}`,
      )
      .join("\n\n");

    const applyPrompt = `The user approved the following SOUL.md changes from your retrospective. Apply them now.

**Edit your SOUL.md file** (\`.teammates/${teammate}/SOUL.md\`) to incorporate these changes:

${changes}

After editing SOUL.md, record a brief summary of the retro outcome in your daily log: which proposals were approved and what changed.

Do NOT modify any other teammate's files. Only edit your own SOUL.md and daily log.`;

    this.view.taskQueue.push({ type: "agent", teammate, task: applyPrompt });
    this.view.feedLine(
      concat(
        tp.muted("  Queued SOUL.md update for "),
        tp.accent(`@${teammate}`),
      ),
    );
    this.view.refreshView();
    this.view.kickDrain();
  }

  /** Reset all pending state. */
  clear(): void {
    this.pendingRetroProposals = [];
  }
}
