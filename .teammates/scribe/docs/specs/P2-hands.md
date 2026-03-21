# P2 — Hands: Cross-Agent Computer Use

A cross-agent computer use capability exposing screenshot, click, type, and scroll tools via an MCP server. Any MCP-capable coding agent gets screen control without native computer use support.

**Status:** Spec
**Owner:** Scribe (spec) → Beacon (implementation) → Pipeline (CI testing)
**Priority:** P2
**Depends on:** S26 (MCP Passthrough) — Hands is an MCP server consumed through the existing MCP config system

---

## Problem

Computer use (screen capture, mouse control, keyboard input) is available natively in some agents (Claude) but not others. There's no cross-agent way to give a coding agent the ability to:

- Take a screenshot and reason about what's on screen
- Click UI elements at specific coordinates
- Type text into focused fields
- Scroll to navigate content

Without this, teammates that need to interact with GUIs (browsers, desktop apps, terminal UIs) are limited to agents with built-in computer use — breaking the framework's agent-agnostic principle.

---

## Design

### Core Insight

MCP is already the cross-agent tool bridge (S26). Computer use is just another MCP server — one that exposes screen control tools instead of database or API tools. Agents with native computer use get passthrough to their built-in capabilities. Agents with MCP but no native computer use get the MCP server. Agents with neither get graceful degradation.

### Three-Tier Model

| Tier | Agent Has | Behavior | Example |
|------|-----------|----------|---------|
| **Native** | Built-in computer use | Passthrough — use agent's native implementation | Claude with `computer_use` tool |
| **MCP** | MCP support, no native computer use | Launch `@teammates/hands` MCP server | Codex, future agents |
| **None** | Neither MCP nor computer use | Warning + skip — task runs without screen access | Aider, basic agents |

### Architecture

```
┌──────────────────────────────────────────────┐
│                  Coding Agent                 │
│  (Claude, Codex, Copilot, etc.)              │
├──────────────────────────────────────────────┤
│              MCP Client (built-in)            │
└────────────────────┬─────────────────────────┘
                     │ MCP protocol (stdio)
                     ▼
┌──────────────────────────────────────────────┐
│          @teammates/hands MCP Server          │
│                                              │
│  Tools:                                      │
│    screenshot()  → base64 PNG                │
│    click(x, y, button?)  → void              │
│    type(text)  → void                        │
│    scroll(x, y, direction, amount?)  → void  │
│    cursor_position()  → {x, y}               │
│    key(keys)  → void                         │
│                                              │
│  Platform adapters:                          │
│    Windows: Win32 API / PowerShell            │
│    macOS: CoreGraphics / AppleScript          │
│    Linux: xdotool / xclip                    │
├──────────────────────────────────────────────┤
│           Platform Abstraction Layer          │
│  (node-screenshots, robotjs, or nut.js)      │
└──────────────────────────────────────────────┘
```

---

## MCP Tool Schema

### `screenshot`

Capture the current screen (or a region).

```json
{
  "name": "screenshot",
  "description": "Capture a screenshot of the screen or a specific region. Returns a base64-encoded PNG image.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "region": {
        "type": "object",
        "description": "Optional region to capture. Omit for full screen.",
        "properties": {
          "x": { "type": "integer", "description": "Top-left X coordinate" },
          "y": { "type": "integer", "description": "Top-left Y coordinate" },
          "width": { "type": "integer", "description": "Region width in pixels" },
          "height": { "type": "integer", "description": "Region height in pixels" }
        },
        "required": ["x", "y", "width", "height"]
      },
      "display": {
        "type": "integer",
        "description": "Display index for multi-monitor setups. Default: 0 (primary)."
      }
    }
  }
}
```

**Returns:** `{ "image": "<base64 PNG>", "width": 1920, "height": 1080 }`

### `click`

Click at screen coordinates.

```json
{
  "name": "click",
  "description": "Click at the specified screen coordinates.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "x": { "type": "integer", "description": "X coordinate" },
      "y": { "type": "integer", "description": "Y coordinate" },
      "button": {
        "type": "string",
        "enum": ["left", "right", "middle"],
        "description": "Mouse button. Default: left."
      },
      "clicks": {
        "type": "integer",
        "description": "Number of clicks (1 = single, 2 = double). Default: 1."
      }
    },
    "required": ["x", "y"]
  }
}
```

**Returns:** `{ "success": true }`

### `type`

Type text into the currently focused element.

```json
{
  "name": "type",
  "description": "Type text into the currently focused element. Simulates keyboard input.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "text": {
        "type": "string",
        "description": "Text to type"
      },
      "delay_ms": {
        "type": "integer",
        "description": "Delay between keystrokes in milliseconds. Default: 0 (instant)."
      }
    },
    "required": ["text"]
  }
}
```

**Returns:** `{ "success": true }`

### `key`

Press keyboard keys (including modifiers and special keys).

```json
{
  "name": "key",
  "description": "Press a key or key combination. Supports modifiers (ctrl, alt, shift, meta) and special keys (enter, tab, escape, etc.).",
  "inputSchema": {
    "type": "object",
    "properties": {
      "keys": {
        "type": "string",
        "description": "Key expression. Examples: 'enter', 'ctrl+c', 'ctrl+shift+p', 'alt+tab'"
      }
    },
    "required": ["keys"]
  }
}
```

**Returns:** `{ "success": true }`

### `scroll`

Scroll at a screen position.

```json
{
  "name": "scroll",
  "description": "Scroll at the specified screen coordinates.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "x": { "type": "integer", "description": "X coordinate to scroll at" },
      "y": { "type": "integer", "description": "Y coordinate to scroll at" },
      "direction": {
        "type": "string",
        "enum": ["up", "down", "left", "right"],
        "description": "Scroll direction"
      },
      "amount": {
        "type": "integer",
        "description": "Scroll amount in 'clicks' (each click ≈ 3 lines). Default: 3."
      }
    },
    "required": ["x", "y", "direction"]
  }
}
```

**Returns:** `{ "success": true }`

### `cursor_position`

Get current mouse cursor position.

```json
{
  "name": "cursor_position",
  "description": "Get the current mouse cursor position on screen.",
  "inputSchema": {
    "type": "object",
    "properties": {}
  }
}
```

**Returns:** `{ "x": 500, "y": 300 }`

---

## Native Passthrough (Tier 1)

For agents with built-in computer use, the MCP server is unnecessary overhead. The adapter should detect native support and skip MCP server launch.

### Claude

Claude has native `computer_use` via the Anthropic API. When the CLI detects Claude as the agent:

- **If running through API** (future): pass `computer_use` tool definition directly
- **If running through Claude Code CLI** (current): Claude Code already supports computer use natively — no additional config needed. The user enables it via Claude Code's own settings.

### Detection

The `AgentPreset` gains a `capabilities` field (from S30):

```typescript
export interface AgentPreset {
  // ... existing fields ...
  capabilities?: {
    computerUse?: "native" | "mcp" | "none";
    mcp?: boolean;
  };
}
```

Adapter logic:
1. If `capabilities.computerUse === "native"` → do nothing, agent handles it
2. If `capabilities.mcp === true` → add `@teammates/hands` to MCP server list
3. Otherwise → log warning, skip computer use

---

## MCP Configuration

Hands plugs into the existing S26 MCP config system. Users add it to `.teammates/mcp.json`:

```json
{
  "mcpServers": {
    "hands": {
      "command": "npx",
      "args": ["-y", "@teammates/hands"]
    }
  },
  "permissions": {
    "*": ["hands"]
  }
}
```

Or for per-teammate access:

```json
{
  "permissions": {
    "beacon": ["hands"],
    "scribe": []
  }
}
```

### Auto-Registration (v1 Enhancement)

Since Hands is a first-party MCP server, the CLI can auto-register it without requiring manual `mcp.json` edits:

```bash
teammates --computer-use
```

This flag:
1. Adds `hands` to the MCP server list for the current session
2. Respects per-teammate permissions from `mcp.json` if present
3. Falls back to `"*": ["hands"]` if no permissions specified

---

## Package Structure

New package: `packages/hands/`

```
packages/hands/
  package.json
  tsconfig.json
  src/
    index.ts          ← MCP server entry point
    tools/
      screenshot.ts   ← screenshot tool implementation
      click.ts        ← click tool implementation
      type.ts         ← type tool implementation
      key.ts          ← key tool implementation
      scroll.ts       ← scroll tool implementation
      cursor.ts       ← cursor_position tool implementation
    platform/
      index.ts        ← platform detection + adapter selection
      windows.ts      ← Win32 implementation
      macos.ts        ← macOS implementation
      linux.ts        ← Linux/X11 implementation
  README.md
```

### Dependencies

| Package | Purpose | Platform |
|---------|---------|----------|
| `@anthropic-ai/sdk` or `@modelcontextprotocol/sdk` | MCP server framework | All |
| `screenshot-desktop` or `node-screenshots` | Screen capture | All (native bindings) |
| `@nut-tree/nut-js` | Mouse/keyboard control | All (native bindings) |

**Note:** Native dependencies (screen capture, input simulation) require platform-specific binaries. The package should use optional dependencies or conditional imports so installation doesn't fail on unsupported platforms.

---

## Work Allocation

### Scribe — Spec & Documentation

| Deliverable | Description | Status |
|-------------|-------------|--------|
| **This spec** | Full design, tool schemas, architecture | ✅ Done |
| **PROTOCOL.md update** | Add "Computer Use" section with tool descriptions and when to use them | Todo |
| **USER.md preference fields** | Add `computerUse: enabled/disabled` preference | Todo |
| **Cookbook recipe** | "Enable computer use for a teammate" recipe | Todo |
| **CLI README update** | Document `--computer-use` flag and MCP server | Todo |
| **Worked example** | Example task using screenshot → click → type flow | Todo |

### Beacon — Implementation

| Deliverable | Description | Priority |
|-------------|-------------|----------|
| **`packages/hands/` MCP server** | New package — MCP server with 6 tools | P0 |
| **Platform adapters** | Windows, macOS, Linux implementations for screenshot/click/type/scroll/key/cursor | P0 |
| **`--computer-use` CLI flag** | Auto-register Hands MCP server for session | P1 |
| **`capabilities` field on AgentPreset** | Support `computerUse` and `mcp` capability detection | P1 |
| **Native passthrough logic** | Skip MCP server for agents with native computer use | P1 |
| **`packages/hands/README.md`** | Package-level docs | P2 |

**Beacon dependency:** S26 (MCP Passthrough) must be implemented first. Hands is consumed through the MCP config system.

### Pipeline — CI & Testing

| Deliverable | Description | Priority |
|-------------|-------------|----------|
| **Build job for `packages/hands/`** | Add to monorepo CI matrix | P0 |
| **Platform test matrix** | Ensure native deps install on Windows, macOS, Linux runners | P1 |
| **Headless testing strategy** | Virtual framebuffer (Xvfb on Linux, headless on Windows) for CI screenshot tests | P1 |
| **Publish config** | npm publish setup for `@teammates/hands` | P2 |

**Pipeline note:** Native dependencies with platform binaries are the main CI risk. Prebuild binaries or conditional test skips may be needed for platforms without display servers.

---

## Security Considerations

- **Screen content exposure** — Screenshots may contain sensitive information (passwords, tokens, personal data). The MCP server should never log or cache screenshot content. Screenshots are returned directly to the agent and not persisted.
- **Input injection** — The type and click tools can interact with any application on the user's machine. This is powerful but dangerous. The CLI's permission system (S28) should gate computer use behind explicit user approval.
- **Headless environments** — In CI/CD (S17 non-interactive mode), computer use should be disabled by default. No screen = no computer use. The MCP server should fail gracefully with a clear error, not crash.
- **Multi-monitor** — The `display` parameter on `screenshot` handles multi-monitor setups. Click/type/scroll operate on the primary display unless coordinates map to another monitor.

---

## Implementation Phases

### Phase 1 — Core MCP Server
- `packages/hands/` with screenshot + click + type + scroll + key + cursor_position
- Windows platform adapter only (primary dev environment)
- Manual `mcp.json` registration
- **Ship criteria:** A Codex or Claude agent can take a screenshot and click a button via MCP

### Phase 2 — Cross-Platform + CLI Integration
- macOS and Linux platform adapters
- `--computer-use` CLI flag for auto-registration
- `capabilities` field on AgentPreset
- Native passthrough for Claude
- **Ship criteria:** Works on all 3 platforms, zero-config for supported agents

### Phase 3 — Polish
- Cookbook recipe and docs updates
- CI test matrix with virtual framebuffers
- npm publish as `@teammates/hands`
- USER.md preference for enabling/disabling
- **Ship criteria:** Published, documented, tested across platforms

---

## Open Questions

1. **nut.js vs robotjs vs native bindings** — nut.js is actively maintained and cross-platform but heavy. robotjs is lighter but maintenance has stalled. Need Beacon to evaluate library options for input simulation.
2. **Screenshot format** — Base64 PNG is simple but large. Should we support JPEG for smaller payloads? Or resize/downsample for token efficiency when the agent is reasoning about screen content?
3. **Coordinate systems** — Logical pixels vs physical pixels on HiDPI displays. The MCP server should normalize to logical coordinates and document the behavior.
4. **Rate limiting** — Should the MCP server throttle screenshot requests? An agent in a tight loop taking screenshots every 100ms could be expensive. A configurable minimum interval (default 500ms?) might be wise.

---

## Review Log

| Date | Reviewer | Status | Key Feedback |
|------|----------|--------|-------------|
| 2026-03-20 | Scribe | Spec written | Initial spec with full tool schemas and work allocation |
