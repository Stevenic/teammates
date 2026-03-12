# Teammates AI Team

Two teammates covering the teammates framework: Beacon owns the recall search package, Scribe owns the templates and onboarding system.

## Roster

<!-- Keep in sync with routing guide below and actual teammate folders -->

| Name | Persona | Primary Ownership | Last Active |
|---|---|---|---|
| **Beacon** | Semantic memory engineer | `recall/src/**`, `recall/package.json`, `recall/tsconfig.json` | 2026-03-11 |
| **Scribe** | Framework & onboarding architect | `template/**`, `ONBOARDING.md`, `README.md` | 2026-03-11 |

## Dependency Flow

```
Templates (Scribe) → Onboarding (Scribe) → Recall (Beacon)
```

Scribe defines the framework structure (templates, onboarding instructions). Beacon builds the tooling that operates on the output of that framework (indexing and searching memory files). Templates are upstream, recall is downstream.

## Routing Guide

<!-- Keep in sync with roster above -->

| Keywords | Teammate |
|---|---|
| recall, search, embeddings, vectra, indexer, CLI, vector, semantic | **Beacon** |
| template, onboarding, SOUL.md, MEMORIES.md, protocol, framework, roster, markdown | **Scribe** |

## Structure

Each teammate folder contains:

- **SOUL.md** — Identity, continuity instructions, principles, boundaries, capabilities, and ownership
- **MEMORIES.md** — Curated long-term lessons (reverse chronological)
- **memory/** — Daily logs (`YYYY-MM-DD.md`), append-only, for session-level notes

Root-level shared files:

- **[USER.md](USER.md)** — Who the user is (gitignored, stays local)
- **[CROSS-TEAM.md](CROSS-TEAM.md)** — Shared lessons across teammates
- **[PROTOCOL.md](PROTOCOL.md)** — Collaboration rules and handoff conventions
- **[TEMPLATE.md](TEMPLATE.md)** — Template for creating new teammates

See [TEMPLATE.md](TEMPLATE.md) for creating new teammates.
See [PROTOCOL.md](PROTOCOL.md) for collaboration rules.
