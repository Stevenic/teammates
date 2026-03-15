/**
 * Panel = Border + background fill.
 *
 * Fills its entire bounds with a background color before drawing
 * the border and child, producing a filled, bordered container.
 */

import type { DrawingContext } from "../drawing/context.js";
import type { Color } from "../pixel/color.js";
import { TRANSPARENT } from "../pixel/color.js";
import { Border, type BorderOptions } from "./border.js";

export interface PanelOptions extends BorderOptions {
  background?: Color;
}

export class Panel extends Border {
  private _background: Color;

  constructor(options: PanelOptions = {}) {
    super(options);
    this._background = options.background ?? TRANSPARENT;
  }

  // ── Properties ────────────────────────────────────────────────

  get background(): Color {
    return this._background;
  }

  set background(value: Color) {
    this._background = value;
    this.invalidate();
  }

  // ── Render ────────────────────────────────────────────────────

  render(ctx: DrawingContext): void {
    const bounds = this.bounds;
    if (!bounds) return;

    // Fill the background first
    if (this._background.a > 0) {
      ctx.fillRect(bounds, this._background);
    }

    // Then draw the border and child
    super.render(ctx);
  }
}
