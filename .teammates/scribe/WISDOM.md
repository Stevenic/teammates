# Scribe — Wisdom

Distilled principles. Read this first every session (after SOUL.md).

Last compacted: 2026-03-29

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

### Retro proposals need a decision gate
Retro proposals don't self-apply. They were proposed 3 times across 2 days before getting approved. When running a retro, explicitly ask the user to approve or reject each proposal in the same session.

### Folder naming convention: no prefix / _ / .
In `.teammates/`: no prefix = teammate folder, `_` prefix = shared checked-in content (`_standups/`, `_tasks/`), `.` prefix = local gitignored content (`.tmp/`, `.index/`).

### The three-project landscape
P1 Parity (S16/S17/S26 — CLI feature parity with Claude Code), P2 Campfire v0.5.0 (multi-human collaboration with twins, "no server first" design), P3 Hands (cross-agent computer use via MCP). Parity ships first because it unblocks everything else. Hands depends on S26 (MCP Passthrough).

### Specs live in scribe/docs/specs/
All feature specs go in `.teammates/scribe/docs/specs/` with a pointer added to CROSS-TEAM.md Shared Docs. Naming: `S##-slug.md` for parity specs, `F#-slug.md` for novel features, `P#-slug.md` for project-level specs, `F-slug.md` for unnumbered feature specs.

### Nothing automatic that a human doesn't control
Twins and AI automation must use a propose-then-approve model. Smart defaults are fine (suggest the right action), but execution requires human confirmation. This applies to PM twin queue reordering, routing decisions, and any action with team-wide impact. User stated this explicitly — it's a hard rule, not a preference.

### Worktrees are per-task, .teammates/ stays in main tree
Code changes happen in a task worktree (branch: `teammates/<agent>/<task-slug>`), but `.teammates/` operations (memory, handoffs, session state) always happen in the main worktree via absolute path. This keeps handoffs and memory writes immediately visible to all agents. Only create worktrees for tasks touching files outside `.teammates/`.

### Claims live in .git/, never committed
Advisory file locks (`.git/teammates/claims/`) are inside the shared `.git` dir so all worktrees on the same machine can see them. Claims are NEVER committed to git — Phase 1 is single-machine only. Cross-machine claims require the Campfire server (Phase 2).

### Recall is LLM-free — two-pass architecture
Recall stays a pure search engine with no LLM dependency. Pass 1 (pre-task, no LLM): adapter fires keyword-extracted queries at recall, injects results into prompt. Pass 2 (during task): agent invokes recall as a tool/MCP server with full context. The agent does the reasoning, recall does the searching.

### Teammates grow, they never shrink
Evolution is always additive to experience. When a role changes (generalist → specialist), nothing is removed — the teammate evolves. SOUL.md = current state (always in context). RESUME.md = career history (loaded on demand, indexed in vector DB for associative recall). Past experience surfaces automatically through semantic search, not deliberate reflection triggers.

### Spec bulk operations with batch limits
When designing specs that produce many artifacts (file creation, memory writes), include batch size guidance. Bulk creation of 42 files caused a 600s agent timeout. The fix is always "break into smaller batches" — specs should anticipate this and prescribe limits.

### Design for interruption
Agents can be killed mid-task (timeout, user interrupt). Conversation logs serve as implicit checkpoints — kill → parse log → resume with condensed context. Specs for long-running features should consider the interrupt/resume path, not just the happy path.

### Large source files are hostile to AI agents
When a single file exceeds ~3k lines, agents struggle to hold full context and make targeted edits. cli.ts at 6,800 lines was a root cause of the thread view churn (18 rounds). Specs that touch large files should recommend extraction first, or at minimum flag the risk.

### Spec UI before coding UI
Visual/interactive features (thread view, feed layout) need a spec with exact rendering examples before any code is written. Without one, feedback becomes serial ("move this, change that") and rounds multiply. The thread view post-mortem confirmed: spec-after-code cost 18 rounds; spec-first features land in 1-3.
