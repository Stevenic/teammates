[![CI](https://github.com/Stevenic/teammates/actions/workflows/ci.yml/badge.svg)](https://github.com/Stevenic/teammates/actions/workflows/ci.yml)

# teammates

A framework for defining persistent AI personas with memory, file ownership, and cross-team protocols. Works with any agentic coding tool.

## The Problem

AI coding agents lose context between sessions. They don't know your project's architecture, ownership boundaries, or lessons learned. Each session starts from zero.

## The Solution

A `.teammates/` directory in your repo containing markdown files that any AI agent can read. Teammates are persistent personas — each one owns a slice of your codebase and accumulates knowledge over time.

## How It Works

1. Clone this repo (or copy `ONBOARDING.md` into your project)
2. Point your AI agent at `ONBOARDING.md`
3. The agent analyzes your codebase and creates a tailored set of teammates

That's it. Your agent reads the onboarding instructions and does the rest.

## What Gets Created

```
your-project/
  .teammates/
    .gitignore          # Keeps USER.md out of version control
    README.md           # Roster, routing guide, dependency flow
    PROTOCOL.md         # Collaboration rules, memory workflow, handoffs
    CROSS-TEAM.md       # Shared lessons across teammates
    TEMPLATE.md         # Template for creating new teammates
    USER.md             # Who you are (gitignored, stays local)
    <teammate-name>/
      SOUL.md           # Identity, continuity, principles, boundaries, ownership
      WISDOM.md         # Distilled principles from compacted memories
      memory/           # Daily logs (YYYY-MM-DD.md) and typed memories (<type>_<topic>.md)
```

## Key Concepts

- **Soul** — A teammate's identity: who they are, what they own, their principles, and their boundaries. Souls evolve — teammates update their own as they learn.
- **Continuity** — Each session starts fresh. Files are the only memory. Teammates read their files at startup and write to them before ending a session.
- **Memory** — Three tiers: raw daily logs (`memory/YYYY-MM-DD.md`), typed memories (`memory/<type>_<topic>.md`), and distilled wisdom (`WISDOM.md`). Memories compact into wisdom over time via the `/compact` command.
- **Ownership** — File patterns each teammate is responsible for. Every part of the codebase has a clear owner.
- **Protocol** — How teammates collaborate: handoff conventions, dependency direction, and conflict resolution.

## CLI Orchestrator (Optional)

Route tasks to teammates, manage handoffs, and run any coding agent backend from a single REPL:

```bash
cd cli && npm install && npm run build
teammates claude       # or codex, aider, echo
```

Inside the session:
- **`@mention`** — assign directly to a teammate (`@beacon fix the search index`)
- **Bare text** — auto-routes to the best teammate based on keywords
- **`/queue`** — queue tasks to run sequentially in the background
- **Handoff approval** — teammates can propose handoffs; you approve, auto-approve, or reject

See [cli/README.md](cli/README.md) for the full command reference and adapter docs.

## Memory Search (Optional)

As daily logs accumulate, teammates can't read every file. Install `@teammates/recall` for local semantic search:

```bash
npm install -g @teammates/recall
teammates-recall index --dir ./.teammates
teammates-recall search "auth token pattern" --json
```

Uses [Vectra](https://github.com/Stevenic/vectra) for vector search and [transformers.js](https://huggingface.co/docs/transformers.js) for local embeddings. No API keys, no cloud — everything runs on-device.

Any agent that can run shell commands gets semantic memory recall. See [recall/README.md](recall/README.md) for details.

## Supported Coding Agents

teammates works with any AI coding tool that can read and write files. The following agents have first-class support:

- **Claude Code** — Anthropic's agentic coding tool
- **OpenAI Codex** — OpenAI's coding agent (CLI)
- **GitHub Copilot** — GitHub's AI coding agent (VS Code, JetBrains, CLI)

Also works with: Cursor, Windsurf, Aider, Cline, Continue, and any other agent that reads markdown.

## Getting Started

### 1. Clone the framework

```bash
git clone https://github.com/Stevenic/teammates.git
```

### 2. Start onboarding with your agent

Pick the agent you use and run the appropriate command from your **target project directory** (the project you want to add teammates to):

#### Claude Code

```bash
claude
```

Then in the Claude Code session:

```
Read <path-to-teammates>/ONBOARDING.md and set up teammates for this project
```

Claude Code will read the onboarding instructions, analyze your codebase, and scaffold the `.teammates/` directory.

#### OpenAI Codex

```bash
codex
```

Then in the Codex session:

```
Read <path-to-teammates>/ONBOARDING.md and set up teammates for this project
```

Codex will follow the same onboarding flow — reading the instructions, proposing teammates based on your codebase, and creating the `.teammates/` directory.

#### GitHub Copilot

In **VS Code** or **JetBrains** with Copilot Chat (Agent mode):

1. Open your target project
2. Open Copilot Chat and switch to **Agent** mode
3. Send:

```
Read <path-to-teammates>/ONBOARDING.md and set up teammates for this project
```

From the **Copilot CLI**:

```bash
gh copilot
```

Then:

```
Read <path-to-teammates>/ONBOARDING.md and set up teammates for this project
```

#### Other Agents

For any agent that can read and write files, the prompt is the same:

> Read ONBOARDING.md and set up teammates for my project at `<path-to-your-project>`

See [ONBOARDING.md](ONBOARDING.md) for the full onboarding instructions.

## Project Structure

```
teammates/
  README.md             # This file
  ONBOARDING.md         # Instructions for an AI agent to bootstrap teammates
  LICENSE               # MIT
  cli/                  # Optional: interactive teammate orchestrator
    src/                # TypeScript source (REPL, orchestrator, adapters)
    package.json        # @teammates/cli package
    README.md           # CLI documentation
  consolonia/           # Optional: terminal UI rendering
    src/                # TypeScript source
    package.json        # @teammates/consolonia package
  recall/               # Optional: local semantic memory search
    src/                # TypeScript source
    package.json        # @teammates/recall package
    README.md           # Recall documentation
  docs/                 # Vision and design documents
    adoption-guide.md   # How to introduce teammates to an existing team
    cookbook.md          # Concrete recipes for common workflows
    migration-guide.md  # Template version upgrade instructions
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
