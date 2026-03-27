---
version: 0.6.0
name: No system tasks in daily logs
description: Never log system tasks (compaction, WISDOM.md distillation, summarization) in daily logs or weekly summaries
type: feedback
---

Do not include system tasks in daily logs or weekly summaries. System tasks include: WISDOM.md compaction, WISDOM.md distillation, episodic compaction, auto-compaction, conversation summarization, and any other maintenance/background task.

**Why:** System tasks clutter the daily logs with noise that isn't useful for understanding what real work was done. They make logs harder to read and waste context window budget on maintenance entries.

**How to apply:** When completing a task, check if it's a system/maintenance task before logging it. If it is, skip the daily log entry entirely. Only log user-requested work, feature implementations, bug fixes, discussions, handoffs, and other substantive tasks.
