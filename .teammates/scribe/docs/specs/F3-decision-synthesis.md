# F3 — Decision & Memory Synthesis

Spec for a cross-teammate semantic query engine with authority ranking and decision archaeology.

**Status:** Draft
**Owner:** Scribe (spec, authority rules, docs) → Beacon (implementation)
**Priority:** Tier 1 — linchpin feature (14pts). F1, F4, F8, F12 all depend on cross-teammate search.

---

## Problem

Each teammate has its own recall index. There's no way to:
- Search across all teammates simultaneously ("what do we know about auth?")
- Rank results by ownership authority (beacon's memory about CLI code > scribe's memory about CLI code)
- Trace decisions across multiple sources ("why did we switch from MEMORIES.md to WISDOM.md?")
- Deduplicate overlapping memories from different teammates

The recall system is per-teammate. This feature makes it team-wide.

## Design

### Query Interface

A new `/search` command for cross-teammate queries, and a `/decision` command for decision archaeology:

```
/search auth middleware          → search all teammates for "auth middleware"
/search @beacon cli refactor    → search only beacon's index
/search --type feedback testing → search for feedback-type memories about testing
/decision WISDOM.md             → trace the decision trail for WISDOM.md
/decision why three tiers       → find why we chose three-tier memory
```

### Cross-Index Search

The engine queries every teammate's recall index in parallel, then merges and ranks results.

```
/search query
    │
    ├─── recall query → beacon index ──── results[]
    ├─── recall query → scribe index ──── results[]
    ├─── recall query → pipeline index ── results[]
    │
    ▼
Merge + Deduplicate + Authority Rank
    │
    ▼
Top N results with source attribution
```

### Authority Ranking

Not all memories are equally authoritative. A teammate's memory about their own domain should rank higher than another teammate's memory about the same topic.

#### Authority Score Formula

```
final_score = semantic_similarity * authority_weight
```

Where `authority_weight` is determined by:

| Condition | Weight | Rationale |
|-----------|--------|-----------|
| Memory is from the **primary owner** of the topic's domain | 1.5x | The owner's perspective is most authoritative |
| Memory is from a **secondary owner** | 1.2x | Co-owners have informed perspectives |
| Memory is from an **unrelated teammate** | 1.0x | No boost, but still included |
| Memory is a **typed memory** (vs episodic summary) | 1.3x | Pre-extracted knowledge is more actionable than narrative |
| Memory is from **DECISIONS.md** | 1.4x | Decisions are high-signal by design |

Authority weights multiply. A typed memory from the primary owner gets `1.5 * 1.3 = 1.95x` boost.

#### Domain Detection

To determine if a result is "about" a teammate's domain, the engine checks:
1. **File path matching** — does the query mention a file path that matches a teammate's ownership patterns?
2. **Keyword matching** — does the query contain routing keywords from a teammate's SOUL.md?
3. **Explicit scope** — did the user specify `@teammate` in the query?

If no domain is detected, all teammates get equal weight (1.0x).

### Deduplication

Multiple teammates may have memories about the same event (e.g., both scribe and beacon logged a handoff). The engine deduplicates by:

1. **Semantic similarity** — if two results from different teammates have >0.90 cosine similarity, they're likely about the same thing
2. **Keep the higher-authority result** — drop the lower-scored duplicate
3. **Add attribution** — note that multiple teammates mentioned this topic: `[beacon, scribe]`

### Decision Archaeology (`/decision`)

Decision archaeology is a specific query pattern built on top of cross-index search. It traces the full decision trail for a topic:

```
/decision WISDOM.md
```

The engine:
1. Searches all indexes for the topic ("WISDOM.md")
2. Searches DECISIONS.md entries for matching keywords
3. Searches git log for commits mentioning the topic
4. Filters results to **decision-relevant** types: `project` memories, DECISIONS.md entries, daily log entries containing "decision", "decided", "chose", "switched", "replaced"
5. Orders results chronologically (oldest first) to show the decision trail
6. Routes to `@claude` for synthesis

#### Decision Trail Output Template

```markdown
# Decision Trail — {topic}

## Timeline
- **{date}** [{source}] — {what happened}
- **{date}** [{source}] — {what happened}
- ...

## Key Decision Points
1. **{decision}** ({date})
   - **Context:** {why this came up}
   - **Alternatives considered:** {what else was discussed}
   - **Decided by:** {teammate or user}
   - **Source:** {DECISIONS.md entry / memory / commit}

## Current State
- {what the current decision is and where it's codified}

## Related Memories
- {additional context from typed memories}
```

### Result Format

Search results are displayed with source attribution and authority context:

```markdown
## Results for "auth middleware"

1. **[beacon] feedback_auth_patterns.md** (score: 0.92, authority: primary owner)
   > Never store session tokens in middleware state — use request-scoped context...

2. **[beacon] 2026-W11 weekly summary** (score: 0.85)
   > Refactored auth middleware to use request-scoped tokens per legal compliance...

3. **[pipeline] project_auth_rewrite.md** (score: 0.78)
   > Auth middleware rewrite driven by legal/compliance requirements...
   > [also mentioned by: scribe]

4. **[DECISIONS.md] D004** (score: 0.76, authority: decision record)
   > Auth middleware uses request-scoped tokens, not middleware state...
```

### Search Filters

| Filter | Syntax | Description |
|--------|--------|-------------|
| Teammate scope | `@beacon` | Only search that teammate's index |
| Memory type | `--type feedback` | Only return memories of this type |
| Date range | `--since 2026-03-01` | Only return memories after this date |
| Limit | `--limit 10` | Max results (default: 10) |

### New Types

```typescript
export interface CrossSearchResult {
  teammate: string;
  source: string;           // file path relative to teammate dir
  sourceType: "typed_memory" | "weekly" | "monthly" | "decision" | "daily";
  content: string;          // matched content snippet
  score: number;            // raw semantic similarity
  authorityWeight: number;  // multiplier based on ownership
  finalScore: number;       // score * authorityWeight
  duplicateOf?: string[];   // teammate names with duplicate memories
  date?: string;            // ISO date if parseable from source
}

export interface DecisionTrail {
  topic: string;
  timeline: Array<{
    date: string;
    source: string;
    teammate: string;
    summary: string;
  }>;
  decisions: Array<{
    decision: string;
    date: string;
    context: string;
    alternatives: string[];
    decidedBy: string;
    source: string;
  }>;
  currentState: string;
}
```

## CLI Integration

### New Commands

| Command | Description |
|---------|-------------|
| `/search <query>` | Cross-teammate semantic search |
| `/search @<teammate> <query>` | Teammate-scoped search |
| `/search --type <type> <query>` | Type-filtered search |
| `/decision <topic>` | Decision archaeology — trace the decision trail |

Aliases: `/find` for `/search`

### Integration with Non-Interactive Mode (S17)

```bash
# CI: check for relevant decisions before a PR
teammates -p "/decision auth middleware" --format json

# Script: search all memories for a topic
teammates -p "/search database migration" --format text
```

### Integration with F1 (Temporal Awareness)

F1's source gathering phase can use cross-index search instead of per-teammate recall queries:

```
# Before F3: F1 queries each index separately
# After F3: F1 calls crossSearch(query, { dateRange }) once
```

This makes F1 faster and more accurate for team-wide catch-ups.

## Recall Package Changes (for Beacon)

The `@teammates/recall` package needs new APIs:

```typescript
// New: search across multiple indexes
export async function crossSearch(
  query: string,
  teammatesDir: string,
  options?: {
    teammates?: string[];      // filter to specific teammates
    types?: string[];          // filter by memory type
    since?: string;            // ISO date
    limit?: number;            // max results per index
  }
): Promise<CrossSearchResult[]>;

// New: get ownership patterns for authority ranking
export function getOwnershipPatterns(
  teammatesDir: string
): Map<string, { primary: string[]; secondary: string[] }>;
```

The `crossSearch` function:
1. Lists all teammate indexes in `.teammates/`
2. Queries each in parallel using the existing `search()` function
3. Loads ownership patterns from each teammate's SOUL.md (cached at init)
4. Computes authority weights based on query-domain matching
5. Merges, deduplicates, and sorts by `finalScore`

## Documentation Updates (Scribe)

- Add `/search` and `/decision` to CLI README slash commands table
- Add "Search Across Teammates" and "Trace a Decision" recipes to cookbook
- Add "Cross-Teammate Search" section to working-with-teammates guide
- Document authority ranking rules in PROTOCOL.md (so teammates understand why some memories rank higher)
- Update ARCHITECTURE.md with cross-index search flow

## Implementation Notes (for Beacon)

- Start with the `crossSearch` function in the recall package — it's the core primitive
- Authority ranking can be approximate in v1 — exact domain detection can improve iteratively
- Deduplication threshold (0.90 cosine similarity) may need tuning — start conservative and lower if too many duplicates survive
- Decision archaeology reuses `crossSearch` with post-filtering — it's not a separate search path
- Git log integration for `/decision` uses `git log --all --grep="<topic>"` — filter to relevant commits
- Cache ownership patterns per session (they don't change during a session)
- The DECISIONS.md parser should extract individual entries by `## D###` headers

## Dependencies

- **F3 unblocks F1** — cross-index search makes temporal queries faster and more complete
- **F3 unblocks F4** — code review needs to search the reviewer's memories for relevant context
- **F3 unblocks F8** — drift detection needs to compare memories across teammates
- **F3 unblocks F12** — predictive routing needs recall freshness across all indexes

## Future Extensions (not in v1)

- **Relevance feedback** — user marks results as helpful/not helpful, adjusts authority weights
- **Auto-indexing DECISIONS.md** — index decision entries as first-class searchable documents
- **Cross-project search** — search across multiple projects' `.teammates/` directories
- **Memory graph** — visualize connections between memories, decisions, and teammates
