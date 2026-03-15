---
name: Scribe goals — March 2026
description: Current goals and backlog for Scribe's framework/docs ownership areas
type: project
---

## Completed (2026-03-15)

- ~~README.md — reflect consolonia package~~ (done earlier today)
- ~~README.md — reflect docs/teammates-memory.md~~ (done earlier today)
- ~~Template example SOUL.md — add private docs Continuity bullet~~ (done earlier today)
- ~~CROSS-TEAM.md Shared Docs — standup description outdated~~ (done earlier today)
- ~~.teammates/README.md — Last Active dates stale~~ (done earlier today)
- ~~Beacon roster entry missing consolonia~~ (done earlier today)
- ~~Complete worked example~~ — Added WISDOM.md, daily log, typed memories (feedback + project), weekly summary, monthly summary to `template/example/`
- ~~USER.md enrichment~~ — Restructured into About You / How You Work / Current Focus / Anything Else sections
- ~~Template versioning~~ — Added `<!-- template-version: 2 -->` markers to TEMPLATE.md, PROTOCOL.md, README.md, CROSS-TEAM.md

## Active Goals

### P0 — Ship Now
- [x] **S1 — Cookbook / recipes doc** — `docs/cookbook.md` with 11 recipes covering all common workflows
- [x] **S2 — Shared decision log (ADR-lite)** — `template/DECISIONS.md` + `.teammates/DECISIONS.md` with 3 backfilled decisions
- [x] **S3 — Template version migration guide** — `docs/migration-guide.md` with full v1→v2 upgrade steps

### P1 — High Impact
- [ ] **S4 — Teammate lifecycle management** — retire/archive flow for teammates
- [ ] **S5 — `/health` self-audit spec** — design correctness checker, hand off to Beacon
- [ ] **S6 — Conflict resolution protocol** — what happens when two teammates edit the same file

### P2 — Medium Impact
- [ ] **S7 — Template archetypes** — role-specific starting templates
- [ ] **S8 — Post-onboarding checklist** — "first session" verification guide
- [ ] **S9 — Teammate discovery protocol** — how teammates learn about new additions
- [ ] **S10 — Framework changelog** — track template version changes

### P3 — Lower Priority
- [ ] **S11 — Landscape comparison doc**
- [ ] **S12 — Onboarding dry-run mode spec**
- [ ] **S13 — Interactive onboarding questionnaire spec**
- [ ] **S14 — Cross-repo handoff spec**
- [ ] **S15 — npm init teammates scaffolder spec**

## Completed (2026-03-15, batch 2)

- ~~Multi-project onboarding~~ — Added monorepo + multi-repo sections to ONBOARDING.md with step-by-step adaptations and a "When to Use Which" table
- ~~Adoption guide~~ — Created `docs/adoption-guide.md` covering prerequisites, gradual rollout, team FAQ, restructuring guidance, and troubleshooting
- ~~Retrospective mechanism~~ — Designed `/retro` format (Working / Not Working / Proposed Changes / Questions) at `.teammates/scribe/docs/RETRO-FORMAT.md`. Handed off to Beacon for CLI implementation

## Standing Goals

- **Template correctness** — templates must match the live `.teammates/` files and vice versa
- **Onboarding accuracy** — ONBOARDING.md must produce a correct `.teammates/` directory when followed step by step
- **Documentation fidelity** — README.md reflects actual project structure
- **Boundary enforcement** — ensure all teammates know and respect ownership boundaries
- **No broken links** — all internal markdown links resolve correctly
