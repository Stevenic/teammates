# Beacon — Memories

Curated long-term lessons, decisions, and patterns. Reverse chronological.

This file is for durable knowledge that stays relevant over time. For day-to-day notes, use `memory/YYYY-MM-DD.md`.

Categories: Bug | Decision | Pattern | Gotcha | Optimization

### 2026-03-12: Scope Expansion — CLI Package
**Category:** Decision | **Last updated:** 2026-03-12

Beacon's scope expanded to include `@teammates/cli` alongside `@teammates/recall`. Key CLI architecture:
- **Orchestrator** (`cli/src/orchestrator.ts`) — routes tasks to teammates, manages handoff chains (max depth 5), delegates to pluggable agent adapters
- **Registry** (`cli/src/registry.ts`) — discovers teammates from `.teammates/` dirs, parses SOUL.md for role/ownership
- **AgentAdapter interface** (`cli/src/adapter.ts`) — pluggable adapter pattern; `buildTeammatePrompt()` hydrates identity + memory + roster + output protocol
- **CliProxyAdapter** (`cli/src/adapters/cli-proxy.ts`) — generic adapter that spawns any CLI agent as subprocess, streams output, parses structured JSON results/handoffs
- **Agent presets** — claude (`-p --verbose --dangerously-skip-permissions`), codex (`exec --full-auto`), aider (`--message-file --yes --no-git`)
- **REPL** (`cli/src/cli.ts`) — interactive loop with slash commands, @mention routing, wordwheel autocomplete, task queue with sequential draining
- **Handoff protocol** — structured JSON envelopes with approval gates (1=approve, 2=always approve, 3=reject)
- Session files stored in OS temp dir per teammate for cross-task continuity
- Dependencies: chalk, ora (plus Node.js builtins)

### 2026-03-11: Initial Setup
**Category:** Decision | **Last updated:** 2026-03-11

Beacon created to own the `@teammates/recall` package. Key initial decisions:
- Vectra for local vector search (simple file-based index, no server needed)
- transformers.js with `Xenova/all-MiniLM-L6-v2` for embeddings (384-dim, ~23 MB, runs on-device)
- One index per teammate, stored at `.teammates/.index/<name>/`
- Auto-sync before search by default — agents shouldn't need to manually manage index state
- CLI designed for agent consumption: `--json` flag for structured output, no interactive prompts
