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

**Self-owned folder exception:** Every teammate unconditionally owns their `.teammates/<name>/` folder. You never need permission to edit your own SOUL.md, MEMORIES.md, memory logs, or private docs. The Boundary Rule applies to the **codebase** (source code, configs, shared framework files), not to your own teammate folder.

### Cross-Domain Tasks

When a task spans multiple teammates' domains:

1. **Identify the primary owner** — the teammate whose domain is most affected by the change.
2. **The primary owner leads** — they coordinate the work and make final decisions within their domain.
3. **Secondary owners review** — teammates with secondary ownership of affected paths should review changes that touch their interfaces.
4. **Hand off, don't reach across** — if you need changes in another teammate's domain, hand off with a clear task description. Do not modify their files directly.

## Dependency Direction

Changes flow downstream. When modifying shared interfaces:

```
<Upstream Layer> (data/foundation)
  ↓
<Middle Layer> (logic/processing)
  ↓
<Downstream Layer> (interface/presentation)
```

- **Breaking changes propagate downstream.** If an upstream teammate changes an interface, downstream teammates must adapt.
- **Feature requests propagate upstream.** If a downstream teammate needs a new capability, they request it from the appropriate upstream teammate.

## Conflict Resolution

| Conflict Type | Resolution Rule |
|---|---|
| Architecture / data model | Deeper-layer teammate wins |
| UX / interaction design | Closer-to-user teammate wins |
| API surface / interface | Producing teammate defines, consuming teammate adapts |
| Testing strategy | Quality teammate advises, domain owner decides |
| Performance tradeoffs | Domain owner decides for their layer |

## Cross-Cutting Concerns

If the team includes a cross-cutting teammate (e.g., for quality/testing):

- They own test infrastructure and evaluation frameworks
- They advise on testing strategy but do not override domain decisions
- They maintain quality metrics and benchmarks

## Services

Optional services are declared in `.teammates/services.json`. This file is checked into git so the entire team shares the same service configuration. Each key is a service name; the value is a config object (`{}` means installed with defaults).

The CLI reads `services.json` to detect which services are available and injects their capabilities into teammate prompts automatically. Services are installed via the `/install` command.

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

## Adding New Teammates

1. Copy the SOUL.md and MEMORIES.md templates from [TEMPLATE.md](TEMPLATE.md) to a new folder under `.teammates/`
2. Fill in all sections with project-specific details
3. Update README.md roster, last-active date, and routing guide
4. Update existing teammates' SOUL.md ownership and boundary sections if domains shift
