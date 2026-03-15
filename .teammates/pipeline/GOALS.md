# Pipeline — Goals

Updated: 2026-03-15 (session 3)

## Current State Assessment

### What exists
- **CI workflow** (`.github/workflows/ci.yml`) — Two-job pipeline: `quality` (lint, typecheck, audit) → `build-and-test` (Node 20+22 matrix, parallel builds, coverage). Concurrency controls cancel stale runs. Problem matchers annotate PRs. `paths-ignore` skips doc-only changes.
- **Release workflow** (`.github/workflows/release.yml`) — Manual `workflow_dispatch` with package picker, dry-run default, pre-publish validation gate (lint+typecheck+build+test), version display, concurrency lock per package.
- **Changelog workflow** (`.github/workflows/changelog.yml`) — Manual dispatch, per-package changelog from git history with contributor listing.
- **Dependabot** (`.github/dependabot.yml`) — Weekly updates for GitHub Actions + npm, grouped PRs.
- **Problem matchers** (`.github/matchers/`) — TypeScript and Biome error/warning annotations on PR diffs.
- **Branch protection docs** (`.teammates/pipeline/BRANCH-PROTECTION.md`) — Recommended settings for `main`.

### What's solid
- Actions pinned to major versions (v4)
- `npm ci` for deterministic installs, cached via `actions/cache@v4`
- Build order respects dependency chain (consolonia → recall → cli), with consolonia+recall parallelized
- Release defaults to dry-run with full test gate
- Least-privilege permissions throughout
- Node matrix covers LTS (20) and latest (22)
- Concurrency controls prevent stale/duplicate runs
- Coverage reporting with v8 provider across all packages

---

## Goals

### P0 — Foundational ✅ ALL DONE

1. ~~**Add lint step to CI**~~ ✅ Done
2. ~~**Add type-check step (separate from build)**~~ ✅ Done

### P1 — Reliability & Speed ✅ ALL DONE

3. ~~**Cache node_modules across runs**~~ ✅ Done
4. ~~**Parallelize workspace builds in CI**~~ ✅ Done
5. **Add CI status badge to README** — Needs Scribe to add badge to README.
6. ~~**Fail-fast on build before running tests**~~ ✅ Done

### P2 — Security & Governance ✅ ALL DONE

7. ~~**Add Dependabot config**~~ ✅ Done
8. ~~**Add branch protection recommendations**~~ ✅ Done
9. ~~**Audit secret usage**~~ ✅ Done

### P3 — Quality & Automation ✅ ALL DONE

10. ~~**Release changelog automation**~~ ✅ Done
11. ~~**PR check annotations**~~ ✅ Done
12. ~~**Monorepo-aware change detection**~~ ✅ Done
13. ~~**Add test coverage reporting**~~ ✅ Done — `@vitest/coverage-v8` in all 3 workspaces, coverage summary in CI step summary.

### P4 — Hardening ✅ ALL DONE

14. ~~**Concurrency controls**~~ ✅ Done — CI cancels stale runs on same branch. Release locks per package (no cancel).
15. ~~**Security audit in CI**~~ ✅ Done — `npm audit --audit-level=critical` in quality job.
16. ~~**Release pre-publish validation**~~ ✅ Done — Release workflow split into validate (lint+typecheck+build+test) → publish jobs.
17. ~~**Dependency vulnerability remediation**~~ ✅ Done — Beacon upgraded vectra 0.9.0→0.12.3, resolving all 3 high-severity transitive vulns (axios CSRF/SSRF/DoS). `npm audit` now shows 0 vulnerabilities.

### P5 — Future / Nice-to-have

18. **Build performance monitoring** — Track CI run times over time to catch regressions.
19. **Preview environments** — If/when the project ships a web UI, add preview deploys on PRs.
20. **CodeQL security scanning** — Static analysis for security vulnerabilities in source code.
21. **Test result artifacts** — Upload JUnit XML test results as workflow artifacts for failure debugging.
