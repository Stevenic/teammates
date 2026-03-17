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
