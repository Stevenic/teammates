# F1 — Temporal Awareness Engine

Spec for a "What happened?" query system that reconstructs timelines from memory and renders them through different lenses.

**Status:** Draft
**Owner:** Scribe (spec, output templates, docs) → Beacon (implementation)
**Priority:** Tier 1 — highest-voted novel feature (19pts). Makes the entire memory system consumable.

---

## Problem

The teammates memory system stores a lot of information (daily logs, weekly summaries, typed memories, commit history) but has no way to answer temporal questions:
- "What happened while I was away for 3 days?"
- "What's the story of `packages/cli/src/cli.ts` this week?"
- "Give me a team standup for today."
- "What did @beacon work on yesterday?"

Users must manually read multiple daily logs, cross-reference standups, and piece together the narrative themselves.

## Design

### Query Interface

A new `/catchup` command (with aliases `/timeline`, `/whatsnew`) that accepts a natural-language time query and optional scope filters:

```
/catchup                           → default: everything since last user activity
/catchup last 3 days               → team-wide timeline for 3 days
/catchup @beacon yesterday         → beacon's activity yesterday
/catchup cli.ts this week          → file-focused narrative for cli.ts
/catchup standup                   → synthesized team standup for today
```

### Query Parsing

The command accepts free-form text. The engine extracts three dimensions:

| Dimension | Default | Examples |
|-----------|---------|---------|
| **Time range** | Since last user activity (inferred from daily log gaps) | "last 3 days", "yesterday", "this week", "since Monday", "March 14-16" |
| **Scope** | All teammates | `@beacon`, `@scribe`, `@everyone` |
| **Lens** | `catchup` | `standup`, `file:<path>`, `catchup` |

The query parser doesn't need to be perfect — it extracts what it can and falls back to sensible defaults. The actual timeline reconstruction is done by the agent using the gathered sources.

### Data Sources

The engine gathers raw material from multiple sources, then passes it to the teammate's agent for synthesis:

| Source | What it provides | How accessed |
|--------|-----------------|--------------|
| Daily logs (`memory/YYYY-MM-DD.md`) | Detailed session-by-session work | Direct file read (adapter injects last 7) |
| Weekly summaries (`memory/weekly/`) | Compacted week narratives | Recall search + direct read for recent |
| Standup entries (`_standups/YYYY-MM-DD.md`) | Teammate Done/Next bullets | Direct file read |
| Typed memories | Decisions, feedback, project context | Recall semantic search |
| Git log | Commits, file changes, authors | `git log --since=<date> --until=<date>` |
| DECISIONS.md | Architectural decisions | Direct file read |

### Source Gathering Strategy

The engine doesn't synthesize — it **gathers** and lets the agent synthesize. The strategy depends on the time range:

| Time range | Sources gathered |
|------------|-----------------|
| ≤ 7 days | Daily logs (direct read) + standups + git log + recall query |
| 8-52 days | Weekly summaries (direct read) + recall query + git log |
| > 52 days | Monthly summaries + recall query + git log (expensive, warn user) |

For teammate-scoped queries (`@beacon`), only that teammate's files are gathered. For file-scoped queries (`cli.ts`), the git log is filtered to that path and recall is queried with the filename.

### Output Templates (Lenses)

Each lens defines how the gathered data should be presented. These are injected into the agent's prompt as formatting instructions.

#### Lens: `catchup` (default)

```markdown
# What happened — {time_range}

## {Teammate Name}
- {bullet summary of key work items, decisions, and outcomes}
- {any handoffs sent or received}
- {blockers or open questions}

## {Next Teammate}
...

### Key Decisions
- {any DECISIONS.md entries or decision-type memories from the period}

### Files Most Changed
- {top 5 files by commit count in the period}
```

#### Lens: `standup`

```markdown
# Team Standup — {date}

## {Teammate}
**Done:** {1-3 bullets from daily log / standup file}
**Next:** {planned work from daily log / standup file}

## {Next Teammate}
...
```

#### Lens: `file:{path}`

```markdown
# File History — {path} ({time_range})

## Timeline
- **{date}** — {who}: {what changed and why} ({commit hash})
- **{date}** — {who}: {what changed and why} ({commit hash})

## Context
- {relevant typed memories mentioning this file}
- {relevant decisions affecting this file}

## Current State
- **Owner:** {teammate from ownership patterns}
- **Last modified:** {date} by {teammate}
```

### Implementation Architecture

The temporal awareness engine is **not a standalone module** — it's a specialized prompt template that the orchestrator routes to the appropriate teammate (or to the user's agent for team-wide queries).

```
/catchup last 3 days
    │
    ▼
CLI parses query → extract time range, scope, lens
    │
    ▼
Gather sources:
  - Read daily logs for date range
  - Read standup files for date range
  - Run git log --since --until
  - Query recall with "activity summary {date range}"
    │
    ▼
Build synthesis prompt:
  - "Here are the raw sources for {time_range}:"
  - {gathered data}
  - "Synthesize this into the following format:"
  - {lens template}
    │
    ▼
Route to agent:
  - @teammate scoped → that teammate's agent
  - team-wide → user's agent (general agent, has no domain bias)
    │
    ▼
Agent produces formatted output
```

### Routing

| Query scope | Routed to | Rationale |
|-------------|-----------|-----------|
| `@beacon` | beacon's agent | Teammate synthesizes their own activity best |
| `@everyone` / no scope | user's agent | Neutral agent, no domain bias for team-wide summaries |
| `file:path` | Owner of that file path | Owner has most context about their files |
| `standup` | user's agent | Cross-team synthesis needs neutrality |

### "Since Last Activity" Detection

The default time range ("catch me up") should detect when the user was last active. Heuristic:
1. Check the most recent daily log across all teammates that was NOT today
2. The gap between that date and today is the catch-up window
3. If no gap (user was active yesterday), default to "last 24 hours"

This makes `/catchup` with no arguments do the right thing for a user returning after a break.

## CLI Integration

### New Command: `/catchup`

| Usage | Description |
|-------|-------------|
| `/catchup` | Catch up since last activity |
| `/catchup <time>` | Catch up over a specific period |
| `/catchup @<teammate> <time>` | Teammate-scoped catch-up |
| `/catchup standup` | Synthesized team standup |
| `/catchup file:<path> <time>` | File-focused narrative |

Aliases: `/timeline`, `/whatsnew`

### Integration with Non-Interactive Mode (S17)

```bash
# CI: generate a daily team summary
teammates -p "/catchup yesterday" --format text > daily-summary.md

# Slack integration: post catch-up to channel
teammates -p "/catchup last 3 days" --format text | slack-post --channel #team
```

## Documentation Updates (Scribe)

- Add `/catchup` to CLI README slash commands table
- Add "Catch Up After Time Away" recipe to cookbook
- Add "Temporal Awareness" section to working-with-teammates guide
- Document lens templates in a new doc for extensibility

## Implementation Notes (for Beacon)

- The source gathering phase should be a utility function (`gatherTimelineSources(range, scope)`) reusable by F3 (Decision Synthesis)
- Git log parsing: use `git log --format="%H|%an|%ad|%s" --since=X --until=Y` for structured output
- For file-scoped queries, add `-- <path>` to git log
- The synthesis prompt should include the lens template as a formatting instruction, not as a rigid schema — the agent should have freedom to adapt
- Consider caching gathered sources for the session (user often follows up with a narrower query)
- Large time ranges (>30 days) should warn: "This covers X days of history and may take a moment."

## Dependency on F3

F1 gathers and synthesizes data for a single query. F3 (Decision & Memory Synthesis) builds the cross-teammate search engine that makes this faster and more accurate. F1 can ship before F3 — it just uses direct file reads and basic recall queries instead of cross-index search. Once F3 ships, F1's source gathering upgrades to use it.

## Future Extensions (not in v1)

- **Custom lenses** — users define their own output templates in `.teammates/_lenses/`
- **Incremental updates** — `/catchup --since-last` only shows what's new since the last catchup
- **Rich output** — markdown tables, mermaid diagrams for handoff flows
- **Subscription** — `/catchup --subscribe daily` posts a summary automatically (needs cron support)
