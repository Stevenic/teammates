# @teammates/cli

> Part of the [teammates](https://github.com/Stevenic/teammates) monorepo.

Agent-agnostic CLI orchestrator for teammates. Routes tasks to teammates, manages handoffs, and plugs into any coding agent backend.

## Quick Start

```bash
cd cli
npm install
npm run build
```

Then launch a session with your preferred agent:

```bash
teammates claude       # Claude Code
teammates codex        # OpenAI Codex
teammates aider        # Aider
teammates echo         # Test adapter (no external agent)
```

The CLI auto-discovers your `.teammates/` directory by walking up from the current working directory.

## Usage

```
teammates <agent> [options] [-- agent-flags...]
```

### Options

| Flag | Description |
|---|---|
| `--model <model>` | Override the agent's model |
| `--dir <path>` | Override `.teammates/` directory location |
| `--help` | Show usage information |

Any arguments after the agent name are passed through to the underlying agent CLI.

## In-Session Commands

Once inside the REPL, you can interact with teammates using `@mentions`, `/commands`, or bare text (auto-routed).

### Task Assignment

| Input | Behavior |
|---|---|
| `@beacon fix the search index` | Assign directly to a teammate |
| `fix the search index` | Auto-route to the best teammate based on keywords |
| `/route fix the search index` | Explicitly auto-route |

### Slash Commands

| Command | Aliases | Description |
|---|---|---|
| `/status` | `/s`, `/queue`, `/qu` | Show teammates, active tasks, and queue |
| `/log [teammate]` | `/l` | Show the last task result (optionally for a specific teammate) |
| `/debug [teammate]` | `/raw` | Show raw agent output from the last task |
| `/cancel <n>` | | Cancel a queued task by number |
| `/init` | `/onboard`, `/setup` | Run onboarding to set up teammates for this project |
| `/install <service>` | | Install a teammates service (e.g. `recall`) |
| `/compact [teammate]` | | Compact daily logs into weekly/monthly summaries |
| `/retro [teammate]` | | Run a structured self-retrospective for a teammate |
| `/copy` | `/cp` | Copy the last response to clipboard |
| `/theme` | | Show current theme colors |
| `/clear` | `/cls`, `/reset` | Clear history and reset the session |
| `/help` | `/h`, `/?` | Show available commands |
| `/exit` | `/q`, `/quit` | Exit the session |

### Autocomplete

- Type `/` to see a command wordwheel — arrow keys to navigate, `Tab` to accept
- Type `@` anywhere in a line to autocomplete teammate names
- Command arguments that take teammate names also autocomplete (e.g. `/log b` → `/log beacon`)

## Task Queue

Queue multiple tasks to run sequentially in the background while the REPL stays responsive:

```
/queue @beacon update the search index
/queue @scribe update the onboarding docs
/queue                    # show queue status
/cancel 2                 # cancel a queued task
```

Queued tasks drain one at a time. If a handoff requires approval, the queue pauses until you respond.

## Handoffs

Teammates propose handoffs by including fenced handoff blocks in their response:

````
```handoff
@beacon
Update the search index to support the new memory format
```
````

Multiple handoff blocks can appear anywhere in a single response. The CLI detects them automatically and presents each one with an approval menu:

```
  1) Approve          — execute the handoff
  2) Always approve   — auto-approve all future handoffs this session
  3) Reject           — decline the handoff
```

Each handoff is approved individually — there is no automatic chaining.

## Conversation History

The CLI maintains a rolling conversation history (last 10 exchanges) that is passed as context to each task. This lets teammates reference prior work in the session without re-reading files.

## Agent Adapters

The CLI uses a generic adapter interface to support any coding agent. Each adapter spawns the agent as a subprocess and streams its output.

### Built-in Presets

| Preset | Command | Notes |
|---|---|---|
| `claude` | `claude -p --verbose` | Requires `claude` on PATH |
| `codex` | `codex exec` | Requires `codex` on PATH |
| `aider` | `aider --message-file` | Requires `aider` on PATH |
| `echo` | (in-process) | Test adapter — echoes prompts, no external agent |

### How Adapters Work

1. The adapter queries the recall index for relevant memories (automatic, in-process)
2. The orchestrator builds a full prompt within a 32k token budget (SOUL → WISDOM → recall results → daily logs (budget-trimmed) → session state → roster → task)
3. The prompt is written to a temp file
4. The agent CLI is spawned with the prompt
5. stdout/stderr are captured for result parsing
6. The output is parsed for embedded handoff blocks
7. The recall index is synced to pick up any files the agent created/modified
8. Temp files are cleaned up

### Writing a Custom Adapter

Implement the `AgentAdapter` interface:

```typescript
import type { AgentAdapter } from "./adapter.js";
import type { TeammateConfig, TaskResult } from "./types.js";

class MyAdapter implements AgentAdapter {
  readonly name = "my-agent";

  async startSession(teammate: TeammateConfig): Promise<string> {
    return `my-agent-${teammate.name}`;
  }

  async executeTask(
    sessionId: string,
    teammate: TeammateConfig,
    prompt: string
  ): Promise<TaskResult> {
    // Call your agent and return results
  }
}
```

Or add a preset to `cli-proxy.ts` for any CLI agent that accepts a prompt and runs to completion.

## Architecture

```
cli/src/
  cli.ts            # Entry point, REPL, slash commands, wordwheel UI
  orchestrator.ts   # Task routing, session management
  adapter.ts        # AgentAdapter interface, prompt builder, handoff formatting
  registry.ts       # Discovers teammates from .teammates/, loads SOUL.md + memory
  types.ts          # Core types (TeammateConfig, TaskResult, HandoffEnvelope)
  dropdown.ts       # Terminal dropdown/wordwheel widget
  adapters/
    cli-proxy.ts    # Generic subprocess adapter with agent presets
    echo.ts         # Test adapter (no-op)
```

### Output Protocol

Agents format their response as a markdown message with a `# Subject` line. Handoffs are embedded as fenced code blocks:

````
```handoff
@<teammate>
<task description with full context>
```
````

The CLI parses all `` ```handoff `` fences in the output. Multiple handoff blocks are supported in a single response. Each is presented to the user for individual approval.

## Testing

Run the test suite:

```bash
cd cli
npm test
```

Run tests in watch mode during development:

```bash
npm run test:watch
```

Tests use [Vitest](https://vitest.dev/) and cover the core modules:

| File | Covers |
|---|---|
| `src/adapter.test.ts` | `buildTeammatePrompt`, `formatHandoffContext` |
| `src/orchestrator.test.ts` | Task routing, assignment, reset |
| `src/registry.test.ts` | Teammate discovery, SOUL.md parsing (role, ownership), daily logs |
| `src/adapters/echo.test.ts` | Echo adapter session and task execution |

## Dependencies

- **`@teammates/recall`** — Bundled as a direct dependency. Provides automatic semantic search over teammate memories before every task. No separate installation or configuration needed.

## Requirements

- Node.js >= 20
- A `.teammates/` directory in your project (see [ONBOARDING.md](../ONBOARDING.md))
- The agent CLI on your PATH (for non-echo adapters)
