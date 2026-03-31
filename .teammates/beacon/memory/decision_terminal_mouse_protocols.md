---
version: 0.7.0
name: terminal_mouse_protocols
description: Consolonia should support both SGR and classic xterm mouse packets for clickable terminal actions.
type: decision
---
# Terminal Mouse Protocols

## Context
Clickable verbs in the terminal UI were working on one Windows machine but not another. The terminal setup already enabled mouse mode, but Consolonia's parser only accepted SGR mouse packets (`ESC [ < Cb ; Cx ; Cy M/m`).

## Decision
Support both mouse packet families in Consolonia:

- SGR mouse packets (`ESC [ < ...`) remain the preferred path.
- Classic xterm/ANSI mouse packets (`ESC [ M Cb Cx Cy`) are also decoded.
- Mouse mode enablement requests classic tracking (`?1000h`) in addition to the existing motion (`?1003h`) and SGR (`?1006h`) modes.

## Why
- Some terminals or terminal configurations fall back to classic mouse packets even when newer modes are requested.
- Parsing only SGR makes clickable actions appear dead even though mouse mode is technically enabled.
- Supporting both formats keeps the UI terminal-agnostic without changing higher-level widgets.

## Verification
- `npm run build` in `packages/consolonia`
- `npx vitest run src\__tests__\input.test.ts src\__tests__\ansi.test.ts` in `packages/consolonia`
