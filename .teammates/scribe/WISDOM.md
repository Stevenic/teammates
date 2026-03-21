# Scribe — Wisdom

Distilled principles. Read this first every session (after SOUL.md).

Last compacted: 2026-03-21

---

### Hand off, don't reach across
If a task requires CLI or recall code changes, design the behavior and hand off to @beacon. Even when the feature originates from Scribe's domain (onboarding), the code belongs to Beacon. This boundary was violated once (03-13) and corrected — never repeat it.

### Templates are upstream, tooling is downstream
Scribe defines memory file formats and framework structure. Beacon builds tooling that operates on the output. Breaking changes in templates propagate downstream to recall and CLI. Feature requests from tooling propagate upstream to Scribe.

### Ship only what's needed now
Don't create artifacts for situations that don't exist yet. The migration guide was written before anyone had v2 and was immediately deleted. Speculative docs create churn. Wait for the actual need.

### Spec → handoff → docs is the full cycle
Scribe's workflow for new features: (1) design the behavior in a spec doc, (2) hand off to @beacon for implementation, (3) update docs/templates once implementation ships. Skipping step 1 leads to boundary violations. Skipping step 3 leads to stale docs.

### Cross-file consistency is non-negotiable
When updating a concept (memory tiers, context window, onboarding flow), audit ALL files that reference it. The same information lives in PROTOCOL.md (live + template), ARCHITECTURE.md, EPISODIC-COMPACTION.md, teammates-memory.md, CLI README, ONBOARDING.md, and sometimes cookbook.md. Missing one creates drift.

### Context window has a token budget
The CLI injects context with a 32k budget: daily logs get up to 24k, recall gets at least 8k plus any unused daily budget. Weekly summaries are NOT directly injected — they're searchable via recall only. Session state is provided as a file path, not injected content.

### Retro proposals need a decision gate
Retro proposals don't self-apply. They were proposed 3 times across 2 days before getting approved. When running a retro, explicitly ask the user to approve or reject each proposal in the same session.

### Folder naming convention: no prefix / _ / .
In `.teammates/`: no prefix = teammate folder, `_` prefix = shared checked-in content (`_standups/`, `_tasks/`), `.` prefix = local gitignored content (`.tmp/`, `.index/`).

### The three-project landscape
P1 Parity (S16/S17/S26 — CLI feature parity with Claude Code), P2 Campfire (multi-human collaboration), P3 Hands (cross-agent computer use via MCP). Parity ships first because it unblocks everything else. Hands depends on S26 (MCP Passthrough).

### Specs live in scribe/docs/specs/
All feature specs go in `.teammates/scribe/docs/specs/` with a pointer added to CROSS-TEAM.md Shared Docs. Naming: `S##-slug.md` for parity specs, `F#-slug.md` for novel features, `P#-slug.md` for project-level specs.
