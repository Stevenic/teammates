# Multi-Human Collaboration — Design Spec

A system where humans and AI agents collaborate as equals within the teammates framework. Every human gets a persistent **twin** — a digital mirror that learns from everything you do and can eventually act on your behalf. The system starts with **zero infrastructure** — plain git and markdown files handle twins, handoffs, presence, and queues. A server is an optional accelerator that adds real-time notifications and WebSocket presence when the team outgrows polling.

**Status:** Draft (updated with Beacon + Pipeline review feedback, user design decisions 2026-03-21)
**Owner:** Scribe (spec) → Beacon (implementation) → Pipeline (server deployment, Phase 2+)
**Priority:** P2 Campfire — Phase 1 this week, Phase 2 next week
**Reviewed by:** Beacon (technical feasibility), Pipeline (CI/CD + infrastructure)

---

## Core Concept

Every participant — human or AI — is a **teammate**. The only difference is execution:

| | AI Teammate | Human Twin |
|---|---|---|
| SOUL.md | Identity, principles, boundaries | Identity, preferences, expertise, working hours |
| Memory | Automatic (daily logs, typed, wisdom) | Automatic (tracks everything the human does in the project) |
| Handoffs | Executed immediately by agent | Queued until human comes online |
| Execution | AI agent runs the task | Human reads the task and acts |

This unified model means all existing infrastructure — recall, context windows, standups, retros, decision logs — works for humans without special-casing.

---

## Problem

Today, teammates is single-human. One person runs the CLI, talks to their AI teammates, and all handoffs resolve within a single session. There's no way to:

- Hand off a task to another human (e.g., "Steve, can you review this PR?")
- Persist context across multiple humans working on the same project
- Route work intelligently based on who knows what
- Accumulate institutional memory that spans the whole team, not just one person's sessions

---

## How Far Can We Get Without a Server?

The answer: **very far.** Phase 1 uses only git and local files. No server, no deployment, no infrastructure.

### Phase 1 Architecture — Git Only

```
.teammates/
  stevenic/        <- human twin (SOUL.md, WISDOM.md, memory/)
  sarah/           <- human twin (SOUL.md, WISDOM.md, memory/)
  beacon/          <- AI teammate (SOUL.md, WISDOM.md, memory/)
  _handoffs/       <- file-based handoff queue
    hoff_abc123.json
    hoff_def456.json
  .tmp/
    heartbeat/     <- presence via local files (gitignored)
      stevenic.json
      sarah.json
```

**What you get with zero infrastructure:**

| Capability | How It Works |
|---|---|
| **Twin folders** | Every human gets a full teammate folder — SOUL.md, WISDOM.md, memory/, RESUME.md |
| **File-based handoffs** | One JSON file per handoff in `_handoffs/`. Clean git merges (additive only, no conflicts) |
| **Heartbeat presence** | CLI writes `heartbeat/<alias>.json` with timestamp. "Last active" is visible to all. Gitignored — local only |
| **Queue digest on startup** | CLI scans `_handoffs/` for items addressed to you, presents a digest before the REPL prompt |
| **Accept / Delegate / Dismiss** | `/accept <id>`, `/delegate <id> @teammate`, `/dismiss <id>` — manage your queue from the CLI |
| **Twin memory formation** | Git commits, handoff responses, code changes — all feed the twin's memory system (with user permission) |
| **All existing infra** | Recall, standups, retros, decision logs, compaction — everything works for human twins with no changes |

**What you can't do without a server:**

| Limitation | Why |
|---|---|
| **Real-time notifications** | You find out about handoffs when you pull / launch the CLI |
| **True cross-machine presence** | Heartbeat is local-only. You can see "last active" via git history, but not "online right now" |
| **Push alerts** | No way to ping someone's phone/desktop when a blocking handoff arrives |

For a team of 2-5 people who pull regularly or work in the same time window, Phase 1 is enough. The server becomes valuable when latency matters or the team exceeds ~5 humans.

### Heartbeat Presence (Phase 1)

The CLI writes a heartbeat file on startup and refreshes it periodically:

```json
// .teammates/.tmp/heartbeat/stevenic.json (gitignored)
{
  "alias": "stevenic",
  "timestamp": "2026-03-21T15:30:00Z",
  "status": "active",
  "session_id": "sess_abc123"
}
```

Other clients can read these files to see who was recently active. Since `.tmp/` is gitignored, this is local-only — presence is scoped to the same machine or shared filesystem. Cross-machine presence requires the server (Phase 2).

The CLI can also commit a lightweight `last-active` field to SOUL.md or a shared presence file on graceful shutdown, giving a git-visible "last seen" timestamp.

---

## What Does the Server Add?

When Phase 1's limitations start to bite, the server adds exactly 3 things:

### Phase 2 Architecture — Server as Accelerator

```
                 Teammates Server
  (adds to Phase 1 -- Phase 1 still works without it)

  +-----------+  +------------+  +----------------+
  |   Auth    |  |  Presence  |  |  Push Notify   |
  |  (GitHub  |  |  (real-    |  |  (handoff      |
  |   OAuth)  |  |   time)    |  |   alerts)      |
  +-----------+  +------------+  +----------------+
       |               |               |
       v               v               v
  +-------------------------------------------------+
  |           Handoff Queue API                      |
  |  (indexes _handoffs/ for faster reads,           |
  |   eventually replaces file polling)              |
  +-------------------------------------------------+
```

| Server Capability | What It Enables |
|---|---|
| **Real-time presence** | WebSocket heartbeat — know who's online *right now*, not just "last active" |
| **Push notifications** | Instant alert when someone hands off work to you, even if the CLI isn't open |
| **Handoff queue API** | Server-indexed queue for faster reads. Replaces git polling at scale |

**Git still owns all durable state.** The server never writes to `.teammates/`. It reads the repo to build its model. If the server goes down, Phase 1 keeps working — you just lose real-time features.

### Server Design Decisions (from review)

**AI execution stays client-side.** The CLI spawns `claude -p`, `codex exec`, etc. as subprocesses. The server handles only queue/presence/auth. Server-side AI execution is deferred to Phase 4. _(Beacon)_

**GitHub App as hosting model.** Solves three problems at once: OAuth + permissions per-repo, native webhook reception, and scoped read-only access to `.teammates/`. _(Pipeline)_

**Server lives in-monorepo as `packages/server/`.** Keeps shared types and enables cross-package testing. Inherits existing CI patterns. _(Pipeline)_

**Container hosting for WebSocket.** Persistent connections rule out pure serverless. Recommended: Azure Container Apps or Fly.io — both handle WebSocket natively and can scale to zero when idle. _(Pipeline)_

---

## Design Decisions (from user, 2026-03-21)

### Naming: "Twin" (confirmed)

The term **twin** is confirmed over "avatar." A twin implies a mirror that learns and can eventually act on your behalf — closer to the digital twin concept from manufacturing/IoT. "Avatar" implies a representation you control; "twin" implies a mirror that grows independently.

### Twin Memory Formation — Requires User Permission

A twin captures memories from everything the human does — git commits, PR reviews, code changes, handoff responses, design decisions, issue comments. However, **this requires explicit user permission**. The human must opt in to what their twin captures. This aligns with the foundational principle that nothing automatic should happen without human control.

The permission model should be configurable per-twin in SOUL.md (details TBD — could be granular per-source or a simple on/off).

### PM Authority — Propose, Don't Act

The PM's twin does NOT have autonomous authority to reorder queues and route work. The PM twin **proposes** actions and the human PM **approves**. Smart defaults make the common case easy (e.g., auto-suggest reordering when a blocking task arrives), but the human always has final say.

This is a universal principle: **nothing automatic that a human doesn't control.** All twin actions that affect other teammates must go through the human.

### Twin as Institutional Memory (confirmed)

When a human leaves a project, their twin stays. New teammates can query the departed human's twin for context about past decisions, domain knowledge, and project history. The twin becomes institutional memory — the project never loses the knowledge that person accumulated.

### Twin Maturity Model (deferred)

The three-phase maturity model (passive recorder → context provider → active proxy) is acknowledged but deferred for now. We'll let this one play out over time and see what the right progression looks like in practice rather than designing it upfront.

---

## Twin Identity Model

A human twin's `SOUL.md` is a **rich routing profile**, not a minimal stub. It enables other teammates (human and AI) to write well-targeted handoffs.

### SOUL.md Structure for Human Twins

```markdown
# <GitHub Alias>

## Identity

- **Name:** Steve Ickman
- **GitHub:** stevenic
- **Role:** AI Platform Architect
- **Type:** human

## Expertise
- Adapter layer, CLI orchestration, TypeScript
- AI agent design, prompt engineering

## Preferences
- Communication: terse, direct
- Reviews: prefers small PRs with clear descriptions
- Working hours: PST, weekdays

## Ownership
<!-- Same format as AI teammates — glob patterns -->
- packages/cli/src/adapter.ts
- packages/cli/src/orchestrator.ts
```

The `Type: human` field is the only structural difference from an AI teammate. Everything else follows the same SOUL.md format.

### Population

Twin SOUL.md is seeded during onboarding from:
1. GitHub profile (name, bio)
2. USER.md interview (preferences, expertise, working hours)
3. Git history analysis (ownership patterns from `git log --author`)

The twin learns and refines over time through the normal memory system — daily logs capture what the human works on, typed memories extract patterns, wisdom distills principles.

---

## Handoff Queue

### Structure

Each queued handoff is a JSON object:

```json
{
  "id": "hoff_abc123",
  "from": "beacon",
  "to": "stevenic",
  "priority": "blocking",
  "created": "2026-03-19T10:30:00Z",
  "expires": null,
  "status": "pending",
  "subject": "Review auth middleware refactor",
  "body": "Refactored the auth middleware to use...",
  "thread_id": null,
  "context": {
    "branch": "feat/auth-refactor",
    "pr": 142,
    "files": ["src/middleware/auth.ts"]
  }
}
```

### Priority Levels

| Priority | Meaning | Presentation |
|---|---|---|
| `blocking` | Sender is waiting on this. Nothing else can proceed. | Top of queue, highlighted |
| `normal` | Standard work handoff. | Default order |
| `fyi` | Informational. No action required. | Collapsed/grouped |

### Storage

**Phase 1 (git-only):** Handoffs are stored as **one file per handoff** in `.teammates/_handoffs/`. One-file-per-handoff ensures git merges are always clean — if two humans push handoff files simultaneously, there are no conflicts (additive only). _(Beacon)_

```
.teammates/_handoffs/
  hoff_abc123.json
  hoff_def456.json
  hoff_ghi789.json
```

**Phase 2 (server):** Server indexes `_handoffs/` and provides a queue API for faster reads. Files remain the source of truth.

### Lifecycle

1. **Created** — A teammate (human or AI) hands off work. Writes a file to `_handoffs/` (Phase 1) or POSTs to server (Phase 2).
2. **Delivered** — Target comes online. CLI presents queued items as a digest.
3. **Accepted** — Human picks up the task. Status → `in_progress`.
4. **Completed** — Human finishes. Can optionally hand back with a response.
5. **Expired** — If `expires` is set and the deadline passes (e.g., PR already merged), status → `expired`.

### Delegation

A human can re-delegate a queued task without doing it:

```
/delegate hoff_abc123 @sarah "You know the auth module better"
```

This creates a new handoff to Sarah with the original context preserved plus the delegation reason.

---

## Presence System

### Phase 1 — Heartbeat Files (Local)

| State | Detection |
|---|---|
| `active` | Heartbeat file updated within last 5 minutes |
| `recent` | Heartbeat file updated within last 30 minutes |
| `away` | Heartbeat file older than 30 minutes or missing |

Heartbeat files live in `.teammates/.tmp/heartbeat/` (gitignored). The CLI updates them every 60 seconds. This is local-only — visibility is scoped to the same machine or shared filesystem.

On graceful shutdown, the CLI can commit a `last-active` timestamp to a shared presence file or SOUL.md, giving git-visible "last seen" data.

### Phase 2 — WebSocket Presence (Real-Time)

| State | Meaning |
|---|---|
| `online` | Client connected, human is active |
| `idle` | Client connected, no activity for 15 min |
| `offline` | Client disconnected |

Client sends heartbeat to server every 60 seconds. Server marks client as `offline` after 3 missed heartbeats (3 min). Presence is ephemeral — never persisted to git.

### Behavior by State

- **Online → online handoff:** Immediate notification in the CLI feed. Configurable: interrupt vs. queue.
- **Online → offline handoff:** Queued. Presented on next connect.
- **AI teammate handoff:** Always immediate (AI teammates execute client-side).

---

## Handoff Threads (Phase 2.5)

Handoffs between humans need replies, not just fire-and-forget. A **thread** is a chain of handoffs sharing a `thread_id`.

```
beacon → stevenic: "Review this PR" (thread_001)
stevenic → beacon: "One nit on line 42" (thread_001)
beacon → stevenic: "Fixed. Re-review?" (thread_001)
stevenic → beacon: "Approved." (thread_001, closed)
```

Threads are displayed as conversations in the queue digest. Any participant can close a thread. Shipped separately from Phase 2 to reduce initial server complexity.

---

## Client Changes

### Phase 1 — No Server Connection

On launch, the CLI:
1. Identifies the current user (from USER.md alias or git config)
2. Scans `.teammates/_handoffs/` for items addressed to this user
3. Presents queue digest if any pending handoffs exist
4. Writes heartbeat file to `.teammates/.tmp/heartbeat/`

### Phase 2 — Server Connection

On launch, the CLI checks for a `server` field in `.teammates/config.json`:

```json
{
  "server": "https://teammates.example.com",
  "repo": "Stevenic/teammates"
}
```

If present, the client:
1. Authenticates via stored GitHub token (or runs OAuth flow)
2. Opens WebSocket for presence + notifications
3. Fetches pending queue items from server API
4. Presents queue digest before the normal REPL prompt

If absent, falls back to Phase 1 behavior (file scanning).

### Queue Digest

On connect/launch, if there are pending handoffs:

```
+-- Pending Handoffs -----------------------------------------+
|                                                              |
|  ** BLOCKING (1)                                             |
|  [1] from @beacon: Review auth middleware refactor           |
|      PR #142 - feat/auth-refactor - 2h ago                   |
|                                                              |
|  NORMAL (2)                                                  |
|  [2] from @sarah: Can you check the perf numbers?           |
|  [3] from @reviewer: Style nits on adapter.ts               |
|                                                              |
|  FYI (1)                                                     |
|  [4] from @beacon: Refactored logging module                |
|                                                              |
|  /accept 1 - /delegate 2 @beacon - /dismiss 4               |
+--------------------------------------------------------------+
```

### New Commands

| Command | Description |
|---|---|
| `/queue` | Show pending handoffs |
| `/accept <id>` | Accept a handoff, load its context |
| `/delegate <id> @teammate [reason]` | Re-delegate to another teammate |
| `/reply <id> <message>` | Reply in a handoff thread (Phase 2.5) |
| `/dismiss <id>` | Dismiss an FYI or expired handoff |
| `/status` | Show team presence (who's online/active) |

---

## Server API (Phase 2)

### Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/auth/github` | GitHub OAuth flow, returns session token |
| `GET` | `/team` | Roster from `.teammates/` |
| `GET` | `/queue` | Pending handoffs for authenticated user |
| `POST` | `/handoff` | Create a new handoff |
| `PATCH` | `/handoff/:id` | Update status (accept, complete, delegate) |
| `GET` | `/handoff/:id/thread` | Get thread for a handoff |
| `POST` | `/handoff/:id/reply` | Reply in a thread |
| `WS` | `/ws` | WebSocket for presence + real-time notifications |

### Auth

GitHub OAuth. The server maps GitHub identity → twin teammate folder. No separate user database — your GitHub account *is* your identity, and your `.teammates/<github_alias>/` folder *is* your profile.

---

## Conflict Resolution

### Code Conflicts

Git handles these. Multiple humans work on branches, merge via PRs. No change from standard git workflow.

### Memory Conflicts

Memory is **per-twin**. Each human's twin writes only to its own `.teammates/<alias>/memory/` directory. No shared memory writes means no write conflicts.

**Privacy model:** All twin memory is team-visible by default (same as AI teammates) and searchable via recall. For sensitive information, twins can use a `## Private` section in SOUL.md that recall skips during indexing. This avoids building a full access control layer into recall while giving humans an opt-out for personal notes. _(Beacon)_

Cross-team knowledge flows through:
- **CROSS-TEAM.md** — shared notes (same as today)
- **Handoffs** — direct communication
- **Recall** — search across all teammates' indexed memories (read-only, respects `## Private` sections)

### Decision Conflicts

If two humans make conflicting decisions, the **DECISIONS.md** log is the resolution mechanism. Decisions are numbered and timestamped. Later decisions supersede earlier ones. Contested decisions get an `Alternatives` section documenting the disagreement.

---

## Twin as AI Proxy (Phase 4)

When a human is offline, their twin can optionally answer questions using accumulated memory. This is a spectrum:

| Level | Capability | Risk |
|---|---|---|
| **Off** | Queue only. No proxy behavior. | None |
| **Read-only** | Answer questions about the human's past work, decisions, and context. Never take actions. | Low — may surface stale or incomplete information |
| **Delegated** | Execute simple, pre-approved task types (e.g., approve a passing CI run, answer "where is X?"). | Medium — needs guardrails |

Proxy level is configured per-twin in SOUL.md:

```markdown
## Proxy
- Level: read-only
- Allowed: answer questions about my past decisions, summarize my recent work
- Disallowed: approve PRs, merge branches, modify code
```

---

## GitHub Integration (Phase 3)

Since the server is a GitHub App, it receives webhook events natively — no CI workflow changes needed. The server consumes events and creates handoffs:

| GitHub Event | Handoff Created |
|---|---|
| PR assigned to user | `@github → @user: Review PR #N` |
| Issue assigned to user | `@github → @user: Assigned issue #N` |
| CI failure on user's commit | `@github → @user: CI failed on commit abc123` |
| PR review requested | `@github → @user: Review requested on PR #N` |

`@github` is a synthetic teammate — no folder, no memory, just an event source. These handoffs appear in the queue alongside teammate handoffs.

---

## Onboarding Flow

### New Human Joining

```
$ teammates join
-> Authenticating with GitHub... ok (stevenic)
-> Repo: Stevenic/teammates

Creating your twin...

? What's your role on this project? AI Platform Architect
? Areas of expertise? (comma-separated) TypeScript, AI agents, CLI design
? Preferred communication style? Terse and direct
? Working hours? PST weekdays
? Anything teammates should know about how you work? I prefer small PRs

-> Created .teammates/stevenic/
-> SOUL.md seeded from GitHub profile + your answers
-> Memory initialized (empty -- will accumulate as you work)
-> You're on the team. Run `teammates` to start.
```

### What Gets Created

```
.teammates/stevenic/
  SOUL.md          <- rich profile from interview + GitHub
  WISDOM.md        <- empty (grows over time)
  RESUME.md        <- empty (grows over time)
  memory/
    weekly/
    monthly/
```

---

## Phase Summary

| Phase | What | Server? | Est. LOC | Owner | Timeline |
|---|---|---|---|---|---|
| **1** | File-based handoffs, human twins, heartbeat presence, `/accept`/`/delegate`/`/dismiss` | **No** | ~400 | Beacon | This week |
| **2** | Server: auth, real-time presence, push notifications, handoff queue API | Yes (lightweight) | ~1100 | Beacon + Pipeline | Next week |
| **2.5** | Handoff threads, `/reply` | Yes | ~200 | Beacon | After Phase 2 |
| **3** | GitHub event bridge (`@github` teammate) | Yes + webhooks | ~400 | Beacon + Pipeline | Future |
| **4** | Server-side AI execution, twin proxy, team dashboard | Yes + compute | Large | Beacon + Pipeline | Future |

**Phase 1 is buildable today with zero new infrastructure.** That's where we start. The server is an accelerator, not a requirement.

---

## Phase 1 — Detailed Implementation Plan

### CLI Changes (~400 LOC, Beacon)

1. **`TeammateConfig` gets `type: "human" | "ai"`** — Registry parses from SOUL.md `Type:` field
2. **`HandoffEnvelope` extended** — `priority`, `expires`, `status`, `thread_id` fields
3. **`Orchestrator.assign()` gate** — If target is `type: "human"`, write to `_handoffs/` instead of executing
4. **Startup scan** — On launch, scan `_handoffs/` for items addressed to the current user's twin
5. **Heartbeat writer** — Write `heartbeat/<alias>.json` on startup, refresh every 60s, clean up on shutdown
6. **New commands** — `/accept`, `/delegate`, `/dismiss`, `/queue`, `/status`

### CI Impact

None. `paths-ignore` already covers `.teammates/**`. Ownership overlay parses any SOUL.md with `### Primary`/`### Secondary` sections, so human twins work automatically. _(Pipeline)_

---

## Resolved Questions

1. **Server hosting model** — **GitHub App**, installing per-repo. Handles OAuth, webhooks, and scoped repo access in one package. _(Pipeline)_
2. **Repo access scope** — Read-only. Git owns state, server indexes it. Server never writes to `.teammates/` directly. _(Pipeline)_
3. **Twin memory privacy** — Team-visible by default (same as AI teammates). `## Private` section in SOUL.md is skipped by recall indexing. No full ACL needed. _(Beacon)_
4. **AI execution model** — Client-side through Phase 3. Server handles only queue/presence/auth. Server-side execution deferred to Phase 4. _(Beacon)_
5. **Naming** — "Twin" over "avatar." Confirmed by user 2026-03-21.
6. **PM twin authority** — Propose-only. Human PM approves all queue reordering and routing changes. Smart defaults, never autonomous. _(User)_
7. **Twin memory permissions** — Twin memory formation requires explicit user permission. Human opts in to what gets captured. _(User)_
8. **Institutional memory** — When a human leaves, their twin stays as queryable project knowledge. Confirmed. _(User)_

## Open Questions

1. **Multi-repo teams** — Can one server span multiple repos? Or is it strictly one server per repo? (GitHub App installations are per-repo, but a single App can be installed on multiple repos.)
2. **Billing/cost model** — AI teammates consume API tokens. Who pays when Sarah's twin hands off to an AI reviewer? Per-human billing? Per-repo pool?
3. **Offline twin intelligence** — The proxy feature (Phase 4) requires running an AI agent as the twin. What model? What context budget? This is a separate cost center from the human's interactive session.
4. **WebSocket idle cost** — WebSocket servers don't scale to zero cleanly. Even idle, there's a minimum cost for the connection listener. Worth sizing early for Phase 2. _(Pipeline)_
5. **Webhook secret management** — GitHub App webhook secrets and private keys need secure storage. Repo secrets (if GitHub Actions deploys) or external secrets manager. _(Pipeline)_

---

## Review Log

| Date | Reviewer | Key Feedback | Status |
|---|---|---|---|
| 2026-03-19 | Beacon | One-file-per-handoff, client-side AI execution, threads → Phase 2.5, memory privacy model | Incorporated |
| 2026-03-19 | Pipeline | GitHub App hosting, in-monorepo server, container hosting, CI compatibility confirmed | Incorporated |
| 2026-03-21 | User (stevenic) | Naming → "twin", memory needs permission, PM proposes/human approves, institutional memory confirmed, maturity model deferred | Incorporated |
| 2026-03-21 | Scribe | Reframed phasing: "no server first" narrative. Phase 1 git-only, Phase 2 server as accelerator. Added heartbeat presence, detailed Phase 1 impl plan | Updated |
