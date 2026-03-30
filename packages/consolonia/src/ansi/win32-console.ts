/**
 * Win32 Console Mode — enables mouse input on Windows terminals.
 *
 * Node.js `setRawMode(true)` enables ENABLE_VIRTUAL_TERMINAL_INPUT but
 * does NOT disable ENABLE_QUICK_EDIT_MODE (which intercepts mouse clicks
 * for text selection) or enable ENABLE_MOUSE_INPUT. This module uses
 * koffi to call the Win32 API directly and set the correct flags.
 *
 * Only loaded on win32 — no-ops on other platforms.
 */

import { createRequire } from "node:module";

// ── Console mode flag constants ─────────────────────────────────────

const ENABLE_PROCESSED_INPUT = 0x0001;
const ENABLE_LINE_INPUT = 0x0002;
const ENABLE_ECHO_INPUT = 0x0004;
const ENABLE_WINDOW_INPUT = 0x0008;
const ENABLE_MOUSE_INPUT = 0x0010;
const ENABLE_QUICK_EDIT_MODE = 0x0040;
const ENABLE_EXTENDED_FLAGS = 0x0080;
const ENABLE_VIRTUAL_TERMINAL_INPUT = 0x0200;

const STD_INPUT_HANDLE = -10;

// ── State ───────────────────────────────────────────────────────────

let originalMode: number | null = null;

// ── Lazy kernel32 binding ───────────────────────────────────────────

interface Kernel32 {
  GetStdHandle: (nStdHandle: number) => unknown;
  GetConsoleMode: (hConsole: unknown, lpMode: Buffer) => boolean;
  SetConsoleMode: (hConsole: unknown, dwMode: number) => boolean;
}

let _kernel32: Kernel32 | null | undefined;

function getKernel32(): Kernel32 | null {
  if (_kernel32 !== undefined) return _kernel32;

  try {
    // koffi is an optional native dependency — dynamic require so the
    // module loads cleanly even when koffi is absent.
    const require = createRequire(import.meta.url);
    const koffi = require("koffi");
    const lib = koffi.load("kernel32.dll");

    _kernel32 = {
      GetStdHandle: lib.func("void* __stdcall GetStdHandle(int nStdHandle)"),
      GetConsoleMode: lib.func(
        "bool __stdcall GetConsoleMode(void* hConsoleHandle, _Out_ uint32_t* lpMode)",
      ),
      SetConsoleMode: lib.func(
        "bool __stdcall SetConsoleMode(void* hConsoleHandle, uint32_t dwMode)",
      ),
    };
  } catch {
    _kernel32 = null;
  }

  return _kernel32;
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Configure the Windows console for mouse input.
 *
 * Disables Quick Edit Mode (which swallows mouse clicks) and enables
 * ENABLE_MOUSE_INPUT + ENABLE_EXTENDED_FLAGS + ENABLE_WINDOW_INPUT.
 * Saves the original mode so it can be restored later.
 *
 * No-op on non-Windows platforms or if koffi is not available.
 * Returns true if the mode was successfully changed.
 */
export function enableWin32Mouse(): boolean {
  if (process.platform !== "win32") return false;

  const k32 = getKernel32();
  if (!k32) return false;

  try {
    const handle = k32.GetStdHandle(STD_INPUT_HANDLE);
    if (!handle) return false;

    // Read current mode
    const modeBuffer = Buffer.alloc(4);
    if (!k32.GetConsoleMode(handle, modeBuffer)) return false;
    originalMode = modeBuffer.readUInt32LE(0);

    // Build new mode:
    // - Keep ENABLE_VIRTUAL_TERMINAL_INPUT (set by Node raw mode)
    // - Add ENABLE_MOUSE_INPUT + ENABLE_WINDOW_INPUT + ENABLE_EXTENDED_FLAGS
    // - Remove ENABLE_QUICK_EDIT_MODE
    // - Remove line/echo/processed (already cleared by raw mode)
    let newMode = originalMode;
    newMode |= ENABLE_MOUSE_INPUT;
    newMode |= ENABLE_WINDOW_INPUT;
    newMode |= ENABLE_EXTENDED_FLAGS;
    newMode &= ~ENABLE_QUICK_EDIT_MODE;
    newMode &= ~ENABLE_LINE_INPUT;
    newMode &= ~ENABLE_ECHO_INPUT;
    newMode &= ~ENABLE_PROCESSED_INPUT;
    // Preserve VT input if it was set
    if (originalMode & ENABLE_VIRTUAL_TERMINAL_INPUT) {
      newMode |= ENABLE_VIRTUAL_TERMINAL_INPUT;
    }

    return k32.SetConsoleMode(handle, newMode);
  } catch {
    return false;
  }
}

/**
 * Restore the original Windows console mode saved by enableWin32Mouse().
 *
 * No-op if enableWin32Mouse() was never called or failed.
 * Returns true if the mode was successfully restored.
 */
export function restoreWin32Console(): boolean {
  if (process.platform !== "win32" || originalMode === null) return false;

  const k32 = getKernel32();
  if (!k32) {
    originalMode = null;
    return false;
  }

  try {
    const handle = k32.GetStdHandle(STD_INPUT_HANDLE);
    if (!handle) {
      originalMode = null;
      return false;
    }

    const result = k32.SetConsoleMode(handle, originalMode);
    originalMode = null;
    return result;
  } catch {
    originalMode = null;
    return false;
  }
}
