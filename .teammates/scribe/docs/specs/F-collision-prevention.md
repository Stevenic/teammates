# Code Collision Prevention — Design Spec

A 5-layer defense model that prevents humans and agents from overwriting each other's code when working concurrently in the same repository. Each layer catches a different class of conflict — from coarse-grained isolation down to fine-grained advisory locks.

**Status:** Draft
**Owner:** Scribe (spec) → Beacon (implementation)
**Depends on:** Campfire (multi-human collaboration), S27 (worktree isolation)

---

## The Problem

When N humans and M agents all work in the same repo, three types of collision can occur:

| Type | Description | Severity | Example |
|---|---|---|---|
| **Textual** | Two people edit the same lines → merge conflict | Low | Two agents both edit `adapter.ts` line 42 |
| **Logical** | Two people edit different lines in the same file → merges cleanly but breaks something | Medium | Agent A changes a function signature, Agent B adds a call using the old signature |
| **Semantic** | Two people edit different files → merges cleanly, tests pass individually, but the combined result is broken | High | Agent A refactors the event system, Agent B adds a new event handler using the old pattern |

Git handles textual conflicts natively. The hard problem is logical and semantic conflicts — code that merges cleanly but shouldn't have.

---

## The 5-Layer Defense Model

Each layer is independent. They stack — you can use any subset, and each one you add catches more conflicts.

```
Layer 5: PR Merge Queue          ← serialized integration (GitHub-native)
Layer 4: Active Claims           ← advisory file locks (new — this spec)
Layer 3: Ownership Routing       ← PM routes by SOUL.md ownership
Layer 2: Worktree Isolation      ← each agent gets its own worktree (S27)
Layer 1: Branch Isolation        ← each human-agent pair on own branch
```

### Layer 1 — Branch Isolation

**What:** Every human (or human-agent pair) works on their own branch. No two people commit to the same branch simultaneously.

**How it works today:** Standard git workflow. Each task gets a feature branch. PRs merge to main.

**What it prevents:** Direct overwrites — two people pushing to the same branch.

**What it doesn't prevent:** Conflicts discovered at merge time. Semantic conflicts that merge cleanly.

**Implementation:** Already exists. No changes needed.

---

### Layer 2 — Worktree Isolation

**What:** Each agent that needs to **write code** gets its own git worktree — a separate working directory with its own HEAD, sharing the same `.git` database. Planning/doc agents (Scribe, etc.) work in the main working tree.

**Granularity: Per agent, not per session.** A session might spawn multiple agents that need to work in parallel on different branches. Tying worktrees to sessions would force serialization. Per-agent is the right granularity.

**Branch naming:** `teammates/<agent-alias>/<task-slug>` — e.g. `teammates/beacon/refactor-events`

#### Worktree Lifecycle

```
1. CREATE   — CLI spawns a coding agent → creates worktree on a new branch
             git worktree add .worktrees/beacon-refactor-events teammates/beacon/refactor-events
2. WORK     — Agent works in the worktree directory. Commits normally.
             .teammates/ operations (memory writes, handoffs, session state) happen
             in the MAIN worktree via absolute path — so they're immediately visible
             to all agents.
3. COMPLETE — Agent finishes. Commits are on the branch.
4. INTEGRATE — PR created from the branch → merge queue (Layer 5)
5. CLEANUP  — After merge (or if no changes), worktree is removed:
             git worktree remove .worktrees/beacon-refactor-events
```

#### When NOT to Create a Worktree

Not every task needs isolation. The CLI checks the teammate's SOUL.md ownership patterns:

| Task type | Example | Worktree? |
|---|---|---|
| Code changes | "Refactor the event system" | Yes — touches source files |
| Memory-only | "Write your daily standup" | No — only touches `.teammates/` |
| Read-only | "Explain how the router works" | No — no file writes |
| Docs/specs only | "Update the README" | No — `.teammates/` or docs only |

**Rule:** If a task is predicted to touch files OUTSIDE `.teammates/`, create a worktree. Otherwise, work in the main tree.

#### `.teammates/` Lives in Main Worktree

This is a critical design point. The `.teammates/` directory (memory, handoffs, session state, claims) stays in the main working tree. Agents in worktrees access it via absolute path back to the main tree. This ensures:

- Handoffs are immediately visible to all agents
- Memory writes don't require merging
- Claims (Layer 4) are visible across worktrees
- Session state is shared, not siloed

#### Multi-Human Scenario

Each human's agents branch off that human's current branch:

```
Human A (on main)     → teammates/beacon/task-from-A  (branched from main)
Human B (on feat/x)   → teammates/beacon/task-from-B  (branched from feat/x)
```

#### Graceful Degradation

If worktrees aren't available (agent doesn't support it, disk space, or git version), the system falls back to branch isolation only. The CLI logs a warning but doesn't block.

**Implementation:** Beacon implements. See handoff below.

---

### Layer 3 — Ownership Routing

**What:** The PM (human or AI) routes tasks to teammates based on file ownership declared in SOUL.md. If Beacon owns `packages/cli/**`, all CLI tasks go to Beacon. No two teammates get tasks that touch the same owned files.

**How it works:**

1. Each teammate's SOUL.md declares Primary and Secondary ownership (glob patterns)
2. When a task arrives, the PM (or `/assign` command) checks which files the task is likely to touch
3. If those files fall under one teammate's ownership, route to that teammate
4. If ownership overlaps or is unclear, the PM makes a routing decision and communicates it

**What it prevents:** Two teammates independently modifying the same module. This is the primary defense against semantic conflicts — if only one person touches the event system, there can't be conflicting refactors.

**What it doesn't prevent:** Cross-boundary changes where a task genuinely needs to touch files owned by multiple teammates. These require coordination (handoffs or pair work).

**Implementation:** Already exists via SOUL.md ownership sections and PM routing. The key insight: **ownership is a conflict prevention mechanism, not just an organizational one.**

**Scaling note:** As the team grows, ownership granularity matters. A single teammate owning `src/**` provides no isolation. The PM should watch for ownership that's too broad and propose evolution (see P4 persona catalog — role evolution).

---

### Layer 4 — Active Claims System

**What:** Advisory file locks. Before starting work, a teammate "claims" the files they're about to touch. Other teammates can see active claims and are warned if they're about to touch claimed files.

**This is the new piece.** Layers 1-3 and 5 already exist or are specced. Layer 4 fills the gap between ownership routing (coarse-grained, static) and merge queue (catches conflicts after the fact).

#### Claim Format

Claims live in `.git/teammates/claims/` — inside the shared `.git` directory so all worktrees on the same machine can see them (worktrees share `.git`). Never committed, never pushed.

```json
// .git/teammates/claims/claim_abc123.json
{
  "id": "claim_abc123",
  "teammate": "beacon",
  "branch": "feat/refactor-events",
  "patterns": [
    "packages/cli/src/events.ts",
    "packages/cli/src/events/**"
  ],
  "reason": "Refactoring event system to use typed emitters",
  "created": "2026-03-22T10:30:00Z",
  "expires": "2026-03-22T22:30:00Z",
  "session_id": "sess_abc123"
}
```

| Field | Description |
|---|---|
| `id` | Unique claim identifier |
| `teammate` | Who holds the claim |
| `branch` | What branch they're working on |
| `patterns` | Glob patterns for claimed files — can be specific files or directories |
| `reason` | Human-readable description of the work |
| `created` | When the claim was created |
| `expires` | Auto-expire time (default: 12 hours). Prevents stale claims from orphaned sessions |
| `session_id` | Links to the session that created it. Used for auto-cleanup |

#### Claim Lifecycle

```
1. CLAIM    — Teammate declares intent to work on files
2. ACTIVE   — Other teammates see the claim and route around it
3. RELEASE  — Work is done (committed/pushed). Claim is deleted.
4. EXPIRE   — Session ends or expires time passes. Claim is auto-deleted.
```

#### How Claims Are Created

**Automatic:** When the orchestrator assigns a task, it analyzes the task description + teammate ownership to predict which files will be touched, and creates a claim. This is best-effort — the prediction doesn't need to be perfect because claims are advisory.

**Manual:** A teammate or human can explicitly claim files:

```
/claim packages/cli/src/events.ts packages/cli/src/events/** --reason "Refactoring event system"
```

**During work:** If an agent touches a file that wasn't in the original claim, the claim is auto-expanded to include it.

#### How Claims Are Checked

**Before task assignment:** The orchestrator checks existing claims before assigning a new task. If the new task's predicted file set overlaps with an active claim:

```
⚠ Conflict detected:
  beacon has claimed packages/cli/src/events.ts
  Reason: "Refactoring event system to use typed emitters"
  Branch: feat/refactor-events
  Since: 2h ago

Options:
  [1] Wait — queue the task until beacon's claim is released
  [2] Proceed — work on it anyway (you'll need to resolve conflicts at merge time)
  [3] Coordinate — hand off to beacon to include in their current work
  [4] Narrow — adjust the task to avoid the claimed files
```

The human decides. Claims are **advisory, not blocking** — you can always proceed, but you do so with full awareness.

**During work:** If an agent tries to edit a file claimed by another teammate, the CLI logs a warning. It doesn't block the edit (that would break agent workflows), but the warning is surfaced in the task output.

#### Claim Storage

**Phase 1 (single machine, no server):** Claims in `.git/teammates/claims/` — inside the shared `.git` directory, so all worktrees on the same machine see them automatically. Never committed, never pushed. Multiple humans on different machines won't see each other's claims — and that's acceptable because the other 4 layers still protect them.

**Phase 2 (server):** Server indexes claims and broadcasts them via WebSocket. The Campfire server adds a `/claims` API endpoint:

| Method | Path | Description |
|---|---|---|
| `GET` | `/claims` | List active claims for this repo |
| `POST` | `/claims` | Create a claim |
| `DELETE` | `/claims/:id` | Release a claim |

Claims remain ephemeral — never persisted to git. The server is the shared visibility layer.

**Transition:** Phase 1 claims are strictly local. When the server ships (Campfire Phase 2), claims graduate to server-managed. No migration needed — Phase 1 claims are ephemeral by design.

#### Auto-Cleanup

Claims are cleaned up in these cases:

1. **Task completes** — Orchestrator releases the claim after the agent's task finishes
2. **Session ends** — On graceful CLI shutdown, all claims for that session are released
3. **Expiry** — If a session crashes or the CLI is killed, claims expire after 12 hours (configurable)
4. **Manual** — `/unclaim <id>` or `/unclaim --all`

#### Edge Cases

| Scenario | Behavior |
|---|---|
| Agent crashes mid-task | Claim stays until expiry. Other agents see it as stale after session heartbeat stops. |
| Two agents claim overlapping files simultaneously | Second claim attempt triggers the conflict warning. Human decides. |
| Claim on a file that doesn't exist yet | Valid — you can claim files you're about to create. Pattern matching handles this. |
| Human working outside the CLI | No claim created. This is a known gap — claims only work for CLI-managed work. Outside edits are caught at merge time (Layer 5). |

---

### Layer 5 — PR Merge Queue

**What:** All branches merge to main through PRs with a merge queue enabled. The merge queue serializes integration — only one PR merges at a time, and each one is tested against the latest main before merging.

**How it works:** GitHub's native merge queue feature. When a PR is approved:

1. PR enters the queue
2. GitHub rebases it onto the latest main
3. CI runs on the rebased version
4. If CI passes, it merges. If not, it's ejected from the queue.

**What it prevents:** The "merge skew" problem — where two PRs both pass CI individually but break when combined. The merge queue ensures every PR is tested against the state it will actually merge into.

**What it doesn't prevent:** Semantic conflicts that pass CI. If two PRs both pass tests individually AND when combined, but the combined behavior is wrong — no automated system catches this. That's what code review is for.

**Implementation:** GitHub-native. Enable in repo settings → Branch protection → Require merge queue.

**Recommendation:** Combine with required status checks (CI must pass) and required reviews (at least one human approves).

---

## How the Layers Work Together

A real scenario: 10 humans + 5 AI teammates, all working on the same monorepo.

```
Morning: PM reviews the task queue and routes work

  Task A (CLI refactor)     → beacon (owns packages/cli/**)
  Task B (docs update)      → scribe (owns docs/**)
  Task C (CI fix)           → pipeline (owns .github/**)
  Task D (new API endpoint) → Steve's agent (Steve owns packages/api/**)
  Task E (perf testing)     → Sarah's agent (Sarah owns packages/perf/**)
```

**Layer 3 (ownership)** ensures no overlap in the assignment. Each task targets files owned by one teammate.

**Layer 1 (branches)** isolates each task on its own branch. beacon works on `feat/cli-refactor`, Steve's agent works on `feat/new-endpoint`, etc.

**Layer 2 (worktrees)** means beacon works in `.worktrees/beacon-cli-refactor` and Steve's agent works in `.worktrees/steves-agent-new-endpoint`. Even on the same machine, they can't step on each other's uncommitted changes. Both agents write memory/handoffs to the main tree's `.teammates/` via absolute path.

Now suppose an unexpected case: Task D (new endpoint) needs to modify `packages/cli/src/router.ts`, which beacon owns and is actively refactoring.

**Layer 4 (claims)** catches this. Beacon claimed `packages/cli/src/**` when they started the refactor. When Steve's agent tries to edit `router.ts`, the claim check fires:

```
⚠ beacon has claimed packages/cli/src/** (CLI refactor in progress)
```

Steve sees the warning and decides to coordinate with beacon — either wait, or have beacon include the router change in their refactor.

Finally, all five tasks complete and create PRs.

**Layer 5 (merge queue)** serializes the merges. Each PR is rebased and tested against the latest main before merging. Even if beacon's refactor changes the router API, Steve's endpoint PR gets rebased and re-tested after beacon's merges first.

---

## What This Doesn't Solve

1. **Semantic conflicts that pass all tests** — If two changes are individually correct and combined-correct but semantically conflicting (e.g., two different caching strategies), no automated system catches this. This requires human judgment via code review.

2. **Work outside the CLI** — If a human edits files directly (not through the teammates CLI), no claim is created. Their changes are only caught at merge time.

3. **Cross-repo conflicts** — This system is per-repo. If two repos depend on each other and conflicting changes are made in each, that's a different problem (dependency management, not collision prevention).

---

## Implementation Path

| Phase | What Ships | Layer | Dependencies |
|---|---|---|---|
| **Already exists** | Branch isolation, ownership routing, PR merge queues | 1, 3, 5 | None |
| **S27** | Worktree isolation (per-agent, `.worktrees/` dir, branch naming, lifecycle) | 2 | Beacon implementation |
| **Campfire Phase 1** | Claims (local, single machine) | 4 (local) | Campfire Phase 1 |
| **Campfire Phase 2** | Claims (server-managed, cross-machine) | 4 (shared) | Campfire server |

Claims should ship with Campfire Phase 1 — they're file-based, no server needed, and solve the most dangerous class of conflict (semantic overlaps between teammates working concurrently).

---

## New CLI Commands

| Command | Description |
|---|---|
| `/claim <patterns...> [--reason "..."]` | Manually claim files before starting work |
| `/unclaim [id \| --all]` | Release a claim |
| `/claims` | List all active claims (local in Phase 1, server-wide in Phase 2) |

---

## Resolved Questions

1. **Cross-machine Phase 1** — Claims are NEVER committed to git. Phase 1 is single-machine only. Cross-machine visibility requires the Campfire server (Phase 2). The other 4 layers (branches, worktrees, ownership, merge queue) still protect across machines without claims. **Decision: No git artifacts. Ever.**

## Open Questions

1. **Claim granularity** — Should claims be file-level or directory-level? File-level is more precise but chattier. Directory-level (glob patterns) is coarser but maps to ownership patterns. Current spec uses globs — validate with real usage.
2. **Claim inheritance** — If beacon claims `packages/cli/src/**` and then hands off a sub-task to another agent, should the sub-agent inherit the claim? Or create its own?
