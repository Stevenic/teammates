# Teammate Collaboration Protocol

## Common Ethics

All teammates share these baseline ethics:

- Never introduce security vulnerabilities
- Never break existing tests without justification
- Always consider downstream impact on other teammates' domains

Individual teammates may define additional ethics in their SOUL.md specific to their domain.

## Handoff Conventions

When a task spans multiple teammates' domains:

1. **Identify the primary owner** — the teammate whose domain is most affected by the change.
2. **The primary owner leads** — they coordinate the work and make final decisions within their domain.
3. **Secondary owners review** — teammates with secondary ownership of affected paths should review changes that touch their interfaces.

## Dependency Direction

Changes flow downstream. When modifying shared interfaces:

```
Templates (framework definitions)
  ↓
Onboarding (scaffolding instructions)
  ↓
Recall (search tooling)
```

- **Breaking changes propagate downstream.** If Scribe changes the template structure (e.g., MEMORIES.md format), Beacon must adapt recall's indexer/parser.
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

## Memory

### How memory works

Each session, every teammate wakes up fresh. Files are the only persistence layer — there is no RAM between sessions.

At the start of each session, a teammate should read:

1. Their **SOUL.md** — identity, principles, boundaries
2. Their **MEMORIES.md** — curated long-term knowledge
3. Their **memory/YYYY-MM-DD.md** — today's and yesterday's daily logs
4. **USER.md** — who the user is and how they prefer to work

### Two layers of memory

- **MEMORIES.md** — Curated, durable knowledge: decisions, patterns, gotchas, bugs. Edit and refine over time. Remove entries that are no longer relevant.
- **memory/YYYY-MM-DD.md** — Append-only daily logs. Capture what happened during a session: what was worked on, what was decided, what to pick up next. Start a new file each day.

### When to write memory

- Decisions, preferences, and durable facts go to **MEMORIES.md**
- Day-to-day notes and running context go to **memory/YYYY-MM-DD.md**
- If the user says "remember this," write it down immediately
- Before ending a session, write anything worth preserving

### Sharing

- Each teammate maintains their own MEMORIES.md and memory/ for domain-specific lessons
- **Cross-team lessons** go in [CROSS-TEAM.md](CROSS-TEAM.md) — one entry, tagged with affected teammates
- Do NOT duplicate entries across multiple MEMORIES.md files
- **Private docs** — Teammates may create additional files and folders under their own `.teammates/<name>/` directory (e.g., `notes/`, `specs/`, `scratch/`). These are private by default. To make a doc visible to other teammates, add a pointer in [CROSS-TEAM.md](CROSS-TEAM.md) with a brief description of what it contains.

## Adding New Teammates

1. Copy the SOUL.md and MEMORIES.md templates from [TEMPLATE.md](TEMPLATE.md) to a new folder under `.teammates/`
2. Fill in all sections with project-specific details
3. Update README.md roster, last-active date, and routing guide
4. Update existing teammates' SOUL.md ownership and boundary sections if domains shift
