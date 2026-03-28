---
version: 0.6.0
name: Beacon Goals — March 2026
description: Current goals for @teammates/recall, @teammates/cli, and @teammates/consolonia — stack-ranked across all tracks
type: project
---

# Beacon Goals

Updated: 2026-03-17

## Vision

Two tracks running in parallel:

1. **Claude Code Parity** — Universal and Enhanced features that close the gap with single-agent tools (hooks, print mode, MCP, skills).
2. **Team-Unique Features** — Novel capabilities that only a persistent multi-agent team with shared memory can deliver. These are our differentiators — no single-agent tool is doing them.

Our edge is the combination: persistent memory across teammates, agent-agnostic orchestration, ownership-aware routing, and local-first recall search. The brainstormed features leverage all of these.

---

## Stack-Ranked Goals

Single priority list across all tracks. Ranking factors: dependency chains (blockers go first), team-voted impact (pts), effort/LOC, and how much each goal unlocks downstream.

| Rank | ID | Goal | Track | LOC | Why this rank |
|------|----|------|-------|-----|---------------|
| **1** | N1 | Decompose cli.ts (~4,800 lines) | Existing | ~500 | Unblocks CP1 (hooks need clean event points). Every future CLI feature is harder until this is done. |
| **2** | CP2 | Non-Interactive Print Mode (`-p`) | Parity | ~150 | Unlocks CI/CD, scripting, SDK use. **Prerequisite for TF4** (code review). Quick win. |
| **3** | N2 | Error observability — replace silent catches | Existing | ~30 | 6 `.catch(() => {})` patterns. Tiny effort, immediate debugging payoff for everything below. |
| **4** | AI1 | Preset Capabilities Declaration | Infra | ~50 | `capabilities` field on `AgentPreset`. Tiny, unblocks **all EP\* goals**. |
| **5** | CP1 | Hooks / Lifecycle Events | Parity | ~300 | Foundation for plugins, automation, custom workflows. Needs N1 done first. |
| **6** | TF2 | Decision & Memory Synthesis (14pts) | Unique | ~400 | Cross-teammate semantic query engine. **Foundation for TF1, TF4, TF5** — the linchpin. |
| **7** | TF1 | Temporal Awareness Engine (19pts) | Unique | ~700 | Highest-voted feature. `/catchup`, `/history`, `/standup`. Depends on TF2. |
| **8** | TF3 | Proactive Ownership Awareness (16pts) | Unique | ~200 | Pre/post-task ownership scanning. Independent of TF2 — can start anytime after N1. |
| **9** | N3 | cli-proxy.ts test suite (~690 lines) | Existing | ~300 | Safety net before all the adapter changes coming from EP\* goals. |
| **10** | CP3 | User-Defined Skills / Commands | Parity | ~200 | `.teammates/_skills/` with markdown prompts. Good differentiator vs single-agent tools. |
| **11** | CP5 | Structured Output (`--json-schema`) | Parity | ~100 | Essential for CP2 consumers. JSON schema validation on `-p` output. |
| **12** | TF4 | Memory-Informed Code Review (14pts) | Unique | ~250 | Recall-augmented PR review. Depends on TF2 + CP2. |
| **13** | AI2 | Settings-Based Agent Config | Infra | ~100 | Per-agent config in `settings.json`. Prerequisite for EP1, EP3. |
| **14** | EP1 | MCP Integration | Enhanced | ~200 | Config-driven MCP server passthrough. Biggest Enhanced unlock. Needs AI1 + AI2. |
| **15** | CP4 | Session Resume (`-c`, `-r`) | Parity | ~100 | `--resume` reads last session file. Small effort, nice UX. |
| **16** | EP2 | Worktree Isolation | Enhanced | ~150 | Native `--worktree` for Claude, sandbox for Codex. |
| **17** | EP3 | Permission Mode Mapping | Enhanced | ~100 | `SandboxLevel` → agent-native flags. Needs AI2. |
| **18** | N6 | End-to-end integration tests | Existing | ~400 | CLI → orchestrator → adapter → agent → result. Important but lower urgency. |
| **19** | N7 | Consolonia widget tests | Existing | ~600 | ChatView, Markdown, Syntax, TextInput — 3,900+ untested lines. |
| **20** | CP6 | Budget / Turn Limits | Parity | ~30 | `--max-turns`, `--max-duration`. Tiny. |
| **21** | CP7 | System Prompt Override | Parity | ~30 | `--append-system-prompt`. Tiny. |
| **22** | TF5 | Teammate Drift & Alignment (4pts) | Unique | ~300 | Pairwise contradiction detection + `/align`. Depends on TF2. Low votes. |
| **23** | EP4 | Effort Levels | Enhanced | ~50 | Prompt baseline + native flag passthrough. |
| **24** | EP5 | Native Tool Restrictions for Skills | Enhanced | ~50 | `allowed_tools` → Claude's `--allowedTools`. Depends on CP3. |
| **25** | EP6 | Browser / Playwright | Enhanced | ~30 | `--chrome` passthrough. Trivial. |
| **26** | CP8 | Shared Task Lists | Parity | ~200 | `.teammates/_tasks/backlog.md`. Low demand. |
| **27** | TF6 | Cross-Session Task Continuity (1pt) | Unique | ~150 | Structured checkpoints + `/resume`. Depends on CP4. Lowest votes. |

---

## Dependency Graph (critical path)

```
N1 (decompose cli.ts)
 └→ CP1 (hooks)

CP2 (print mode)
 └→ TF4 (code review) ← also needs TF2

TF2 (memory synthesis)
 ├→ TF1 (temporal engine)
 ├→ TF4 (code review)
 └→ TF5 (drift & alignment)

AI1 (capabilities)
 └→ all EP* goals

AI2 (settings config)
 ├→ EP1 (MCP)
 └→ EP3 (permissions)

CP3 (skills)
 └→ EP5 (tool restrictions)

CP4 (session resume)
 └→ TF6 (cross-session continuity)
```

**Optimal execution order:** N1 → CP2 → N2 → AI1 in parallel. Then CP1 + TF2 in parallel. Then TF1 + TF3 + N3. Then the rest flows naturally.

---

## Team-Unique Feature Details

### TF1 — Temporal Awareness Engine (19pts)
**Authors:** Scribe, Beacon

A "what happened?" engine that reconstructs timelines across any scope — team-wide catch-up after time away, file-specific narratives, or daily standups. One underlying engine, three lenses.

**How it works:**
- Query all teammates' daily logs, weekly summaries, and typed memories for a given time range
- Cross-reference with `git log` to correlate memory entries with actual code changes
- Synthesize a coherent narrative ordered by time, grouped by teammate or by topic
- Three access modes:
  - `/catchup [since]` — "What happened since Monday?" Scans all teammates' logs, groups by topic, highlights decisions and blockers
  - `/history <file-or-topic>` — "What's the story of auth middleware?" Traces a subject across all teammates' memories and git history
  - `/standup` — Last-24h summary from each teammate, formatted as a team standup

**Beacon's role:** Build the cross-teammate temporal query engine in `@teammates/recall` (multi-index time-range search, git log correlation). Add the `/catchup`, `/history`, `/standup` commands to `@teammates/cli`. Consolonia renders the timeline UI.

### TF2 — Decision & Memory Synthesis (14pts)
**Authors:** Scribe, Beacon

A cross-teammate semantic query engine — search all recall indexes simultaneously, deduplicate results, rank by ownership authority. "Decision archaeology" is a query pattern on top: find where and when a decision was made, who made it, and what the reasoning was.

**Beacon's role:** This lives almost entirely in Beacon's packages. Extend `@teammates/recall` search API with multi-index aggregation, deduplication, and authority ranking. Add CLI commands. **Foundation for TF1, TF4, and TF5.**

### TF3 — Proactive Ownership Awareness (16pts)
**Authors:** Beacon, Pipeline/Scribe

Pre- and post-coding ownership scanning. Before coding: "who should I coordinate with?" After coding: "who needs to know?" Uses the existing `Registry` ownership data and `Orchestrator.route()` scoring.

**Beacon's role:** Build the ownership scanning logic in `@teammates/cli`. Wire pre-task warnings into `drainAgentQueue`. Wire post-task notifications into `handleEvent` on `task_completed`. Pipeline owns the CI version.

### TF4 — Memory-Informed Code Review (14pts)
**Authors:** Beacon, Pipeline

Route diffs to owning teammates for review against their WISDOM.md and accumulated memories. The reviewer sees not just the code change but the relevant context from their memory.

**Beacon's role:** Build the diff-to-ownership mapping and recall-augmented review prompt in `@teammates/cli`. Depends on TF2 + CP2.

### TF5 — Teammate Drift & Alignment (4pts)
**Authors:** Beacon, Scribe

Detect contradictions and style divergence across teammates' memories, then propose fixes. `/align` command.

**Beacon's role:** Build the comparison engine in `@teammates/recall`. Depends on TF2.

### TF6 — Cross-Session Task Continuity (1pt)
**Authors:** Beacon

Structured checkpoints for interrupted work. `/resume` command. Depends on CP4.

---

## Completed Goals

- ~~P0 — Test coverage for cli.ts~~ (extracted cli-utils.ts, 33 tests)
- ~~P0 — Test coverage for compact.ts~~ (14 tests)
- ~~P0 — Recall test suite~~ (3 suites, 47 tests)
- ~~P1 — Console utility tests~~ (4 suites, 49 tests)
- ~~P1 — Configurable routing~~ (routing keywords in SOUL.md)
- ~~P1 — Search CLI flags~~ (--max-chunks, --max-tokens, --recency-depth, --typed-memory-boost)
- ~~Linting & formatting~~ (Biome, 0 errors)
- ~~Recall bundled as CLI dependency~~
- ~~/install command removed~~
