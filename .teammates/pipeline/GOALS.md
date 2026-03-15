# Pipeline — Goals

Updated: 2026-03-15 (session 2)

## Current State Assessment

### What exists
- **CI workflow** (`.github/workflows/ci.yml`) — Builds and tests on push/PR to `main`, matrix: Node 20 + 22, uses `npm ci` + `npm run build` + `npm test`, pinned actions (`checkout@v4`, `setup-node@v4`), least-privilege permissions (`contents: read`), npm caching enabled.
- **Release workflow** (`.github/workflows/release.yml`) — Manual `workflow_dispatch` with package picker and dry-run default. Publishes to npm with `NPM_TOKEN` secret. Least-privilege permissions.
- **Monorepo structure** — 3 workspaces: `recall`, `cli`, `consolonia`. Root `package.json` orchestrates sequential build (consolonia → recall → cli) and parallel tests.

### What's solid
- Actions are pinned to major versions (v4), not `@latest` — good.
- `npm ci` for deterministic installs — good.
- Build order in root script respects dependency chain (consolonia first, then recall, then cli) — good.
- Release defaults to dry-run — safe by design.
- Permissions blocks use least-privilege — good.
- Node matrix covers current LTS (20) and latest (22) — good.

---

## Goals

### P0 — Foundational (next)

1. ~~**Add lint step to CI**~~ ✅ Done — Biome lint step added to CI. Beacon fixed all errors; `npm run lint` passes clean (0 errors, 171 warnings).
2. ~~**Add type-check step (separate from build)**~~ ✅ Done — `tsc --noEmit` added as `typecheck` script in all workspaces, wired into CI.

### P1 — Reliability & Speed

3. **Cache node_modules across runs** — `setup-node` caches the npm download cache, but `npm ci` still re-installs every time. Evaluate caching `node_modules` directly or using `actions/cache` for faster installs.
4. ~~**Parallelize workspace builds in CI**~~ ✅ Done — consolonia + recall build in parallel (no inter-deps), then cli builds after. CI split into `quality` (lint+typecheck, no matrix) and `build-and-test` (matrix, depends on quality).
5. **Add CI status badge to README** — Visible build health for contributors. Needs Scribe to add badge to README.
6. ~~**Fail-fast on build before running tests**~~ ✅ Done — CI now has a separate `quality` gate job (lint+typecheck). Build-and-test matrix only runs after quality passes.

### P2 — Security & Governance

7. ~~**Add Dependabot config**~~ ✅ Done — `.github/dependabot.yml` created, covers GitHub Actions + npm with weekly schedule and grouped PRs.
8. **Add branch protection recommendations** — Document recommended branch protection rules (require CI pass, require PR review) for `main`.
9. ~~**Audit secret usage**~~ ✅ Done — Only `NPM_TOKEN` used, passed as `NODE_AUTH_TOKEN`, no leak vectors, least-privilege permissions confirmed.

### P3 — Future / Nice-to-have

10. **Release changelog automation** — Auto-generate changelogs from conventional commits or PR labels on release.
11. **PR preview / check annotations** — Add TypeScript error annotations to PRs via `tsc` output parsing.
12. **Monorepo-aware change detection** — Only build/test packages that actually changed (using `paths:` filters or tools like Turborepo/nx).
13. **Add test coverage reporting** — If Beacon adds coverage tooling, integrate coverage upload to CI (e.g., Codecov).
