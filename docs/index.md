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

1. Install the CLI: `npm install -g @teammates/cli`
2. Launch a session: `teammates claude` (or codex, aider, copilot)
3. The CLI guides you through onboarding — analyzing your codebase, proposing teammates from 16 built-in personas (PM, SWE, DevOps, QA, Prompt Engineer, Security, and more), and scaffolding the `.teammates/` directory

That's it. The CLI handles routing, handoffs, and memory automatically.

## Key Concepts

- **Soul** — A teammate's identity: who they are, what they own, their principles, and their boundaries.
- **Goals** — Active objectives and priorities. Tracks what a teammate is working towards — distinct from identity (SOUL.md) and knowledge (WISDOM.md).
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

- [Working with Teammates](working-with-teammates) — Day-to-day workflows: standups, retros, task routing, and more
- [Adoption Guide](adoption-guide) — How to introduce teammates to an existing team
- [Cookbook](cookbook) — Concrete recipes for common workflows
- [Memory System](teammates-memory) — Memory system design and comparison
- [Vision](teammates-vision) — Architecture and Microsoft Teams roadmap

## Getting Started

```bash
npm install -g @teammates/cli
cd your-project
teammates claude       # or codex, aider, copilot
```

The CLI will prompt you to set up teammates on first run. You can also use the framework without the CLI — see the [full README](https://github.com/Stevenic/teammates) for all setup options.

## License

MIT
