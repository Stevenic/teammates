---
layout: default
title: Cookbook
---

# Teammates Cookbook

Concrete recipes for common workflows. Each recipe is self-contained — read the one you need, skip the rest.

---

## Table of Contents

- [Add a new teammate](#add-a-new-teammate)
- [Retire or archive a teammate](#retire-or-archive-a-teammate)
- [Hand off work between teammates](#hand-off-work-between-teammates)
- [Hand off across repositories](#hand-off-across-repositories)
- [Run a retrospective](#run-a-retrospective)
- [Run memory compaction](#run-memory-compaction)
- [Record a decision](#record-a-decision)
- [Add a service (recall, etc.)](#add-a-service)
- [Update templates after a framework change](#update-templates-after-a-framework-change)
- [Resolve an ownership conflict](#resolve-an-ownership-conflict)
- [Onboard a new human team member](#onboard-a-new-human-team-member)

---

## Add a new teammate

**When:** Your project has grown a new domain that doesn't fit cleanly into any existing teammate's ownership.

**Steps:**

1. Copy the SOUL.md and WISDOM.md templates from `.teammates/TEMPLATE.md` into a new folder:
   ```
   .teammates/<name>/
     SOUL.md
     WISDOM.md
     memory/
       weekly/
       monthly/
   ```

2. Fill in every section of SOUL.md with project-specific details. Use `template/example/SOUL.md` as a reference for tone and detail level.

3. Leave WISDOM.md in its initial empty state — wisdom emerges after the first compaction.

4. Update these shared files:
   - `.teammates/README.md` — add to the roster table, routing guide, and dependency flow
   - `.teammates/CROSS-TEAM.md` — add a row to the Ownership Scopes table
   - `.teammates/PROTOCOL.md` — update the conflict resolution table if the new domain introduces new conflict types

5. Update existing teammates' SOUL.md Boundaries sections to reference the new teammate where relevant.

6. Verify: the new teammate's ownership globs don't overlap with existing teammates.

**Tip:** Start broad. A new teammate with wide ownership that narrows over time is better than one with gaps from day one.

---

## Retire or archive a teammate

**When:** A domain has been removed, merged into another teammate, or is no longer actively maintained.

**Steps:**

1. Decide: **merge** (transfer ownership to another teammate) or **archive** (remove entirely).

2. If merging:
   - Update the receiving teammate's SOUL.md: add the retired teammate's file patterns to Primary Ownership, update Boundaries.
   - Move any still-relevant typed memories from the retired teammate's `memory/` into the receiving teammate's `memory/`.
   - Copy any wisdom entries that still apply into the receiving teammate's WISDOM.md.

3. If archiving:
   - No ownership transfer needed, but verify no files are left unowned.

4. Delete the retired teammate's folder: `.teammates/<name>/`

5. Update shared files:
   - `.teammates/README.md` — remove from roster, routing guide, dependency flow
   - `.teammates/CROSS-TEAM.md` — remove from Ownership Scopes table
   - `.teammates/PROTOCOL.md` — remove from conflict resolution table
   - Other teammates' SOUL.md Boundaries sections — remove references

6. Commit with a clear message: `retire @<name>: merged into @<other>` or `archive @<name>: domain removed`.

---

## Hand off work between teammates

**When:** Your current task requires changes to files you don't own.

**Steps:**

1. Do as much work as you can within your own domain first.

2. Write a clear handoff with full context:
   ```
   ```handoff
   @<teammate>
   <What you need done, why, and any relevant context or constraints.
   Include file paths, function names, or specs if applicable.>
   ```
   ```

3. Include the handoff block anywhere in your response — it will be detected automatically.

**Rules:**
- Never modify files outside your ownership, even for "small" fixes.
- Provide enough context that the receiving teammate can act without reading your full conversation history.
- If the task is complex, write a spec or design doc in your own folder first, then reference it in the handoff.

---

## Hand off across repositories

**When:** A task spans multiple repositories that each have their own `.teammates/` directory.

**Steps:**

1. Complete all work in the current repository first.

2. Write a handoff message describing:
   - Which repository needs the change
   - Which teammate in that repository should handle it
   - What needs to be done and why
   - Any interfaces or contracts that must match between repos

3. Tell the user to switch to the other repository and relay the handoff. Cross-repo handoffs are manual — the user is the bridge.

**Example:**
> The API contract changed: `GET /users` now returns `{ items: User[], cursor: string }` instead of `User[]`. The frontend repo's `@pixel` teammate needs to update the API client at `src/api/users.ts` to handle the new shape.

---

## Run a retrospective

**When:** After a significant milestone, a rough week, or on a regular cadence (e.g., bi-weekly).

**Steps:**

1. Ask a teammate to run `/retro` (or prompt them to reflect).

2. The teammate produces four sections:
   - **Working** — what's going well
   - **Not Working** — what's causing friction
   - **Proposed SOUL.md Changes** — specific before/after edits with reasoning
   - **Questions** — things that need user input

3. Review the proposed SOUL.md changes. Approve, modify, or reject each one.

4. Approved changes are written to the teammate's SOUL.md immediately. The retro is not complete until approved changes are applied.

See `.teammates/scribe/docs/RETRO-FORMAT.md` for the full format specification.

---

## Run memory compaction

**When:** A teammate's `memory/` directory is getting large (20+ daily logs), or on a regular cadence.

**Steps:**

1. Ask the teammate to run `/compact`.

2. The command runs two pipelines:

   **Episodic compaction:**
   - Completed weeks' daily logs → `memory/weekly/YYYY-Wnn.md`
   - Weekly summaries older than 52 weeks → `memory/monthly/YYYY-MM.md`
   - Raw daily logs are deleted after compaction

   **Semantic compaction:**
   - Reviews all typed memory files
   - Identifies patterns and recurring themes
   - Distills into WISDOM.md entries
   - Deletes fully absorbed memory files

3. Verify: WISDOM.md entries are principled and actionable, not just summaries of events.

**Tip:** Run episodic compaction weekly and semantic compaction monthly for best results.

---

## Record a decision

**When:** The team makes a choice that future sessions should know about — architecture, convention, tool selection, or scope decisions.

**Steps:**

1. Add an entry to `.teammates/DECISIONS.md`:

   ```markdown
   ## DDDD — <Title>

   **Date:** YYYY-MM-DD
   **Decided by:** <who was involved>
   **Status:** accepted

   ### Context
   <Why did this decision come up?>

   ### Decision
   <What was decided?>

   ### Alternatives considered
   - <Option A> — <why not>
   - <Option B> — <why not>
   ```

2. Number decisions sequentially (D001, D002, ...).

3. If a decision is later reversed, update its status to `superseded by DDDD` and add the new decision.

See the [decision log template](../template/DECISIONS.md) for the full format.

---

## Add a service

**When:** You want to enable an optional service like `teammates-recall` for semantic memory search.

**Steps:**

1. Install the service:
   ```bash
   cd <service-dir> && npm install && npm run build
   ```

2. Add the service to `.teammates/services.json`:
   ```json
   {
     "recall": {}
   }
   ```

3. The CLI automatically detects services from `services.json` and injects their capabilities into teammate prompts.

4. Verify the service works:
   ```bash
   teammates-recall status    # for recall
   ```

---

## Update templates after a framework change

**When:** The upstream `template/` files have changed (new template version) and your project's `.teammates/` files need to catch up.

**Steps:**

1. Check the current template version in your project files — look for `<!-- template-version: N -->` comments.

2. Check the upstream template version in the `template/` directory.

3. If versions differ, consult `docs/migration-guide.md` for the specific changes between versions and step-by-step upgrade instructions.

4. After updating, bump the `<!-- template-version: N -->` comment in each updated file.

---

## Resolve an ownership conflict

**When:** Two teammates both believe they should handle a task, or a file falls in an ambiguous ownership zone.

**Steps:**

1. Check `.teammates/PROTOCOL.md` — the Conflict Resolution table has explicit rules for common conflict types.

2. If the table doesn't cover the case:
   - The **upstream owner** (per the dependency flow) gets priority for shared interfaces.
   - The **domain owner** gets priority for implementation details.
   - When in doubt, the user decides.

3. If this conflict type is likely to recur, add a new row to the Conflict Resolution table and record the decision in `.teammates/DECISIONS.md`.

---

## Onboard a new human team member

**When:** A new person joins the project and needs to understand the teammates system.

**Steps:**

1. Point them to `README.md` for the project overview and `.teammates/README.md` for the roster and routing guide.

2. Have them fill in `.teammates/USER.md` with their role, preferences, and current focus. (This file is gitignored — it stays local.)

3. Explain the basics:
   - `@mention` a teammate by name to route work directly
   - Bare text in the CLI auto-routes to the best teammate
   - Teammates hand off to each other — approve or reject handoffs as they come

4. Optionally, point them to `docs/adoption-guide.md` for a deeper walkthrough of how to work with the system.
