/**
 * StyledText — text display widget that renders multi-styled lines.
 *
 * Unlike Text (which applies one TextStyle to the whole block), StyledText
 * accepts StyledSpan lines where each segment can have its own color,
 * bold, italic, etc.  Plain strings are also accepted and rendered with
 * a default style.
 *
 * Supports word wrapping, but wrapping is computed on the plain-text
 * representation and styles are carried across wrap boundaries.
 */
import { Control } from "../layout/control.js";
import { spanLength } from "../styled.js";
// ── Widget ───────────────────────────────────────────────────────
export class StyledText extends Control {
    _lines;
    _defaultStyle;
    _wrap;
    /** Cached wrapped lines from the last measure pass. */
    _wrapped = [];
    constructor(options = {}) {
        super();
        this._lines = options.lines ?? [];
        this._defaultStyle = options.defaultStyle ?? {};
        this._wrap = options.wrap ?? false;
    }
    // ── Properties ─────────────────────────────────────────────────
    get lines() {
        return this._lines;
    }
    set lines(value) {
        this._lines = value;
        this.invalidate();
    }
    get defaultStyle() {
        return this._defaultStyle;
    }
    set defaultStyle(value) {
        this._defaultStyle = value;
        this.invalidate();
    }
    get wrap() {
        return this._wrap;
    }
    set wrap(value) {
        if (this._wrap !== value) {
            this._wrap = value;
            this.invalidate();
        }
    }
    // ── Layout ─────────────────────────────────────────────────────
    measure(constraint) {
        if (this._lines.length === 0) {
            this._wrapped = [];
            return { width: 0, height: 0 };
        }
        if (!this._wrap) {
            this._wrapped = this._lines;
            const maxW = this._lines.reduce((max, line) => Math.max(max, lineLength(line)), 0);
            return {
                width: Math.min(maxW, constraint.maxWidth),
                height: Math.min(this._lines.length, constraint.maxHeight),
            };
        }
        // Word-wrap mode
        const maxW = constraint.maxWidth;
        if (maxW <= 0) {
            this._wrapped = [];
            return { width: 0, height: 0 };
        }
        const wrapped = [];
        for (const line of this._lines) {
            const sub = wrapStyledLine(line, maxW);
            wrapped.push(...sub);
        }
        this._wrapped = wrapped;
        const longestW = wrapped.reduce((max, line) => Math.max(max, lineLength(line)), 0);
        return {
            width: Math.min(longestW, constraint.maxWidth),
            height: Math.min(wrapped.length, constraint.maxHeight),
        };
    }
    render(ctx) {
        const bounds = this.bounds;
        if (!bounds || this._wrapped.length === 0)
            return;
        for (let i = 0; i < this._wrapped.length && i < bounds.height; i++) {
            const line = this._wrapped[i];
            if (typeof line === "string") {
                ctx.drawText(bounds.x, bounds.y + i, line, this._defaultStyle);
            }
            else {
                // Apply defaultStyle as fallback for segments without explicit colors
                const merged = line.map((seg) => ({
                    text: seg.text,
                    style: mergeStyles(this._defaultStyle, seg.style),
                }));
                ctx.drawStyledText(bounds.x, bounds.y + i, merged);
            }
        }
    }
}
// ── Helpers ──────────────────────────────────────────────────────
function lineLength(line) {
    if (typeof line === "string")
        return line.length;
    return spanLength(line);
}
/** Merge a default style with a segment's explicit style. */
function mergeStyles(base, over) {
    return {
        fg: over.fg ?? base.fg,
        bg: over.bg ?? base.bg,
        bold: over.bold ?? base.bold,
        italic: over.italic ?? base.italic,
        underline: over.underline ?? base.underline,
        strikethrough: over.strikethrough ?? base.strikethrough,
    };
}
/**
 * Wrap a styled line to fit within maxWidth.
 * For plain strings, standard word-wrap. For StyledSpans,
 * we wrap on the concatenated text and split segments at boundaries.
 */
function wrapStyledLine(line, maxWidth) {
    if (typeof line === "string") {
        return wrapPlainLine(line, maxWidth);
    }
    // Flatten to a stream of { char, style } for wrap calculation
    const chars = [];
    for (const seg of line) {
        for (const ch of seg.text) {
            chars.push({ char: ch, style: seg.style });
        }
    }
    if (chars.length <= maxWidth)
        return [line];
    // Simple hard-wrap at maxWidth (word-aware wrap is complex for styled text)
    const result = [];
    for (let start = 0; start < chars.length; start += maxWidth) {
        const slice = chars.slice(start, start + maxWidth);
        // Coalesce consecutive chars with same style into segments
        const segments = [];
        let cur = null;
        for (const { char, style } of slice) {
            if (cur && cur.style === style) {
                cur.text += char;
            }
            else {
                if (cur)
                    segments.push(cur);
                cur = { text: char, style };
            }
        }
        if (cur)
            segments.push(cur);
        result.push(segments);
    }
    return result;
}
function wrapPlainLine(text, maxWidth) {
    if (text.length <= maxWidth)
        return [text];
    const result = [];
    for (let i = 0; i < text.length; i += maxWidth) {
        result.push(text.slice(i, i + maxWidth));
    }
    return result;
}
