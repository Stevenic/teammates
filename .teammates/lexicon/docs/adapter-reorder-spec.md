# Adapter Prompt Reorder Spec

**Author:** Lexicon
**Date:** 2026-03-22
**Diagnostic:** Distance problem — recall results are ~5,000+ tokens away from the Task they're meant to inform.

## Problem

In `adapter.ts:buildTeammatePrompt()`, the current prompt order places recall results (step 5) far from the Task (step 12). Intervening sections (roster, services, recall tool instructions, date/time) add thousands of tokens of distance between the retrieved context and the question it's supposed to help answer.

This is a classic **distance failure**: the model must traverse low-relevance reference data to connect recall results to the task.

## Current Order

```
1.  Identity + SOUL           (top — anchors persona) ✓
2.  Wisdom                    (stable knowledge) ✓
3.  Today's daily log         (session context)
4.  Past daily logs (2-7)     (recent history)
5.  Recall results            ← task-relevant, but far from Task
6.  Roster                    (reference, used only for handoffs)
7.  Services                  (reference, rarely used per-task)
8.  Recall tool instructions  (reference, rarely used per-task)
9.  Handoff context           (task-relevant when present)
10. Date/time + environment   (reference)
11. User profile              (reference)
12. Task                      (the question)
13. Output Protocol           (CRITICAL instructions) ✓
14. Session state             (instructions) ✓
15. Memory updates + REMINDER (instructions) ✓
```

## Proposed Order

Move low-frequency reference data into the middle (where "lost in the middle" effects are acceptable for rarely-needed content), and push task-relevant context adjacent to the Task.

```
1.  Identity + SOUL           (top — anchors persona)
2.  Wisdom                    (stable knowledge)
3.  Roster                    ← moved up (reference)
4.  Services                  ← moved up (reference)
5.  Recall tool instructions  ← moved up (reference)
6.  Date/time + environment   ← moved up (reference)
7.  Today's daily log         (session context)
8.  Past daily logs (2-7)     (recent history)
9.  User profile              (task context)
10. Recall results            ← NOW ADJACENT to Task
11. Handoff context           (directly task-relevant)
12. Task                      (the question)
13. Output Protocol           (CRITICAL instructions)
14. Session state             (instructions)
15. Memory updates + REMINDER (instructions)
```

## Rationale

- **Recall → Task distance reduced** from ~7 sections to ~1 section. The model can now directly connect retrieved memories to the current task.
- **Reference data (roster, services, recall tool, date)** moves to the middle where it's still accessible but doesn't interfere with the primary task→context connection.
- **Daily logs** stay in the middle-to-lower zone. They're session context that the model scans once; proximity to the task is less critical than for recall results.
- **Identity + Wisdom stay at the top** (high-attention edge). Instructions stay at the bottom (high-attention edge). Data fills the middle. This is the standard section-tag layout.

## Impact

Every teammate, every task. This is the single highest-leverage change in the prompt system because it improves context utilization across the board.
