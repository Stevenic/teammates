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

## Startup Lifecycle

The CLI startup runs in two phases:

**Phase 1 — Pre-TUI (console I/O)**
1. **User profile setup** — Prompts for alias (required), name, role, experience, preferences, context. Creates `USER.md` and a user avatar folder at `.teammates/<alias>/` with `SOUL.md` (`**Type:** human`).
2. **Team onboarding** (if no `.teammates/` exists) — Offers New team / Import / Solo / Exit. Onboarding agents run non-interactively to completion.
3. **Orchestrator init** — Loads existing teammates from `.teammates/`, registers user avatar with `type: "human"` and `presence: "online"`.

**Phase 2 — TUI (Consolonia)**
4. Animated startup banner with roster
5. REPL starts — routing, slash commands, handoff approval

All user interaction during Phase 1 uses plain console I/O (readline + ora spinners), avoiding mouse tracking issues that would occur inside the TUI.

## Personas

The CLI ships with 15 built-in persona templates that serve as starting points when creating new teammates. Each persona file (`personas/*.md`) contains YAML frontmatter (name, default alias, tier, description) and a complete SOUL.md scaffold pre-filled with the role's identity, principles, quality bar, and ownership structure.

### Tiers

| Tier | Personas |
|---|---|
| **1 — Core** | PM (`scribe`), SWE (`beacon`), DevOps (`pipeline`), QA (`sentinel`) |
| **2 — Specialist** | Security (`shield`), Designer (`canvas`), Tech Writer (`quill`), Data Engineer (`forge`), SRE (`watchtower`), Architect (`blueprint`) |
| **3 — Niche** | Frontend (`pixel`), Backend (`engine`), Mobile (`orbit`), ML/AI (`neuron`), Performance (`tempo`) |

During onboarding, the CLI uses these personas to scaffold teammates. The user picks roles, optionally renames them, and the persona's SOUL.md body becomes the starting template — project-specific sections (commands, file patterns, technologies) are filled in by the onboarding agent.

## Architecture

```
cli/src/
  cli.ts            # Entry point, startup lifecycle, REPL, slash commands, wordwheel UI
  orchestrator.ts   # Task routing, session management, presence tracking
  adapter.ts        # AgentAdapter interface, prompt builder, handoff formatting
  registry.ts       # Discovers teammates from .teammates/, loads SOUL.md + memory, type detection
  personas.ts       # Persona loader — reads and parses bundled persona templates
  types.ts          # Core types (TeammateConfig, TaskResult, HandoffEnvelope, TeammateType, PresenceState)
  onboard.ts        # Template copying, team import, onboarding/adaptation prompts
  dropdown.ts       # Terminal dropdown/wordwheel widget
  adapters/
    cli-proxy.ts    # Generic subprocess adapter with agent presets
    echo.ts         # Test adapter (no-op)
cli/personas/       # 15 persona template files (pm.md, swe.md, devops.md, etc.)
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
