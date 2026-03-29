---
version: 0.7.0
name: Persona templates are folder-based
description: Bundled CLI personas now live in per-persona folders with SOUL.md and WISDOM.md instead of single markdown files.
type: decision
---
# Persona templates are folder-based

Date: 2026-03-29

## Decision

Bundled persona templates for `@teammates/cli` live under `packages/cli/personas/<slug>/` with:

- `SOUL.md` containing the persona metadata frontmatter plus the SOUL template body
- `WISDOM.md` containing the paired wisdom template

The loader discovers persona directories, parses metadata from `SOUL.md`, and scaffolding copies both files with `<Name>` substitution.

## Why

- Persona-specific wisdom should be template data, not hardcoded scaffolder output.
- The resulting structure matches real teammate folders, so persona templates are easier to inspect and evolve.
- Future persona changes can touch either SOUL or WISDOM independently without adding code paths.

## Notes

- Legacy top-level `packages/cli/personas/*.md` files may still exist if a sandbox blocks deletion; the loader must ignore them because it only reads directories.
