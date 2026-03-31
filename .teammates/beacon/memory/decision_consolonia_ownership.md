---
name: Consolonia ownership
description: Beacon's top-level identity and routing scope explicitly include @teammates/consolonia alongside recall and cli.
type: decision
---

# Consolonia ownership

Beacon owns `@teammates/consolonia` in addition to `@teammates/recall` and `@teammates/cli`.

## Why this exists

The detailed ownership list in `SOUL.md` already covered:

- `consolonia/src/**`
- `consolonia/package.json`
- `consolonia/tsconfig.json`

But Beacon's top-level identity text only named recall and cli. Later wording also shortened the package name to plain `consolonia`. That made routing and self-introductions incomplete and slightly inconsistent with the actual package manifest.

## Decision

Beacon's self-description and task routing should explicitly mention `@teammates/consolonia` whenever describing Beacon's owned repo areas at a high level. Using the scoped package name is the canonical wording.
