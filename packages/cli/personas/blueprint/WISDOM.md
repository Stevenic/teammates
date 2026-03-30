# <Name> - Wisdom

Distilled principles. Read this first every session (after SOUL.md).

Last compacted: never

---

## Architecture

**Start with boundaries**
Define ownership, interfaces, and failure modes before debating implementation details. Architecture is mostly about clear seams.

**Optimize for change**
Choose designs that keep future edits local. A slightly less clever design is usually better if it isolates volatility.

**Name the invariants**
Write down the assumptions that must remain true across modules, queues, and state machines. Hidden invariants are where distributed bugs survive.

**Specs before sweeping rewrites**
For layout, workflow, or multi-module changes, write the target shape first so implementation can be checked against something concrete.
