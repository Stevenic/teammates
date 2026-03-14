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
├── WISDOM.md                      # Distilled principles (Tier 3)
└── memory/
    ├── YYYY-MM-DD.md              # Daily logs (Tier 1)
    ├── <type>_<topic>.md          # Typed memories (Tier 2)
    ├── weekly/
    │   └── YYYY-Wnn.md           # Weekly summaries (Tier 1b)
    └── monthly/
        └── YYYY-MM.md            # Monthly summaries (Tier 1b)
```

## Session Startup — Read Order

When a teammate wakes up, it reads files in this order:

1. **SOUL.md** — identity, principles, boundaries
2. **WISDOM.md** — distilled principles from compacted memories
3. **Daily logs** — today's and yesterday's `memory/YYYY-MM-DD.md`
4. **USER.md** — who the user is and how they prefer to work
5. **Typed memories** — browsed or searched on-demand as the task requires

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

`WISDOM.md` — Distilled, high-signal principles derived from compacting multiple typed memories. Compact, stable, rarely changes. Read second after SOUL.md.

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

## Recall — Vector Search Service (Optional)

The `teammates-recall` service adds a local vector database with semantic search across all teammate memory files. It uses [Vectra](https://github.com/Stevenic/vectra) as the vector store and [transformers.js](https://huggingface.co/docs/transformers.js) for on-device embeddings (`Xenova/all-MiniLM-L6-v2`, 384 dimensions). Zero cloud dependencies — everything runs locally.

### What it provides

- **Vector database** — Per-teammate Vectra indexes stored at `.teammates/<name>/.index/` (gitignored, rebuildable)
- **On-device embeddings** — Text is chunked and embedded using transformers.js. Model downloads automatically on first run (~23 MB), cached locally. No API keys required.
- **Hybrid retrieval** — Two-pass search combining recency and semantic similarity:
  - **Recency pass** — Always returns the 2–3 most recent weekly summaries (by file date, not query relevance), giving agents a sense of recent activity beyond the 7 daily logs already in context
  - **Semantic pass** — Standard vector similarity search across all indexed content (weekly summaries, monthly summaries, typed memories), ranked by embedding distance to the query
  - **Merge + dedup** — Results from both passes are combined, deduplicated by URI, and trimmed to a token budget
- **Type-based priority boost** — Typed memories (pre-extracted knowledge) score higher than episodic summaries at the same semantic similarity, since distilled facts are more actionable than narrative
- **Auto-sync** — Every search call detects new or changed memory files and indexes them before returning results. Agents write markdown, then search — no manual sync step needed.

### Commands

```bash
teammates-recall search "query"                    # Search all memories
teammates-recall search "query" --teammate beacon  # Scoped to one teammate
teammates-recall sync                              # Incremental index update
teammates-recall index                             # Full rebuild from scratch
teammates-recall status                            # Index health and stats
```

### What gets indexed

| Content | Indexed | Reason |
|---------|---------|--------|
| Weekly summaries | Yes | Primary episodic search surface (52-week window) |
| Monthly summaries | Yes | Long-term episodic context (permanent) |
| Typed memories | Yes | Searchable semantic knowledge |
| Raw daily logs | No | Already in prompt context (last 7 days), too noisy for search |
| SOUL.md / WISDOM.md | No | Always loaded directly into prompt |

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
| Hybrid search | Recency pass (file-date sorted) + semantic pass (vector similarity), merged and deduped | BM25 + vector with configurable weights |
| Post-processing | Type-based priority boost (typed memories rank above episodic summaries) | MMR (diversity re-ranking) + temporal decay (recency boost) |
| Auto-sync | Yes — indexes new/changed files before every search | N/A — indexes on write |
| Session indexing | Not supported | Optional — indexes session transcripts for recall |

Both systems provide vector-based semantic search with embeddings. Teammates' hybrid approach combines a recency pass (most recent weekly summaries, always included) with a semantic pass (vector similarity across all indexed content), then merges and deduplicates. OpenClaw's hybrid approach combines BM25 keyword matching with vector similarity using configurable weights. OpenClaw supports more embedding providers and adds MMR diversity re-ranking, while Teammates adds type-aware priority boosting (pre-extracted knowledge scores higher than episodic narrative) and runs fully offline with zero configuration.

### Design Philosophy

| Aspect | Teammates | OpenClaw |
|---|---|---|
| Philosophy | Structure through convention | Power through infrastructure |
| Complexity | Low — plain Markdown, no config | High — SQLite, embeddings, dual backends, 98+ source files |
| Dependencies | None required; recall adds Vectra + transformers.js (all local) | SQLite, embedding providers, optional QMD sidecar |
| Cloud requirements | None | Optional (remote embedding providers) |
| Configuration surface | Minimal (file naming conventions) | Extensive (chunking, weights, batch indexing, caching, scoping) |
| Multi-agent coordination | Built-in (CROSS-TEAM.md, handoffs, ownership) | Per-agent isolation |

Teammates prioritizes simplicity and multi-agent coordination. The memory system is plain Markdown with naming conventions — any AI tool that can read files can participate. The framework is designed for teams of specialized agents that share context through explicit handoffs and cross-team notes.

OpenClaw prioritizes search quality and retrieval sophistication. It invests heavily in making `memory_search` return the best possible results through hybrid scoring, diversity re-ranking, and temporal decay. The tradeoff is a much larger configuration surface and infrastructure footprint.

### Summary

- **Teammates** is a convention-based system with optional vector search: structured file layout, typed memories, compaction pipelines, wisdom distillation, and a local vector DB (Vectra + transformers.js) via the recall service. The base memory system works with any AI tool that can read files; adding recall layers on hybrid retrieval (recency + semantic), on-device embeddings, and type-aware ranking — all fully offline.
- **OpenClaw** is an infrastructure-based system: SQLite vector indexes, hybrid BM25+vector search, multiple embedding backends, automatic memory flush, and extensive tuning knobs. The memory system is tightly integrated with its runtime.

Both systems store Markdown as the source of truth and both provide vector-based semantic search with embeddings. Teammates adds semantic structure on top (types, tiers, compaction rules) and keeps search optional with zero-config local operation. OpenClaw adds more search infrastructure (BM25, MMR, temporal decay, multiple providers) and offers finer-grained tuning at the cost of a larger configuration surface.
