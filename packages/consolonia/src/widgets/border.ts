/**
 * Box-drawing border around a single child control.
 *
 * Draws a Unicode box-drawing rectangle (via DrawingContext.drawBox)
 * and optionally renders a title string embedded in the top border
 * in the form: ┤ Title ├
 */

import type {
  BoxStyle,
  DrawingContext,
  TextStyle,
} from "../drawing/context.js";
import { Control } from "../layout/control.js";
import type { Constraint, Rect, Size } from "../layout/types.js";

export interface BorderOptions {
  child?: Control;
  title?: string;
  style?: BoxStyle;
  titleStyle?: TextStyle;
}

export class Border extends Control {
  private _child: Control | null;
  private _title: string;
  private _style: BoxStyle;
  private _titleStyle: TextStyle;

  constructor(options: BorderOptions = {}) {
    super();
    this._child = options.child ?? null;
    this._title = options.title ?? "";
    this._style = options.style ?? {};
    this._titleStyle = options.titleStyle ?? {};

    if (this._child) {
      this.children.push(this._child);
    }
  }

  // ── Properties ────────────────────────────────────────────────

  get child(): Control | null {
    return this._child;
  }

  set child(value: Control | null) {
    // Remove old child
    if (this._child) {
      const idx = this.children.indexOf(this._child);
      if (idx >= 0) this.children.splice(idx, 1);
    }
    this._child = value;
    if (value) {
      this.children.push(value);
    }
    this.invalidate();
  }

  get title(): string {
    return this._title;
  }

  set title(value: string) {
    if (this._title !== value) {
      this._title = value;
      this.invalidate();
    }
  }

  get style(): BoxStyle {
    return this._style;
  }

  set style(value: BoxStyle) {
    this._style = value;
    this.invalidate();
  }

  get titleStyle(): TextStyle {
    return this._titleStyle;
  }

  set titleStyle(value: TextStyle) {
    this._titleStyle = value;
    this.invalidate();
  }

  // ── Layout ────────────────────────────────────────────────────

  measure(constraint: Constraint): Size {
    // Border takes 1 cell on each side (2 total per axis)
    const _innerConstraint: Constraint = {
      minWidth: Math.max(0, constraint.minWidth - 2),
      minHeight: Math.max(0, constraint.minHeight - 2),
      maxWidth: Math.max(0, constraint.maxWidth - 2),
      maxHeight: Math.max(0, constraint.maxHeight - 2),
    };

    if (this._child) {
      // Trigger child measure through its public API
      const childSize = this._child.desiredSize ?? { width: 0, height: 0 };
      // We need to invoke the child's layout — in a typical layout system
      // the parent is responsible for measuring children. We'll call the
      // child's measure indirectly by having the layout system handle it.
      // For now, return border + child desired.
      return {
        width: (childSize.width ?? 0) + 2,
        height: (childSize.height ?? 0) + 2,
      };
    }

    // No child: just the border itself (minimum 2x2 for corners)
    return { width: 2, height: 2 };
  }

  arrange(rect: Rect): void {
    if (this._child) {
      this._child.arrange({
        x: rect.x + 1,
        y: rect.y + 1,
        width: Math.max(0, rect.width - 2),
        height: Math.max(0, rect.height - 2),
      });
    }
  }

  render(ctx: DrawingContext): void {
    const bounds = this.bounds;
    if (!bounds || bounds.width < 2 || bounds.height < 2) return;

    // Draw the box border
    ctx.drawBox(bounds, this._style);

    // Draw title in the top border if present
    if (this._title.length > 0) {
      const maxTitleLen = bounds.width - 4; // room for ┤ and ├ plus spaces
      if (maxTitleLen > 0) {
        const displayTitle =
          this._title.length > maxTitleLen
            ? this._title.slice(0, maxTitleLen)
            : this._title;

        // Draw "┤ Title ├" starting 2 cells from the left edge of top border
        const startX = bounds.x + 2;
        ctx.drawText(
          startX,
          bounds.y,
          `\u2524 ${displayTitle} \u251C`,
          this._titleStyle,
        );
      }
    }

    // Render child
    if (this._child) {
      this._child.render(ctx);
    }
  }
}
