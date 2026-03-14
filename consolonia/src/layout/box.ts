/**
 * Box container — a single-child wrapper with padding.
 *
 * The Box adds padding around its child during measure and arrange,
 * but produces no visual output of its own.
 */

import type { Size, Rect, Constraint } from './types.js';
import type { DrawingContext } from '../drawing/context.js';
import { Control, clampSize } from './control.js';

export interface BoxOptions {
  child?: Control;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  /** Shorthand: sets all four sides when the individual values are not given. */
  padding?: number;
}

export class Box extends Control {
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;

  constructor(options: BoxOptions = {}) {
    super();
    const p = options.padding ?? 0;
    this.paddingTop = options.paddingTop ?? p;
    this.paddingRight = options.paddingRight ?? p;
    this.paddingBottom = options.paddingBottom ?? p;
    this.paddingLeft = options.paddingLeft ?? p;

    if (options.child) {
      this.addChild(options.child);
    }
  }

  /** The single child, or null. */
  get child(): Control | null {
    return this.children.length > 0 ? this.children[0] : null;
  }

  set child(ctrl: Control | null) {
    // Remove existing child
    while (this.children.length > 0) {
      this.removeChild(this.children[0]);
    }
    if (ctrl) {
      this.addChild(ctrl);
    }
  }

  // ── Horizontal / vertical padding totals ──────────────────────────

  private get hPad(): number {
    return this.paddingLeft + this.paddingRight;
  }

  private get vPad(): number {
    return this.paddingTop + this.paddingBottom;
  }

  // ── Layout ────────────────────────────────────────────────────────

  override measure(constraint: Constraint): Size {
    const innerConstraint: Constraint = {
      minWidth: Math.max(0, constraint.minWidth - this.hPad),
      minHeight: Math.max(0, constraint.minHeight - this.vPad),
      maxWidth: Math.max(0, constraint.maxWidth - this.hPad),
      maxHeight: Math.max(0, constraint.maxHeight - this.vPad),
    };

    let childSize: Size = { width: 0, height: 0 };
    if (this.child && this.child.visible) {
      childSize = this.child.measure(innerConstraint);
    }

    const size = clampSize(
      {
        width: childSize.width + this.hPad,
        height: childSize.height + this.vPad,
      },
      constraint,
    );
    this.desiredSize = size;
    return size;
  }

  override arrange(rect: Rect): void {
    this.bounds = rect;

    if (this.child && this.child.visible) {
      const innerRect: Rect = {
        x: this.paddingLeft,
        y: this.paddingTop,
        width: Math.max(0, rect.width - this.hPad),
        height: Math.max(0, rect.height - this.vPad),
      };
      this.child.arrange(innerRect);
    }
  }

  // ── Render ────────────────────────────────────────────────────────

  render(ctx: DrawingContext): void {
    if (this.child && this.child.visible) {
      const child = this.child;
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
