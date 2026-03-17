---
layout: default
title: Working with Teammates
---

# Working with Teammates

A practical guide to day-to-day interaction with your AI teammates. Covers the commands, patterns, and workflows you'll use most.

---

## Talking to Teammates

### Direct assignment

Use `@mention` to send a task to a specific teammate:

```
@beacon fix the search index timeout
@scribe update the onboarding docs
```

### Auto-routing

Type bare text and the CLI routes it to the best teammate based on keywords and ownership:

```
fix the search index timeout
```

The routing uses each teammate's ownership patterns and role description to pick the right one.

### Broadcast with `@everyone`

Use `@everyone` to send the same message to all teammates at once:

```
@everyone give me a status update
@everyone what are your current goals?
/retro everyone
```

Each teammate receives the message and responds independently. This is useful for:

- **Standups** — ask all teammates what they've done and what's next
- **Status checks** — get a quick read on where things stand across the project
- **Team-wide actions** — trigger retros, compaction, or goal-setting for everyone at once
- **Brainstorming** — ask all teammates for ideas on a topic and compare perspectives

## Running Standups

Standups are async status updates. Each teammate reports what they've done and what's next.

### Quick standup

```
@everyone do a standup
```

Each teammate posts a short **Done / Next** summary. Done captures what changed since their last standup. Next captures intent — what they plan to work on.

### Standup format

Teammates write standups to `.teammates/_standups/YYYY-MM-DD.md`. One file per day, all teammates append to the same file:

```markdown
# Standup — 2026-03-14

## Beacon — 2026-03-14

### Done (since last standup)
- Fixed CLI adapter proxy error on large payloads
- Updated recall indexer for typed memory frontmatter

### Next
- Implement episodic compaction in recall
- Migrate MEMORIES.md references to WISDOM.md

---

## Scribe — 2026-03-14

### Done (since last standup)
- Implemented three-tier memory system across all templates
- Updated ONBOARDING.md for new memory structure

### Next
- Design episodic compaction format
- Update ARCHITECTURE.md with memory lifecycle diagram
```

### Tips

- Standups are lightweight summaries, not detailed logs. Daily logs (`memory/YYYY-MM-DD.md`) remain each teammate's detailed record.
- Standup files are ephemeral — safe to delete after a week.
- Reviewing consecutive standups shows goals progressing or shifting, which tells the project's story.

## Running Retrospectives

Retrospectives are how teammates grow. They review their own work, identify what's working and what isn't, and propose concrete changes to their SOUL.md.

### Run a retro for one teammate

```
/retro beacon
```

### Run retros for everyone

```
/retro everyone
```

### What happens during a retro

1. The teammate reviews its SOUL.md, WISDOM.md, recent logs, and typed memories
2. It produces four sections:
   - **What's Working** — patterns worth reinforcing, with evidence
   - **What's Not Working** — friction or recurring issues
   - **Proposed SOUL.md Changes** — specific before/after edits with reasoning
   - **Questions** — things that need your input
3. You review each proposed SOUL.md change and approve or reject it
4. Approved changes are written to the teammate's SOUL.md immediately

### When to retro

- After a major milestone or release
- When a teammate keeps making the same kind of mistake
- On a regular cadence (monthly works well)
- Whenever something feels off about how a teammate is working

A retro that finds nothing to change is a perfectly valid outcome — don't force changes for the sake of activity.

## Brainstorming

Brainstorming uses `@everyone` to collect ideas from all teammates, then narrows them through voting rounds. Each teammate brings a different perspective based on their role and ownership area.

### The flow

**1. Prompt for ideas**

```
@everyone brainstorm features that no other coding agent is doing
```

Each teammate responds independently with their ideas. You'll get different angles — infrastructure-focused ideas from one, UX-focused from another, docs-focused from a third.

**2. Consolidate**

Once all responses are in, ask a teammate (or `@claude`) to merge the ideas into a single ranked list:

```
@claude consolidate all the brainstorm responses into a single table
```

This produces a deduplicated table with columns for points, idea name, author(s), and summary.

**3. Vote**

Ask each teammate to distribute points across the consolidated list:

```
@everyone you have 25 points. distribute them across the ideas based on impact and buildability
```

Each teammate allocates their points based on their own priorities and expertise. Tally the results into the table.

**4. Add your own points (optional)**

You can weight the results with your own points:

```
@claude give each idea 2 points each
```

Or allocate selectively to the ideas you care about most.

**5. Pick favorites (optional tiebreaker)**

If the top ideas are close, run a final round:

```
@everyone pick your favorite idea from the list and explain why
```

Each teammate advocates for one idea. You award points for their picks.

**6. Update goals**

Once rankings are settled, have teammates update their goals based on the results:

```
@everyone update your long-term goals to cover working towards these features
```

Each teammate logs only the features they'll participate in implementing, with their specific role described.

### Tips

- The best brainstorm prompts are specific enough to focus ideas but open enough to allow creativity. "Brainstorm features" is too vague; "brainstorm features that exploit our unique multi-agent memory system" gives each teammate a lens to think through.
- Teammates vote differently based on their ownership area — this is a feature, not a bug. A CI teammate will prioritize enforceable checks; a docs teammate will prioritize developer experience.
- You don't have to follow the full flow every time. Sometimes you just need ideas (`@everyone brainstorm`) without voting or goal updates.
- The consolidation step is important — without it, you're comparing ideas across separate responses, which is hard to rank.

## Managing the Task Queue

Tasks sent to different teammates run in parallel. Tasks sent to the same teammate run in sequence:

```
@beacon update the search index
@scribe update the onboarding docs
@pipeline check the CI status
```

All three tasks above run at the same time because they target different teammates. But if you queue two tasks to the same teammate, the second waits until the first finishes:

```
@beacon update the search index
@beacon then refactor the query parser
```

Handoffs work the same way — when one teammate hands off to another, the handoff is queued as a regular task. It runs immediately if the target teammate is idle, or waits in their queue if they're busy.

Use `/status` (or `/s`) to see what's running and what's queued:

```
/status
```

Cancel a queued task by number:

```
/cancel 2
```

## Handling Handoffs

Teammates hand off work to each other when a task crosses ownership boundaries. When a handoff is proposed, you see an approval menu:

```
  1) Approve          — execute the handoff
  2) Always approve   — auto-approve all future handoffs this session
  3) Reject           — decline the handoff
```

You control every handoff. If a teammate tries to hand off something it should handle itself, reject it and tell it why.

## Memory Compaction

Over time, teammates accumulate daily logs and typed memories. Compaction keeps this manageable.

### Compact one teammate

```
/compact beacon
```

### Compact everyone

```
/compact everyone
```

### What compaction does

**Episodic compaction:**
- Rolls completed weeks' daily logs into `memory/weekly/YYYY-Wnn.md` summaries
- Rolls weekly summaries older than 52 weeks into `memory/monthly/YYYY-MM.md`
- Deletes raw daily logs after they're compacted

**Semantic compaction:**
- Reviews typed memory files for patterns and themes
- Distills recurring insights into WISDOM.md entries
- Deletes fully absorbed memory files

### When to compact

- **Episodic:** weekly (keeps daily logs from piling up)
- **Semantic:** monthly (lets enough experience accumulate before distilling)

## Checking Status

```
/status
```

Shows:
- All discovered teammates and their current state (idle, active, queued)
- Active task details
- Queued tasks

Aliases: `/s`, `/queue`, `/qu`

## Working with Images

You can share screenshots and images with teammates by dragging and dropping them into the input box. This is useful for:

- **Bug reports** — show a teammate exactly what's broken instead of describing it
- **UI review** — drop a screenshot and ask a teammate to review the layout or spot issues
- **Design reference** — share mockups or wireframes as context for implementation tasks

Just drag an image file from your file manager into the CLI input and type your message:

```
@beacon [image screenshot.png] the sidebar is overlapping the main content
```

The image is sent to the teammate along with your text. Teammates with vision capabilities can read the image and respond based on what they see.

### Tips

- PNG and JPG formats work best
- Drop the image first, then type your message
- You can include multiple images in one message
- Combine images with `@everyone` to get multiple perspectives on the same screenshot

## Debugging Responses

Every request generates a temporary log file of the coding agent's actions. You can analyze this log for a specific teammate using `/debug`:

```
/debug beacon
```

This analyzes the log for `beacon`'s last response, showing what the coding agent did and why. It's useful for understanding why a teammate took a particular approach or produced unexpected output.

## Quick Reference

| What you want | What to type |
|---|---|
| Assign a task directly | `@beacon fix the bug` |
| Let the CLI pick the teammate | `fix the bug` |
| Ask all teammates | `@everyone status update` |
| Run standups | `@everyone standup` |
| Brainstorm ideas | `@everyone brainstorm <topic>` |
| Run a retro | `/retro beacon` |
| Run all retros | `/retro everyone` |
| Compact memories | `/compact beacon` |
| Check queue status | `/status` |
| Debug last response | `/debug beacon` |
| Copy session text | `/copy` |
| Clear session | `/clear` |
| Exit | `/exit` |
