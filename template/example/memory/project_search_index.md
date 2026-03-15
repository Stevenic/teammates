---
name: Search endpoint needs GIN index
description: /api/search is slow due to unindexed LIKE query on description — fix with pg_trgm GIN index
type: project
---

The `/api/search` endpoint does a `LIKE '%query%'` on `projects.description`, which triggers a sequential scan.

**Why:** Response times exceed 2s on datasets over 10k rows. Users have reported the search as unusable.

**How to apply:** Create a migration adding `CREATE EXTENSION IF NOT EXISTS pg_trgm` and a GIN index on `projects.description`. Scheduled for W11. Coordinate with Forge if the extension needs to be enabled in production first.
