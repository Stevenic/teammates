---
layout: default
title: Memory System
---

# Teammates Memory System

How AI teammates persist knowledge across sessions.

## The Problem

Every AI session starts with a blank slate. The model has no memory of prior conversations, decisions, or context. Without a persistence layer, users must re-explain context every time, and agents repeat the same mistakes.

Teammates solves this with a file-based memory system. Files are the only persistence layer — there is no RAM between sessions.

## Architecture

Memory operates on two independent axes:

```
Episodic (timeline):   Daily Logs  →  Weekly Summaries  →  Monthly Summaries
                       (raw, days)    (compacted, 52 wk)   (compacted, permanent)

Semantic (knowledge):  Typed Memories  →  WISDOM
                       (durable facts)    (distilled principles, permanent)
```

Daily logs feed both axes. Episodic compaction produces weekly and monthly summaries. Durable facts and lessons extracted during compaction become typed memories, which eventually distill into wisdom.

## File Layout

Each teammate has its own memory under `.teammates/<name>/`:

```
.teammates/<name>/
├── SOUL.md                        # Identity, principles, boundaries
├── GOALS.md                       # Active objectives and priorities
├── WISDOM.md                      # Distilled principles (Tier 3)
└── memory/
    ├── YYYY-MM-DD.md              # Daily logs (Tier 1)
    ├── <type>_<topic>.md          # Typed memories (Tier 2)
    ├── weekly/
    │   └── YYYY-Wnn.md           # Weekly summaries (Tier 1b)
    └── monthly/
        └── YYYY-MM.md            # Monthly summaries (Tier 1b)
```

## Context Window — What Gets Injected

The CLI automatically builds each teammate's context before every task. The prompt is assembled within a **32k token budget** for memory context, with smart allocation across sources.

The prompt stack (in order):

1. **SOUL.md** — identity, principles, boundaries (always, outside budget)
2. **GOALS.md** — active objectives and priorities (always, outside budget)
3. **WISDOM.md** — distilled principles from compacted memories (always, outside budget)
4. **Relevant memories from recall** — automatically queried using the task prompt; returns matching episodic summaries and typed memories from the vector index (at least 8k tokens, plus any unused daily log budget)
5. **Recent daily logs** — today's log is always included; days 2-7 are included most-recent-first up to 24k tokens (whole entries only, never truncated mid-entry)
6. **Session state** — path to the session file (`.teammates/.tmp/sessions/<name>.md`); the agent reads and writes it directly for cross-task continuity
7. **Roster** — all teammates and their roles
8. **Memory update instructions** — how to write daily logs, typed memories, and WISDOM.md
9. **Output protocol** — response format and handoff syntax
10. **Current date/time**
11. **Task** — the user's message (always, outside budget)

Weekly summaries are **not** injected directly — they are searchable via recall (step 3) and surface when relevant to the task prompt.

Teammates do not need to manually read these files or run recall searches — the CLI handles all context assembly automatically.

## Tier 1 — Daily Logs

`memory/YYYY-MM-DD.md` — Append-only session notes. What was worked on, decided, what to pick up next. A new file is created each day. No frontmatter needed. These are raw scratch.

```markdown
# 2026-03-14

## Refactored auth middleware

- Moved session validation into its own module
- Decided to keep cookie-based auth for now (JWT migration deferred)
- Need to update tests tomorrow
```

## Tier 1b — Episodic Summaries

Compacted from daily logs by the `/compact` command:

- **Weekly** (`memory/weekly/YYYY-Wnn.md`) — Summary of a full week's daily logs. Kept for 52 weeks.
- **Monthly** (`memory/monthly/YYYY-MM.md`) — Summary of weekly summaries older than 52 weeks. Kept permanently.

Both include frontmatter for searchability:

```markdown
---
type: weekly
week: 2026-W11
teammate: beacon
period: 2026-03-09 to 2026-03-15
---

Implemented hybrid search merging for recall. Fixed chunking overlap
issue that caused duplicate results. Shipped v0.4.0.
```

## Tier 2 — Typed Memories

`memory/<type>_<topic>.md` — Individual files capturing durable knowledge. Each has frontmatter for search and relevance matching.

### Four types

| Type | When to save | Body structure |
|---|---|---|
| `user` | User's role, goals, preferences, knowledge level | Free-form description |
| `feedback` | Corrections or guidance from the user | Rule, then **Why:** and **How to apply:** |
| `project` | Ongoing work, goals, deadlines, decisions | Fact/decision, then **Why:** and **How to apply:** |
| `reference` | Pointers to external resources | Resource location and when to use it |

### Example

`memory/feedback_no_mocks.md`:
```markdown
---
name: No mocks in integration tests
description: Integration tests must use real services, not mocks
type: feedback
---

Integration tests must hit a real database, not mocks.

**Why:** Last quarter, mocked tests passed but the prod migration
failed because mocks diverged from actual behavior.

**How to apply:** When writing integration tests, always use the
staging environment. Only use mocks for unit tests of pure logic.
```

## Tier 3 — Wisdom

`WISDOM.md` — Distilled, high-signal principles derived from compacting multiple typed memories. Compact, stable, rarely changes. Read after SOUL.md and GOALS.md.

A good wisdom entry is:
- **Pattern, not incident** — derived from multiple memories
- **Principled** — states a rule or heuristic
- **Compact** — 1-3 sentences
- **Actionable** — tells you what to do

### Example compaction

Three memories:
- `feedback_no_mocks.md` — "Don't mock the database in tests"
- `feedback_real_api.md` — "Use real API calls in integration tests"
- `project_staging_env.md` — "Staging environment was set up for realistic testing"

Become one wisdom entry:
> **Test against reality** — Integration tests use real services, not mocks. Mock/prod divergence has caused incidents. Prefer the staging environment over in-process fakes.

The three source memories are deleted. The wisdom entry persists.

## Compaction

The `/compact` command runs two independent pipelines:

### Episodic compaction (daily -> weekly -> monthly)

1. Completed weeks' daily logs are compacted into `memory/weekly/YYYY-Wnn.md`
2. Durable facts and lessons are extracted as typed memories
3. Raw daily logs are deleted after successful compaction
4. Weekly summaries older than 52 weeks are compacted into `memory/monthly/YYYY-MM.md`

### Semantic compaction (typed memories -> wisdom)

1. Review all typed memory files in `memory/`
2. Identify patterns — recurring themes, reinforced feedback, confirmed lessons
3. Distill into WISDOM.md entries
4. Delete the source memory files that were fully absorbed
5. Leave memories that are still active or evolving

## What NOT to Save

- Code patterns or architecture — derive from the current code
- Git history — use `git log` / `git blame`
- Debugging solutions — the fix is in the code
- Anything already in WISDOM.md
- Ephemeral task details — use daily logs

## Recall — Automatic Vector Search

`@teammates/recall` is bundled as a direct dependency of the CLI. It provides a local vector database with semantic search across all teammate memory files, queried **automatically before every task**. It uses [Vectra](https://github.com/Stevenic/vectra) as the vector store and [transformers.js](https://huggingface.co/docs/transformers.js) for on-device embeddings (`Xenova/all-MiniLM-L6-v2`, 384 dimensions). Zero cloud dependencies — everything runs locally.

### How it works

The CLI queries the recall index before every task, using the task prompt as the search query. Relevant episodic summaries and typed memories are injected into the teammate's context window automatically — no manual search needed.

- **Automatic query** — Before every task, the CLI calls `queryRecallContext()` with the task prompt as the query. Results are injected into the prompt between WISDOM.md and the daily logs.
- **Automatic sync** — After every task completes and after `/compact`, the CLI calls `syncRecallIndex()` to pick up any new or changed files.
- **In-process** — Recall is imported as a library, not spawned as a subprocess. Queries run in-process for speed.

### What it provides

- **Vector database** — Per-teammate Vectra indexes stored at `.teammates/<name>/.index/` (gitignored, rebuildable)
- **On-device embeddings** — Text is chunked and embedded using transformers.js. Model downloads automatically on first run (~23 MB), cached locally. No API keys required.
- **Hybrid retrieval** — BM25 + vector search combining keyword matching and semantic similarity, with type-based priority boosting (typed memories rank above episodic summaries)

### What gets indexed

| Content | Indexed | Reason |
|---------|---------|--------|
| Weekly summaries | Yes | Primary episodic search surface (52-week window) |
| Monthly summaries | Yes | Long-term episodic context (permanent) |
| Typed memories | Yes | Searchable semantic knowledge |
| Raw daily logs | No | Already in prompt context (last 7 days), too noisy for search |
| SOUL.md / GOALS.md / WISDOM.md | No | Always loaded directly into prompt |

## Cross-Teammate Sharing

- Each teammate maintains their own WISDOM.md and `memory/` for domain-specific knowledge
- Cross-team lessons go in `CROSS-TEAM.md` — tagged with affected teammates
- Wisdom is personal to each teammate — never duplicated across teammates
- Private docs under `.teammates/<name>/` can be shared by adding a pointer in CROSS-TEAM.md

---

## Comparison with OpenClaw's Memory System

Both Teammates and OpenClaw use plain Markdown files as the source of truth for memory. Both systems solve the same fundamental problem: AI agents lose context between sessions. The approaches differ significantly in complexity and design philosophy.

### File Layout

| Aspect | Teammates | OpenClaw |
|---|---|---|
| Daily logs | `memory/YYYY-MM-DD.md` | `memory/YYYY-MM-DD.md` |
| Long-term memory | WISDOM.md (distilled) + typed memories | MEMORY.md (curated, flat) |
| Structure | 3-tier hierarchy with compaction | 2-layer (daily + curated) |
| Episodic summaries | Weekly + monthly compacted files | None |
| Per-entity scope | Per-teammate (each has own memory/) | Per-agent |

Both systems use daily logs in the same `memory/YYYY-MM-DD.md` format with append-only semantics. The key structural difference is that Teammates introduces typed memories and wisdom as intermediate layers, while OpenClaw uses a single curated `MEMORY.md` file for all long-term knowledge.

### Memory Lifecycle

| Aspect | Teammates | OpenClaw |
|---|---|---|
| Compaction | Two pipelines: episodic (daily->weekly->monthly) and semantic (typed->wisdom) | No built-in compaction; MEMORY.md is manually curated |
| Memory flush | Teammate writes at end of session by convention | Automatic pre-compaction flush (silent agentic turn before context window compaction) |
| Retention | Dailies deleted after weekly compaction; weeklies kept 52 weeks; monthlies permanent | Dailies accumulate indefinitely |
| Knowledge distillation | Typed memories -> WISDOM.md via `/compact` | User manually curates MEMORY.md |

OpenClaw has an automatic memory flush that triggers when the session approaches context window compaction — a silent agentic turn reminds the model to write durable memories before context is lost. Teammates relies on convention (teammates write session notes before returning results).

### Search and Retrieval

| Aspect | Teammates (with recall) | OpenClaw |
|---|---|---|
| Search engine | teammates-recall — Vectra vector DB + transformers.js embeddings | Built-in vector index (default) or QMD sidecar |
| Embedding model | Local only — `Xenova/all-MiniLM-L6-v2` (384-dim, ~23 MB) | Auto-selected: local, OpenAI, Gemini, Voyage, Mistral, Ollama |
| Storage | Per-teammate Vectra index at `.teammates/<name>/.index/` | Per-agent SQLite at `~/.openclaw/memory/<agentId>.sqlite` |
| Hybrid search | BM25 + vector (Vectra native) + recency pass, merged and deduped | BM25 + vector with configurable weights |
| Post-processing | Type-based priority boost (typed memories rank above episodic summaries) | MMR (diversity re-ranking) + temporal decay (recency boost) |
| Auto-sync | Yes — indexes new/changed files before every search | N/A — indexes on write |
| Session indexing | Not supported | Optional — indexes session transcripts for recall |

Both systems provide hybrid BM25+vector search with embeddings. Teammates leverages Vectra's native BM25+vector hybrid scoring, layered with a recency pass (most recent weekly summaries, always included), then merges and deduplicates. OpenClaw similarly combines BM25 keyword matching with vector similarity using configurable weights. Both approaches combine keyword exactness with semantic understanding. OpenClaw supports more embedding providers and adds MMR diversity re-ranking, while Teammates adds type-aware priority boosting (pre-extracted knowledge scores higher than episodic narrative) and runs fully offline with zero configuration.

### Design Philosophy

| Aspect | Teammates | OpenClaw |
|---|---|---|
| Philosophy | Structure through convention | Power through infrastructure |
| Complexity | Low — plain Markdown, no config | High — SQLite, embeddings, dual backends, 98+ source files |
| Dependencies | Recall bundled (Vectra + transformers.js, all local) | SQLite, embedding providers, optional QMD sidecar |
| Cloud requirements | None | Optional (remote embedding providers) |
| Configuration surface | Minimal (file naming conventions) | Extensive (chunking, weights, batch indexing, caching, scoping) |
| Multi-agent coordination | Built-in (CROSS-TEAM.md, handoffs, ownership) | Per-agent isolation |

Teammates prioritizes simplicity and multi-agent coordination. The memory system is plain Markdown with naming conventions — any AI tool that can read files can participate. The framework is designed for teams of specialized agents that share context through explicit handoffs and cross-team notes.

OpenClaw prioritizes search quality and retrieval sophistication. It invests heavily in making `memory_search` return the best possible results through hybrid scoring, diversity re-ranking, and temporal decay. The tradeoff is a much larger configuration surface and infrastructure footprint.

### Summary

- **Teammates** is a convention-based system with built-in vector search: structured file layout, typed memories, compaction pipelines, wisdom distillation, and a bundled local vector DB (Vectra + transformers.js) that is automatically queried before every task. The recall index provides hybrid BM25+vector search, on-device embeddings, and type-aware ranking — all fully offline.
- **OpenClaw** is an infrastructure-based system: SQLite vector indexes, hybrid BM25+vector search, multiple embedding backends, automatic memory flush, and extensive tuning knobs. The memory system is tightly integrated with its runtime.

Both systems store Markdown as the source of truth and both provide hybrid BM25+vector search with embeddings. Teammates adds semantic structure on top (types, tiers, compaction rules) with automatic recall queries bundled into the CLI — zero configuration, fully local. OpenClaw adds more search infrastructure (MMR, temporal decay, multiple providers) and offers finer-grained tuning at the cost of a larger configuration surface.
