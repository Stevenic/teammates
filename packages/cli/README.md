# @teammates/cli

> Part of the [teammates](https://github.com/Stevenic/teammates) monorepo.

Agent-agnostic CLI orchestrator for teammates. Routes tasks to teammates, manages handoffs, and plugs into any coding agent backend.

## Quick Start

```bash
cd packages/cli
npm install
npm run build
```

Then launch a session:

```bash
teammates               # Uses default adapter (claude)
teammates --model sonnet # Override the agent model
teammates echo           # Use the test adapter (no external agent)
```

The CLI auto-discovers your `.teammates/` directory by walking up from the current working directory.

## Usage

```
teammates [options] [-- agent-flags...]
```

### Options

| Flag | Description |
|---|---|
| `--model <model>` | Override the agent's model |
| `--dir <path>` | Override `.teammates/` directory location |
| `--help` | Show usage information |

Any arguments after `--` are passed through to the underlying agent CLI.

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
| `/status` | `/s`, `/queue` | Show teammates, active tasks, and queue |
| `/debug [teammate] [focus]` | | Analyze the last agent task with optional focus text |
| `/cancel [n]` | | Cancel a queued task by number |
| `/init` | `/onboard`, `/setup` | Run onboarding to set up teammates |
| `/init pick` | | Pick teammates from persona templates (in-TUI) |
| `/compact [teammate]` | | Compact daily logs into weekly/monthly summaries |
| `/retro [teammate]` | | Run a structured self-retrospective for a teammate |
| `/user [change]` | | View or update USER.md |
| `/btw [question]` | | Ask a quick side question without interrupting |
| `/copy` | `/cp` | Copy the last response to clipboard |
| `/theme` | | Show current theme colors |
| `/configure [service]` | `/config` | Configure external services (e.g. GitHub) |
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
| `claude` | `claude -p --verbose` | Default adapter. Requires `claude` on PATH |
| `codex` | `codex exec` | Requires `codex` on PATH |
| `aider` | `aider --message-file` | Requires `aider` on PATH |
| `copilot` | GitHub Copilot SDK | Requires `@anthropic-ai/copilot-sdk` |
| `echo` | (in-process) | Test adapter — echoes prompts, no external agent |

### How Adapters Work

1. **Auto-compaction** — If daily logs exceed the 24k token budget, oldest weeks are compacted into weekly summaries
2. **Two-pass recall** — Pass 1: keyword extraction → query variation generation → frontmatter catalog matching → multi-query fusion with dedup. Pass 2: agents can search mid-task via `teammates-recall search`
3. The orchestrator builds a full prompt with token-budgeted sections (identity → wisdom → recall → daily logs → roster → services → date/time/environment → user profile → task → output protocol → session/memory instructions)
4. The prompt is written to a temp file
5. The agent CLI is spawned with the prompt
6. stdout/stderr are captured for result parsing
7. **Empty response defense** — If the agent returns no text: retry with raw mode (no prompt wrapping), then minimal prompt, then synthetic fallback from metadata
8. The output is parsed for embedded handoff blocks (with natural-language fallback)
9. The recall index is synced to pick up any files the agent created/modified
10. Temp files are cleaned up

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
1. **User profile setup** — If `USER.md` is missing, offers three paths: **GitHub** (imports name/alias via `gh api user`), **Manual** (prompts for alias, name, role, experience, preferences), or **Skip**. Creates `USER.md` and a user avatar folder at `.teammates/<alias>/` with `SOUL.md` (`**Type:** human`). Auto-detects the user's timezone.
2. **Team onboarding** (if `.teammates/` was just created) — Offers **Pick teammates** (persona templates), **Auto-generate** (agent-driven), **Import** (from another project), **Solo mode**, or **Exit**.
3. **Orchestrator init** — Loads existing teammates from `.teammates/`, registers user avatar with `type: "human"` and `presence: "online"`.
4. **Startup maintenance** — Runs auto-compaction and recall sync for all teammates (silent — progress bar only, no feed output unless actual work was done).

**Phase 2 — TUI (Consolonia)**
5. Animated startup banner with presence-colored roster
6. REPL starts — routing, slash commands, handoff approval
7. System tasks (compaction, summarization, wisdom distillation) run in the background without blocking user tasks

All user interaction during Phase 1 uses plain console I/O (readline + ora spinners), avoiding mouse tracking issues that would occur inside the TUI.

## Personas

The CLI ships with 15 built-in persona templates that serve as starting points when creating new teammates. Each persona file (`personas/*.md`) contains YAML frontmatter (name, default alias, tier, description) and a complete SOUL.md scaffold pre-filled with the role's identity, principles, quality bar, and ownership structure.

### Tiers

| Tier | Personas |
|---|---|
| **1 — Core** | PM (`scribe`), SWE (`beacon`), DevOps (`pipeline`), QA (`sentinel`) |
| **2 — Specialist** | Security (`shield`), Designer (`canvas`), Tech Writer (`quill`), Data Engineer (`forge`), SRE (`watchtower`), Architect (`blueprint`) |
| **3 — Niche** | Frontend (`pixel`), Backend (`engine`), Mobile (`orbit`), ML/AI (`neuron`), Performance (`tempo`) |

During onboarding, the CLI uses these personas to scaffold teammates. Use **Pick teammates** during initial onboarding or `/init pick` in-session to choose from the list. The user picks roles, optionally renames them, and the persona's SOUL.md body becomes the starting template — project-specific sections (commands, file patterns, technologies) are filled in by the onboarding agent.

## Architecture

```
cli/src/
  cli.ts            # Entry point, startup lifecycle, REPL, slash commands, wordwheel UI
  orchestrator.ts   # Task routing, session management, presence tracking
  adapter.ts        # AgentAdapter interface, prompt builder, handoff formatting
  registry.ts       # Discovers teammates from .teammates/, loads SOUL.md + memory, type detection
  compact.ts        # Episodic memory compaction (daily→weekly→monthly) + auto-compaction
  banner.ts         # Animated startup banner with presence roster and segmented footer
  personas.ts       # Persona loader — reads and parses bundled persona templates
  theme.ts          # Theme configuration, color palette, styled text shortcuts
  cli-args.ts       # CLI argument parsing, .teammates/ directory discovery
  cli-utils.ts      # Pure utility functions (relativeTime, wrapLine, findAtMention, etc.)
  types.ts          # Core types (TeammateConfig, TaskResult, HandoffEnvelope, TeammateType, PresenceState)
  onboard.ts        # Template copying, team import, onboarding/adaptation prompts
  dropdown.ts       # Terminal dropdown/wordwheel widget
  adapters/
    cli-proxy.ts    # Generic subprocess adapter with agent presets (claude, codex, aider)
    copilot.ts      # GitHub Copilot adapter
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
| `src/compact.test.ts` | Daily→weekly compaction, auto-compaction, partial merge |
| `src/personas.test.ts` | Persona loading and scaffolding |
| `src/theme.test.ts` | Theme configuration |
| `src/cli-args.test.ts` | Argument parsing, directory discovery |
| `src/cli-utils.test.ts` | Utility functions |
| `src/adapters/echo.test.ts` | Echo adapter session and task execution |

## Dependencies

- **`@teammates/recall`** — Bundled as a direct dependency. Provides automatic semantic search over teammate memories before every task. No separate installation or configuration needed.

## Requirements

- Node.js >= 20
- A `.teammates/` directory in your project (see [ONBOARDING.md](../ONBOARDING.md))
- The agent CLI on your PATH (for non-echo adapters)
