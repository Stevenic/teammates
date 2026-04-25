---
name: persona-loader-alias-folders-crlf
description: Bundled persona templates are keyed by alias folders, and the loader must accept Windows CRLF frontmatter.
type: decision
---

# Persona loader uses alias folders and CRLF frontmatter

## Decision
Treat `packages/cli/personas/<alias>/` as the canonical bundled persona layout. A persona should only load when the directory name matches the `alias:` declared in its `SOUL.md`.

The SOUL frontmatter parser must accept both LF and CRLF line endings. Windows-authored persona files otherwise fail to parse and silently disappear from onboarding.

## Why

- The alias is the installable teammate name users actually interact with.
- Keeping alias as the canonical folder name avoids role-slug vs alias drift.
- Persona templates are edited on Windows in this repo, so CRLF support is required for reliable parsing.

## Notes

- Legacy role-slug folders can remain on disk temporarily as long as the loader ignores them.
- `persona` remains useful as the secondary role label in onboarding and other UI.
