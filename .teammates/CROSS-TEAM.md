# Cross-Team Notes

Shared lessons that affect multiple teammates. Record here instead of duplicating across individual MEMORIES.md files.

This file also serves as a **shared index** — teammates can add pointers to private docs in their folder that other teammates might find useful.

Reverse chronological. Tag affected teammates.

## Ownership Scopes

Every teammate **owns everything** under their `.teammates/<name>/` folder — SOUL.md, MEMORIES.md, memory/, and any private docs they create. This is unconditional: no teammate needs permission to edit their own folder, and no other teammate should modify it.

The **Boundary Rule** (see PROTOCOL.md) applies to the **codebase** — source code, configs, and shared framework files — not to a teammate's own `.teammates/<name>/` directory.

| Teammate | Self-owned folder | Codebase ownership (see SOUL.md for full details) |
|---|---|---|
| **Beacon** | `.teammates/beacon/**` | `recall/**`, `cli/**` |
| **Scribe** | `.teammates/scribe/**` | `template/**`, `ONBOARDING.md`, `README.md`, `.teammates/README.md`, `.teammates/PROTOCOL.md`, `.teammates/CROSS-TEAM.md`, `.teammates/TEMPLATE.md` |

When adding a new teammate, add a row to this table.

## Shared Docs

- **[Architecture](scribe/docs/ARCHITECTURE.md)** — Full project architecture: packages, data flow, key patterns, tech stack. Maintained by Scribe. _(added 2026-03-13)_
