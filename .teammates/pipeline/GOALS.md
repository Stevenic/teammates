# Pipeline — Goals

Updated: 2026-03-17

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

### P5 — Team Governance CI (UNBLOCKED — Pipeline ships these now)

These are the highest-value goals Pipeline can ship *right now* with no dependencies on Beacon. They emerged from the team brainstorm as Pipeline's unique contribution and are foundational for later features (#61, #62). Ranked by dependency chain: #59 first (ownership graph), then #60 (uses same graph), then #47 (independent but high-value).

59. **Boundary Violation Detector** ⭐ 9pts — A CI check that parses each teammate's SOUL.md to extract declared ownership patterns (glob-based Primary and Secondary ownership), then compares every file changed in a PR against those patterns. If a teammate's commit touches files outside their declared ownership, the check flags the violation with a clear annotation: which teammate owns the file, which teammate changed it, and what the ownership declaration says. **Foundation for #61 and #62.** Full Pipeline ownership.
    - Parse `SOUL.md` → `### Primary` / `### Secondary` sections → extract glob patterns → build ownership map
    - On PR: diff changed files against ownership map → annotate violations
    - Allow secondary ownership edits with warning (not block), flag unowned files

60. **Memory & Ownership CI** ⭐ 8pts — CI job that validates teammate memory health + ownership coverage. Two sub-checks: (1) **Memory integrity** — scan `memory/` dirs for orphaned files, stale memories, broken cross-references, missing SOUL.md/WISDOM.md, malformed frontmatter. (2) **Ownership gap detection** — walk repo tree, match against all ownership patterns, report gaps (unowned files) and overlaps (multi-owned without co-ownership declaration). Full Pipeline ownership.
    - Output as CI step summary (markdown table) + annotations for violations
    - Configurable thresholds: max memory age, allowed unowned paths (root config files)

47. **Changesets integration** — Replace manual version bumping with `@changesets/cli`. Each PR includes a changeset file describing the change. CI validates changesets exist for code changes. Release workflow consumes changesets to auto-bump versions and generate changelogs.

### P6 — Quick Wins & Developer Experience (UNBLOCKED)

Small, immediately actionable goals that improve developer experience and CI hygiene. No external dependencies.

5. **Add CI status badge to README** — Needs Scribe to add badge to README (Pipeline provides badge markdown).
63. **Local CI simulation script** — `npm run ci` mirroring the full pipeline locally.
64. **PR template with CI checklist** — `.github/PULL_REQUEST_TEMPLATE.md`.
39. **Workflow linting** — `actionlint` for workflow YAML validation.
45. **CLI binary packaging** — Package CLI as standalone binary (via `pkg` or `esbuild`) for non-Node environments.

### P7 — Team Feature Roadmap: Blocked on Beacon (HIGH VALUE)

These brainstorm features scored highest in voting (14-16pts) but require Beacon to ship headless mode (`-p`) before Pipeline can build the CI infrastructure. Pipeline's prep work (#59 ownership graph) should be done first.

61. **Memory-Informed Code Review** ⭐ 14pts — CI workflow that identifies which teammates own changed files (using #59's ownership graph), dispatches owning teammates via headless mode to review the diff against their accumulated knowledge (WISDOM.md, typed memories, recall search). Posts review comments as PR comments with teammate attribution. **Blocked on:** #59 (ownership graph) + Beacon shipping print mode (`-p`). Pipeline builds workflow; Beacon builds headless execution + recall integration.

62. **Proactive Ownership Awareness** ⭐ 16pts — Two-phase ownership scanning: (1) Pre-coding impact analysis (CLI command, Beacon owns), (2) Post-coding handoff suggestions (CI step on PR, Pipeline owns). Post-coding phase scans changed files against ownership map and posts handoff suggestions with relevant memories from owning teammates. **Blocked on:** #59 + Beacon shipping print mode. Pipeline builds the PR workflow step; Beacon builds pre-coding CLI; Scribe defines handoff protocol.

### P8 — Cross-Agent CI Infrastructure (Blocked on Beacon features)

CI/CD infrastructure to support cross-agent features Beacon is building for Claude parity. Pipeline doesn't build these features — Pipeline ensures they're tested, validated, and releasable. Most are blocked on Beacon shipping the corresponding features.

**Integration Testing Infrastructure**
40. **E2E integration test workflow** — Headless teammate sessions in CI validating full orchestrator → adapter → agent pipeline. Blocked on: Beacon shipping print mode (`-p`).
41. **Adapter compatibility matrix** — E2E tests across multiple adapter backends. Blocked on: #40 + adapters existing.
42. **Hook validation in CI** — Dry-run lifecycle hooks to catch errors before runtime. Blocked on: Beacon shipping hooks system.

**Structured Output & Schema Validation**
43. **JSON schema validation step** — Validate structured output from print mode against JSON schemas. Blocked on: Beacon shipping structured output.
44. **Skill/command lint step** — Validate user-defined skills format, fields, arguments. Blocked on: Beacon shipping skills system.

**Release & Packaging**
46. **Plugin packaging workflow** — Validate and package teammate plugins. Blocked on: Beacon shipping plugin system.

**Headless / Automation Support**
48. **Budget enforcement in CI** — Max turn count, wall-clock time, output size limits for headless runs. Blocked on: Beacon shipping budget/turn limits.
49. **Worktree-aware CI testing** — Test worktree isolation in CI. Blocked on: Beacon shipping worktree support.
50. **Headless smoke test on release** — Pre-publish `teammates -p "hello"` sanity check. Blocked on: Beacon shipping print mode.

### P8b — Agent-Specific (Enhanced Tier) CI Infrastructure (Blocked on Beacon features)

Validates adapter passthrough, capability declarations, and graceful degradation for agent-specific features.

**MCP & External Tools**
51. **MCP config validation in CI** — Parse and validate MCP server config. Blocked on: Beacon shipping MCP passthrough.
52. **MCP adapter passthrough test** — Verify adapters map MCP config to native flags. Blocked on: #40 + MCP passthrough.

**Worktree Isolation**
53. **Worktree lifecycle CI test** — Full worktree lifecycle validation. Blocked on: Beacon shipping worktree support.
54. **Parallel worktree conflict detection** — Multi-worktree isolation testing. Blocked on: #53.

**Permission Mode Mapping**
55. **Permission mode passthrough validation** — Validate SandboxLevel mapping to adapter-specific flags. Blocked on: Beacon shipping permission mode mapping.

**Browser / Playwright**
56. **Browser integration smoke test** — Validate `--chrome` passthrough. Blocked on: Beacon shipping browser passthrough.

**Capability Declaration**
57. **Adapter capability matrix CI** — Generate compatibility matrix from adapter capabilities. Blocked on: Beacon adding `capabilities` to `AgentPreset`.
58. **Capability degradation warnings** — Validate clean degradation when config uses unsupported features. Blocked on: #57.

### P9 — Backlog

**Reliability & Observability**
25. **Workflow failure notifications** — Slack/Discord alerts on `main` CI failures.
26. **Flaky test detection** — Re-run failed tests once before marking CI failed.
27. **CI health dashboard** — Pass/fail rates, duration trends, cache hit rates.

**Security & Compliance**
28. **SBOM generation** — CycloneDX/SPDX as release artifact.
29. **License compliance check** — Scan for incompatible licenses.
30. **Signed releases** — npm provenance for published packages.
65. **Commit message linting** — Conventional commits enforcement. (Superseded by #47 changesets if adopted.)

**Scaling & Performance**
34. **Selective workspace testing** — Only test packages affected by changed files.
35. **Build artifact caching** — Cache `dist/` when source unchanged.
36. **Node.js version matrix expansion** — Add Node 23, drop Node 20 when LTS ends (April 2026).

**Infrastructure**
37. **Reusable workflow extraction** — Common CI patterns as reusable workflows.
38. **Self-hosted runner evaluation** — Evaluate speed/cost improvements.

**Other**
18. **Build performance monitoring** — Track CI run times over time.
20. **CodeQL security scanning** — Static analysis for security vulns.
21. **Test result artifacts** — Upload JUnit XML as workflow artifacts.
