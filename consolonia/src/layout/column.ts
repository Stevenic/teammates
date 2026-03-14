/**
 * Column — vertical layout container.
 *
 * Children are laid out top to bottom. If total desired heights exceed
 * the available height, children are proportionally scaled down.
 */

import type { Size, Rect, Constraint } from './types.js';
import type { DrawingContext } from '../drawing/context.js';
import { Control, clampSize } from './control.js';

export interface ColumnOptions {
  children?: Control[];
  /** Spacing in rows between adjacent children (default 0). */
  gap?: number;
}

export class Column extends Control {
  gap: number;

  constructor(options: ColumnOptions = {}) {
    super();
    this.gap = options.gap ?? 0;
    if (options.children) {
      for (const child of options.children) {
        this.addChild(child);
      }
    }
  }

  // ── Layout ────────────────────────────────────────────────────────

  override measure(constraint: Constraint): Size {
    const visible = this.children.filter(c => c.visible);
    if (visible.length === 0) {
      const size = clampSize({ width: 0, height: 0 }, constraint);
      this.desiredSize = size;
      return size;
    }

    const totalGap = this.gap * (visible.length - 1);
    let maxWidth = 0;
    let totalHeight = 0;

    for (const child of visible) {
      const childConstraint: Constraint = {
        minWidth: constraint.minWidth,
        minHeight: 0,
        maxWidth: constraint.maxWidth,
        maxHeight: Math.max(0, constraint.maxHeight - totalGap),
      };
      const childSize = child.measure(childConstraint);
      maxWidth = Math.max(maxWidth, childSize.width);
      totalHeight += childSize.height;
    }

    const size = clampSize(
      { width: maxWidth, height: totalHeight + totalGap },
      constraint,
    );
    this.desiredSize = size;
    return size;
  }

  override arrange(rect: Rect): void {
    this.bounds = rect;

    const visible = this.children.filter(c => c.visible);
    if (visible.length === 0) return;

    const totalGap = this.gap * (visible.length - 1);
    const availableHeight = Math.max(0, rect.height - totalGap);

    const totalDesired = visible.reduce((s, c) => s + c.desiredSize.height, 0);

    let y = 0;
    for (let i = 0; i < visible.length; i++) {
      const child = visible[i];
      let childHeight: number;

      if (totalDesired <= availableHeight || totalDesired === 0) {
        childHeight = child.desiredSize.height;
      } else {
        childHeight = Math.floor(
          (child.desiredSize.height / totalDesired) * availableHeight,
        );
      }

      child.arrange({
        x: 0,
        y,
        width: rect.width,
        height: childHeight,
      });

      y += childHeight + this.gap;
    }
  }

  // ── Render ────────────────────────────────────────────────────────

  render(ctx: DrawingContext): void {
    for (const child of this.children) {
      if (!child.visible) continue;
      ctx.pushClip({
        x: child.bounds.x,
        y: child.bounds.y,
        width: child.bounds.width,
        height: child.bounds.height,
      });
      ctx.pushTranslate(child.bounds.x, child.bounds.y);
      child.render(ctx);
      child.dirty = false;
      ctx.popTranslate();
      ctx.popClip();
    }
  }
}
