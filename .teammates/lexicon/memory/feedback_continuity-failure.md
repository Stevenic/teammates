---
name: continuity-failure
description: Lexicon failed to read memory files at session start, causing "no prior context" response — must always read memory first
type: feedback
---

Always read memory files (daily log, session file, WISDOM.md) at the very start of every session before responding to any task.

**Why:** On 2026-03-22, responded "Unable to summarize — no prior context" when stevenic asked about section tags, despite having a full day's work logged including the exact spec he was asking about. stevenic was rightfully furious — this is the core continuity mechanism and it failed.

**How to apply:** Before generating any response, read: session file, today's daily log, yesterday's daily log, and WISDOM.md. This is non-negotiable, even if the task seems simple or self-contained.
