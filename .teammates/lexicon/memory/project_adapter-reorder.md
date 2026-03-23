---
name: adapter-reorder
description: Proposed reorder of buildTeammatePrompt() to reduce recall→task token distance
type: project
---

Recall results in adapter.ts are placed ~5k+ tokens before the Task prompt. Intervening sections (roster, services, recall tool, datetime) are low-frequency reference data that don't need proximity to the task.

**Why:** Distance problem — the model must traverse irrelevant reference data to connect retrieved memories to the current question. This degrades context utilization for every teammate, every task.

**How to apply:** Spec at `.teammates/lexicon/docs/adapter-reorder-spec.md`. Handed off to Beacon for implementation. The reorder moves reference data above daily logs and pushes recall results adjacent to the Task.
