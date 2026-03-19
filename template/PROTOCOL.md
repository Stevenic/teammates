# Teammate Collaboration Protocol

<!-- template-version: 2 -->

## Common Ethics

All teammates share these baseline ethics:

- Never introduce security vulnerabilities
- Never break existing tests without justification
- Always consider downstream impact on other teammates' domains

Individual teammates may define additional ethics in their SOUL.md specific to their domain.

## Handoff Conventions

### Boundary Rule

**Never write code or modify files outside your ownership.** If a task requires changes to files you don't own, hand off that portion to the owning teammate. Design the behavior, write a spec if needed, then hand off — don't implement it yourself, even if the fix seems small or obvious. Your Boundaries section lists what you do NOT touch and who does.

**Self-owned folder exception:** Every teammate unconditionally owns their `.teammates/<name>/` folder. You never need permission to edit your own SOUL.md, WISDOM.md, memory files, or private docs. The Boundary Rule applies to the **codebase** (source code, configs, shared framework files), not to your own teammate folder.

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

Memory operates on two independent axes:

```
Episodic (timeline):   Daily Logs → Weekly Summaries → Monthly Summaries
                       (raw, days)   (compacted, 52wk)  (compacted, permanent)

Semantic (knowledge):  Typed Memories → WISDOM
                       (durable)        (distilled, permanent)
```

Daily logs feed both axes: episodic compaction produces weekly/monthly summaries, while durable facts and lessons extracted during compaction become typed memories that eventually distill into wisdom.

### Context window — what the CLI injects

The CLI automatically builds each teammate's context before every task. The prompt is assembled within a **32k token budget** for memory context, with smart allocation across sources.

The prompt stack (in order):

1. **SOUL.md** — identity, principles, boundaries (always, outside budget)
2. **WISDOM.md** — distilled principles from compacted memories (always, outside budget)
3. **Relevant memories from recall** — automatically queried using the task prompt; returns matching episodic summaries and typed memories from the vector index (at least 8k tokens, plus any unused daily log budget)
4. **Recent daily logs** — today's log is always included; days 2-7 are included most-recent-first up to 24k tokens (whole entries only, never truncated mid-entry)
5. **Session state** — path to the session file (`.teammates/.tmp/sessions/<name>.md`); the agent reads and writes it directly for cross-task continuity
6. **Roster** — all teammates and their roles
7. **Memory update instructions** — how to write daily logs, typed memories, and WISDOM.md
8. **Output protocol** — response format and handoff syntax
9. **Current date/time**
10. **Task** — the user's message (always, outside budget)

Weekly summaries are **not** injected directly — they are searchable via recall (step 3) and surface when relevant to the task prompt.

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
