# Atlas — Goals

Updated: 2026-03-10

## Active Goals

### P0 — Current Sprint

- [ ] Add rate limiting middleware to public endpoints — spike from last week's load test
- [ ] Migrate user preferences table to new schema — [spec](docs/specs/F-user-prefs-v2.md)

### P1 — Up Next

- [ ] Replace hand-rolled JWT validation with `jose` library
- [ ] Add OpenAPI spec generation from Zod schemas

### P2 — Backlog

- [ ] Evaluate connection pooling options for read replicas
- [ ] Add request tracing headers (correlation IDs)

## Completed

- [x] Add pagination to `/api/projects` endpoint — done 2026-03-08
- [x] Fix N+1 query in team membership lookups — done 2026-03-06
