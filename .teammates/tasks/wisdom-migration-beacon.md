# Task: Update CLI and Recall for Three-Tier Memory System

## Context

Scribe has migrated the framework from the two-layer memory system (MEMORIES.md + daily logs) to a three-tier system:

- **Tier 1 — Daily Logs** (`memory/YYYY-MM-DD.md`) — unchanged
- **Tier 2 — Typed Memories** (`memory/<type>_<topic>.md`) — individual files with frontmatter (`name`, `description`, `type`)
- **Tier 3 — WISDOM.md** — distilled principles, replaces MEMORIES.md as the curated file

MEMORIES.md no longer exists. WISDOM.md takes its place in the read order (SOUL.md → WISDOM.md → daily logs → memories on-demand).

## What needs to change

### CLI (`cli/src/`)

1. **`adapter.ts`** — Update prompt hydration to read WISDOM.md instead of MEMORIES.md. Also inject typed memory files from `memory/` that match relevant types.
2. **`registry.ts`** — Update any references to MEMORIES.md in teammate file discovery.
3. **`types.ts`** — Update any type definitions that reference MEMORIES.md.
4. **`onboard.ts`** — Update onboarding flow to create WISDOM.md instead of MEMORIES.md.
5. **`registry.test.ts`** — Update tests to reflect new file structure.

### CLI Templates (`cli/template/`)

6. **`cli/template/TEMPLATE.md`** — Should match `template/TEMPLATE.md` (already updated by Scribe).
7. **`cli/template/PROTOCOL.md`** — Should match `template/PROTOCOL.md` (already updated by Scribe).
8. **`cli/template/README.md`** — Update MEMORIES.md references.
9. **`cli/template/CROSS-TEAM.md`** — Update MEMORIES.md references.
10. **`cli/template/example/SOUL.md`** — Update Continuity section.

### Recall (`recall/`)

11. **`recall/src/indexer.ts`** — Update to index WISDOM.md + typed memory files instead of MEMORIES.md. Typed memories have frontmatter that could be used as metadata for search.
12. **`recall/README.md`** — Update documentation.
13. **`recall/package.json`** — Update description if it mentions MEMORIES.md.

### Beacon's own files

14. **`.teammates/beacon/SOUL.md`** — Update Continuity section (MEMORIES.md → WISDOM.md) and boundaries description.
15. **`.teammates/beacon/MEMORIES.md`** — Migrate to WISDOM.md + typed memories, then delete MEMORIES.md.

## Key design points

- Typed memory files have this frontmatter: `name`, `description`, `type` (user/feedback/project/reference)
- The `description` field is a one-line summary useful for relevance matching during search
- WISDOM.md is a single flat file, not individual files
- Compaction (memories → wisdom) happens via `/compact` command or every 7 days
- See `template/TEMPLATE.md` for the full spec with formats and examples
