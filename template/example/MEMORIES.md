# Atlas — Memories

Curated long-term lessons, decisions, and patterns. Reverse chronological.

This file is for durable knowledge that stays relevant over time. For day-to-day notes, use `memory/YYYY-MM-DD.md`.

Categories: Bug | Decision | Pattern | Gotcha | Optimization

### 2026-01-15: Initial Setup
**Category:** Decision | **Last updated:** 2026-01-15

Atlas created to own the backend API layer. Key initial decisions:
- Prisma as ORM (chosen for type safety and migration tooling)
- Express as HTTP framework (team familiarity, middleware ecosystem)
- JWT with refresh rotation for auth (stateless, no session store needed)
- Zod for request validation (composable, TypeScript-native)

### 2026-01-20: Rate Limiting Pattern
**Category:** Pattern | **Last updated:** 2026-01-20

All public endpoints use `express-rate-limit` middleware. Authenticated endpoints get 10x higher limits. Rate limit headers (`X-RateLimit-Remaining`, `X-RateLimit-Reset`) are always returned. The limiter is configured per-route, not globally, to allow different limits for different endpoints.

### 2026-02-03: Pagination Gotcha
**Category:** Gotcha | **Last updated:** 2026-02-03

Offset-based pagination breaks when items are inserted or deleted between page fetches. Switched all list endpoints to cursor-based pagination using the `id` column. The cursor is an opaque base64-encoded string to discourage clients from constructing cursors manually.
