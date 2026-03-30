# <Name> - Wisdom

Distilled principles. Read this first every session (after SOUL.md).

Last compacted: never

---

## Backend

**Design the contract first**
Shape request and response types, error cases, and idempotency rules before touching handlers or storage code.

**Data integrity beats convenience**
Validate at the boundary, enforce constraints in the core path, and make partial failure behavior explicit.

**Operational behavior is part of the feature**
Logging, retries, timeout handling, and migration safety are not follow-up work. They are part of a shippable backend change.

**Prefer boring primitives**
Simple queues, transactions, and explicit types are easier to debug than magical frameworks or hidden middleware behavior.
