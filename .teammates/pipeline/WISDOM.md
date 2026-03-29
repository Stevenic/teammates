# Pipeline - Wisdom

Distilled principles. Read this first every session (after SOUL.md).

Last compacted: 2026-03-29

---

**Co-ownership should warn, not block.**
Multiple teammates can legitimately share primary ownership of a file.
Ownership checks should surface that as review context, but only fail on actual map corruption.

**Bash regex state belongs at script scope.**
In `check-ownership.sh`, `[[ =~ ]]` gets brittle when regex patterns or match arrays live in `local` function scope. Keep shared regex state global to avoid false negatives and parsing surprises.

**Local verification beats workflow speculation.**
CI changes are not done when they merely look correct.
Run the real workspace commands locally against current repo state before declaring a workflow, cache, or policy change complete.

**Sandbox failures need signature-based triage.**
On this Windows sandbox, Vitest can fail before loading config with Vite `externalize-deps` and `spawn EPERM`.
Treat that startup signature as an environment constraint first, not immediate evidence that CI or workspace tests are broken.

**Dirty worktrees require scope discipline.**
This repo is often used with unrelated local edits in flight.
Pipeline work should avoid reverting or "cleaning up" user-owned changes and stay tightly scoped to CI/CD files.

**Repo-root paths matter in workflows.**
GitHub Actions steps start at the repository root unless a working directory is set.
Package-scoped logic should use explicit repo-root paths like `packages/${PACKAGE}/`, not assume the package directory is current.

**New packages must be added everywhere CI reasons about packages.**
A workspace is not covered just because it builds locally.
Update lint, type-check, build, test, coverage, publish, changelog, and any OS-specific or E2E matrix logic in the same pass.

**Audit at `high` unless reality forces lower.**
The default security bar for this repo is `npm audit --audit-level=high`.
Only relax it when an unfixable transitive issue makes CI noisy, and treat that downgrade as temporary debt to remove later.

**Deployment concurrency should protect in-flight releases.**
For publish and deploy workflows, serialize runs without canceling the one already shipping.
A stale deploy is recoverable; a half-canceled release is how you get broken state.

**Solo branch protection still needs discipline.**
For a one-developer repo, require PRs and required status checks, keep `strict=true`, allow 0 approvals, and leave `enforce_admins=false` as the emergency escape hatch.

**Operational metadata should not trigger product CI.**
Memory files, handoffs, and other teammate-only metadata belong under `paths-ignore`. CI should burn minutes on product changes, not on internal coordination artifacts.

**Pages deploys work best as docs-only builds.**
GitHub Pages should build from `./docs` with a manual dispatch escape hatch.
Its deploy concurrency should avoid canceling an in-flight publish, and docs hosting should stay isolated from the main app build.

**Minimal-theme layout changes require wrapper overrides.**
On GitHub Pages' minimal theme, full-width docs layouts require overriding the theme's default `.wrapper` max-width and float-based structure.
Styling tweaks alone will not break the built-in narrow layout.

**`gh` auth is the pragmatic default for GitHub automation.**
Browser-based `gh auth login` is usually simpler and safer than managing long-lived PATs.
If code needs a token, piping `gh auth token` into tooling is cleaner than inventing new secret handling.

**Daily logs are part of the prompt budget.**
Verbose teammate logs crowd out the actual task in future sessions.
Record durable outcomes and key numbers only when they change decisions; compress or omit the rest.
