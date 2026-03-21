[![CI](https://github.com/Stevenic/teammates/actions/workflows/ci.yml/badge.svg)](https://github.com/Stevenic/teammates/actions/workflows/ci.yml)

# teammates

A framework for defining persistent AI personas with memory, file ownership, and cross-team protocols. Works with any agentic coding tool.

**[Documentation](https://stevenic.github.io/teammates)**

## The Problem

AI coding agents lose context between sessions. They don't know your project's architecture, ownership boundaries, or lessons learned. Each session starts from zero.

## The Solution

A `.teammates/` directory in your repo containing markdown files that any AI agent can read. Teammates are persistent personas — each one owns a slice of your codebase and accumulates knowledge over time.

## Getting Started

### 1. Install the CLI

```bash
npm install -g @teammates/cli
```

### 2. Launch a session

From your project directory, start the CLI with your preferred coding agent:

```bash
teammates claude       # Claude Code
teammates codex        # OpenAI Codex
teammates aider        # Aider
teammates copilot      # GitHub Copilot
```

### 3. Set up your profile

On first run, the CLI sets up your user profile **before** the terminal UI starts. You'll be asked for:

- **Alias** (required) — your handle for `@mentions` and the roster (e.g., `stevenic`). Normalized to lowercase `[a-z0-9_-]`.
- **Name, role, experience, preferences, context** (optional) — helps teammates tailor their communication style and technical depth.

This creates a `USER.md` (gitignored) and a **user avatar folder** at `.teammates/<alias>/` with a `SOUL.md` marked `**Type:** human`. You appear in the roster and `/status` alongside your AI teammates.

### 4. Onboard your team

If this is a new project without a `.teammates/` directory, the CLI prompts you to set up your team (still pre-TUI):

| Option | What it does |
|---|---|
| **New team** | Analyzes your codebase and creates teammates from scratch — proposes a roster based on your project's domains, gets your approval, then scaffolds everything |
| **Import team** | Copies teammates from another project (`/init <path>`). Imports SOUL.md + WISDOM.md only, then each teammate adapts itself to the new codebase |
| **Solo mode** | Uses the agent without teammates — no `.teammates/` directory, no routing |
| **Exit** | Quits without changes |

All onboarding agents run non-interactively — they complete fully without additional prompts.

### 5. Start working

Once your team is set up, you're in the REPL:

- **`@mention`** — assign directly to a teammate (`@beacon fix the search index`)
- **Bare text** — auto-routes to the best teammate based on keywords
- **`/status`** — see active teammates, running tasks, and the queue
- **Handoff approval** — teammates can propose handoffs; you approve, auto-approve, or reject

### Re-running onboarding

Use `/init` inside an existing session to re-run onboarding from scratch, or `/init <path>` to import teammates from another project.

### CLI options

```
teammates <agent> [options] [-- agent-flags...]
```

| Flag | Description |
|---|---|
| `--model <model>` | Override the agent's model |
| `--dir <path>` | Override `.teammates/` directory location |
| `--help` | Show usage information |

Arguments after `--` are passed through to the underlying agent CLI.

See [packages/cli/README.md](packages/cli/README.md) for the full command reference and adapter docs.

## Framework Only (No CLI)

If you prefer not to use the CLI, you can set up teammates manually with any AI coding tool that reads markdown:

1. Clone or copy the `template/` directory from this repo
2. Point your AI agent at `ONBOARDING.md`:

```
Read ONBOARDING.md and set up teammates for this project
```

3. The agent analyzes your codebase and creates a tailored `.teammates/` directory

This is the original approach and still works with any agent. The CLI automates routing, handoffs, and memory — but the underlying framework is plain markdown that any tool can read.

See [ONBOARDING.md](ONBOARDING.md) for the full onboarding instructions.

## What Gets Created

```
your-project/
  .teammates/
    .gitignore          # Keeps USER.md out of version control
    README.md           # Roster, routing guide, dependency flow
    PROTOCOL.md         # Collaboration rules, memory workflow, handoffs
    CROSS-TEAM.md       # Shared lessons across teammates
    TEMPLATE.md         # Template for creating new teammates
    DECISIONS.md        # Decision log (ADR-lite)
    USER.md             # Who you are (gitignored, stays local)
    _standups/          # Shared async standup entries
    _tasks/             # Shared task queue
    <your-alias>/       # Your avatar (Type: human) — appears in roster alongside AI teammates
      SOUL.md           # Your profile and preferences
      WISDOM.md         # (empty for humans)
      memory/           # Your activity logs
    <teammate-name>/
      SOUL.md           # Identity, continuity, principles, boundaries, ownership
      WISDOM.md         # Distilled principles from compacted memories
      memory/           # Daily logs (YYYY-MM-DD.md) and typed memories (<type>_<topic>.md)
        weekly/         # Weekly episodic summaries
        monthly/        # Monthly episodic summaries
```

## Key Concepts

- **Soul** — A teammate's identity: who they are, what they own, their principles, and their boundaries. Souls evolve — teammates update their own as they learn.
- **Continuity** — Each session starts fresh. Files are the only memory. Teammates read their files at startup and write to them before ending a session.
- **Memory** — Three tiers: raw daily logs (`memory/YYYY-MM-DD.md`), typed memories (`memory/<type>_<topic>.md`), and distilled wisdom (`WISDOM.md`). Memories compact into wisdom over time via the `/compact` command.
- **Ownership** — File patterns each teammate is responsible for. Every part of the codebase has a clear owner.
- **Protocol** — How teammates collaborate: handoff conventions, dependency direction, and conflict resolution.

## Supported Coding Agents

teammates works with any AI coding tool that can read and write files. The following agents have first-class CLI adapters:

- **Claude Code** — `teammates claude`
- **OpenAI Codex** — `teammates codex`
- **Aider** — `teammates aider`
- **GitHub Copilot** — `teammates copilot`
- **Echo** — `teammates echo` (test adapter, no external agent)

Also works without the CLI: Cursor, Windsurf, Cline, Continue, and any other agent that reads markdown.

## Packages

| Package | Description |
|---|---|
| [@teammates/cli](packages/cli) | Interactive teammate orchestrator — routes tasks, manages handoffs, runs any coding agent backend |
| [@teammates/recall](packages/recall) | Local semantic memory search using Vectra and transformers.js — bundled with the CLI |
| [@teammates/consolonia](packages/consolonia) | Terminal UI rendering engine for ANSI output |

`@teammates/recall` is bundled as a dependency of the CLI. No separate install needed — memory search runs automatically before every task, injecting relevant context into each teammate's prompt.

## Project Structure

```
teammates/
  README.md             # This file
  ONBOARDING.md         # Instructions for an AI agent to bootstrap teammates
  LICENSE               # MIT
  packages/
    cli/                # Interactive teammate orchestrator
      src/              # TypeScript source (REPL, orchestrator, adapters)
      package.json      # @teammates/cli package
      README.md         # CLI documentation
    consolonia/         # Terminal UI rendering
      src/              # TypeScript source
      package.json      # @teammates/consolonia package
    recall/             # Local semantic memory search (bundled with CLI)
      src/              # TypeScript source
      package.json      # @teammates/recall package
      README.md         # Recall documentation
  docs/                 # Documentation site (https://stevenic.github.io/teammates)
    working-with-teammates.md  # Day-to-day workflows: standups, retros, routing
    adoption-guide.md   # How to introduce teammates to an existing team
    cookbook.md          # Concrete recipes for common workflows
    teammates-vision.md # Architecture and Microsoft Teams roadmap
    teammates-memory.md # Memory system design and comparison
  template/
    .gitignore          # Keeps USER.md out of version control
    README.md           # Roster template with placeholders
    PROTOCOL.md         # Collaboration rules template
    CROSS-TEAM.md       # Empty starter for cross-team notes
    DECISIONS.md        # Decision log template
    TEMPLATE.md         # Template for individual teammate files (SOUL, WISDOM, typed memories, daily logs)
    USER.md             # User profile template (gitignored)
    example/
      SOUL.md           # Worked example of a filled-in SOUL.md
```

## License

MIT
