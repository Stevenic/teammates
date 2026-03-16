---
layout: default
title: Home
---

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

## Key Concepts

- **Soul** — A teammate's identity: who they are, what they own, their principles, and their boundaries.
- **Continuity** — Each session starts fresh. Files are the only memory. Teammates read their files at startup and write to them before ending a session.
- **Memory** — Three tiers: raw daily logs, typed memories, and distilled wisdom. Memories compact into wisdom over time.
- **Ownership** — File patterns each teammate is responsible for. Every part of the codebase has a clear owner.
- **Protocol** — How teammates collaborate: handoff conventions, dependency direction, and conflict resolution.

## Packages

| Package | Description |
|---|---|
| [@teammates/cli](https://github.com/Stevenic/teammates/tree/main/packages/cli) | Interactive teammate orchestrator — routes tasks, manages handoffs, runs any coding agent backend |
| [@teammates/recall](https://github.com/Stevenic/teammates/tree/main/packages/recall) | Local semantic memory search using Vectra and transformers.js — no API keys, no cloud |
| [@teammates/consolonia](https://github.com/Stevenic/teammates/tree/main/packages/consolonia) | Terminal UI rendering engine for ANSI output |

## Supported Coding Agents

- **Claude Code** — Anthropic's agentic coding tool
- **OpenAI Codex** — OpenAI's coding agent (CLI)
- **GitHub Copilot** — GitHub's AI coding agent (VS Code, JetBrains, CLI)
- Also works with: Cursor, Windsurf, Aider, Cline, Continue, and any other agent that reads markdown.

## Documentation

- [Adoption Guide](adoption-guide) — How to introduce teammates to an existing team
- [Cookbook](cookbook) — Concrete recipes for common workflows
- [Memory System](teammates-memory) — Memory system design and comparison
- [Vision](teammates-vision) — Architecture and Microsoft Teams roadmap

## Getting Started

```bash
git clone https://github.com/Stevenic/teammates.git
```

Then point your AI coding agent at `ONBOARDING.md`:

```
Read ONBOARDING.md and set up teammates for this project
```

See the [full README](https://github.com/Stevenic/teammates) for detailed setup instructions per agent.

## License

MIT
