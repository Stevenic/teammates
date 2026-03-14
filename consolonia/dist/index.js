/**
 * @teammates/consolonia — Terminal UI rendering engine for Node.js.
 *
 * A TypeScript port of Consolonia (.NET console UI framework).
 * Provides pixel-buffer rendering, raw input handling, layout engine,
 * and widgets for building interactive terminal applications.
 */
// ── Pixel types ─────────────────────────────────────────────────────
export { color, colorBlend, colorBrighten, colorShade, TRANSPARENT, BLACK, WHITE, RED, GREEN, BLUE, YELLOW, CYAN, MAGENTA, GRAY, DARK_GRAY, LIGHT_GRAY, } from "./pixel/color.js";
export { UP, RIGHT, DOWN, LEFT, BOX_NONE, BOX_CHARS, boxChar, mergeBoxPatterns, } from "./pixel/box-pattern.js";
export { charWidth, sym, EMPTY_SYMBOL, } from "./pixel/symbol.js";
export { foreground, blendForeground, EMPTY_FOREGROUND, } from "./pixel/foreground.js";
export { background, blendBackground, EMPTY_BACKGROUND, } from "./pixel/background.js";
export { pixel, blendPixel, PIXEL_EMPTY, PIXEL_SPACE, } from "./pixel/pixel.js";
export { PixelBuffer } from "./pixel/buffer.js";
// ── ANSI output ─────────────────────────────────────────────────────
export * as esc from "./ansi/esc.js";
export { stripAnsi, visibleLength, truncateAnsi, } from "./ansi/strip.js";
export { AnsiOutput } from "./ansi/output.js";
// ── Render pipeline ─────────────────────────────────────────────────
export { DirtyRegions, DirtySnapshot } from "./render/regions.js";
export { RenderTarget } from "./render/render-target.js";
export { keyEvent, mouseEvent, pasteEvent, resizeEvent, } from "./input/events.js";
export { enableRawMode, disableRawMode } from "./input/raw-mode.js";
export { MatchResult } from "./input/matcher.js";
export { EscapeMatcher } from "./input/escape-matcher.js";
export { PasteMatcher } from "./input/paste-matcher.js";
export { MouseMatcher } from "./input/mouse-matcher.js";
export { TextMatcher } from "./input/text-matcher.js";
export { InputProcessor, createInputProcessor } from "./input/processor.js";
// ── Drawing context ─────────────────────────────────────────────────
export { ClipStack } from "./drawing/clip.js";
export { DrawingContext } from "./drawing/context.js";
// ── Layout engine ───────────────────────────────────────────────────
export { Control } from "./layout/control.js";
export { Box } from "./layout/box.js";
export { Row } from "./layout/row.js";
export { Column } from "./layout/column.js";
export { Stack } from "./layout/stack.js";
// ── Widgets ─────────────────────────────────────────────────────────
export { Text } from "./widgets/text.js";
export { Border } from "./widgets/border.js";
export { Panel } from "./widgets/panel.js";
export { TextInput } from "./widgets/text-input.js";
export { ScrollView } from "./widgets/scroll-view.js";
// ── App shell ────────────────────────────────────────────────────────
export { App } from "./app.js";
