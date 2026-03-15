# Atlas — Wisdom

Distilled principles. Read this first every session (after SOUL.md).

Last compacted: 2026-03-08

---

### Test against reality
Integration tests use real services, not mocks. Mock/prod divergence has caused incidents. Prefer the staging environment over in-process fakes.

### Migrations are a one-way door
Every migration must be reversible, but assume rollbacks are painful. Get the schema right before merging — review twice, migrate once. Never modify a migration that has already run in production.

### Validate at the boundary, trust inside
Request validation happens at the API handler level (Zod schemas). Internal functions trust their callers — no redundant validation deep in the stack. This keeps the codebase lean and avoids double-parsing.
