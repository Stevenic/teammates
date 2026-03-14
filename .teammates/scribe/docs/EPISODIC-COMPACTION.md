# Episodic Memory Compaction — Design

Status: **Implemented** (CLI: `compact.ts`, Recall: indexer/search updates, Framework: templates/protocol updated)

## Overview

Scalable episodic memory management through time-based compaction:
- **Daily logs** → compacted weekly (kept 52 weeks)
- **Weekly summaries** → compacted monthly (kept permanently)

This sits alongside the existing semantic memory layer (typed memories → wisdom) as an orthogonal axis.

## The Two Axes

| Axis | Purpose | Flow | Lifespan |
|------|---------|------|----------|
| **Episodic** (timeline) | "What happened when" | daily → weekly → monthly | Time-bound, compresses |
| **Semantic** (knowledge) | "What was learned" | typed memories → wisdom | Durable, updated in place |

These are independent systems that feed into each other at compaction boundaries.

## Compaction Pipeline

### Daily → Weekly (every 7 days)

- 7 daily logs compress into one `memory/weekly/YYYY-Wnn.md`
- During compaction, **extract typed memories** — any durable facts, feedback, decisions, or references become `memory/<type>_<topic>.md` files (create or update)
- Raw dailies are deleted after successful compaction

### Weekly → Monthly (after 52 weeks)

- 4–5 weekly summaries compress into `memory/monthly/YYYY-MM.md`
- Weekly files older than 1 year are deleted after successful compaction

## File Structure

```
memory/
├── 2026-03-14.md          # daily (current week, deleted after compaction)
├── weekly/
│   ├── 2026-W11.md        # weekly summary (kept 52 weeks)
│   └── 2026-W10.md
├── monthly/
│   ├── 2025-03.md          # monthly summary (kept permanently)
│   └── 2025-02.md
├── user_role.md            # typed memory (durable)
├── feedback_testing.md     # typed memory (durable)
└── project_auth_rewrite.md # typed memory (durable)
```

## Interaction with Typed Memories

Typed memories are **extracted during weekly compaction** as a side effect. They are not compacted themselves — they live until they're wrong or obsolete, at which point they're updated or deleted manually.

- Episodic files: append-only, time-bound, disposable (compress and expire)
- Typed memories: durable, topic-indexed, mutable (updated in place, never auto-expired)

A typed memory can be created at any time (during daily work or during weekly compaction). Both paths are valid.

## Interaction with Wisdom

Wisdom is **completely independent of episodic compaction**. It feeds exclusively from typed memories via `/compact`:

```
dailies ──weekly compaction──→ weekly summaries ──yearly compaction──→ monthly summaries
                │
                └──extracts──→ typed memories ──/compact──→ WISDOM.md
```

Wisdom never reads from episodic files directly:
- Episodic events → typed memories (durable facts extracted)
- Typed memories → wisdom (principles distilled)

Wisdom is never lost when episodic files compress or delete, because durable knowledge was already extracted into typed memories before compaction.

## Recall Integration

### What Gets Indexed

| Content | Indexed | Reason |
|---------|---------|--------|
| Raw dailies (current week) | No | Already in prompt context (last 3), too noisy |
| Weekly summaries | Yes | Primary episodic search surface, 1-year window |
| Monthly summaries | Yes | Long-term episodic context, permanent |
| Typed memories | Yes | Searchable semantic knowledge |
| WISDOM.md | No | Always loaded in prompt, indexing adds nothing |
| SOUL.md | No | Always loaded in prompt |

### What's Always in Context (No Recall Needed)

These are injected directly into every prompt by `adapter.ts`:

| Content | Method | Rationale |
|---------|--------|-----------|
| SOUL.md | Direct injection | Identity, boundaries, ownership — always needed |
| WISDOM.md | Direct injection | Distilled principles — always needed |
| Last 3 daily logs | Direct injection | Immediate context about current work |

Recall's job starts where direct injection ends — it fills the gap between "the last 3 days" and "everything else."

### Multi-Pass Retrieval Strategy

Recall should perform two retrieval passes per query, then merge results:

#### Pass 1: Recency (always runs)

Return the **last 2–3 weekly summaries** regardless of query relevance. This gives the agent a sense of "what's been happening lately" beyond the 3 daily logs already in context.

- Recency pass uses **file date sorting**, not semantic similarity
- Default: 2 most recent weekly summaries
- Configurable via `--recency-depth N`
- If fewer than 2 weekly summaries exist (new project), skip this pass

#### Pass 2: Semantic (query-driven)

Standard semantic search across **all indexed content** (weekly summaries, monthly summaries, typed memories). Returns top-N results ranked by embedding similarity to the query.

This finds:
- Relevant medium-term episodic context ("what did we decide about auth 3 months ago?")
- Relevant long-term episodic context ("how did we handle the 2025 migration?")
- Relevant typed memories ("we use PostgreSQL, not MySQL")

#### Merge and Deduplicate

1. Combine recency + semantic results
2. Deduplicate by URI (if a recent weekly also scored high semantically, keep it once)
3. Apply **type-based priority boost**: typed memories get a relevance boost over episodic summaries at the same semantic score (pre-extracted knowledge is more actionable than narrative)
4. Trim to token budget

### Frontmatter for Indexed Files

Weekly and monthly summaries should include frontmatter so recall can filter by type and date range without parsing filenames:

```markdown
---
type: weekly
week: 2026-W11
teammate: scribe
period: 2026-03-09 to 2026-03-15
---
```

```markdown
---
type: monthly
month: 2026-03
teammate: scribe
period: 2026-03-01 to 2026-03-31
---
```

Typed memories already have frontmatter (`name`, `description`, `type`). No changes needed there.

### Recall ↔ Prompt Assembly Flow

```
adapter.ts builds prompt:
    ┌─ SOUL.md                          (always, direct)
    ├─ WISDOM.md                        (always, direct)
    ├─ Last 3 daily logs                (always, direct)
    ├─ Recency: 2–3 recent weeklies     (always, via recall)
    ├─ Semantic: relevant memories       (query-driven, via recall)
    └─ Task prompt
```

The open question is whether the recency pass should be done by recall (as a search mode) or by `adapter.ts` directly (just read the 2 most recent files from `memory/weekly/`). Doing it in recall keeps the adapter simple; doing it in adapter avoids a recall dependency for basic context.

**Recommendation:** Do recency in `adapter.ts` (it's just reading 2 files by date), semantic in recall. This means adapter.ts loads: SOUL + WISDOM + 3 dailies + 2 weeklies. Recall handles everything else on-demand.

## Compaction Triggers

- **Weekly**: automatic, every 7 days (or via command)
- **Monthly**: automatic, when weekly files exceed 52 weeks
- **Wisdom**: manual via `/compact` (unchanged from current system)

## Open Questions

- Should compaction be a CLI command (`/compact-episodic`) or handled by the teammate autonomously?
- What format should weekly/monthly summaries use? (narrative vs structured)
- Should the adapter load recent weekly summaries directly, or should this go through recall? (see Recall ↔ Prompt Assembly section)
- Should typed memories get a configurable relevance boost, or a fixed multiplier?
