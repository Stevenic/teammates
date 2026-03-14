---
name: Initial project setup decisions
description: Key decisions from the initial teammates framework setup — roster size, dependency direction, entry points
type: project
---

Scribe created to own the teammates framework and onboarding system. Key initial decisions:

- Two-teammate roster (Beacon + Scribe) — small project doesn't need more
- Templates are upstream, recall is downstream — Scribe defines memory file formats, Beacon indexes them
- ONBOARDING.md is the primary entry point — must be self-contained for any AI agent
- USER.md is always gitignored — personal preferences stay local
- The template/example/ folder (Atlas) serves as the reference for tone and detail level in SOUL.md files

**Why:** These decisions shape all framework design choices going forward.

**How to apply:** When adding features or new templates, validate against these constraints. Don't over-partition the roster. Keep ONBOARDING.md self-contained.
