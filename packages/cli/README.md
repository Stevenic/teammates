# @teammates/cli

> Part of the [teammates](https://github.com/Stevenic/teammates) monorepo.

Agent-agnostic CLI orchestrator for teammates. Routes tasks to teammates, manages handoffs, and plugs into any coding agent backend.

## Quick Start

Install from npm:

```bash
npm install -g @teammates/cli
```

Or build from source:

```bash
cd packages/cli
npm install
npm run build
```

Then launch a session — the first positional argument selects the adapter:

```bash
teammates claude                 # Claude Code
teammates codex                  # OpenAI Codex
teammates copilot                # GitHub Copilot
teammates aider                  # Aider
teammates echo                   # Test adapter (no external agent)
teammates claude --model sonnet  # Override the agent model
```

The CLI auto-discovers your `.teammates/` directory by walking up from the current working directory.

## Usage

```
teammates <agent> [options] [agent-flags...]
```

### Options

| Flag | Description |
|---|---|
| `--model <model>` | Override the agent's model |
| `--dir <path>` | Override `.teammates/` directory location |
| `--help` | Show usage information |

Any extra positional arguments are passed through to the underlying agent CLI.

## In-Session Commands

Once inside the REPL, you can interact with teammates using `@mentions`, `/commands`, or bare text (auto-routed).

### Task Assignment

| Input | Behavior |
|---|---|
| `@beacon fix the search index` | Assign directly to a teammate |
| `@everyone status update` | Broadcast to every teammate (each responds independently) |
| `fix the search index` | Auto-route to the best teammate based on keywords |

### Slash Commands

| Command | Aliases | Description |
|---|---|---|
| `/status` | `/s`, `/queue`, `/qu` | Show teammates, active tasks, and queue |
| `/help` | `/h`, `/?` | Show available commands |
| `/debug [teammate] [focus]` | `/raw` | Analyze the last agent task with optional focus text |
| `/cancel [task-id] [teammate]` | | Cancel a task, or a specific teammate inside one |
| `/interrupt [task-id] [teammate] [message]` | `/int` | Interrupt a teammate and restart with extra instructions |
| `/add [teammate]` | | Add a new teammate from bundled personas |
| `/remove [teammate]` | | Remove an agentic teammate |
| `/update [teammate]` | | Refresh a teammate's SOUL.md & WISDOM.md from bundled personas |
| `/tab [description]` | `/new`, `/t` | Create a new conversation tab and switch to it |
| `/close [#id]` | `/done` | Close a tab (cannot close the last tab) |
| `/tabs` | `/ls` | List all tabs with status |
| `/clear` | `/cls`, `/reset` | Clear the focused tab's feed content |
| `/compact [teammate]` | | Compact daily logs into weekly/monthly summaries |
| `/retro [teammate]` | | Run a structured self-retrospective for a teammate |
| `/copy` | `/cp` | Copy session text to clipboard |
| `/user [change]` | | View or update USER.md |
| `/btw [question]` | | Ask a quick side question without interrupting |
| `/script [description]` | | Write and run reusable scripts via the coding agent |
| `/theme` | | Show current theme colors |
| `/about` | `/info`, `/diag` | Show version, platform, and diagnostic info |
| `/configure [service]` | `/config` | Configure external services (e.g. GitHub) |
| `/exit` | `/q`, `/quit` | Exit the session |

`everyone` can be used as a pseudo-teammate for any command that takes a teammate name (e.g. `/compact everyone`, `/retro everyone`).

### Autocomplete

- Type `/` to see a command wordwheel — arrow keys to navigate, `Tab` to accept
- Type `@` anywhere in a line to autocomplete teammate names
- Command arguments that take teammate names also autocomplete (e.g. `/retro b` → `/retro beacon`)

## Task Queue

Tasks sent to different teammates run in **parallel**. Tasks sent to the same teammate run **sequentially** — the second waits until the first finishes:

```
@beacon update the search index
@scribe update the onboarding docs    # runs in parallel with beacon
@beacon then refactor the query parser # queues behind beacon's first task
```

Handoffs work the same way — a handoff is queued as a regular task on the target teammate. It runs immediately if idle, or waits in their queue if busy.

Use `/status` to see what's running and what's queued. Cancel a specific task or teammate with `/cancel [task-id] [teammate]`.

## Tabs

Tabs are independent conversation contexts. Each tab has its own feed, active tasks, and scroll state. Use tabs to isolate parallel lines of work (e.g. one tab debugging CI while another drafts a spec).

```
/tab refactor planning     # open a new tab with a description
/tabs                      # list all tabs with status
/close 2                   # close tab #2
```

Switch between tabs with the tab shortcut shown in the footer. Tasks keep running in background tabs — switching away never blocks them.

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
2. **Team onboarding** (if `.teammates/` was just created) — Offers **Pick teammates** (persona templates), **Auto-generate** (agent-driven), **Import team** (from another project), **Solo mode**, or **Exit**.
3. **Orchestrator init** — Loads existing teammates from `.teammates/`, registers user avatar with `type: "human"` and `presence: "online"`.
4. **Startup maintenance** — Runs auto-compaction and recall sync for all teammates (silent — progress bar only, no feed output unless actual work was done).

**Phase 2 — TUI (Consolonia)**
5. Animated startup banner with presence-colored roster
6. REPL starts — routing, slash commands, handoff approval, tab switching
7. System tasks (compaction, summarization, wisdom distillation) run in the background without blocking user tasks

All user interaction during Phase 1 uses plain console I/O (readline + ora spinners), avoiding mouse tracking issues that would occur inside the TUI.

## Personas

The CLI ships with 16 built-in persona templates that serve as starting points when creating new teammates. Each persona file (`personas/*.md`) contains YAML frontmatter (name, default alias, tier, description) and a complete SOUL.md scaffold pre-filled with the role's identity, principles, quality bar, and ownership structure.

### Tiers

| Tier | Personas |
|---|---|
| **1 — Core** | PM (`scribe`), SWE (`beacon`), DevOps (`pipeline`), QA (`sentinel`) |
| **2 — Specialist** | Architect (`blueprint`), Designer (`prism`), Data Engineer (`forge`), Prompt Engineer (`lexicon`), Security (`shield`), SRE (`watchtower`), Tech Writer (`quill`) |
| **3 — Niche** | Frontend (`pixel`), Backend (`engine`), Mobile (`orbit`), ML/AI (`neuron`), Performance (`tempo`) |

Use **Pick teammates** during initial onboarding or `/add` in-session to choose from the list. The user picks roles, optionally renames them, and the persona's SOUL.md body becomes the starting template — project-specific sections (commands, file patterns, technologies) are filled in by the onboarding agent.

## Architecture

Key source files in `cli/src/`:

| File | Responsibility |
|---|---|
| `cli.ts` | Entry point, startup lifecycle, REPL loop, input handling |
| `commands.ts` | Slash command registration and dispatch |
| `orchestrator.ts` | Task routing, session management, presence, queue |
| `adapter.ts` | `AgentAdapter` interface, prompt builder, handoff parsing |
| `system-prompt.ts` | Token-budgeted prompt assembly (identity → wisdom → recall → logs → roster → task) |
| `registry.ts` | Discovers teammates, loads SOUL.md + memory, type detection |
| `conversation.ts` | Rolling conversation history passed to each task |
| `compact.ts` | Episodic memory compaction (daily → weekly → monthly) + auto-compaction |
| `retro-manager.ts` | `/retro` flow — proposals, approvals, SOUL.md edits |
| `thread-manager.ts`, `thread-container.ts` | Per-tab feed stores, switching, rendering |
| `feed-adapter.ts`, `feed-renderer.ts` | Feed I/O and markdown rendering |
| `handoff-manager.ts` | Parses `` ```handoff `` blocks, presents approval UI |
| `activity-manager.ts`, `activity-watcher.ts`, `log-parser.ts` | Live streaming of underlying agent activity |
| `startup-manager.ts`, `status-tracker.ts` | Startup maintenance and presence tracking |
| `onboard.ts`, `onboard-flow.ts` | Template copying, persona picking, import, agent-driven onboarding |
| `personas.ts` | Loads and parses bundled persona templates |
| `banner.ts`, `theme.ts`, `console/`, `wordwheel.ts` | TUI banner, theme, dropdown/wordwheel |
| `service-config.ts`, `hook-installer.ts` | Optional service configuration (`services.json`) |
| `user-task-logger.ts` | User activity log |
| `migrations.ts` | One-shot migrations for older `.teammates/` layouts |
| `cli-args.ts`, `cli-utils.ts` | Argument parsing, discovery, pure utilities |
| `types.ts` | Core types (`TeammateConfig`, `TaskResult`, `HandoffEnvelope`, `PresenceState`, etc.) |
| `adapters/` | `claude.ts`, `codex.ts`, `copilot.ts`, `cli-proxy.ts`, `presets.ts`, `echo.ts` |

`cli/personas/` holds 16 persona scaffolds (`pm.md`, `swe.md`, `devops.md`, `qa.md`, `prompt-engineer.md`, etc.).

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

Tests use [Vitest](https://vitest.dev/) and cover the core modules — representative examples:

| File | Covers |
|---|---|
| `src/adapter.test.ts` | Prompt builder and handoff formatting |
| `src/orchestrator.test.ts` | Task routing, assignment, reset |
| `src/registry.test.ts` | Teammate discovery, SOUL.md parsing, daily logs |
| `src/compact.test.ts` | Daily→weekly compaction, auto-compaction, partial merge |
| `src/personas.test.ts` | Persona loading and scaffolding |
| `src/activity-watcher.test.ts` | Live agent activity streaming and debug-log parsing |
| `src/log-parser.test.ts` | Debug log parsing for activity events |
| `src/user-task-logger.test.ts` | User activity log writes |
| `src/esm-compliance.test.ts` | ESM compliance of bundled source |
| `src/adapters/echo.test.ts` | Echo adapter session and task execution |
| `src/adapters/presets.test.ts` | CLI proxy presets for claude, codex, aider |

## Dependencies

- **`@teammates/recall`** — Bundled as a direct dependency. Provides automatic semantic search over teammate memories before every task. No separate installation or configuration needed.

## Requirements

- Node.js >= 20
- A `.teammates/` directory in your project (see [ONBOARDING.md](../ONBOARDING.md))
- The agent CLI on your PATH (for non-echo adapters)
