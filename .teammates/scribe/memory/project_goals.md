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

### 1. Multi-project onboarding
ONBOARDING.md assumes a single repo. Support monorepos or multi-repo setups where teammates span repos. Needs design before implementation.

### 2. Adoption guide
A doc covering "how to introduce teammates to an existing team" — pitching it, rolling it out incrementally, what to expect. Target: `docs/adoption-guide.md`.

### 3. Retrospective mechanism
A `/retro` command or structured format where teammates review what went well/poorly and propose changes to their own SOUL.md. Needs design, then handoff to Beacon for CLI implementation.

## Standing Goals

- **Template correctness** — templates must match the live `.teammates/` files and vice versa
- **Onboarding accuracy** — ONBOARDING.md must produce a correct `.teammates/` directory when followed step by step
- **Documentation fidelity** — README.md reflects actual project structure
- **Boundary enforcement** — ensure all teammates know and respect ownership boundaries
- **No broken links** — all internal markdown links resolve correctly
