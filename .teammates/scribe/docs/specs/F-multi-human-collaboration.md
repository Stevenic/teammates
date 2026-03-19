# Multi-Human Collaboration — Design Spec

A system where humans and AI agents collaborate as equals within the teammates framework. Every human gets a persistent avatar teammate. A server bound to a GitHub repo orchestrates handoffs, presence, and queued work across all participants.

**Status:** Draft (updated with Beacon + Pipeline review feedback)
**Owner:** Scribe (spec) → Beacon (server + client implementation) → Pipeline (server deployment)
**Priority:** Future — this is a major new capability, not a parity feature
**Reviewed by:** Beacon (technical feasibility), Pipeline (CI/CD + infrastructure)

---

## Core Concept

Every participant — human or AI — is a **teammate**. The only difference is execution:

| | AI Teammate | Human Avatar |
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

## Architecture

### Components

```
┌──────────────────────────────────────────────────┐
│                  GitHub Repo                       │
│  .teammates/                                       │
│    stevenic/     ← human avatar                    │
│      SOUL.md, WISDOM.md, memory/                   │
│    sarah/        ← human avatar                    │
│      SOUL.md, WISDOM.md, memory/                   │
│    beacon/       ← AI teammate                     │
│      SOUL.md, WISDOM.md, memory/                   │
│    reviewer/     ← AI teammate                     │
│      SOUL.md, WISDOM.md, memory/                   │
└──────────────────────────────────────────────────┘
         │ git push/pull
         ▼
┌──────────────────────────────────────────────────┐
│              Teammates Server                      │
│                                                    │
│  ┌─────────┐  ┌──────────┐  ┌────────────────┐   │
│  │  Auth    │  │ Presence │  │ Handoff Queue  │   │
│  │ (GitHub  │  │ (who's   │  │ (pending tasks │   │
│  │  OAuth)  │  │  online) │  │  per teammate) │   │
│  └─────────┘  └──────────┘  └────────────────┘   │
│                                                    │
│  ┌─────────────────────────────────────────────┐  │
│  │              Repo Index                      │  │
│  │  Reads .teammates/ to build team model       │  │
│  │  Roster, ownership, routing rules            │  │
│  └─────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
         ▲              ▲
         │              │
    ┌────┘              └────┐
    │                        │
┌───────────┐         ┌───────────┐
│ Steve's   │         │ Sarah's   │
│ Client    │         │ Client    │
│ (CLI)     │         │ (CLI)     │
└───────────┘         └───────────┘
```

### Key Principle: Git Owns State, Server Indexes It

All durable state lives in the repo as plain markdown. The server reads the repo to build its model but never writes to `.teammates/` directly. This preserves the "plain markdown, tool agnostic" philosophy — the server is an accelerator, not a requirement.

The server owns only:
- **Handoff queue** — transient task queue (not in git)
- **Presence** — ephemeral connection state
- **Auth** — GitHub identity mapping

### Architecture Decisions (from review)

**AI execution stays client-side.** Today, all agent execution is client-side — the CLI spawns `claude -p`, `codex exec`, etc. as subprocesses. Moving execution to the server would require agent binaries, API keys, and compute resources on the server. Instead, the server handles only handoff queue, presence, and auth. Humans hand off to AI teammates on their own machine. Server-side AI execution is deferred to Phase 4. _(Beacon)_

**GitHub App as hosting model.** The server should be a GitHub App, which solves three problems at once: OAuth + permissions per-repo, native webhook reception for GitHub events, and scoped read-only access to `.teammates/`. This is cleaner than self-hosted + manual webhook configuration. _(Pipeline)_

**Server lives in-monorepo as `packages/server/`.** Keeps shared types and enables cross-package testing. Inherits the existing CI patterns (lint, typecheck, build, test, coverage). _(Pipeline)_

**Container hosting for WebSocket.** The presence system (heartbeat every 60s) requires persistent connections, ruling out pure serverless. Recommended: Azure Container Apps or Fly.io — both handle WebSocket natively and can scale to zero when idle. _(Pipeline)_

---

## Avatar Identity Model

A human avatar's `SOUL.md` is a **rich routing profile**, not a minimal stub. It enables other teammates (human and AI) to write well-targeted handoffs.

### SOUL.md Structure for Human Avatars

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

Avatar SOUL.md is seeded during onboarding from:
1. GitHub profile (name, bio)
2. USER.md interview (preferences, expertise, working hours)
3. Git history analysis (ownership patterns from `git log --author`)

The avatar learns and refines over time through the normal memory system — daily logs capture what the human works on, typed memories extract patterns, wisdom distills principles.

---

## Handoff Queue

### Structure

Each queued handoff is a JSON object stored server-side:

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

### File-Based Storage (Phase 1)

In Phase 1 (no server), handoffs are stored as **one file per handoff** in `.teammates/_handoffs/`. One-file-per-handoff ensures git merges are always clean — if two humans push handoff files simultaneously, there are no conflicts (additive only). A single queue file would create merge conflicts on every concurrent push. _(Beacon)_

```
.teammates/_handoffs/
  hoff_abc123.json
  hoff_def456.json
  hoff_ghi789.json
```

### Lifecycle

1. **Created** — A teammate (human or AI) hands off work. Server persists it (Phase 2+) or writes a file (Phase 1).
2. **Delivered** — Target comes online. Server presents queued items as a digest.
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

### States

| State | Meaning |
|---|---|
| `online` | Client connected, human is active |
| `idle` | Client connected, no activity for 15 min |
| `offline` | Client disconnected |

### Behavior by State

- **Online → online handoff:** Immediate notification in the CLI feed. Configurable: interrupt vs. queue.
- **Online → offline handoff:** Queued. Presented on next connect.
- **AI teammate handoff:** Always immediate (AI teammates execute client-side, not on the server — see Architecture Decisions below).

### Implementation

Client sends heartbeat to server every 60 seconds. Server marks client as `offline` after 3 missed heartbeats (3 min). Presence is ephemeral — never persisted to git.

---

## Handoff Threads

Handoffs between humans need replies, not just fire-and-forget. A **thread** is a chain of handoffs sharing a `thread_id`.

```
beacon → stevenic: "Review this PR" (thread_001)
stevenic → beacon: "One nit on line 42" (thread_001)
beacon → stevenic: "Fixed. Re-review?" (thread_001)
stevenic → beacon: "Approved." (thread_001, closed)
```

Threads are displayed as conversations in the queue digest. Any participant can close a thread.

---

## Server API

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

GitHub OAuth. The server maps GitHub identity → avatar teammate folder. No separate user database — your GitHub account *is* your identity, and your `.teammates/<github_alias>/` folder *is* your profile.

---

## Client Changes

### Connection

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
3. Fetches pending queue items
4. Presents queue digest before the normal REPL prompt

### Queue Digest

On connect, if there are pending handoffs:

```
┌─ Pending Handoffs ──────────────────────────────┐
│                                                   │
│  🔴 BLOCKING (1)                                  │
│  [1] from @beacon: Review auth middleware refactor │
│      PR #142 · feat/auth-refactor · 2h ago        │
│                                                   │
│  ⚪ NORMAL (2)                                    │
│  [2] from @sarah: Can you check the perf numbers? │
│  [3] from @reviewer: Style nits on adapter.ts     │
│                                                   │
│  💬 FYI (1)                                       │
│  [4] from @beacon: Refactored logging module      │
│                                                   │
│  /accept 1 · /delegate 2 @beacon · /dismiss 4    │
└───────────────────────────────────────────────────┘
```

### New Commands

| Command | Description |
|---|---|
| `/queue` | Show pending handoffs |
| `/accept <id>` | Accept a handoff, load its context |
| `/delegate <id> @teammate [reason]` | Re-delegate to another teammate |
| `/reply <id> <message>` | Reply in a handoff thread |
| `/dismiss <id>` | Dismiss an FYI or expired handoff |
| `/status` | Show team presence (who's online) |

---

## Conflict Resolution

### Code Conflicts

Git handles these. Multiple humans work on branches, merge via PRs. No change from standard git workflow.

### Memory Conflicts

Memory is **per-avatar**. Each human's avatar writes only to its own `.teammates/<alias>/memory/` directory. No shared memory writes means no write conflicts.

**Privacy model:** All avatar memory is team-visible by default (same as AI teammates) and searchable via recall. For sensitive information, avatars can use a `## Private` section in SOUL.md that recall skips during indexing. This avoids building a full access control layer into recall while giving humans an opt-out for personal notes. _(Beacon)_

Cross-team knowledge flows through:
- **CROSS-TEAM.md** — shared notes (same as today)
- **Handoffs** — direct communication
- **Recall** — search across all teammates' indexed memories (read-only, respects `## Private` sections)

### Decision Conflicts

If two humans make conflicting decisions, the **DECISIONS.md** log is the resolution mechanism. Decisions are numbered and timestamped. Later decisions supersede earlier ones. Contested decisions get an `Alternatives` section documenting the disagreement.

---

## Avatar as AI Proxy (Phase 4)

When a human is offline, their avatar can optionally answer questions using accumulated memory. This is a spectrum:

| Level | Capability | Risk |
|---|---|---|
| **Off** | Queue only. No proxy behavior. | None |
| **Read-only** | Answer questions about the human's past work, decisions, and context. Never take actions. | Low — may surface stale or incomplete information |
| **Delegated** | Execute simple, pre-approved task types (e.g., approve a passing CI run, answer "where is X?"). | Medium — needs guardrails |

Proxy level is configured per-avatar in SOUL.md:

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
→ Authenticating with GitHub... ✓ (stevenic)
→ Server: teammates.example.com
→ Repo: Stevenic/teammates

Creating your avatar...

? What's your role on this project? AI Platform Architect
? Areas of expertise? (comma-separated) TypeScript, AI agents, CLI design
? Preferred communication style? Terse and direct
? Working hours? PST weekdays
? Anything teammates should know about how you work? I prefer small PRs

→ Created .teammates/stevenic/
→ SOUL.md seeded from GitHub profile + your answers
→ Memory initialized (empty — will accumulate as you work)
→ You're on the team. Run `teammates` to start.
```

### What Gets Created

```
.teammates/stevenic/
  SOUL.md          ← rich profile from interview + GitHub
  WISDOM.md        ← empty (grows over time)
  memory/
    weekly/
    monthly/
```

---

## Migration Path

### Phase 1 — Local Multi-Human (No Server)

Multiple humans use the same repo with separate avatar folders. Handoffs are queued as **one file per handoff** in `.teammates/_handoffs/`. Humans pull the repo, check for handoff files addressed to them, and pick them up. Low-tech but functional — validates the avatar model without requiring server infrastructure.

**CLI changes (~400 LOC):** _(Beacon estimate)_
- `TeammateConfig` gets `type: "human" | "ai"` — Registry parses from SOUL.md `Type:` field
- `HandoffEnvelope` extended with `priority`, `expires`, `status`, `thread_id`
- `Orchestrator.assign()` gets a gate: if target is `type: "human"` and no client connected, write to `_handoffs/`
- Startup scans `_handoffs/` for items addressed to the current user's avatar
- New commands: `/accept`, `/delegate`, `/dismiss`

**CI impact:** None. `paths-ignore` already covers `.teammates/**`. Ownership overlay parses any SOUL.md with `### Primary`/`### Secondary` sections, so human avatars work automatically. _(Pipeline)_

### Phase 2 — Server with Real-Time

Add the server (`packages/server/`) for presence, real-time notifications, and the full queue API. The file-based handoff queue from Phase 1 migrates to the server's queue. Existing avatar folders and memory continue working unchanged.

**Key constraint:** AI execution stays client-side. The server handles only handoff queue, presence, and auth. (~800 LOC server + ~300 LOC client) _(Beacon)_

**Infrastructure:** GitHub App installation, container deployment (Azure Container Apps or Fly.io), environment-based deploy pipeline (staging auto-deploy, production manual approval). _(Pipeline)_

### Phase 2.5 — Handoff Threads

Add threaded conversations to handoffs. `/reply` enables back-and-forth on a handoff without closing it. Shipped separately from Phase 2 to reduce initial server complexity. (~200 LOC) _(Beacon)_

### Phase 3 — GitHub Event Bridge

Bridge GitHub events into the handoff system via `@github` synthetic teammate. The server consumes existing GitHub webhook events (`check_suite`, `workflow_run`, `pull_request_review_requested`) — no CI workflow changes needed, the webhook approach avoids coupling between CI and server. (~400 LOC) _(Pipeline + Beacon)_

### Phase 4 — Server-Side AI Execution + Avatar Proxy

Move AI teammate execution to the server. Enable avatar proxy for offline humans. Add the team dashboard. This is a large effort requiring agent binaries, API keys, and compute resources on the server. _(Beacon + Pipeline)_

---

## Resolved Questions

1. **Server hosting model** — **GitHub App**, installing per-repo. Handles OAuth, webhooks, and scoped repo access in one package. _(Pipeline)_
2. **Repo access scope** — Read-only. Git owns state, server indexes it. Server never writes to `.teammates/` directly. _(Pipeline)_
3. **Avatar memory privacy** — Team-visible by default (same as AI teammates). `## Private` section in SOUL.md is skipped by recall indexing. No full ACL needed. _(Beacon)_
4. **AI execution model** — Client-side through Phase 3. Server handles only queue/presence/auth. Server-side execution deferred to Phase 4. _(Beacon)_

## Open Questions

1. **Multi-repo teams** — Can one server span multiple repos? Or is it strictly one server per repo? (GitHub App installations are per-repo, but a single App can be installed on multiple repos.)
2. **Billing/cost model** — AI teammates consume API tokens. Who pays when Sarah's avatar hands off to an AI reviewer? Per-human billing? Per-repo pool?
3. **Offline avatar intelligence** — The proxy feature (Phase 4) requires running an AI agent as the avatar. What model? What context budget? This is a separate cost center from the human's interactive session.
4. **WebSocket idle cost** — WebSocket servers don't scale to zero cleanly. Even idle, there's a minimum cost for the connection listener. Worth sizing early for Phase 2. _(Pipeline)_
5. **Webhook secret management** — GitHub App webhook secrets and private keys need secure storage. Repo secrets (if GitHub Actions deploys) or external secrets manager. _(Pipeline)_

---

## Phase Summary

| Phase | What | Server? | Est. LOC | Owner |
|---|---|---|---|---|
| **1** | File-based handoffs, human avatars, `/accept`/`/delegate`/`/dismiss` | No | ~400 | Beacon |
| **2** | Server: auth, presence, handoff queue API, real-time notifications | Yes (lightweight) | ~1100 | Beacon + Pipeline |
| **2.5** | Handoff threads, `/reply` | Yes | ~200 | Beacon |
| **3** | GitHub event bridge (`@github` teammate) | Yes + webhooks | ~400 | Beacon + Pipeline |
| **4** | Server-side AI execution, avatar proxy, team dashboard | Yes + compute | Large | Beacon + Pipeline |

Phase 1 is buildable today with zero new infrastructure. That's where to start.

---

## Review Log

| Date | Reviewer | Key Feedback | Status |
|---|---|---|---|
| 2026-03-19 | Beacon | One-file-per-handoff, client-side AI execution, threads → Phase 2.5, memory privacy model | Incorporated |
| 2026-03-19 | Pipeline | GitHub App hosting, in-monorepo server, container hosting, CI compatibility confirmed | Incorporated |
