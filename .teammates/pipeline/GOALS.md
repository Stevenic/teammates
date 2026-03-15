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

### P6 — Brainstormed (2026-03-15) — Needs prioritization

**Developer Experience**
22. **Local CI simulation script** — A `npm run ci` script that mirrors the full CI pipeline locally (lint → typecheck → build → test), so devs can catch failures before pushing.
23. **PR template with CI checklist** — `.github/PULL_REQUEST_TEMPLATE.md` with checkboxes for "CI passes", "coverage not decreased", "no new lint warnings".
24. **Commit message linting** — Add commitlint or similar to enforce conventional commits, enabling automated changelogs and semantic versioning.

**Reliability & Observability**
25. **Workflow failure notifications** — Slack/Discord/email notifications on CI failures on `main` (not PRs), so broken main is caught immediately.
26. **Flaky test detection** — Re-run failed tests once before marking CI as failed. Track tests that flip between pass/fail across runs.
27. **CI health dashboard** — GitHub Actions workflow run history with pass/fail rates, avg duration, cache hit rates. Could be a scheduled workflow that writes to step summary or a simple script.

**Security & Compliance**
28. **SBOM generation** — Generate Software Bill of Materials (SPDX/CycloneDX) as a release artifact. Increasingly required for enterprise/government consumers.
29. **License compliance check** — Scan dependencies for incompatible licenses (GPL in an MIT project, etc.). Can use `license-checker` or similar.
30. **Signed releases** — npm provenance or cosign for published packages, proving packages were built in CI from the expected source.

**Release & Versioning**
31. **Automated version bumping** — Use changesets or similar to manage version bumps across the monorepo, replacing manual version edits.
32. **Release-please integration** — Automate release PRs with changelogs based on conventional commits. Replaces the manual changelog workflow.
33. **Pre-release / canary publishes** — Publish pre-release versions from feature branches or PRs for testing before merge.

**Scaling & Performance**
34. **Selective workspace testing** — Only run tests for packages affected by changed files (using `turbo` or custom change detection). Currently all tests run on every change.
35. **Build artifact caching** — Cache `dist/` outputs between CI runs when source hasn't changed, skipping redundant rebuilds.
36. **Node.js version matrix expansion** — Add Node 23 (current) to the test matrix to catch upcoming breaking changes early. Drop Node 20 when it leaves LTS (April 2026).

**Infrastructure**
37. **Reusable workflow extraction** — Extract common CI patterns (checkout → setup → cache → install) into a reusable workflow, reducing duplication between ci.yml, release.yml, and changelog.yml.
38. **Self-hosted runner evaluation** — Evaluate whether self-hosted runners would improve CI speed or reduce costs as the project scales.
39. **Workflow linting** — Add `actionlint` to validate workflow YAML syntax and catch common mistakes before they hit CI.
