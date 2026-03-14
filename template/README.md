# <Project Name> AI Teammates

<One sentence describing the team composition and what they cover.>

## Roster

<!-- Keep in sync with routing guide below and actual teammate folders -->

| Name | Persona | Primary Ownership | Last Active |
|---|---|---|---|
| **<Name>** | <One-line persona> | `<paths>` | YYYY-MM-DD |

## Dependency Flow

```
<Upstream Layer> → <Middle Layer> → <Downstream Layer>
                                  → <Downstream Layer>
                    <Cross-cutting>
```

<Brief description of the actual package/module dependency chain.>

## Routing Guide

<!-- Keep in sync with roster above -->

| Keywords | Teammate |
|---|---|
| <keyword1>, <keyword2>, <keyword3> | **<Name>** |

## Structure

Each teammate folder contains:

- **SOUL.md** — Identity, continuity instructions, principles, boundaries, capabilities, and ownership
- **WISDOM.md** — Distilled principles from compacted memories (read second, after SOUL.md)
- **memory/** — Daily logs (`YYYY-MM-DD.md`) and typed memory files (`<type>_<topic>.md`)
- Additional files as needed (e.g., design docs, bug trackers)

Root-level shared files:

- **[USER.md](USER.md)** — Who the user is (gitignored, stays local)
- **[CROSS-TEAM.md](CROSS-TEAM.md)** — Shared lessons across teammates
- **[PROTOCOL.md](PROTOCOL.md)** — Collaboration rules and handoff conventions
- **[TEMPLATE.md](TEMPLATE.md)** — Template for creating new teammates

See [TEMPLATE.md](TEMPLATE.md) for creating new teammates.
See [PROTOCOL.md](PROTOCOL.md) for collaboration rules.
