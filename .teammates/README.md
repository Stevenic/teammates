# Teammates AI Team

Two teammates covering the teammates framework: Beacon owns the recall search package and the CLI orchestrator, Scribe owns the templates and onboarding system.

## Roster

<!-- Keep in sync with routing guide below and actual teammate folders -->

| Name | Persona | Primary Ownership | Last Active |
|---|---|---|---|
| **Beacon** | Teammates platform engineer | `recall/src/**`, `recall/package.json`, `recall/tsconfig.json`, `cli/src/**`, `cli/package.json`, `cli/tsconfig.json` | 2026-03-12 |
| **Scribe** | Framework & onboarding architect | `template/**`, `ONBOARDING.md`, `README.md` | 2026-03-12 |

## Dependency Flow

```
Templates (Scribe) → Onboarding (Scribe) → Recall (Beacon)
                                          → CLI (Beacon)
```

Scribe defines the framework structure (templates, onboarding instructions). Beacon builds the tooling that operates on the output of that framework: recall for indexing and searching memory files, and the CLI orchestrator for routing tasks to teammates. Templates are upstream, recall and CLI are downstream.

## Routing Guide

<!-- Keep in sync with roster above -->

| Keywords | Teammate |
|---|---|
| recall, search, embeddings, vectra, indexer, vector, semantic | **Beacon** |
| cli, orchestrator, adapter, REPL, handoff, agent, routing, queue | **Beacon** |
| template, onboarding, SOUL.md, WISDOM.md, protocol, framework, roster, markdown | **Scribe** |

## Structure

Each teammate folder contains:

- **SOUL.md** — Identity, continuity instructions, principles, boundaries, capabilities, and ownership
- **WISDOM.md** — Distilled principles from compacted memories (read second, after SOUL.md)
- **memory/** — Daily logs (`YYYY-MM-DD.md`), typed memory files (`<type>_<topic>.md`), and episodic summaries (`weekly/`, `monthly/`)

Root-level shared files:

- **[USER.md](USER.md)** — Who the user is (gitignored, stays local)
- **[CROSS-TEAM.md](CROSS-TEAM.md)** — Shared lessons across teammates
- **[PROTOCOL.md](PROTOCOL.md)** — Collaboration rules and handoff conventions
- **[TEMPLATE.md](TEMPLATE.md)** — Template for creating new teammates

See [TEMPLATE.md](TEMPLATE.md) for creating new teammates.
See [PROTOCOL.md](PROTOCOL.md) for collaboration rules.
