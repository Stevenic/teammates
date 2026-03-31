---
version: 0.7.3
name: Win32 mouse — pure ANSI, no SetConsoleMode
description: Consolonia creator confirmed ANSI escape sequences are the correct and more accurate approach for mouse tracking. Removed koffi/SetConsoleMode entirely.
type: feedback
---

# Mouse Input Strategy: Pure ANSI

## Decision

Use **ANSI DECSET escape sequences only** for mouse tracking. Do not call Win32 `SetConsoleMode()` via koffi or any FFI.

**Why:** The Consolonia creator (external project author) explicitly advised that ANSI codes are more accurate for mouse tracking. Our koffi/`SetConsoleMode` approach was manipulating console mode flags at the kernel32 layer, which likely interfered with how the terminal emulator (Windows Terminal, VS Code xterm.js) delivers VT mouse sequences through ConPTY.

**How to apply:** The ANSI sequences in `esc.ts` (`?1000h`, `?1003h`, `?1005h`, `?1006h`, `?1015h`, `?1016h`) are the single source of truth for mouse tracking. Do not add Win32 API calls for mouse. If mouse doesn't work, investigate the ANSI path — don't reach for native FFI.

## Background

The external C#/.NET Consolonia uses `ReadConsoleInput()` + `MOUSE_EVENT_RECORD` on Windows — a completely different input path. Node.js/libuv drops `MOUSE_EVENT` records from `ReadConsoleInputW`, so that path is not viable for us. The Win32 `SetConsoleMode` approach (clearing `ENABLE_QUICK_EDIT_MODE`, forcing `ENABLE_VIRTUAL_TERMINAL_INPUT`) was an attempt to work around this, but it was counterproductive — the Consolonia creator confirmed ANSI is the right approach.
