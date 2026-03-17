# S26 — MCP Passthrough

Spec for passing MCP (Model Context Protocol) server configurations through to agents that support them natively.

**Status:** Draft
**Owner:** Scribe (spec) → Beacon (implementation)
**Priority:** P0 — biggest agent capability unlock; agents with MCP can access databases, APIs, file systems, and custom tools

---

## Problem

MCP servers give AI agents access to external tools and data sources (databases, APIs, browsers, custom integrations). Claude Code, Codex, and other agents support MCP natively, but the teammates CLI has no way to configure or pass through MCP server definitions. Teammates currently can only interact with the local filesystem and shell.

## Design

### Configuration

MCP servers are defined in `.teammates/mcp.json` (project-level, checked in). This file describes available MCP servers and which teammates can access them.

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}"
      }
    },
    "postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres"],
      "env": {
        "DATABASE_URL": "${DATABASE_URL}"
      }
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/data"]
    }
  },
  "permissions": {
    "beacon": ["github", "postgres"],
    "scribe": ["github"],
    "pipeline": ["github"],
    "*": ["filesystem"]
  }
}
```

### Config Schema

#### `mcpServers` Object

Each key is a server name. Values:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `command` | string | Yes | Executable to launch the MCP server |
| `args` | string[] | No | Arguments passed to the command |
| `env` | Record<string, string> | No | Environment variables. `${VAR}` syntax expands from the process environment. |
| `url` | string | No | For remote MCP servers (SSE transport). Mutually exclusive with `command`. |
| `transport` | `"stdio"` \| `"sse"` | No | Transport type. Default: `"stdio"` for `command`, `"sse"` for `url`. |

#### `permissions` Object

Maps teammate names to arrays of allowed server names. `"*"` means all teammates. A teammate can only use servers listed in their permission entry (plus `"*"` entries). If `permissions` is omitted entirely, all teammates can use all servers.

### Environment Variable Expansion

Env vars in the `env` object use `${VAR}` syntax. The CLI expands these from `process.env` at startup. If a referenced variable is not set:
- **Warning** — log to debug: `MCP server "postgres" references unset env var DATABASE_URL`
- **Server still registered** — the agent may handle the missing credential itself, or the MCP server may fail at connection time

### Adapter Mapping

Each adapter maps the MCP config to its agent's native flags. This is the **Enhanced** tier — agents that don't support MCP get a warning, not an error.

#### Claude

Claude Code supports MCP natively via `--mcp-config`:

```bash
claude --mcp-config /tmp/teammates-mcp-{teammate}.json -p "task"
```

The adapter writes a temporary JSON file containing only the servers permitted for that teammate, in Claude's expected format:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "ghp_..." }
    }
  }
}
```

#### Codex

Codex supports MCP servers via `--mcp-server` flags (one per server):

```bash
codex --mcp-server "github:npx -y @modelcontextprotocol/server-github" "task"
```

The adapter maps each permitted server to a `--mcp-server` argument.

#### Agents Without MCP Support

For agents that don't support MCP (aider, etc.):
- No MCP flags are passed
- A one-time warning is logged: `Agent "aider" does not support MCP — servers will not be available for @<teammate>`
- The task still executes normally, just without MCP capabilities

### AgentPreset Extension

Add an optional `mcp` field to `AgentPreset`:

```typescript
export interface AgentPreset {
  // ... existing fields ...
  mcp?: {
    /** How this agent receives MCP config */
    mode: "config-file" | "cli-flags" | "none";
    /** Build MCP args for this agent. Only called if mode != "none". */
    buildMcpArgs?(servers: McpServerConfig[]): string[];
  };
}
```

This keeps the MCP mapping inside each preset, consistent with how `buildArgs` already works.

### New Types

```typescript
export interface McpServerConfig {
  name: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  transport?: "stdio" | "sse";
}

export interface McpConfig {
  mcpServers: Record<string, Omit<McpServerConfig, "name">>;
  permissions?: Record<string, string[]>;
}
```

### Lifecycle

1. **CLI startup** — Load `.teammates/mcp.json`, expand env vars, validate schema
2. **Pre-task** — Filter servers by teammate permissions → pass to adapter
3. **Adapter** — Map filtered servers to agent-native flags (preset's `mcp.buildMcpArgs`)
4. **Agent execution** — Agent spawns with MCP access
5. **Post-task** — Clean up any temp config files (e.g., Claude's `--mcp-config` JSON) in a `finally` block after `executeTask()`. This is per-task, not per-session — REPL sessions span many tasks, so waiting for `destroySession` would leak temp files.

### Validation

At startup, the CLI validates:
- `mcp.json` matches the expected schema
- All server names referenced in `permissions` exist in `mcpServers`
- All teammate names in `permissions` exist in the registry (warning, not error — allows pre-configuring for teammates not yet created)
- Env vars with `${...}` that reference unset variables generate warnings

## CLI Integration

### `/mcp` Command

| Subcommand | Description |
|------------|-------------|
| `/mcp` | List all configured MCP servers and which teammates can use them |
| `/mcp status` | Show server status (configured, env vars resolved/missing) |

### Adapter Flow Update

The adapter's task execution flow gains a new step between prompt hydration and agent spawn:

```
hydrate prompt → query recall → resolve MCP servers for teammate → build agent args → spawn
```

## Security Considerations

- **Env var secrets** — MCP config may contain API tokens. The expanded config (with resolved env vars) should only be written to temp files, never logged.
- **Permission scoping** — Not all teammates should access all servers. A documentation teammate doesn't need database access. The `permissions` field enforces this.
- **Temp file cleanup** — Config files written for Claude's `--mcp-config` must be deleted in a `finally` block after each `executeTask()` call, not in `destroySession`. Sessions persist across tasks in REPL mode.

## Documentation Updates (Scribe)

- Add "MCP Servers" section to PROTOCOL.md with config format and permission model
- Add `/mcp` to CLI README slash commands table
- Add "Configure MCP servers" recipe to cookbook
- Add MCP to ARCHITECTURE.md data flow
- Document per-agent support matrix in CLI README

## Implementation Notes (for Beacon)

- Load `mcp.json` alongside `services.json` in the orchestrator init phase
- Write a `resolveMcpForTeammate(name: string): McpServerConfig[]` function
- Claude preset: write temp file, add `--mcp-config` to args, clean up in `finally` block after each `executeTask()`
- Codex preset: map to `--mcp-server` flags (verify exact Codex MCP flag syntax)
- Add `mcp` field to `AgentPreset` interface in `cli-proxy.ts`

## Future Extensions (not in v1)

- **Dynamic MCP discovery** — scan `node_modules` for MCP server packages
- **Per-task MCP overrides** — `teammates -p "task" --mcp github,postgres`
- **MCP tool approval** — require user approval before agents use specific MCP tools
- **Shared MCP sessions** — multiple teammates share a long-running MCP server process
