---
name: No mocks in integration tests
description: Integration tests must use real services, not mocks — prior incident with mock/prod divergence
type: feedback
---

Integration tests must hit a real database, not mocks.

**Why:** Last quarter, mocked tests passed but the prod migration failed because mocks diverged from actual behavior. The staging environment was set up specifically to catch this.

**How to apply:** When writing integration tests, always use the staging environment. Only use mocks for unit tests of pure logic.
