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

3. ~~**Cache node_modules across runs**~~ ✅ Done — Added `actions/cache@v4` for `node_modules` (root + all 3 workspaces), keyed on Node version + `package-lock.json` hash. `npm ci` only runs on cache miss.
4. ~~**Parallelize workspace builds in CI**~~ ✅ Done — consolonia + recall build in parallel (no inter-deps), then cli builds after. CI split into `quality` (lint+typecheck, no matrix) and `build-and-test` (matrix, depends on quality).
5. **Add CI status badge to README** — Visible build health for contributors. Needs Scribe to add badge to README.
6. ~~**Fail-fast on build before running tests**~~ ✅ Done — CI now has a separate `quality` gate job (lint+typecheck). Build-and-test matrix only runs after quality passes.

### P2 — Security & Governance

7. ~~**Add Dependabot config**~~ ✅ Done — `.github/dependabot.yml` created, covers GitHub Actions + npm with weekly schedule and grouped PRs.
8. ~~**Add branch protection recommendations**~~ ✅ Done — Created `BRANCH-PROTECTION.md` with recommended rules (require CI pass, require PR review, restrict force pushes).
9. ~~**Audit secret usage**~~ ✅ Done — Only `NPM_TOKEN` used, passed as `NODE_AUTH_TOKEN`, no leak vectors, least-privilege permissions confirmed.

### P3 — Future / Nice-to-have

10. ~~**Release changelog automation**~~ ✅ Done — Created `.github/workflows/changelog.yml` with manual dispatch, per-package changelog generation from git history, outputs to GitHub Actions step summary.
11. ~~**PR check annotations**~~ ✅ Done — Added problem matchers (`.github/matchers/tsc.json`, `.github/matchers/biome-lint.json`) for TypeScript and Biome. Registered in CI quality job so errors appear inline on PR diffs.
12. ~~**Monorepo-aware change detection**~~ ✅ Done — Added `paths-ignore` to CI triggers: doc-only changes (`.md`, `.teammates/`, `template/`, `LICENSE`, `.gitignore`) skip CI entirely.
13. **Add test coverage reporting** — If Beacon adds coverage tooling, integrate coverage upload to CI (e.g., Codecov).
