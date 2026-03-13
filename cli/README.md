# @teammates/cli

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
| `/route <task>` | `/r` | Auto-route a task to the best teammate |
| `/status` | `/s` | Show teammate roster and session status |
| `/teammates` | `/team`, `/t` | List all teammates and their roles |
| `/log [teammate]` | `/l` | Show the last task result (optionally for a specific teammate) |
| `/debug [teammate]` | `/raw` | Show raw agent output from the last task |
| `/queue @teammate <task>` | `/qu` | Add a task to the background queue |
| `/queue` | `/qu` | Show the current queue |
| `/cancel <n>` | | Cancel a queued task by number |
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

When a teammate finishes a task, it may propose a handoff to another teammate. The CLI presents a menu:

```
  1) Approve          — execute the handoff
  2) Always approve   — auto-approve all future handoffs this session
  3) Reject           — decline the handoff
```

Handoff details (task, changed files, acceptance criteria, open questions) are displayed before you choose.

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

1. The orchestrator builds a full prompt (identity + memory + roster + task)
2. The prompt is written to a temp file
3. The agent CLI is spawned with the prompt
4. stdout/stderr are captured for result parsing
5. The output is parsed for structured JSON result/handoff blocks
6. Temp files are cleaned up

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
  orchestrator.ts   # Task routing, handoff chains, session management
  adapter.ts        # AgentAdapter interface, prompt builder, handoff formatting
  registry.ts       # Discovers teammates from .teammates/, loads SOUL.md + memory
  types.ts          # Core types (TeammateConfig, TaskResult, HandoffEnvelope)
  dropdown.ts       # Terminal dropdown/wordwheel widget
  adapters/
    cli-proxy.ts    # Generic subprocess adapter with agent presets
    echo.ts         # Test adapter (no-op)
```

### Output Protocol

Agents are instructed to end their response with a structured JSON block:

```json
{ "result": { "summary": "...", "changedFiles": ["..."] } }
```

Or for handoffs:

```json
{ "handoff": { "to": "teammate", "task": "...", "context": "..." } }
```

The CLI parses the last JSON fence in the output. If no structured block is found, it falls back to scraping file paths and summaries from freeform output.

## Requirements

- Node.js >= 20
- A `.teammates/` directory in your project (see [ONBOARDING.md](../ONBOARDING.md))
- The agent CLI on your PATH (for non-echo adapters)
