---
version: 0.7.0
name: terminal_mouse_sgr
description: ChatView clickable verbs depend on SGR mouse tracking support from the host terminal.
type: reference
---
# Terminal Mouse SGR

`@teammates/consolonia` enables mouse tracking in the app shell, but clickable action verbs only work when the terminal sends SGR mouse escape sequences.

## Facts

- `App` enables mouse tracking with `esc.mouseTrackingOn` when created with `mouse: true`.
- The CLI creates `App` with `mouse: true`.
- `MouseMatcher` only parses SGR extended mouse sequences in the form `\x1b[<Cb;Cx;CyM` / `m`.
- `ChatView` emits verb actions only when it receives parsed mouse press events on action lines.
- There is no fallback parser for older mouse protocols or for terminals that do not forward mouse events.

## Diagnostic implication

If one user can click `[reply]`, `[copy]`, `[show activity]`, etc. and another cannot on Windows, the first suspect is a terminal/environment mismatch:

- different terminal app or host
- terminal setting that disables or intercepts mouse reporting
- intermediary layer such as tmux/remote shell that does not pass SGR mouse events through
- text selection behavior taking precedence because no mouse event reaches ChatView
