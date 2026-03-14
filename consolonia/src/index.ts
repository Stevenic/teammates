/**
 * @teammates/consolonia — Terminal UI rendering engine for Node.js.
 *
 * A TypeScript port of Consolonia (.NET console UI framework).
 * Provides pixel-buffer rendering, raw input handling, layout engine,
 * and widgets for building interactive terminal applications.
 */

// ── Pixel types ─────────────────────────────────────────────────────

export {
  type Color,
  color,
  colorBlend,
  colorBrighten,
  colorShade,
  TRANSPARENT,
  BLACK,
  WHITE,
  RED,
  GREEN,
  BLUE,
  YELLOW,
  CYAN,
  MAGENTA,
  GRAY,
  DARK_GRAY,
  LIGHT_GRAY,
} from "./pixel/color.js";

export {
  type BoxPattern,
  UP,
  RIGHT,
  DOWN,
  LEFT,
  BOX_NONE,
  BOX_CHARS,
  boxChar,
  mergeBoxPatterns,
} from "./pixel/box-pattern.js";

export {
  type Symbol,
  charWidth,
  sym,
  EMPTY_SYMBOL,
} from "./pixel/symbol.js";

export {
  type PixelForeground,
  foreground,
  blendForeground,
  EMPTY_FOREGROUND,
} from "./pixel/foreground.js";

export {
  type PixelBackground,
  background,
  blendBackground,
  EMPTY_BACKGROUND,
} from "./pixel/background.js";

export {
  type Pixel,
  pixel,
  blendPixel,
  PIXEL_EMPTY,
  PIXEL_SPACE,
} from "./pixel/pixel.js";

export { PixelBuffer } from "./pixel/buffer.js";

// ── Layout types ────────────────────────────────────────────────────

export {
  type Size,
  type Point,
  type Rect,
  type Constraint,
} from "./layout/types.js";

// ── ANSI output ─────────────────────────────────────────────────────

export * as esc from "./ansi/esc.js";

export {
  stripAnsi,
  visibleLength,
  truncateAnsi,
} from "./ansi/strip.js";

export { AnsiOutput } from "./ansi/output.js";

// ── Render pipeline ─────────────────────────────────────────────────

export { DirtyRegions, DirtySnapshot } from "./render/regions.js";
export { RenderTarget } from "./render/render-target.js";

// ── Input system ────────────────────────────────────────────────────

export type {
  KeyEvent,
  MouseEvent,
  PasteEvent,
  InputEvent,
} from "./input/events.js";

export {
  keyEvent,
  mouseEvent,
  pasteEvent,
  resizeEvent,
} from "./input/events.js";

export { enableRawMode, disableRawMode } from "./input/raw-mode.js";
export { MatchResult, type IMatcher } from "./input/matcher.js";
export { EscapeMatcher } from "./input/escape-matcher.js";
export { PasteMatcher } from "./input/paste-matcher.js";
export { MouseMatcher } from "./input/mouse-matcher.js";
export { TextMatcher } from "./input/text-matcher.js";
export { InputProcessor, createInputProcessor } from "./input/processor.js";

// ── Drawing context ─────────────────────────────────────────────────

export { ClipStack } from "./drawing/clip.js";
export { DrawingContext, type TextStyle, type BoxStyle } from "./drawing/context.js";

// ── Layout engine ───────────────────────────────────────────────────

export { Control } from "./layout/control.js";
export { Box, type BoxOptions } from "./layout/box.js";
export { Row, type RowOptions } from "./layout/row.js";
export { Column, type ColumnOptions } from "./layout/column.js";
export { Stack, type StackOptions } from "./layout/stack.js";

// ── Widgets ─────────────────────────────────────────────────────────

export { Text, type TextOptions } from "./widgets/text.js";
export { Border, type BorderOptions } from "./widgets/border.js";
export { Panel, type PanelOptions } from "./widgets/panel.js";
export { TextInput, type TextInputOptions } from "./widgets/text-input.js";
export { ScrollView, type ScrollViewOptions } from "./widgets/scroll-view.js";
export {
  ChatView,
  type ChatViewOptions,
  type DropdownItem,
} from "./widgets/chat-view.js";

// ── App shell ────────────────────────────────────────────────────────

export { App, type AppOptions } from "./app.js";
