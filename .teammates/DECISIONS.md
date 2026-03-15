# Decision Log

<!-- template-version: 2 -->

Lightweight record of architectural and process decisions. When someone asks "why did we do X?" — the answer is here.

**Format:** One entry per decision, numbered sequentially. Reverse chronological (newest first).

**When to record:** Any choice that affects multiple teammates, changes a convention, picks a tool, or constrains future work. If you'd want to explain it to someone joining next month, write it down.

**Who records:** Any teammate can add a decision. The teammate who led the discussion writes the entry.

---

## D003 — Retros produce SOUL.md edits, not just text

**Date:** 2026-03-15
**Decided by:** @scribe, user
**Status:** accepted

### Context
The initial retro format produced reflection text but didn't connect back to anything durable. Retros were generating discussion without changing behavior.

### Decision
Retrospectives must produce specific SOUL.md edits as their primary output. The `/retro` command has two phases: reflection (generate proposed changes) and apply (write approved changes to SOUL.md immediately). A retro is not complete until approved changes are written.

### Alternatives considered
- Text-only retros with manual follow-up — too easy to forget, changes never land
- Automatic application without approval — too risky, user should review changes to teammate identity

---

## D002 — Three-tier memory with episodic compaction

**Date:** 2026-03-14
**Decided by:** @scribe, @beacon, user
**Status:** accepted

### Context
The original two-layer memory (MEMORIES.md + daily logs) didn't scale. MEMORIES.md grew unbounded, and there was no way to distinguish between timeline history and extracted knowledge.

### Decision
Memory operates on two independent axes: episodic (daily → weekly → monthly summaries) and semantic (typed memories → WISDOM.md). The `/compact` command runs both pipelines. Daily logs from completed weeks are compacted into weekly summaries (kept 52 weeks), which compact into monthly summaries (kept permanently). Typed memories with frontmatter replace the monolithic MEMORIES.md.

### Alternatives considered
- Keep MEMORIES.md with manual pruning — doesn't scale, no structure for search
- Single compaction pipeline (everything into wisdom) — loses the timeline, can't answer "what happened in week 10?"

---

## D001 — Strict ownership boundaries with handoffs

**Date:** 2026-03-13
**Decided by:** @scribe, user
**Status:** accepted

### Context
Scribe accidentally implemented CLI code that belonged to Beacon's domain. The "small fix" took longer to untangle than a clean handoff would have.

### Decision
Teammates must never modify files outside their ownership, even for small or obvious fixes. If a task requires changes to files you don't own, design the behavior and hand off to the owning teammate. The Boundary Rule is documented in PROTOCOL.md and enforced by convention.

### Alternatives considered
- Allow "minor" cross-boundary edits with review — too subjective, boundary erodes over time
- Shared ownership zones — creates ambiguity about who leads
