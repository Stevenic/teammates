---
name: Always run lint after build
description: Run biome lint with auto-fix after every build, automatically repair any errors
type: feedback
---

Always run lint after completing a build. Automatically repair any lint errors found.

**Why:** User explicitly requested this workflow — lint errors should never be left behind after a build. Catches unused imports, style issues, and other problems before the user sees them.

**How to apply:** After every `rm -rf dist && npm run build`, run `npx biome check --write --unsafe <changed files>` (or the full source dir). If fixes are applied, rebuild to verify they compile cleanly. This is a mandatory step in the build-verify cycle.
