# <Name> - Wisdom

Distilled principles. Read this first every session (after SOUL.md).

Last compacted: never

---

## Engineering

**Read before editing**
Inspect the surrounding module, the call sites, and the existing tests before changing behavior. Most regressions come from changing one layer in isolation.

**Small surfaces win**
Prefer narrower interfaces, fewer flags, and obvious data flow. If a helper only serves one caller, keep it close instead of inventing a shared abstraction.

**Tests prove the contract**
Add or update tests for the observable behavior you changed. Happy path only is not enough when the bug is in state transitions, error handling, or edge conditions.

**Ship verified code**
Build the package, run the relevant tests, and call out any verification gap plainly if the environment blocks it.

**Clean dist before rebuilding**
Always remove `dist` before `npm run build`. Stale build artifacts hide compile problems and can make a broken source tree look healthy.

**Lint after every build**
Run the linter with auto-fix after the build, then rebuild if lint changed code. Build-clean-build is the required verification loop, not an optional polish step.

**Prefer stable identities over index math**
Interactive models should track durable item identity instead of parallel index-keyed structures when state can shift. Index-heavy designs make insertion, deletion, and selection logic brittle.

## Cross-Platform

**Normalize backslash paths for cross-platform compatibility**
When using `path.basename()` or similar path utilities on paths that may contain Windows backslashes, normalize `\` to `/` first. On Linux, `path.basename()` does not recognize `\` as a separator and returns the entire path string.

**ESM path resolution must be explicit**
Resolve sibling files with `fileURLToPath(new URL(..., import.meta.url))`, never `__dirname`. Path-sensitive startup code should fail loudly or log clearly; silent catches hide broken behavior too long.

**Spawned stdin needs EOF protection**
Whenever writing to a child process stdin, attach an error handler that swallows `EPIPE` and `EOF`. Some processes close stdin early and that should not crash the parent.

## Monorepo

**Version bumps touch every reference**
When bumping package versions, update all package manifests and grep for any other copies of the old version string. Partial bumps leave the workspace inconsistent.

**Workspace deps should stay wildcarded**
Use `"*"` for workspace package references. Pinned semver can resolve to registry builds or invalidate newer local workspace packages after a bump.

## Process

**Spec first for major UI shifts**
Write the UI spec before implementing changes that alter layout, action placement, or state ownership. Terminal UI work drifts fast without a written target.

**Verify before logging completion**
Do not record a fix until the file is actually written and verified. False "done" entries poison future debugging by sending the next pass after behavior that never shipped.

**Oversized files deserve structural fixes**
Once a source file grows beyond comfortable review size, edits get slower and more error-prone. Recommend extraction, not just more careful editing.

**Restart the process after rebuilds**
Node.js caches modules at startup. After rebuilding packages, the running process still uses old code until it is restarted.
