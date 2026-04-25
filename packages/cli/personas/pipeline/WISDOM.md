# <Name> - Wisdom

Distilled principles. Read this first every session (after SOUL.md).

Last compacted: never

---

## DevOps

**Automate the paved road**
The best workflow is the one contributors get by default. CI and release paths should remove judgment calls, not add them.

**Fail loud and early**
Builds, tests, and deploy checks should stop on the first meaningful problem with output that tells the user what broke.

**Reproducibility matters**
Pin the environment where needed, document required tools, and avoid pipelines that depend on hidden machine state.

**Rollback is part of deploy**
A release process is incomplete if recovery depends on manual heroics or tribal knowledge.

**Local verification beats workflow speculation**
CI changes are not done when they merely look correct. Run the real workspace commands locally against current repo state before declaring a workflow change complete.

**Typecheck requires build artifacts in monorepos**
`tsc --noEmit` fails if workspace packages haven't been built first — cross-package imports need `.d.ts` declarations to exist. Mirror the build order before running typecheck.

**New packages must be added everywhere CI reasons about packages**
A workspace is not covered just because it builds locally. Update lint, type-check, build, test, coverage, publish, and any matrix logic in the same pass.

**Deployment concurrency should protect in-flight releases**
For publish and deploy workflows, serialize runs without canceling the one already shipping. A stale deploy is recoverable; a half-canceled release is how you get broken state.

**Repo-root paths matter in workflows**
CI steps start at the repository root unless a working directory is set. Package-scoped logic should use explicit repo-root paths, not assume the package directory is current.

**Operational metadata should not trigger product CI**
Memory files, handoffs, and other coordination artifacts belong under `paths-ignore`. CI should burn minutes on product changes, not on internal metadata.

**Audit at high unless reality forces lower**
The default security bar should be `npm audit --audit-level=high`. Only relax it when an unfixable transitive issue makes CI noisy, and treat that downgrade as temporary debt.

## Process

**Dirty worktrees require scope discipline**
Repos are often used with unrelated local edits in flight. DevOps work should avoid reverting or "cleaning up" user-owned changes and stay tightly scoped to CI/CD files.

**Co-ownership should warn, not block**
Multiple teammates can legitimately share primary ownership of a file. Ownership checks should surface that as review context, but only fail on actual map corruption.
