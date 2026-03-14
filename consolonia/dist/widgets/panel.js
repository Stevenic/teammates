/**
 * Panel = Border + background fill.
 *
 * Fills its entire bounds with a background color before drawing
 * the border and child, producing a filled, bordered container.
 */
import { Border } from "./border.js";
import { TRANSPARENT } from "../pixel/color.js";
export class Panel extends Border {
    _background;
    constructor(options = {}) {
        super(options);
        this._background = options.background ?? TRANSPARENT;
    }
    // ── Properties ────────────────────────────────────────────────
    get background() {
        return this._background;
    }
    set background(value) {
        this._background = value;
        this.invalidate();
    }
    // ── Render ────────────────────────────────────────────────────
    render(ctx) {
        const bounds = this.bounds;
        if (!bounds)
            return;
        // Fill the background first
        if (this._background.a > 0) {
            ctx.fillRect(bounds, this._background);
        }
        // Then draw the border and child
        super.render(ctx);
    }
}
