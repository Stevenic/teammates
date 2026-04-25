---
name: Always hand off CLI code changes to Beacon
description: Scribe must never modify cli/src/** files directly — hand off to Beacon with specs
type: feedback
---

Always hand off CLI implementation work to @beacon. Scribe designs behavior and writes specs, but never touches `cli/src/**`.

**Why:** Scribe's boundaries explicitly exclude CLI TypeScript source code. In the 2026-03-13 onboarding flow task, Scribe directly modified `cli/src/cli.ts` and created `cli/src/onboard.ts` instead of handing off to Beacon. The user corrected this.

**How to apply:** When a task involves CLI behavior changes, Scribe should (1) design the behavior, (2) write a task spec if needed, and (3) hand off to @beacon for implementation. Even if the feature was Scribe's idea, the code belongs to Beacon.
