# Teammates AI Team

Three teammates covering the teammates framework: Scribe is the PM owning strategy, documentation, and project planning. Beacon is the Software Engineer owning all coding tasks. Pipeline is DevOps owning everything related to shipping code.

## Roster

<!-- Keep in sync with routing guide below and actual teammate folders -->

| Name | Persona | Primary Ownership | Last Active |
|---|---|---|---|
| **Scribe** | Project Manager (PM) | Strategy, docs, specs, project planning | 2026-03-21 |
| **Beacon** | Software Engineer | `recall/src/**`, `cli/src/**`, `consolonia/src/**` + all code | 2026-03-15 |
| **Pipeline** | DevOps | `.github/workflows/**`, shipping, CI/CD, releases | 2026-03-15 |

## Dependency Flow

```
Templates (Scribe) → Onboarding (Scribe) → Recall (Beacon)
                                          → CLI (Beacon)
                                          → Consolonia (Beacon)
                                          → CI/CD (Pipeline)
```

Scribe defines the framework structure (templates, onboarding instructions). Beacon builds the tooling that operates on the output of that framework: recall for indexing and searching memory files, and the CLI orchestrator for routing tasks to teammates. Templates are upstream, recall and CLI are downstream.

## Routing Guide

<!-- Keep in sync with roster above -->

| Keywords | Teammate |
|---|---|
| strategy, roadmap, specs, planning, priorities, docs, documentation, template, onboarding, SOUL.md, GOALS.md, WISDOM.md, protocol, framework, roster, markdown | **Scribe** |
| recall, search, embeddings, vectra, indexer, vector, semantic, cli, orchestrator, adapter, REPL, handoff, agent, routing, queue, consolonia, terminal UI, code, implementation, bug fix, feature | **Beacon** |
| ci, cd, pipeline, workflow, actions, release, publish, deploy, build automation, shipping, containers, infrastructure | **Pipeline** |

## Structure

Every child folder of `.teammates/` is interpreted by its name prefix:

- **No prefix** → teammate folder (e.g., `beacon/`, `scribe/`)
- **`_` prefix** → shared non-teammate folder, checked in (e.g., `_standups/`, `_tasks/`)
- **`.` prefix** → local/ephemeral folder, gitignored (e.g., `.tmp/`)

Each teammate folder contains:

- **SOUL.md** — Identity, continuity instructions, principles, boundaries, capabilities, and ownership
- **GOALS.md** — Active objectives and priorities (read after SOUL.md)
- **WISDOM.md** — Distilled principles from compacted memories (read after GOALS.md)
- **memory/** — Daily logs (`YYYY-MM-DD.md`), typed memory files (`<type>_<topic>.md`), and episodic summaries (`weekly/`, `monthly/`)

Shared folders:

- **[_standups/](_standups/)** — Daily standup entries (one file per day, all teammates append)
- **[_tasks/](_tasks/)** — Queued task files

Root-level shared files:

- **[USER.md](USER.md)** — Who the user is (gitignored, stays local)
- **[CROSS-TEAM.md](CROSS-TEAM.md)** — Shared lessons across teammates
- **[PROTOCOL.md](PROTOCOL.md)** — Collaboration rules and handoff conventions
- **[TEMPLATE.md](TEMPLATE.md)** — Template for creating new teammates
- **[DECISIONS.md](DECISIONS.md)** — Decision log (ADR-lite format)
- **[PROJECTS.md](PROJECTS.md)** — Active project registry

See [TEMPLATE.md](TEMPLATE.md) for creating new teammates.
See [PROTOCOL.md](PROTOCOL.md) for collaboration rules.
