/**
 * @teammates/console — reusable interactive console components for Node.js CLIs.
 *
 * Components:
 *   - InteractiveReadline: batteries-included REPL with paste handling + autocomplete
 *   - MutableOutput: writable stream that can be muted/unmuted
 *   - PasteHandler: detects and manages pasted text
 *   - Dropdown: renders content below the readline prompt
 *   - Wordwheel: autocomplete engine with keyboard navigation
 *   - ANSI helpers: cursor movement, line erasure, color stripping
 */

export { InteractiveReadline, type InteractiveReadlineOptions } from "./interactive-readline.js";
export { MutableOutput } from "./mutable-output.js";
export { PasteHandler, type PasteResult, type PasteHandlerOptions } from "./paste-handler.js";
export { FileDropHandler, type FileAttachment } from "./file-drop.js";
export { Dropdown } from "./dropdown.js";
export { PromptBox, type PromptBoxOptions } from "./prompt-box.js";
export { PromptInput, type PromptInputOptions } from "./prompt-input.js";
export { Wordwheel, type WordwheelItem, type WordwheelOptions } from "./wordwheel.js";
export { renderMarkdownTables } from "./markdown-table.js";
export {
  cursorUp,
  cursorDown,
  cursorToCol,
  eraseLine,
  eraseToEnd,
  eraseDown,
  eraseScreen,
  cursorHome,
  cr,
  stripAnsi,
  visibleLength,
  truncateAnsi,
} from "./ansi.js";
