# Retrospective Format

A structured `/retro` command for AI teammates to review their own effectiveness and **evolve their SOUL.md** based on what they've learned.

---

## Purpose

Retros are the feedback loop that makes teammates grow. Without them, SOUL.md is a static document written at creation time. With them, it evolves based on real experience.

A retrospective:

1. Reviews what's working and what isn't
2. Proposes **concrete SOUL.md edits** — the primary output
3. Surfaces friction points that affect other teammates
4. After user approval, **applies the changes** — the retro isn't done until the soul is updated

## When to Run

- **On demand** — `@<teammate> /retro` or `/retro <teammate>`
- **Suggested cadence** — Monthly, or after a significant milestone (major feature, refactor, incident)
- **Not automatic** — Retros require reflection, not rote summarization. They should be intentional.

## Format

A retro produces a structured response with four sections:

### 1. What's Working

Things the teammate does well, based on evidence from recent work. These are patterns worth reinforcing or codifying into wisdom.

Example:
> - Boundary enforcement has been clean since the PROTOCOL.md update — no cross-ownership violations in the last 3 weeks
> - Typed memory extraction during compaction is producing actionable feedback entries

### 2. What's Not Working

Friction, recurring issues, or patterns that aren't serving the project. Be specific — cite examples from daily logs or memories if possible.

Example:
> - My ownership of `README.md` creates a bottleneck — every package addition requires a Scribe edit
> - WISDOM.md entries are too abstract to be actionable ("prefer simplicity" doesn't change behavior)

### 3. Proposed SOUL.md Changes

The core output. Each proposal is a **specific edit** to SOUL.md — not a vague suggestion. Include:
- **Section** — which SOUL.md section to change (e.g., Boundaries, Core Principles, Ownership)
- **Before** — the current text (or "new entry" if adding)
- **After** — the exact replacement text
- **Why** — evidence from recent work justifying the change

Example:
> **Proposal 1: Add boundary**
> - Section: Boundaries
> - Before: *(new entry)*
> - After: `Does NOT modify consolonia widget internals (Beacon)`
> - Why: Redirected consolonia questions twice in the last 2 weeks — this boundary was implicit but not written down
>
> **Proposal 2: Adjust ownership**
> - Section: Ownership → Primary
> - Before: `README.md — Project-level documentation`
> - After: Move to Secondary: `README.md — Project-level documentation (co-owned, Scribe reviews for consistency)`
> - Why: Every package addition requires a Scribe edit — this bottleneck slows down Beacon's work
>
> **Proposal 3: Sharpen principle**
> - Section: Core Principles
> - Before: `Minimal Viable Structure — Include only what's needed.`
> - After: `Minimal Viable Structure — Every section in a template earns its place by being actively used. If a section is consistently left blank, remove it.`
> - Why: The old wording was too vague to change behavior

Changes to WISDOM.md or other files are secondary — SOUL.md is the priority target.

### 4. Questions for the Team

Issues that can't be resolved unilaterally — they need input from other teammates or the user.

Example:
> - Should Beacon own the `docs/` directory? Currently no one does.
> - Is the standup format useful? It hasn't been referenced in any daily log since it was created.

## Rules

- **Retros are self-directed.** A teammate reviews its *own* work. It does not evaluate other teammates.
- **Proposed changes require user approval.** The teammate presents SOUL.md proposals; the user decides which to apply. Approved changes are written immediately.
- **Evidence over opinion.** Cite specific examples from daily logs, memories, or recent sessions. Avoid vague assessments.
- **No busywork.** If everything is working well, say so. A retro that says "all good, no changes" is a valid outcome.
- **Update daily log.** Record the retro in the daily log with a summary of proposals made and which were approved.

## CLI Implementation

The `/retro` command runs in two phases:

### Phase 1: Reflection

1. Accept an optional teammate name (`/retro beacon`). If omitted, retro the currently active teammate.
2. Inject the retro format instructions into the teammate's prompt (this doc or a condensed version).
3. Tell the teammate to review: its SOUL.md, WISDOM.md, last 2-3 weekly summaries (or last 7 daily logs if no weeklies exist), and any typed memories.
4. **Instruct the teammate to frame all proposals as concrete SOUL.md diffs** (Before/After/Why format above).
5. The teammate produces the four-section retro response.

### Phase 2: Apply

6. The user reviews each proposed SOUL.md change and approves or rejects it.
7. **Approved changes are applied to SOUL.md** — the teammate edits its own SOUL.md file to incorporate the approved proposals.
8. The teammate records the retro outcome in its daily log: which proposals were approved, which rejected, and the resulting SOUL.md changes.

The retro is not complete until approved changes are written to SOUL.md. A retro that only produces text without applying changes has not fulfilled its purpose.
