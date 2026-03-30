# Scribe - Wisdom

Distilled principles. Read this first every session (after SOUL.md).

Last compacted: 2026-03-30

---

**Templates are upstream, tooling is downstream**
Scribe defines memory formats and framework structure; implementation consumes that output.
Any template change should be treated as an API change for recall, CLI behavior, and docs.

**Spec → handoff → docs is the full cycle**
Design behavior before implementation, hand code work to the owner, then document the shipped result.
Skipping the first step creates churn; skipping the last creates drift.

**Cross-file consistency is non-negotiable**
Framework concepts repeat across templates, onboarding, protocol docs, cookbook pages, and package READMEs.
When one concept changes, audit every place that teaches or depends on it.

**New concepts need a propagation pass**
Adding a framework file (like GOALS.md) means updating every doc that describes the file structure: templates, onboarding, protocol, cookbook, README, adoption guide.
Treat it as a checklist, not a best-effort sweep — missed references become stale fast.

**Practice drifts from templates**
Periodically compare live `.teammates/` against `template/` to catch convention gaps that evolved in practice but weren't backported.
The template is the contract; if practice improved, update the template so new projects inherit it.

**Three files define a teammate**
SOUL.md (identity and boundaries), WISDOM.md (distilled knowledge), GOALS.md (intent and direction).
Each has a distinct purpose — don't mix identity into wisdom, or task tracking into identity.

**Discoverability is part of the design**
Specs and shared docs should live in stable locations and be linked from shared indexes like `CROSS-TEAM.md`.
If a teammate cannot find a decision quickly, the documentation is incomplete.

**Automation stops at recommendation**
Anything that affects teammate work should use propose-then-approve, not silent execution.
Good automation narrows the choice; the human still makes it.

**Start with the no-server path**
Collaboration features should first prove their value with files, git, and local conventions before adding infrastructure.
Add a server only when latency, presence, or scale problems are concrete rather than hypothetical.

**`.teammates/` stays authoritative**
Use task worktrees for product code, but keep memory, handoffs, and session state in the main checkout.
That split keeps collaboration state singular, visible, and immediately shared.

**Claims belong in `.git/`, not the repo**
Advisory claims must be shared across local worktrees without becoming committed project state.
Putting them under `.git/teammates/claims/` preserves that boundary.

**Recall is retrieval, not reasoning**
Recall should surface relevant context; the agent should do the thinking.
Use it to inject likely relevant memory, not to replace analysis.

**Batch long-running work**
Large write sets and other heavy tasks should be split into checkpointable batches with clear resume points.
Timeout-prone workflows are easier to recover when progress is chunked.

**Design for interruption, not just completion**
Agents can be stopped by timeout or by humans mid-task.
Long-running workflows should define how to checkpoint, reconstruct state, and resume cleanly.

**Oversized files deserve structural fixes**
Once a source file grows beyond comfortable review size, edits get slower and more error-prone.
Specs touching oversized files should recommend extraction, not just more careful editing.

**Spec UI before coding UI**
Interactive features need concrete rendering examples and behavior rules before implementation starts.
Without that, visual work turns into serial guess-and-correct loops.

**Batch visual feedback**
For UI review, one consolidated feedback round is cheaper than many tiny corrections.
Design workflows should encourage grouped critique so implementation converges faster.

**Prefer stable identities over index math**
Interactive models should track durable item identity instead of parallel index-keyed structures when state can shift.
Index-heavy designs make insertion, deletion, and selection logic brittle.

**State-shifting logic needs dedicated tests**
When behavior depends on inserting, removing, or reordering items, manual reasoning is not enough.
Specs should call for focused tests around index shifts, selection movement, and list mutation.

**Command surfaces must fit both the host and the product**
Slash commands should avoid collisions with the agent's native command set and align with the product's existing interaction model.
A clear name is still wrong if it conflicts with the host or duplicates a better built-in affordance.

**Shared summaries should report deltas**
Standups, digests, and progress views are most useful when they emphasize what changed since the last update.
Repeating static state creates noise and hides the actual movement.

**Progress views should separate signal from no-ops**
Status UIs are clearer when housekeeping and no-op steps stay in progress reporting while user-meaningful work enters the main feed.
This keeps activity visible without flooding the primary narrative.

**Retro proposals need a decision gate**
Retrospectives should end in explicit approve-or-reject calls, not a pile of unclaimed recommendations.
A proposal without a decision is just deferred ambiguity.

**Verify before logging completion**
A fix is not done when it sounds plausible; it is done when someone confirmed the behavior.
Any workflow that records completion should also define the verification step first.

**Roadmap order matters more than feature count**
Prerequisites and parity work ship before higher-level collaboration features because they unlock the rest.
When prioritization is unclear, prefer the feature that removes downstream blockers.

**WISDOM is for heuristics, not recipes**
Keep this file to durable principles and short patterns, not post-mortems or implementation commentary.
If an entry reads like a task note, it belongs somewhere else.
