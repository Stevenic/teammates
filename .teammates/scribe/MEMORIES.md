# Scribe — Memories

Curated long-term lessons, decisions, and patterns. Reverse chronological.

This file is for durable knowledge that stays relevant over time. For day-to-day notes, use `memory/YYYY-MM-DD.md`.

Categories: Bug | Decision | Pattern | Gotcha | Optimization

### 2026-03-13: Boundary Violation — CLI Code
**Category:** Gotcha | **Last updated:** 2026-03-13

Scribe directly modified `cli/src/cli.ts` and created `cli/src/onboard.ts` instead of handing off to Beacon. User corrected this. **Rule: always hand off CLI implementation to @beacon**, even when the feature originates from Scribe's domain (onboarding). Scribe designs, Beacon implements CLI code.

### 2026-03-11: Initial Setup
**Category:** Decision | **Last updated:** 2026-03-11

Scribe created to own the teammates framework and onboarding system. Key initial decisions:
- Two-teammate roster (Beacon + Scribe) — small project doesn't need more
- Templates are upstream, recall is downstream — Scribe defines memory file formats, Beacon indexes them
- ONBOARDING.md is the primary entry point — it must be self-contained enough for any AI agent to follow
- USER.md is always gitignored — it contains personal preferences and should never be committed
- The template/example/ folder (Atlas) serves as the reference for tone and detail level in SOUL.md files
