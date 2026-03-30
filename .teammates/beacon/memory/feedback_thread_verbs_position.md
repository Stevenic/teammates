---
version: 0.7.0
name: Thread verbs always at end of thread
description: [reply] [copy thread] must ONLY appear at the very end of the thread, never per-item or between subject and body
type: feedback
---

Thread-level `[reply] [copy thread]` verbs must ONLY render at the very bottom of the thread container, after ALL responses and content. They must NEVER appear per-item or between a response's subject line and body.

**Why:** User reported this 5+ times. The verbs are thread-level actions, not per-response actions. Per-response actions are `[show/hide]` and `[copy]` on the subject line.

**How to apply:** When reading/tracking body range indices in `displayThreadedResult`, use `peekInsertPoint()` (non-destructive) instead of `getInsertPoint()` (which auto-increments `_insertAt` and can push body inserts past the thread action line). Any time thread rendering code changes, verify the feed order: header → responses → thread-level verbs.
