/**
 * ThreadBar — 3-row tab bar widget with box-drawing characters.
 *
 * Renders a line-drawn tab interface between the banner and the feed.
 * The focused tab has a full box (┌─┐ top, │ │ sides) and connects
 * to the separator line with ┴ corners. Unfocused tabs sit inline.
 *
 * Layout (3 rows):
 *   Row 0:    ┌──────────────┐
 *   Row 1:  < │ Default [x]  │  Tab 2 [x]  [+]              >
 *   Row 2: ──-┴──────────────┴────────────────────────────────
 *
 * Always visible — even with a single tab. The [+] button is treated
 * as a virtual trailing tab for pagination. The < and > arrows are
 * always rendered: < is disabled when the first tab is visible, > is
 * disabled when the [+] is visible. At least one real tab is always
 * shown when paging.
 *
 * Events emitted:
 *   "switch"  (threadId: number)  — user clicked a tab
 *   "close"   (threadId: number)  — user clicked [x] on a tab
 *   "new"     ()                  — user clicked [+]
 */

import type { DrawingContext, TextStyle } from "../drawing/context.js";
import { Control } from "../layout/control.js";
import type { Constraint, Size } from "../layout/types.js";

// ── Types ──────────────────────────────────────────────────────────

export interface ThreadBarTab {
  id: number;
  name: string;
  focused: boolean;
  unread: boolean;
  working: boolean;
}

export interface ThreadBarStyles {
  /** Style for the focused (active) tab name. */
  focused: TextStyle;
  /** Style for an unfocused tab name. */
  normal: TextStyle;
  /** Style for the unread ● indicator. */
  unread: TextStyle;
  /** Style for the working ◎ indicator. */
  working: TextStyle;
  /** Style for the close [x] button. */
  close: TextStyle;
  /** Style for the [+] new-tab button and < > nav arrows. */
  add: TextStyle;
  /** Style for box-drawing characters (─ ┌ ┐ └ ┘) and the bottom line. */
  separator: TextStyle;
  /** Style for [x], [+], < > when hovered (accent color). */
  hover: TextStyle;
}

// ── ThreadBar ─────────────────────────────────────────────────────

export class ThreadBar extends Control {
  private _tabs: ThreadBarTab[] = [];
  private _styles: ThreadBarStyles;
  /** Hit regions for click handling (row 0 = top border, row 1 = content, row 2 = separator). */
  private _hitRegions: {
    startX: number;
    endX: number;
    row: number;
    type: "tab" | "close" | "add" | "prev" | "next";
    threadId?: number;
  }[] = [];
  /** First visible tab index for pagination. */
  private _pageStart = 0;
  /** Currently hovered region key (e.g. "close:3", "add", "prev", "next"). */
  private _hoveredKey: string | null = null;
  /** Id of the focused tab on the last setter call (used to detect focus change). */
  private _lastFocusedId: number | null = null;
  /** Set when the focused tab changes — consumed by render() to scroll it into view. */
  private _scrollToFocused = false;

  constructor(styles: ThreadBarStyles) {
    super();
    this._styles = styles;
    // Always visible — even with a single tab
    this.visible = true;
  }

  // ── Public API ──────────────────────────────────────────────────

  /** Update the tabs. Always visible regardless of count. */
  set tabs(tabs: ThreadBarTab[]) {
    this._tabs = tabs;
    // Clamp pageStart
    if (this._pageStart >= tabs.length) {
      this._pageStart = Math.max(0, tabs.length - 1);
    }
    // Scroll the focused tab into view only when it actually changes —
    // otherwise the user can't page past the focused tab with < / >.
    const focusedIdx = tabs.findIndex((t) => t.focused);
    const focusedId = focusedIdx >= 0 ? tabs[focusedIdx].id : null;
    if (focusedId !== this._lastFocusedId) {
      this._scrollToFocused = true;
      this._lastFocusedId = focusedId;
    }
    this.invalidate();
  }

  get tabs(): ThreadBarTab[] {
    return this._tabs;
  }

  // ── Layout ────────────────────────────────────────────────────

  override measure(constraint: Constraint): Size {
    this.desiredSize = { width: constraint.maxWidth, height: 3 };
    return this.desiredSize;
  }

  // ── Render ────────────────────────────────────────────────────

  override render(ctx: DrawingContext): void {
    const b = this.bounds;
    if (!b || !this.visible) return;

    const W = b.width;
    const y0 = b.y; // row 0: top border of focused tab
    const y1 = b.y + 1; // row 1: tab content
    const y2 = b.y + 2; // row 2: separator line
    this._hitRegions = [];

    // Clear all three rows
    ctx.drawText(b.x, y0, " ".repeat(W), this._styles.normal);
    ctx.drawText(b.x, y1, " ".repeat(W), this._styles.normal);
    ctx.drawText(b.x, y2, "─".repeat(W), this._styles.separator);

    // ── Calculate widths for pagination ──────────────────────────
    // The [+] button is treated as a virtual tab appended to the end.
    // Pagination: < and > are always visible; < is disabled at _pageStart 0,
    // > is disabled when the [+] is fully visible.

    const NAV_W = 3; // " < " or " > "
    const ADD_W = 3; // "[+]"
    const availWidth = W - NAV_W * 2; // space between arrows for tabs + [+]

    // Focused tab width: │ name [●|◎] [x]│ (box borders included)
    // Unfocused tab width: name [●|◎] [x]
    const tabWidths = this._tabs.map((tab) => {
      const name = this._truncateName(tab.name, 20);
      let w = name.length + 1 + 3; // name + " " + "[x]"
      if (tab.working || tab.unread) w += 2; // " ◎" or " ●"
      if (tab.focused) w += 3; // "│ " prefix + "│" suffix
      return w;
    });

    // Clamp _pageStart so at least one tab is visible (not just the [+])
    if (this._pageStart >= this._tabs.length) {
      this._pageStart = Math.max(0, this._tabs.length - 1);
    }

    // Ensure focused tab is in the visible range — only when focus changed,
    // so the user's manual < / > paging isn't constantly overridden.
    const focusedIdx = this._tabs.findIndex((t) => t.focused);
    if (
      this._scrollToFocused &&
      focusedIdx >= 0 &&
      focusedIdx < this._pageStart
    ) {
      this._pageStart = focusedIdx;
    }

    // Item list = [tab0, tab1, ..., tabN-1, ADD_SENTINEL]
    // _pageStart refers to tab indices (0..tabs.length-1). The [+] is
    // appended automatically when it fits after the last visible tab.
    const itemCount = this._tabs.length + 1; // +1 for [+]
    const itemWidth = (idx: number): number =>
      idx < this._tabs.length ? tabWidths[idx] : ADD_W;

    const fitFrom = (start: number): number => {
      let end = start;
      let used = 0;
      while (end < itemCount) {
        const gap = end > start ? 1 : 0;
        const needed = itemWidth(end) + gap;
        if (used + needed > availWidth) break;
        used += needed;
        end++;
      }
      // Always show at least one real tab
      if (end <= start && start < this._tabs.length) end = start + 1;
      return end;
    };

    let visEnd = fitFrom(this._pageStart);

    // If focused tab overflowed, pull _pageStart forward to include it —
    // but only when focus actually changed; otherwise the user can't page
    // forward past the focused tab with > .
    if (this._scrollToFocused && focusedIdx >= 0 && focusedIdx >= visEnd) {
      let newStart = focusedIdx;
      let fitWidth = tabWidths[focusedIdx];
      while (newStart > 0) {
        const prev = tabWidths[newStart - 1] + 1; // inter-tab gap
        if (fitWidth + prev > availWidth) break;
        fitWidth += prev;
        newStart--;
      }
      this._pageStart = newStart;
      visEnd = fitFrom(this._pageStart);
    }

    // One-shot flag — consumed by this render.
    this._scrollToFocused = false;

    // Enabled state for nav arrows
    const leftEnabled = this._pageStart > 0;
    const rightEnabled = visEnd < itemCount; // [+] not yet shown

    // ── Row 1: nav arrows + tabs + [+] ─────────────────────────

    let x = b.x;

    // Left nav " < " — always rendered, disabled style when at first page
    {
      const leftStyle = leftEnabled
        ? this._hoveredKey === "prev"
          ? this._styles.hover
          : this._styles.add
        : this._styles.separator;
      ctx.drawText(x, y1, " < ", leftStyle);
      if (leftEnabled) {
        this._hitRegions.push({
          startX: x,
          endX: x + NAV_W,
          row: 1,
          type: "prev",
        });
      }
    }
    x += NAV_W;

    // Track focused tab box positions for row 0 and row 2
    let focusBoxLeft = -1;
    let focusBoxRight = -1;

    // Render visible items on row 1 (tabs, then [+] if it fits on this page)
    for (let i = this._pageStart; i < visEnd; i++) {
      // Inter-item space
      if (i > this._pageStart) {
        ctx.drawText(x, y1, " ", this._styles.normal);
        x += 1;
      }

      if (i >= this._tabs.length) {
        // [+] sentinel
        const addStyle =
          this._hoveredKey === "add" ? this._styles.hover : this._styles.add;
        ctx.drawText(x, y1, "[+]", addStyle);
        this._hitRegions.push({
          startX: x,
          endX: x + ADD_W,
          row: 1,
          type: "add",
        });
        x += ADD_W;
        continue;
      }

      const tab = this._tabs[i];
      const name = this._truncateName(tab.name, 20);

      if (tab.focused) {
        // │ name [●|◎] [x]│
        focusBoxLeft = x;
        ctx.drawText(x, y1, "│ ", this._styles.separator);
        x += 2;

        const tabHitStart = x;
        ctx.drawText(x, y1, name, this._styles.focused);
        x += name.length;

        // Status indicator
        if (tab.working) {
          ctx.drawText(x, y1, " ◎", this._styles.working);
          x += 2;
        } else if (tab.unread) {
          ctx.drawText(x, y1, " ●", this._styles.unread);
          x += 2;
        }

        ctx.drawText(x, y1, " ", this._styles.normal);
        x += 1;

        // [x] close
        const closeStart = x;
        const closeKey = this._regionKey("close", tab.id);
        const closeStyle =
          this._hoveredKey === closeKey
            ? this._styles.hover
            : this._styles.close;
        ctx.drawText(x, y1, "[x]", closeStyle);
        x += 3;
        this._hitRegions.push({
          startX: closeStart,
          endX: x,
          row: 1,
          type: "close",
          threadId: tab.id,
        });

        ctx.drawText(x, y1, "│", this._styles.separator);
        focusBoxRight = x;
        x += 1;

        // Tab name hit region (from after │ to before [x])
        this._hitRegions.push({
          startX: tabHitStart,
          endX: closeStart,
          row: 1,
          type: "tab",
          threadId: tab.id,
        });
      } else {
        // name [●|◎] [x]
        const tabHitStart = x;
        const tabKey = this._regionKey("tab", tab.id);
        const tabNameStyle =
          this._hoveredKey === tabKey
            ? this._styles.hover
            : this._styles.normal;
        ctx.drawText(x, y1, name, tabNameStyle);
        x += name.length;

        // Status indicator
        if (tab.working) {
          ctx.drawText(x, y1, " ◎", this._styles.working);
          x += 2;
        } else if (tab.unread) {
          ctx.drawText(x, y1, " ●", this._styles.unread);
          x += 2;
        }

        ctx.drawText(x, y1, " ", this._styles.normal);
        x += 1;

        // [x] close
        const closeStart = x;
        const unfocusedCloseKey = this._regionKey("close", tab.id);
        const unfocusedCloseStyle =
          this._hoveredKey === unfocusedCloseKey
            ? this._styles.hover
            : this._styles.close;
        ctx.drawText(x, y1, "[x]", unfocusedCloseStyle);
        x += 3;
        this._hitRegions.push({
          startX: closeStart,
          endX: x,
          row: 1,
          type: "close",
          threadId: tab.id,
        });

        // Tab name hit region
        this._hitRegions.push({
          startX: tabHitStart,
          endX: closeStart,
          row: 1,
          type: "tab",
          threadId: tab.id,
        });
      }
    }

    // Right nav " > " — always rendered, disabled style when [+] is visible
    {
      const rightX = b.x + W - NAV_W;
      const rightStyle = rightEnabled
        ? this._hoveredKey === "next"
          ? this._styles.hover
          : this._styles.add
        : this._styles.separator;
      ctx.drawText(rightX, y1, " > ", rightStyle);
      if (rightEnabled) {
        this._hitRegions.push({
          startX: rightX,
          endX: rightX + NAV_W,
          row: 1,
          type: "next",
        });
      }
    }

    // ── Row 0: top border of focused tab ────────────────────────

    if (focusBoxLeft >= 0 && focusBoxRight >= 0) {
      ctx.drawText(focusBoxLeft, y0, "┌", this._styles.separator);
      const innerW = focusBoxRight - focusBoxLeft - 1;
      if (innerW > 0) {
        ctx.drawText(
          focusBoxLeft + 1,
          y0,
          "─".repeat(innerW),
          this._styles.separator,
        );
      }
      ctx.drawText(focusBoxRight, y0, "┐", this._styles.separator);
    }

    // ── Row 2: separator line with ┴ under focused tab corners ──

    if (focusBoxLeft >= 0 && focusBoxRight >= 0) {
      ctx.drawText(focusBoxLeft, y2, "┴", this._styles.separator);
      ctx.drawText(focusBoxRight, y2, "┴", this._styles.separator);
    }
  }

  /** Handle a mouse click at position (x, y relative to widget bounds). */
  handleClick(clickX: number, clickY?: number): boolean {
    const row = clickY ?? 0;
    for (const region of this._hitRegions) {
      if (clickY != null && region.row !== row) continue;
      if (clickX >= region.startX && clickX < region.endX) {
        switch (region.type) {
          case "close":
            if (region.threadId != null) this.emit("close", region.threadId);
            return true;
          case "tab":
            if (region.threadId != null) this.emit("switch", region.threadId);
            return true;
          case "add":
            this.emit("new");
            return true;
          case "prev":
            if (this._pageStart > 0) {
              this._pageStart--;
              this.invalidate();
            }
            return true;
          case "next":
            if (this._pageStart < Math.max(0, this._tabs.length - 1)) {
              this._pageStart++;
              this.invalidate();
            }
            return true;
        }
      }
    }
    return false;
  }

  /** Build a region key for hover tracking. */
  private _regionKey(
    type: string,
    threadId?: number,
  ): string {
    return threadId != null ? `${type}:${threadId}` : type;
  }

  /** Handle mouse move — update hover state for [x], [+], < >. */
  handleMouseMove(moveX: number, moveY?: number): boolean {
    const row = moveY ?? 0;
    let newKey: string | null = null;
    for (const region of this._hitRegions) {
      if (moveY != null && region.row !== row) continue;
      if (moveX >= region.startX && moveX < region.endX) {
        newKey = this._regionKey(region.type, region.threadId);
        break;
      }
    }
    if (newKey !== this._hoveredKey) {
      this._hoveredKey = newKey;
      this.invalidate();
      return true;
    }
    return false;
  }

  /** Clear hover state when mouse leaves the bar area. */
  handleMouseLeave(): void {
    if (this._hoveredKey) {
      this._hoveredKey = null;
      this.invalidate();
    }
  }

  /** Truncate a thread name to fit available width. */
  private _truncateName(name: string, maxLen: number): string {
    if (maxLen < 3) return "";
    if (name.length <= maxLen) return name;
    return `${name.slice(0, maxLen - 1)}…`;
  }
}
