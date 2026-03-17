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

**Status:** Recall is now bundled as a direct dependency of `@teammates/cli`. The CLI automatically queries the recall index before every task and syncs after every task. Agents no longer need to manually run `teammates-recall search`.

### What Gets Indexed

| Content | Indexed | Reason |
|---------|---------|--------|
| Raw dailies (current week) | No | Already in prompt context (last 7 days), too noisy |
| Weekly summaries | Yes | Primary episodic search surface, 1-year window |
| Monthly summaries | Yes | Long-term episodic context, permanent |
| Typed memories | Yes | Searchable semantic knowledge |
| WISDOM.md | No | Always loaded in prompt, indexing adds nothing |
| SOUL.md | No | Always loaded in prompt |

### Prompt Assembly — Context Window Stack

The CLI (`adapter.ts`) builds the full prompt automatically:

```
adapter.ts builds prompt:
    ┌─ SOUL.md                          (always, direct file read)
    ├─ WISDOM.md                        (always, direct file read)
    ├─ Relevant memories from recall    (automatic, queried using task prompt)
    ├─ Last 7 daily logs                (always, direct file reads)
    ├─ Weekly summaries                 (always, direct file reads)
    ├─ Session history                  (injected as content from session file)
    ├─ Roster                           (all teammates and roles)
    ├─ Memory/session write instructions
    ├─ Output protocol
    └─ Conversation history + task
```

Recall queries run in-process via library imports (`queryRecallContext`), not subprocess spawning. The task prompt is used as the search query to find relevant episodic summaries and typed memories.

### Sync Lifecycle

1. **After every agent task** — CLI calls `syncRecallIndex()` to pick up any files the agent created/modified
2. **After `/compact`** — CLI calls `syncRecallIndex()` to re-index after compaction changes files
3. **Before every task** — CLI calls `queryRecallContext()` with `skipSync: true` (fast, relies on post-task sync being current)

### Frontmatter for Indexed Files

Weekly and monthly summaries include frontmatter so recall can filter by type and date range:

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

## Compaction Triggers

- **Weekly**: automatic, every 7 days (or via command)
- **Monthly**: automatic, when weekly files exceed 52 weeks
- **Wisdom**: manual via `/compact` (unchanged from current system)

## Resolved Questions

- **Compaction trigger:** `/compact` CLI command (implemented)
- **Summary format:** Narrative with frontmatter (implemented)
- **Weekly loading:** Adapter loads recent weeklies directly; recall handles semantic search (implemented)
- **Recall integration:** Bundled as CLI dependency, automatic pre-task query (implemented)
