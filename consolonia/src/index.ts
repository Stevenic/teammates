/**
 * @teammates/consolonia — Terminal UI rendering engine for Node.js.
 *
 * A TypeScript port of Consolonia (.NET console UI framework).
 * Provides pixel-buffer rendering, raw input handling, layout engine,
 * and widgets for building interactive terminal applications.
 */

// ── Pixel types ─────────────────────────────────────────────────────

export {
  background,
  blendBackground,
  EMPTY_BACKGROUND,
  type PixelBackground,
} from "./pixel/background.js";

export {
  BOX_CHARS,
  BOX_NONE,
  type BoxPattern,
  boxChar,
  DOWN,
  LEFT,
  mergeBoxPatterns,
  RIGHT,
  UP,
} from "./pixel/box-pattern.js";
export { PixelBuffer } from "./pixel/buffer.js";
export {
  // Standard ANSI colors
  BLACK,
  // Bright ANSI colors
  BLACK_BRIGHT,
  BLUE,
  BLUE_BRIGHT,
  type Color,
  CYAN,
  CYAN_BRIGHT,
  color,
  colorBlend,
  colorBrighten,
  colorShade,
  DARK_GRAY,
  // Aliases
  GRAY,
  GREEN,
  GREEN_BRIGHT,
  GREY,
  LIGHT_GRAY,
  MAGENTA,
  MAGENTA_BRIGHT,
  RED,
  RED_BRIGHT,
  TRANSPARENT,
  WHITE,
  WHITE_BRIGHT,
  YELLOW,
  YELLOW_BRIGHT,
} from "./pixel/color.js";
export {
  blendForeground,
  EMPTY_FOREGROUND,
  foreground,
  type PixelForeground,
} from "./pixel/foreground.js";

export {
  blendPixel,
  PIXEL_EMPTY,
  PIXEL_SPACE,
  type Pixel,
  pixel,
} from "./pixel/pixel.js";
export {
  charWidth,
  EMPTY_SYMBOL,
  type Symbol,
  sym,
} from "./pixel/symbol.js";

// ── Layout types ────────────────────────────────────────────────────

export type {
  Constraint,
  Point,
  Rect,
  Size,
} from "./layout/types.js";

// ── ANSI output ─────────────────────────────────────────────────────

export * as esc from "./ansi/esc.js";
export { AnsiOutput } from "./ansi/output.js";
export {
  stripAnsi,
  truncateAnsi,
  visibleLength,
} from "./ansi/strip.js";

// ── Render pipeline ─────────────────────────────────────────────────

export { DirtyRegions, DirtySnapshot } from "./render/regions.js";
export { RenderTarget } from "./render/render-target.js";

// ── Input system ────────────────────────────────────────────────────

export { EscapeMatcher } from "./input/escape-matcher.js";
export type {
  InputEvent,
  KeyEvent,
  MouseEvent,
  PasteEvent,
} from "./input/events.js";
export {
  keyEvent,
  mouseEvent,
  pasteEvent,
  resizeEvent,
} from "./input/events.js";
export { type IMatcher, MatchResult } from "./input/matcher.js";
export { MouseMatcher } from "./input/mouse-matcher.js";
export { PasteMatcher } from "./input/paste-matcher.js";
export { createInputProcessor, InputProcessor } from "./input/processor.js";
export { disableRawMode, enableRawMode } from "./input/raw-mode.js";
export { TextMatcher } from "./input/text-matcher.js";

// ── Drawing context ─────────────────────────────────────────────────

export { ClipStack } from "./drawing/clip.js";
export {
  type BoxStyle,
  DrawingContext,
  type TextStyle,
} from "./drawing/context.js";

// ── Layout engine ───────────────────────────────────────────────────

export { Box, type BoxOptions } from "./layout/box.js";
export { Column, type ColumnOptions } from "./layout/column.js";
export { Control } from "./layout/control.js";
export { Row, type RowOptions } from "./layout/row.js";
export { Stack, type StackOptions } from "./layout/stack.js";

// ── Widgets ─────────────────────────────────────────────────────────

export { Border, type BorderOptions } from "./widgets/border.js";
export {
  ChatView,
  type ChatViewOptions,
  type DropdownItem,
  type FeedActionItem,
} from "./widgets/chat-view.js";
export { Panel, type PanelOptions } from "./widgets/panel.js";
export { ScrollView, type ScrollViewOptions } from "./widgets/scroll-view.js";
export {
  type StyledLine,
  StyledText,
  type StyledTextOptions,
} from "./widgets/styled-text.js";
export { Text, type TextOptions } from "./widgets/text.js";
export {
  type DeleteSizer,
  type InputColorizer,
  TextInput,
  type TextInputOptions,
} from "./widgets/text-input.js";

// ── Markdown ─────────────────────────────────────────────────────────

export {
  type MarkdownOptions,
  type MarkdownTheme,
  renderMarkdown,
} from "./widgets/markdown.js";

// ── Syntax highlighting ──────────────────────────────────────────────

export {
  DEFAULT_SYNTAX_THEME,
  getHighlighter,
  highlightLine,
  registerHighlighter,
  type SyntaxHighlighter,
  type SyntaxTheme,
  type SyntaxToken,
  type SyntaxTokenType,
} from "./widgets/syntax.js";

// ── Styled text (chalk-like API) ─────────────────────────────────────

export {
  concat,
  isStyledSpan,
  pen,
  type StyledSegment,
  type StyledSpan,
  spanLength,
  spanText,
} from "./styled.js";

// ── App shell ────────────────────────────────────────────────────────

export { App, type AppOptions } from "./app.js";
