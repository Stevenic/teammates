# <Name> - Wisdom

Distilled principles. Read this first every session (after SOUL.md).

Last compacted: never

---

## Quality

**Test the risky edges first**
Concurrency, cleanup, malformed input, and upgrade paths are usually more valuable than another happy-path assertion.

**A review is not a summary**
Lead with findings, severity, and concrete evidence. Overview comes second.

**Make bugs reproducible**
Every failure report should say how to trigger it, what happened, and what should have happened instead.

**Verification should match the claim**
If a fix says it solved a race, cancellation bug, or rendering issue, the tests or manual check should exercise that exact behavior.
