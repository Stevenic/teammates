# Cross-Team Notes

Shared lessons that affect multiple teammates. Record here instead of duplicating across individual WISDOM.md files.

This file also serves as a **shared index** — teammates can add pointers to private docs in their folder that other teammates might find useful.

Reverse chronological. Tag affected teammates.

## Ownership Scopes

Every teammate **owns everything** under their `.teammates/<name>/` folder — SOUL.md, WISDOM.md, memory/, and any private docs they create. This is unconditional: no teammate needs permission to edit their own folder, and no other teammate should modify it.

The **Boundary Rule** (see PROTOCOL.md) applies to the **codebase** — source code, configs, and shared framework files — not to a teammate's own `.teammates/<name>/` directory.

| Teammate | Self-owned folder | Codebase ownership (see SOUL.md for full details) |
|---|---|---|
| **Beacon** | `.teammates/beacon/**` | `recall/**`, `cli/**` |
| **Scribe** | `.teammates/scribe/**` | `template/**`, `ONBOARDING.md`, `README.md`, `.teammates/README.md`, `.teammates/PROTOCOL.md`, `.teammates/CROSS-TEAM.md`, `.teammates/TEMPLATE.md` |
| **Pipeline** | `.teammates/pipeline/**` | `.github/**` (workflows, CI/CD config, release automation) |

When adding a new teammate, add a row to this table.

## Projects

Active projects are tracked in **[PROJECTS.md](PROJECTS.md)** — codename, spec link, lead, phase, status.

## Shared Docs

- **[Architecture](scribe/docs/ARCHITECTURE.md)** — Full project architecture: packages, data flow, key patterns, tech stack. Maintained by Scribe. _(added 2026-03-13)_
- **[Episodic Compaction Design](scribe/docs/EPISODIC-COMPACTION.md)** — Design for daily→weekly→monthly memory compaction and its interaction with typed memories + wisdom. Implemented. _(added 2026-03-14)_
- **[Daily Standup Format](scribe/docs/STANDUP-FORMAT.md)** — Async standup format for AI teammates: Done/Next, posted daily to `.teammates/_standups/YYYY-MM-DD.md`. _(added 2026-03-14)_
- **[Retrospective Format](scribe/docs/RETRO-FORMAT.md)** — `/retro` command design: four-section self-review (Working / Not Working / Proposed Changes / Questions). Needs CLI implementation by Beacon. _(added 2026-03-15)_
- **[Cookbook](../docs/cookbook.md)** — Concrete recipes for common workflows: adding teammates, handoffs, retros, compaction, decisions, etc. _(added 2026-03-15)_
- **[Decision Log](DECISIONS.md)** — Shared decision log (ADR-lite). All teammates can record decisions here. _(added 2026-03-15)_
- **[S16 — Hooks Spec](scribe/docs/specs/S16-hooks.md)** — Lifecycle events and shell hook system. For Beacon implementation. _(added 2026-03-17)_
- **[S17 — Non-Interactive Mode Spec](scribe/docs/specs/S17-non-interactive.md)** — Headless `-p` flag for CI/scripts. For Beacon implementation. _(added 2026-03-17)_
- **[S26 — MCP Passthrough Spec](scribe/docs/specs/S26-mcp-passthrough.md)** — MCP server config and per-agent passthrough. For Beacon implementation. _(added 2026-03-17)_
- **[F1 — Temporal Awareness Spec](scribe/docs/specs/F1-temporal-awareness.md)** — `/catchup` command: "What happened?" queries with lens-based rendering. For Beacon implementation. _(added 2026-03-17)_
- **[F3 — Decision Synthesis Spec](scribe/docs/specs/F3-decision-synthesis.md)** — Cross-teammate search with authority ranking + `/decision` command. For Beacon implementation. _(added 2026-03-17)_
- **[Multi-Human Collaboration Spec](scribe/docs/specs/F-multi-human-collaboration.md)** — Design for human avatars, server architecture, handoff queues, presence, and GitHub integration. _(added 2026-03-19)_
- **[P2 — Hands Spec](scribe/docs/specs/P2-hands.md)** — Cross-agent computer use via MCP server: screenshot, click, type, scroll, key, cursor tools. Work allocation across all 3 teammates. _(added 2026-03-20)_
- **[P4 — Persona Catalog](scribe/docs/specs/P4-persona-catalog.md)** — 15 role personas that ship with the CLI as team-building templates. Tiered by commonality, includes team composition guide. _(added 2026-03-21)_
- **[Recall Query Architecture](scribe/docs/specs/F-recall-query-architecture.md)** — Two-pass recall design: LLM-free priming pass + agent-driven mid-task search. Solves the chicken-and-egg query problem. _(added 2026-03-21)_
- **[Collision Prevention](scribe/docs/specs/F-collision-prevention.md)** — 5-layer defense model for preventing code overwrites in multi-human + multi-agent repos: branches, worktrees, ownership routing, active claims, merge queues. _(added 2026-03-22)_
- **[Interrupt and Resume](scribe/docs/specs/F-interrupt-and-resume.md)** — Checkpoint/restore for agent timeouts: kill agent, capture conversation log, replay with user steering as new prompt. Manual `/interrupt` command + automatic timeout-triggered resume. _(added 2026-03-27)_
- **[Avalonia Shell Over Node Engine](scribe/docs/specs/F-avalonia-shell.md)** — Migration spec for replacing the JavaScript UI with an Avalonia/Consolonia shell while keeping the existing Node/TypeScript engine authoritative. Covers shell/engine boundary, JSON transport, MVVM composition, spacing tokens, and rollout phases. _(added 2026-03-30)_
- **[Agent Tabs Shell UX](scribe/docs/specs/F-agent-tabs-shell-ux.md)** — UX spec for left-side `TEAM` + per-agent tabs, selected-tab activity view, and one shared bottom composer that routes to the active tab. _(added 2026-03-30)_
