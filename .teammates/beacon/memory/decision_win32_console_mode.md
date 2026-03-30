---
version: 0.7.1
name: Win32 Console Mode for Mouse Input
description: Windows requires SetConsoleMode Win32 API to disable Quick Edit Mode and enable mouse input — ANSI escape sequences alone are insufficient
type: project
---

# Win32 Console Mode for Mouse Input

On Windows, ANSI escape sequences (`?1000h`, `?1006h`, etc.) tell the terminal to *generate* mouse event sequences, but the Windows console input mode must also be configured via Win32 API for those events to be *delivered* to stdin.

**Why:** The external Consolonia project (C#/.NET) works on the same machine because it calls `SetConsoleMode()` with `ENABLE_MOUSE_INPUT | ENABLE_EXTENDED_FLAGS` and clears `ENABLE_QUICK_EDIT_MODE`. Node.js `setRawMode(true)` does NOT touch these flags. Quick Edit Mode intercepts mouse clicks for text selection, preventing them from reaching the application.

**How to apply:** Add a Win32 FFI call (via `koffi` or similar) to `app.ts` init on `process.platform === 'win32'` that disables Quick Edit Mode and enables mouse input before sending ANSI escape sequences. Restore original console mode on cleanup.

## Key Win32 Flags

| Flag | Value | Purpose |
|---|---|---|
| `ENABLE_MOUSE_INPUT` | `0x0010` | Deliver mouse events to input buffer |
| `ENABLE_QUICK_EDIT_MODE` | `0x0040` | Console captures mouse for text select (MUST disable) |
| `ENABLE_EXTENDED_FLAGS` | `0x0080` | Required when modifying Quick Edit or Insert Mode |

## Node.js Raw Mode (What It Does)

- Removes: `ENABLE_ECHO_INPUT | ENABLE_LINE_INPUT | ENABLE_PROCESSED_INPUT`
- Adds: `ENABLE_WINDOW_INPUT | ENABLE_VIRTUAL_TERMINAL_INPUT`
- Does NOT touch: `ENABLE_MOUSE_INPUT`, `ENABLE_QUICK_EDIT_MODE`, `ENABLE_EXTENDED_FLAGS`
