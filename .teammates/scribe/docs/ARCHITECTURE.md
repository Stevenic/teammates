# Teammates — Architecture

## What It Is

Teammates is a middleware layer for AI agent continuity. It gives AI agents persistent identities, file ownership, memory across sessions, and structured handoffs — all backed by plain markdown files and local-only tooling.

## Packages

```
teammates/
├── cli/          @teammates/cli      Interactive orchestrator (TypeScript)
├── recall/       @teammates/recall   Local semantic memory search (TypeScript)
├── template/                         Framework templates (Markdown)
└── .teammates/                       Instance: teammates, memory, protocols
```

### CLI Orchestrator (`cli/`)

Routes tasks between teammates via a REPL. Key components:

| File | Purpose |
|------|---------|
| `cli.ts` | REPL, command dispatch, wordwheel autocomplete, task queue |
| `orchestrator.ts` | Task routing, handoff chains, cycle detection, sessions |
| `adapter.ts` | `AgentAdapter` interface, prompt hydration (identity + memory + roster) |
| `registry.ts` | Discovers teammates from `.teammates/`, parses SOUL.md |
| `cli-proxy.ts` | Generic subprocess adapter with presets (claude, codex, aider) |
| `types.ts` | Core types: `TeammateConfig`, `TaskResult`, `HandoffEnvelope` |

**Built-in agent presets:** `claude` (Claude Code), `codex` (OpenAI Codex), `aider`, `echo` (test)

### Recall Search (`recall/`)

Local semantic search over teammate memory files. Zero cloud dependencies.

| File | Purpose |
|------|---------|
| `cli.ts` | CLI commands: index, sync, add, search, status |
| `indexer.ts` | Vectra document indexing, file discovery, incremental sync |
| `search.ts` | Semantic search with auto-sync before queries |
| `embeddings.ts` | transformers.js wrapper (Xenova/all-MiniLM-L6-v2, 384-dim) |

**Index storage:** `.teammates/.index/<teammate>/` (gitignored, auto-generated)

### Framework (`template/` + `.teammates/`)

Plain markdown. No preprocessing. Works with any AI tool that reads files.

- **SOUL.md** — Teammate identity, ownership rules, principles, boundaries
- **MEMORIES.md** — Curated long-term knowledge (reverse chronological)
- **memory/YYYY-MM-DD.md** — Daily logs (append-only, one per session)
- **PROTOCOL.md** — Collaboration rules, handoff format, conflict resolution
- **CROSS-TEAM.md** — Shared lessons + index of private doc pointers

## Data Flow

### Task Execution

```
User input (REPL)
    │
    ▼
cli.ts ─── parse command, tokenize ───▶ orchestrator.ts
                                            │
                                    route by ownership keywords
                                            │
                                            ▼
                                       adapter.ts
                                            │
                                   hydrate prompt:
                                   • SOUL.md (identity)
                                   • MEMORIES.md + last 3 daily logs
                                   • roster (all teammates)
                                   • handoff context (if chained)
                                   • output protocol
                                            │
                                            ▼
                                    cli-proxy.ts
                                            │
                                   spawn agent subprocess
                                   stream stdout/stderr
                                   parse JSON result
                                            │
                                            ▼
                                    orchestrator.ts
                                            │
                              ┌─────────────┴─────────────┐
                              │                           │
                         result JSON                 handoff JSON
                    { summary, files }          { to, task, context }
                              │                           │
                         return to user          queue for approval
                                                 or auto-follow
```

### Memory Lifecycle

```
Agent writes memory files
    │
    ▼
.teammates/<name>/MEMORIES.md        (curated, updated per session)
.teammates/<name>/memory/YYYY-MM-DD  (append-only daily log)
    │
    ▼
recall search (auto-syncs before query)
    │
    ▼
indexer.ts ─── detect changed files ─── chunk text ─── embed locally
    │
    ▼
Vectra index at .teammates/.index/<name>/
    │
    ▼
search.ts ─── query embeddings ─── return scored results
```

### Handoff Chains

Teammates can hand off work to each other with structured envelopes:

```json
{ "handoff": { "to": "beacon", "task": "...", "changedFiles": [...], "context": "..." } }
```

**Safety:** Orchestrator tracks visited teammates (prevents A→B→A cycles) and enforces `maxHandoffDepth` (default 5). User approval gates are optional.

## Key Patterns

| Pattern | Where | What It Does |
|---------|-------|-------------|
| Pluggable adapters | `adapter.ts`, `cli-proxy.ts` | Any CLI agent wires in via `AgentAdapter` interface |
| Registry discovery | `registry.ts` | Auto-discovers teammates from `.teammates/` dirs, parses SOUL.md |
| Prompt hydration | `adapter.ts` | Layers identity → memory → roster → handoff → protocol → task |
| File-as-memory | Framework | No in-RAM state; markdown files are the only persistence |
| Auto-sync search | `search.ts` | Transparently indexes new/changed files before returning results |
| Structured output | Output protocol | Agents end responses with `{ "result": ... }` or `{ "handoff": ... }` |
| Ownership routing | `orchestrator.ts` | Keyword matching against SOUL.md ownership patterns |

## Technology Stack

| Tech | Package | Purpose |
|------|---------|---------|
| TypeScript (ES2022) | cli, recall | Type-safe source, Node16 module resolution |
| Vectra | recall | Local file-based vector database |
| transformers.js | recall | On-device embeddings (no API keys) |
| chalk | cli | Terminal colors |
| ora | cli | Spinners |
| Node.js readline | cli | REPL interaction |
| child_process | cli | Agent subprocess spawning |

## Dependency Direction

```
Templates (Scribe) ──▶ Onboarding ──▶ Recall (Beacon)
                                  ──▶ CLI (Beacon)
```

Breaking changes propagate downstream. Feature requests propagate upstream.

## Build & Run

```bash
# CLI
cd cli && npm install && npm run build
teammates claude              # Launch REPL

# Recall
cd recall && npm install && npm run build
teammates-recall search "query" --dir ./.teammates
```

**Requirements:** Node.js >= 20. No external API keys needed.

## Source Stats

~2,750 lines of TypeScript across 2 packages. All memory and configuration is plain markdown.
