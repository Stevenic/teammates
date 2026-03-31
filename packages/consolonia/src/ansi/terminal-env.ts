/**
 * Terminal environment detection.
 *
 * Probes environment variables and process state to determine which
 * terminal capabilities are available. Used by App to send only the
 * escape sequences the host terminal actually supports.
 */

// ── Capability flags ────────────────────────────────────────────────

export interface TerminalCaps {
  /** Terminal is a TTY (not piped). */
  isTTY: boolean;
  /** Supports alternate screen buffer (?1049h). */
  alternateScreen: boolean;
  /** Supports bracketed paste mode (?2004h). */
  bracketedPaste: boolean;
  /** Supports escape-based mouse tracking (?1000h and above). */
  mouse: boolean;
  /** Supports SGR extended mouse encoding (?1006h). */
  sgrMouse: boolean;
  /** Supports truecolor (24-bit) SGR sequences. */
  truecolor: boolean;
  /** Supports 256-color SGR sequences. */
  color256: boolean;
  /** Detected terminal name (for diagnostics). */
  name: string;
}

// ── Detection ───────────────────────────────────────────────────────

/**
 * Detect terminal capabilities from the current environment.
 *
 * On Windows the main differentiator is whether we're running under
 * Windows Terminal / ConPTY (full VT support) or legacy conhost
 * (very limited escape handling). On Unix the TERM variable and
 * TERM_PROGRAM give us enough signal.
 */
export function detectTerminal(): TerminalCaps {
  const env = process.env;
  const isTTY = !!process.stdout.isTTY;

  if (!isTTY) {
    return {
      isTTY: false,
      alternateScreen: false,
      bracketedPaste: false,
      mouse: false,
      sgrMouse: false,
      truecolor: false,
      color256: false,
      name: "pipe",
    };
  }

  // ── Windows ─────────────────────────────────────────────────────

  if (process.platform === "win32") {
    // Windows Terminal sets WT_SESSION
    if (env.WT_SESSION) {
      return {
        isTTY: true,
        alternateScreen: true,
        bracketedPaste: true,
        mouse: true,
        sgrMouse: true,
        truecolor: true,
        color256: true,
        name: "windows-terminal",
      };
    }

    // VS Code's integrated terminal (xterm.js)
    if (env.TERM_PROGRAM === "vscode") {
      return {
        isTTY: true,
        alternateScreen: true,
        bracketedPaste: true,
        mouse: true,
        sgrMouse: true,
        truecolor: true,
        color256: true,
        name: "vscode",
      };
    }

    // ConEmu / Cmder
    if (env.ConEmuPID) {
      return {
        isTTY: true,
        alternateScreen: true,
        bracketedPaste: true,
        mouse: true,
        sgrMouse: true,
        truecolor: true,
        color256: true,
        name: "conemu",
      };
    }

    // Mintty (Git Bash) — sets TERM=xterm*
    if (env.TERM?.startsWith("xterm") && env.MSYSTEM) {
      return {
        isTTY: true,
        alternateScreen: true,
        bracketedPaste: true,
        mouse: true,
        sgrMouse: true,
        truecolor: true,
        color256: true,
        name: "mintty",
      };
    }

    // Fallback: modern Windows 10+ conhost with ConPTY has decent VT
    // support, but mouse tracking can be unreliable. Enable everything
    // and let the terminal silently ignore what it doesn't support.
    return {
      isTTY: true,
      alternateScreen: true,
      bracketedPaste: true,
      mouse: true,
      sgrMouse: true,
      truecolor: true,
      color256: true,
      name: "conhost",
    };
  }

  // ── Unix / macOS ────────────────────────────────────────────────

  const term = env.TERM ?? "";
  const termProgram = env.TERM_PROGRAM ?? "";

  // tmux — full VT support, passes through SGR mouse
  if (env.TMUX || term.startsWith("tmux") || term === "screen-256color") {
    return {
      isTTY: true,
      alternateScreen: true,
      bracketedPaste: true,
      mouse: true,
      sgrMouse: true,
      truecolor: !!env.COLORTERM || term.includes("256color"),
      color256: true,
      name: "tmux",
    };
  }

  // GNU screen — limited mouse support, no SGR
  if (term === "screen" && !env.TMUX) {
    return {
      isTTY: true,
      alternateScreen: true,
      bracketedPaste: false,
      mouse: true,
      sgrMouse: false,
      truecolor: false,
      color256: false,
      name: "screen",
    };
  }

  // iTerm2
  if (termProgram === "iTerm.app" || env.ITERM_SESSION_ID) {
    return {
      isTTY: true,
      alternateScreen: true,
      bracketedPaste: true,
      mouse: true,
      sgrMouse: true,
      truecolor: true,
      color256: true,
      name: "iterm2",
    };
  }

  // VS Code integrated terminal (macOS/Linux)
  if (termProgram === "vscode") {
    return {
      isTTY: true,
      alternateScreen: true,
      bracketedPaste: true,
      mouse: true,
      sgrMouse: true,
      truecolor: true,
      color256: true,
      name: "vscode",
    };
  }

  // Alacritty
  if (termProgram === "Alacritty" || term === "alacritty") {
    return {
      isTTY: true,
      alternateScreen: true,
      bracketedPaste: true,
      mouse: true,
      sgrMouse: true,
      truecolor: true,
      color256: true,
      name: "alacritty",
    };
  }

  // xterm-compatible (most Linux/macOS terminals)
  if (term.startsWith("xterm") || term.includes("256color")) {
    const hasTruecolor =
      env.COLORTERM === "truecolor" || env.COLORTERM === "24bit";
    return {
      isTTY: true,
      alternateScreen: true,
      bracketedPaste: true,
      mouse: true,
      sgrMouse: true,
      truecolor: hasTruecolor,
      color256: true,
      name: term,
    };
  }

  // Dumb terminal — absolute minimum
  if (term === "dumb" || !term) {
    return {
      isTTY: true,
      alternateScreen: false,
      bracketedPaste: false,
      mouse: false,
      sgrMouse: false,
      truecolor: false,
      color256: false,
      name: term || "unknown",
    };
  }

  // Unknown but it is a TTY — enable common capabilities
  return {
    isTTY: true,
    alternateScreen: true,
    bracketedPaste: true,
    mouse: true,
    sgrMouse: false,
    truecolor: false,
    color256: true,
    name: term,
  };
}
