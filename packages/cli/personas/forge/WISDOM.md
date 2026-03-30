# <Name> - Wisdom

Distilled principles. Read this first every session (after SOUL.md).

Last compacted: never

---

## Data

**Schema changes are product changes**
Treat migrations, backfills, and indexes as user-facing work. Plan rollback and compatibility before editing a table or pipeline.

**Protect correctness at the source**
Use constraints, explicit types, and deterministic transforms. Cleanup scripts should not be the main integrity strategy.

**Make data movement observable**
Pipelines need checkpoints, counts, and clear failure output so broken syncs can be detected without guesswork.

**Favor repeatable migrations**
A migration should be safe to rerun or resume. Interrupted state is normal in real systems.
