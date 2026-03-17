# Teammate Collaboration Protocol

## Common Ethics

All teammates share these baseline ethics:

- Never introduce security vulnerabilities
- Never break existing tests without justification
- Always consider downstream impact on other teammates' domains

Individual teammates may define additional ethics in their SOUL.md specific to their domain.

## Handoff Conventions

### Boundary Rule

**Never write code or modify files outside your ownership.** If a task requires changes to files you don't own, hand off that portion to the owning teammate. Design the behavior, write a spec if needed, then hand off — don't implement it yourself, even if the fix seems small or obvious. Your Boundaries section lists what you do NOT touch and who does.

**Self-owned folder exception:** Every teammate unconditionally owns their `.teammates/<name>/` folder. You never need permission to edit your own SOUL.md, WISDOM.md, memory files, or private docs. The Boundary Rule applies to the **codebase** (source code, configs, shared framework files), not to your own teammate folder. See [CROSS-TEAM.md](CROSS-TEAM.md) for the full ownership scope table.

### Cross-Domain Tasks

When a task spans multiple teammates' domains:

1. **Identify the primary owner** — the teammate whose domain is most affected by the change.
2. **The primary owner leads** — they coordinate the work and make final decisions within their domain.
3. **Secondary owners review** — teammates with secondary ownership of affected paths should review changes that touch their interfaces.
4. **Hand off, don't reach across** — if you need changes in another teammate's domain, hand off with a clear task description. Do not modify their files directly.

## Dependency Direction

Changes flow downstream. When modifying shared interfaces:

```
Templates (framework definitions)
  ↓
Onboarding (scaffolding instructions)
  ↓
Recall (search tooling)
```

- **Breaking changes propagate downstream.** If Scribe changes the template structure (e.g., memory file format), Beacon must adapt recall's indexer/parser.
- **Feature requests propagate upstream.** If Beacon needs a new memory file convention to improve search, they request it from Scribe.

## Conflict Resolution

| Conflict Type | Resolution Rule |
|---|---|
| Template structure / memory format | Scribe wins (upstream owner) |
| Search behavior / indexing strategy | Beacon wins (domain owner) |
| API surface / CLI interface | Beacon defines, Scribe adapts docs |
| Cross-cutting documentation | Scribe leads, Beacon reviews |
| Performance tradeoffs | Domain owner decides for their layer |

## Cross-Cutting Concerns

This is a small team without a dedicated quality teammate. Each teammate owns testing and quality within their domain:

- Beacon owns recall test coverage and search quality
- Scribe owns template completeness and onboarding correctness

## Services

Optional services are declared in `.teammates/services.json`. This file is checked into git so the entire team shares the same service configuration. Each key is a service name; the value is a config object (`{}` means installed with defaults).

The CLI reads `services.json` to detect which services are available and injects their capabilities into teammate prompts automatically.

### Recall — Automatic Memory Search

`@teammates/recall` is bundled as a direct dependency of the CLI. It provides local semantic search across teammate memory files using Vectra vector indexes and on-device embeddings (transformers.js). Zero cloud dependencies.

**How it works:** The CLI automatically queries the recall index before every task, using the task prompt as the search query. Relevant episodic summaries and typed memories are injected into the teammate's context window — no manual search needed.

**Sync:** The CLI automatically syncs the recall index after every task completes and after `/compact` runs. Teammates do not need to run sync manually.

**What gets indexed:**

| Content | Indexed | Reason |
|---------|---------|--------|
| Weekly summaries | Yes | Primary episodic search surface (52-week window) |
| Monthly summaries | Yes | Long-term episodic context (permanent) |
| Typed memories | Yes | Searchable semantic knowledge |
| Raw daily logs | No | Already in prompt context (last 7 days) |
| SOUL.md / WISDOM.md | No | Always loaded directly into prompt |

## Memory

### How memory works

Each session, every teammate wakes up fresh. Files are the only persistence layer — there is no RAM between sessions.

Memory operates on two independent axes:

```
Episodic (timeline):   Daily Logs → Weekly Summaries → Monthly Summaries
                       (raw, days)   (compacted, 52wk)  (compacted, permanent)

Semantic (knowledge):  Typed Memories → WISDOM
                       (durable)        (distilled, permanent)
```

Daily logs feed both axes: episodic compaction produces weekly/monthly summaries, while durable facts and lessons extracted during compaction become typed memories that eventually distill into wisdom.

### Context window — what the CLI injects

The CLI automatically builds each teammate's context before every task. The prompt stack (in order):

1. **SOUL.md** — identity, principles, boundaries
2. **WISDOM.md** — distilled principles from compacted memories
3. **Relevant memories from recall** — automatically queried using the task prompt; returns matching episodic summaries and typed memories from the vector index
4. **Last 7 daily logs** — recent session notes
5. **Weekly summaries** — most recent episodic summaries
6. **Session history** — prior task results from the current CLI session (injected as content, not a file path)
7. **Roster** — all teammates and their roles
8. **Conversation history + task** — the user's message and prior exchanges

Teammates do not need to manually read these files or run recall searches — the CLI handles all context assembly automatically.

### Tier 1 — Daily Logs

`memory/YYYY-MM-DD.md` — Append-only session notes. What was worked on, decided, what to pick up next. Start a new file each day. These are raw scratch — no frontmatter needed. Daily logs from completed weeks are compacted into weekly summaries by `/compact`.

### Tier 1b — Episodic Summaries

`memory/weekly/YYYY-Wnn.md` — Weekly summaries compacted from daily logs (completed weeks only). Kept for 52 weeks.
`memory/monthly/YYYY-MM.md` — Monthly summaries compacted from weekly summaries older than 52 weeks. Kept permanently.

Weekly and monthly files include frontmatter (`type`, `week`/`month`, `teammate`, `period`) for searchability. See [TEMPLATE.md](TEMPLATE.md) for the full format.

### Tier 2 — Typed Memories

`memory/<type>_<topic>.md` — Individual files with frontmatter (`name`, `description`, `type`). Four types:

| Type | When to save |
|---|---|
| `user` | User's role, preferences, knowledge level |
| `feedback` | Corrections or guidance from the user |
| `project` | Ongoing work, goals, deadlines, decisions |
| `reference` | Pointers to external resources |

See [TEMPLATE.md](TEMPLATE.md) for full format, body structure per type, and examples.

### Tier 3 — Wisdom

`WISDOM.md` — Distilled, high-signal principles derived from compacting multiple memories. Compact, stable, rarely changes. Read second (after SOUL.md).

### Compaction

The `/compact` command runs two independent pipelines:

**Episodic compaction** (daily → weekly → monthly):
1. Completed weeks' daily logs are compacted into `memory/weekly/YYYY-Wnn.md`
2. Durable facts and lessons are extracted as typed memories during compaction
3. Raw daily logs are deleted after successful compaction
4. Weekly summaries older than 52 weeks are compacted into `memory/monthly/YYYY-MM.md`

**Semantic compaction** (typed memories → wisdom):
1. Review all typed memory files in `memory/`
2. Identify patterns — recurring themes, reinforced feedback, confirmed lessons
3. Distill into WISDOM.md entries — short, principled, event-agnostic
4. Delete the source memory files that were fully absorbed
5. Leave memories that are still active or evolving
6. Update the "Last compacted" date in WISDOM.md

A good wisdom entry is a **pattern** (not an incident), **principled** (states a rule), **compact** (1-3 sentences), and **actionable** (tells you what to do).

### When to write memory

- User corrections and guidance → typed memory (`feedback`)
- Decisions, deadlines, project context → typed memory (`project`)
- User profile info → typed memory (`user`)
- External resource locations → typed memory (`reference`)
- Session notes and running context → daily log
- If the user says "remember this," write it immediately

### What NOT to save

- Code patterns derivable from the code itself
- Git history — use `git log` / `git blame`
- Debugging solutions — the fix is in the code
- Anything already in WISDOM.md
- Ephemeral task details — use daily logs

### Sharing

- Each teammate maintains their own WISDOM.md and memory/ for domain-specific knowledge
- **Cross-team lessons** go in [CROSS-TEAM.md](CROSS-TEAM.md) — one entry, tagged with affected teammates
- Wisdom is personal to each teammate — do not duplicate across teammates
- **Private docs** — Teammates may create additional files and folders under their own `.teammates/<name>/` directory (e.g., `notes/`, `specs/`, `scratch/`). These are private by default. To make a doc visible to other teammates, add a pointer in [CROSS-TEAM.md](CROSS-TEAM.md) with a brief description of what it contains.

## Folder Naming Convention

Every child folder of `.teammates/` is interpreted by its name prefix:

| Prefix | Meaning | Git behavior | Examples |
|---|---|---|---|
| _(none)_ | Teammate folder | Checked in | `beacon/`, `scribe/` |
| `_` | Shared non-teammate folder | Checked in | `_standups/`, `_tasks/` |
| `.` | Local/ephemeral folder | Gitignored | `.tmp/`, `.index/` |

The CLI uses this convention to detect teammates: any child directory without a `.` or `_` prefix that contains a `SOUL.md` is treated as a teammate. Shared folders (like `_standups/`) are committed to the repo but are not teammates. Dot-prefixed folders (like `.tmp/`) are local-only and always gitignored.

## Adding New Teammates

1. Copy the SOUL.md and WISDOM.md templates from [TEMPLATE.md](TEMPLATE.md) to a new folder under `.teammates/`
2. Fill in all sections with project-specific details
3. Update README.md roster, last-active date, and routing guide
4. Update existing teammates' SOUL.md ownership and boundary sections if domains shift
