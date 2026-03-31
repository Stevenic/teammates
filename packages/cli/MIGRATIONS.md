# Migration Guide

Instructions for upgrading teammate memory files between CLI versions. Each section describes what needs to change when upgrading TO that version. The coding agent receives the relevant sections and applies the changes.

## 0.6.0

Compress all uncompressed daily log files in the teammate's `memory/` directory.

**What to do:**
- Find all daily log files (`memory/YYYY-MM-DD.md`) that do NOT have `compressed: true` in their YAML frontmatter
- For each uncompressed daily log:
  - Compress the content into a concise summary preserving key decisions, files changed, and outcomes
  - Add `compressed: true` to the YAML frontmatter
  - Keep other frontmatter fields intact (e.g. `type`)
- If the file has no frontmatter, add one with `type: daily` and `compressed: true`

## 0.7.0

Scrub system task noise and cap WISDOM.md.

**What to do:**
1. **Scrub system task entries** — In all daily logs and weekly summaries, remove any `## Task:` sections that are about system maintenance:
   - Wisdom compaction or distillation
   - Log compression or daily compression
   - Auto-compaction or compaction for budget
   - Startup compaction or maintenance
   - Scrubbing system tasks
   - Any other internal housekeeping that isn't user-requested work

2. **Cap WISDOM.md at ~20 high-value entries** — Purge implementation recipes. Entries should be *decision rationale* and *gotchas*, not API documentation. If it's derivable from reading the code (function signatures, file paths, parameter lists), it doesn't belong in WISDOM.md. Keep only entries that represent:
   - Decisions that would cause bugs if forgotten
   - Gotchas that burned real debugging time
   - Architectural invariants that aren't obvious from the code
   - Process rules the team agreed on

## 0.7.3

Remove `version:` lines from all memory file YAML frontmatter. The version field caused merge conflicts and serves no purpose.

**What to do:**
1. **Strip `version:` from all memory files** — In all memory files (`memory/*.md`, `memory/weekly/*.md`, `memory/monthly/*.md`), remove the `version: <any>` line from the YAML frontmatter block. Keep all other frontmatter fields (`type`, `week`, `period`, `compressed`, `name`, `description`, etc.) intact.

2. **Strip embedded version frontmatter** — Some weekly/monthly summaries contain `version:` lines embedded inside their content (from compressed daily logs). Find and remove those `version:` lines as well, keeping the rest of the embedded frontmatter intact.

**Example — before:**
```yaml
---
version: 0.7.0
type: weekly
week: 2026-W14
period: 2026-03-30 to 2026-03-30
---
```

**Example — after:**
```yaml
---
type: weekly
week: 2026-W14
period: 2026-03-30 to 2026-03-30
---
```
