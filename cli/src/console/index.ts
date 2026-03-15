/**
 * @teammates/console — reusable interactive console components for Node.js CLIs.
 *
 * Components:
 *   - InteractiveReadline: batteries-included REPL with paste handling + autocomplete
 *   - MutableOutput: writable stream that can be muted/unmuted
 *   - PasteHandler: detects and manages pasted text
 *   - Dropdown: renders content below the readline prompt
 *   - Wordwheel: autocomplete engine with keyboard navigation
 *   - ANSI helpers: re-exported from @teammates/consolonia + CLI-specific extras
 */

// ANSI helpers — consolonia re-exports + CLI-specific extras
export { stripAnsi, truncateAnsi, visibleLength } from "@teammates/consolonia";
export {
  cr,
  cursorDown,
  cursorHome,
  cursorToCol,
  cursorUp,
  eraseDown,
  eraseLine,
  eraseScreen,
  eraseToEnd,
} from "./ansi.js";
export { Dropdown } from "./dropdown.js";
export { type FileAttachment, FileDropHandler } from "./file-drop.js";
export {
  InteractiveReadline,
  type InteractiveReadlineOptions,
} from "./interactive-readline.js";
export { renderMarkdownTables } from "./markdown-table.js";
export { MutableOutput } from "./mutable-output.js";
export {
  PasteHandler,
  type PasteHandlerOptions,
  type PasteResult,
} from "./paste-handler.js";
export { PromptBox, type PromptBoxOptions } from "./prompt-box.js";
export { PromptInput, type PromptInputOptions } from "./prompt-input.js";
export {
  Wordwheel,
  type WordwheelItem,
  type WordwheelOptions,
} from "./wordwheel.js";
