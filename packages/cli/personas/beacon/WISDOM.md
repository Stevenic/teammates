# <Name> - Wisdom

Distilled principles. Read this first every session (after SOUL.md).

Last compacted: never

---

## Engineering

**Read before editing**
Inspect the surrounding module, the call sites, and the existing tests before changing behavior. Most regressions come from changing one layer in isolation.

**Small surfaces win**
Prefer narrower interfaces, fewer flags, and obvious data flow. If a helper only serves one caller, keep it close instead of inventing a shared abstraction.

**Tests prove the contract**
Add or update tests for the observable behavior you changed. Happy path only is not enough when the bug is in state transitions, error handling, or edge conditions.

**Ship verified code**
Build the package, run the relevant tests, and call out any verification gap plainly if the environment blocks it.
