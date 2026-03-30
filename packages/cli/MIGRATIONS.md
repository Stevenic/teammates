# Migration Guide

Instructions for upgrading teammate memory files between CLI versions. Each section describes what needs to change when upgrading TO that version. The coding agent receives the relevant sections and applies the changes.

## 0.6.0

Compress all uncompressed daily log files in the teammate's `memory/` directory.

**What to do:**
- Find all daily log files (`memory/YYYY-MM-DD.md`) that do NOT have `compressed: true` in their YAML frontmatter
- For each uncompressed daily log:
  - Compress the content into a concise summary preserving key decisions, files changed, and outcomes
  - Add `compressed: true` to the YAML frontmatter
  - Keep the `version` and `type` fields intact
- If the file has no frontmatter, add one with `version: 0.6.0`, `type: daily`, and `compressed: true`

## 0.7.0

Update version references, scrub system task noise, and cap WISDOM.md.

**What to do:**
1. **Update version frontmatter** — In all memory files (`memory/*.md`, `memory/weekly/*.md`, `memory/monthly/*.md`), change `version: 0.6.0` to `version: 0.7.0` in the YAML frontmatter.

2. **Scrub system task entries** — In all daily logs and weekly summaries, remove any `## Task:` sections that are about system maintenance:
   - Wisdom compaction or distillation
   - Log compression or daily compression
   - Auto-compaction or compaction for budget
   - Startup compaction or maintenance
   - Scrubbing system tasks
   - Any other internal housekeeping that isn't user-requested work

3. **Cap WISDOM.md at ~20 high-value entries** — Purge implementation recipes. Entries should be *decision rationale* and *gotchas*, not API documentation. If it's derivable from reading the code (function signatures, file paths, parameter lists), it doesn't belong in WISDOM.md. Keep only entries that represent:
   - Decisions that would cause bugs if forgotten
   - Gotchas that burned real debugging time
   - Architectural invariants that aren't obvious from the code
   - Process rules the team agreed on
