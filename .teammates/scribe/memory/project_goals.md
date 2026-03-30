---
version: 0.7.0
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

## Unified Stack Rank

All goals — novel features (F) and parity specs (S) — ranked in execution order. Rationale: parity features that unblock novel features ship first, then high-value differentiators, then remaining infrastructure.

| Rank | ID | Goal | Type | Why this position |
|------|----|------|------|-------------------|
| **1** | S16 | Hooks / lifecycle events spec | Parity P0 | Foundational — F5, F6, F9 all need lifecycle hooks to trigger |
| **2** | S17 | Non-interactive mode (`-p`) spec | Parity P0 | Enables CI integration — prerequisite for F4 (code review), F5 (boundary CI), F6 (memory CI) |
| **3** | S26 | MCP passthrough spec | Parity P0 | Biggest agent capability unlock — agents with MCP can do vastly more |
| **4** | F1 | Temporal Awareness Engine _(19pts)_ | Novel T1 | Highest-voted, makes the entire memory system consumable. Spec: query format + output templates |
| **5** | F3 | Decision & Memory Synthesis _(14pts)_ | Novel T1 | Linchpin — cross-teammate search engine that F1, F4, F8 all depend on. Spec: authority ranking rules |
| **6** | F2 | Proactive Ownership Awareness _(16pts)_ | Novel T1 | High value, builds on existing ownership data. Spec: ownership format standardization |
| **7** | F4 | Memory-Informed Code Review _(14pts)_ | Novel T1 | Needs S17 + F3. Spec: review prompt template |
| **8** | S18 | User-defined skills/commands spec | Parity P1 | User extensibility — enables custom workflows without framework changes |
| **9** | S19 | Session resume spec | Parity P1 | Quality of life for longer tasks, reduces context loss |
| **10** | F5 | Boundary Violation Detector _(9pts)_ | Novel T2 | Needs S16 + S17. Spec: machine-parseable ownership format |
| **11** | F6 | Memory & Ownership CI _(8pts)_ | Novel T2 | Needs S16 + S17. Spec: memory file format schema for validation |
| **12** | S27 | Worktree isolation spec | Parity P1 | Prevents file conflicts between concurrent teammates |
| **13** | S28 | Permission mode mapping spec | Parity P1 | Security — maps sandbox levels to agent-native flags |
| **14** | F7 | Project Onboarding for Humans _(6pts)_ | Novel T2 | Scribe-primary. Spec: briefing format + synthesis template |
| **15** | S6 | Conflict resolution protocol | Parity P1 | Needed until worktrees (S27) are universal |
| **16** | F8 | Teammate Drift & Alignment _(4pts)_ | Novel T2 | Needs F3. Spec: contradiction detection + resolution workflow |
| **17** | F9 | Proactive Issue Detection _(4pts)_ | Novel T2 | Scribe-primary. Needs S16 hooks. Spec: observation format + pattern rules |
| **18** | S20 | Structured output spec | Parity P2 | Useful but not blocking anything else |
| **19** | S21 | Effort levels spec | Parity P2 | Nice to have, simple spec |
| **20** | S22 | Budget / turn limits spec | Parity P2 | Safety guardrail |
| **21** | S5 | `/health` self-audit spec | Parity P2 | Quality of life |
| **22** | F10 | Multi-Perspective Design Review _(3pts)_ | Novel T3 | Scribe-primary. Low urgency |
| **23** | F11 | Team Retrospectives _(3pts)_ | Novel T3 | Extends existing `/retro`. Low urgency |
| **24** | S23 | System prompt override spec | Parity P2 | Edge case, rarely needed |
| **25** | S24 | Shared task list spec | Parity P2 | Nice to have |
| **26** | S29 | Browser integration spec | Parity P2 | Niche — only Claude supports it currently |
| **27** | F12 | Predictive Task Routing _(1pt)_ | Novel T3 | Needs F3. Low value signal from votes |
| **28** | S30 | Agent capabilities registry spec | Parity P3 | Infrastructure — needed eventually but not blocking |
| **29** | S4 | Teammate lifecycle management | Parity P3 | No one is retiring teammates yet |
| **30** | S14 | Cross-repo handoff spec | Parity P3 | No multi-repo users yet |
| **31** | S15 | npm init teammates scaffolder spec | Parity P3 | Nice to have, onboarding works fine without it |

### Key Dependencies
- **F3 (Decision Synthesis) unblocks:** F1, F4, F8, F12 — build cross-teammate search first
- **S16 + S17 (Hooks + Non-interactive) unlock:** F5, F6, F9, F4 — CI features need headless execution
- **S27 (Worktrees) defers:** S6 (Conflict resolution) — less urgent once isolation exists

---

## Goal Details — Novel Features

Ranked by community vote. Scribe's role: spec design, template/doc changes, format definitions. Beacon implements code.

### Tier 1 — Top Priority (14+ pts)

- [ ] **F1 — Temporal Awareness Engine** _(19pts, Scribe + Beacon)_
  "What happened?" across any scope — team-wide catch-up, file-specific narratives, or daily standup synthesis. One underlying engine that reconstructs a timeline from daily logs, weekly summaries, commit history, and typed memories, then renders it through different lenses: "catch me up on the last 3 days," "what's the story of this file this week," "give me a team standup." Scribe's role: define the query format, output templates for each lens (catch-up, file narrative, standup), and document the feature in the cookbook and working-with-teammates guide. This is the feature that makes the entire memory system consumable — we store knowledge, this surfaces it.

- [ ] **F2 — Proactive Ownership Awareness** _(16pts, Beacon + Pipeline/Scribe)_
  Pre- and post-coding ownership scanning. Before a task: "these files are owned by @beacon and @pipeline — coordinate with them." After a task: "you touched files outside your ownership — flag for review." Uses the ownership graph from SOUL.md `Ownership` sections and CROSS-TEAM.md `Ownership Scopes` table. Scribe's role: define the ownership declaration format (already exists in SOUL.md — may need standardization), document the expected behavior in PROTOCOL.md, and write the cookbook recipe for configuring ownership alerts.

- [ ] **F3 — Decision & Memory Synthesis** _(14pts, Scribe + Beacon)_
  Cross-teammate semantic query engine. Search all recall indexes simultaneously, deduplicate overlapping memories, rank results by ownership authority (a teammate's memory about their own domain scores higher). Decision archaeology is a specific query pattern on top: "why did we decide X?" traces through DECISIONS.md, typed memories, and daily logs to reconstruct the decision trail. Scribe's role: define the cross-index query format, the authority ranking rules (which teammate's memory is authoritative for which domain), and document the `/decision` or `/search-all` command interface.

- [ ] **F4 — Memory-Informed Code Review** _(14pts, Beacon + Pipeline)_
  Route diffs to owning teammates for review against their WISDOM.md and accumulated memories. When a PR touches files owned by @scribe, Scribe's recall index is queried for relevant context — past decisions, known pitfalls, style preferences — and that context is injected into the review prompt. CI-triggered (via GitHub Actions) or interactive (via `/review`). Scribe's role: define the review prompt template (what context gets injected, how it's formatted), document the feature, and participate as a reviewer for framework/docs changes.

### Tier 2 — Medium Priority (4-9 pts)

- [ ] **F5 — Boundary Violation Detector** _(9pts, Pipeline)_
  CI check that parses each teammate's declared ownership patterns from SOUL.md and flags when a PR includes changes outside those boundaries. Turns the honor-system ownership model into an enforceable contract. Scribe's role: ensure the ownership declaration format in SOUL.md and CROSS-TEAM.md is machine-parseable (glob patterns in the `Ownership` section), document the expected format, and update templates if needed.

- [ ] **F6 — Memory & Ownership CI** _(8pts, Pipeline)_
  Single CI job covering memory health (orphaned files, stale memories, broken internal links, missing frontmatter) and ownership gaps (files not claimed by any teammate, overlapping claims). Scribe's role: define the expected memory file format (frontmatter schema, directory structure) that the CI job validates against, and document the health check rules.

- [ ] **F7 — Project Onboarding for Humans** _(6pts, Scribe)_
  The team collectively explains the project to a new human engineer, each teammate covering their domain. A `/onboard-human` command triggers each teammate to produce a briefing from their perspective — Scribe explains the framework and docs, Beacon explains the CLI and recall architecture, Pipeline explains CI/CD. The briefings are synthesized into a single onboarding document. Scribe's role: design the briefing format, the synthesis template, write the command spec, and produce Scribe's own briefing section. This is a Scribe-primary feature.

- [ ] **F8 — Teammate Drift & Alignment** _(4pts, Beacon + Scribe)_
  Detect contradictions and style divergence across teammates' WISDOM.md and typed memories. When two teammates have conflicting wisdom about the same topic (e.g., one says "always use mocks" and another says "never use mocks"), surface the contradiction and propose resolution. Cross-pollination: when one teammate learns something universally applicable, suggest adding it to other teammates' wisdom. Scribe's role: define what constitutes a "contradiction" (same topic, opposing guidance), the resolution workflow (who decides?), and document the `/drift` command.

- [ ] **F9 — Proactive Issue Detection** _(4pts, Scribe)_
  Teammates emit lightweight observations during tasks ("this API has no error handling," "this test is flaky," "this dependency is 3 major versions behind"). The orchestrator collects these observations and surfaces patterns — if multiple teammates flag the same area, it's probably a real issue. Scribe's role: define the observation format (structured annotation in task output), the pattern detection rules, and the surfacing mechanism (daily digest? threshold alert?). Scribe-primary feature.

### Tier 3 — Lower Priority (1-3 pts)

- [ ] **F10 — Multi-Perspective Design Review** _(3pts, Scribe)_
  Route a design question to all teammates simultaneously; each responds from their domain perspective. Responses are synthesized with dissenting opinions highlighted — not a majority-wins vote, but a structured view of trade-offs from different angles. Scribe's role: design the `/design-review` command format, the synthesis template (how to present agreement vs dissent), and document the workflow. Scribe-primary feature.

- [ ] **F11 — Team Retrospectives** _(3pts, Scribe)_
  Cross-teammate retro (distinct from per-teammate `/retro`). Analyzes handoff breakdowns, wisdom contradictions, and collaboration patterns across the whole team. Outputs proposed changes to PROTOCOL.md and CROSS-TEAM.md, not individual SOUL.md files. Scribe's role: design the cross-team retro format, the analysis prompts, and the output template. Extends the existing `/retro` spec in RETRO-FORMAT.md. Scribe-primary feature.

- [ ] **F12 — Predictive Task Routing** _(1pt, Scribe)_
  Route tasks based on recall index freshness and teammate context, not just keyword matches. If @beacon recently worked on the auth module (fresh recall entries), route auth questions there even if the keyword match is ambiguous. Scribe's role: define the routing heuristic (freshness weight, keyword weight, ownership weight) and document the behavior. Hand off to Beacon.

---

## Goal Details — Claude Code Parity

Two-tier feature model:
- **Universal** — orchestrator-level, works with any agent
- **Enhanced** — config passthrough to agents that support it, graceful degradation for others

Scribe owns specs, templates, and docs — hands off to Beacon for implementation.

- [ ] **S16 — Hooks / lifecycle events spec** _(Universal)_ — Design the hook config format (`settings.json`), event catalog (`session_start`, `pre_task`, `post_task`, `pre_compact`, `post_compact`, `teammate_idle`, `error`), and hook types (shell command, JS callback). Document in PROTOCOL.md and cookbook. Hand off to Beacon.
- [ ] **S17 — Non-interactive mode (`-p`) spec** _(Universal)_ — Design the headless CLI interface: `teammates -p "task" --teammate name`, `--output-format json|text`, pipe support. Document in CLI README. Hand off to Beacon.
- [ ] **S26 — MCP passthrough spec** _(Enhanced)_ — Design MCP server config in `settings.json` or `.teammates/mcp.json`. Each adapter maps config to the agent's native MCP flags (`--mcp-server` for Claude, equivalent for others). Document per-agent support matrix. Hand off to Beacon.
- [ ] **S18 — User-defined skills/commands spec** _(Universal + Enhanced)_ — Design `.teammates/_skills/` directory format: markdown prompt files with frontmatter (name, description, arguments), auto-registered as slash commands. Enhanced: Claude adapter passes `allowed_tools` from skill frontmatter. Document in PROTOCOL.md and cookbook. Hand off to Beacon.
- [ ] **S27 — Worktree isolation spec** _(Enhanced)_ — Design `--worktree` flag: Claude adapter passes native `--worktree`, Codex uses container isolation, agents without support get a warning. Document per-agent behavior. Hand off to Beacon.
- [ ] **S19 — Session resume spec** _(Universal)_ — Design `--resume` and `--continue` flags: session file persistence across CLI invocations, session naming (`--name`), session listing. Update session docs in PROTOCOL.md. Hand off to Beacon.
- [ ] **S28 — Permission mode mapping spec** _(Enhanced)_ — Map `SandboxLevel` from SOUL.md to each agent's native permission flags: Claude (`--dangerously-skip-permissions`, `--allowedTools`), Codex (`--full-auto`, sandbox levels), Copilot (`approveAll`). Document the mapping table and graceful degradation. Hand off to Beacon.
- [ ] **S6 — Conflict resolution protocol** _(Universal)_ — What happens when two teammates edit the same file (less urgent now that worktree isolation is on the roadmap, but still needed for agents without worktree support)
- [ ] **S20 — Structured output spec** _(Universal)_ — Design `--json-schema` flag: prompt injection strategy, output validation, error handling for non-conforming output. Document in CLI README. Hand off to Beacon.
- [ ] **S21 — Effort levels spec** _(Universal + Enhanced)_ — Design `--effort low|medium|high|max`: prompt modifiers per level (universal), plus native flag passthrough for agents that support it (Claude `--effort`). Hand off to Beacon.
- [ ] **S22 — Budget / turn limits spec** _(Universal)_ — Design `--max-turns` and `--max-duration` options: where enforced (task queue loop), how reported. Hand off to Beacon.
- [ ] **S5 — `/health` self-audit spec** _(Universal)_ — Design correctness checker for template/doc drift. Hand off to Beacon.
- [ ] **S23 — System prompt override spec** _(Universal)_ — Design `--append-system-prompt` and `--system-prompt-file` flags: interaction with SOUL.md/memory stack, safety guardrails. Hand off to Beacon.
- [ ] **S24 — Shared task list spec** _(Universal)_ — Design `.teammates/_tasks/backlog.md` format for agent-team-style shared work: task claiming, dependency tracking, status updates. Extends existing `_tasks/` directory.
- [ ] **S29 — Browser integration spec** _(Enhanced)_ — Design `--chrome` passthrough for agents that support Playwright (Claude). Define use cases: screenshot-based UI review, E2E test running. No-op for agents without support. Hand off to Beacon.
- [ ] **S30 — Agent capabilities registry spec** _(Enhanced)_ — Design `capabilities` field in `AgentPreset` declaring what each agent supports (MCP, worktrees, permissions, browser, native effort). CLI uses this to warn when a feature isn't available for a teammate's agent. Hand off to Beacon.
- [ ] **S4 — Teammate lifecycle management** _(Universal)_ — Retire/archive flow for teammates
- [ ] **S14 — Cross-repo handoff spec** _(Universal)_ — How handoffs work across separate repos
- [ ] **S15 — npm init teammates scaffolder spec** _(Universal)_ — Zero-config project bootstrapping

### Deprioritized (superseded by parity goals)
- ~~S7 — Template archetypes~~ — deferred, skills system (S18) covers similar ground
- ~~S8 — Post-onboarding checklist~~ — deferred, `/health` (S5) subsumes this
- ~~S9 — Teammate discovery protocol~~ — deferred
- ~~S10 — Framework changelog~~ — deferred, template versioning already shipped
- ~~S11 — Landscape comparison doc~~ — deferred, gap analysis covers this
- ~~S12 — Onboarding dry-run mode spec~~ — deferred
- ~~S13 — Interactive onboarding questionnaire spec~~ — deferred

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
