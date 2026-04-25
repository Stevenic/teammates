---
name: Bump package references on version bump
description: When bumping package versions, always update all references including settings.json cliVersion
type: feedback
---

When bumping package versions, always update ALL references — not just the three package.json files. Also update `cliVersion` in `.teammates/settings.json` and any other version references in the codebase.

**Why:** User explicitly requested this. Version references can get out of sync across the monorepo, causing resolution issues or stale version tracking.

**How to apply:** On every version bump, grep the codebase for the old version string to catch all references. The known sites are: `packages/cli/package.json`, `packages/consolonia/package.json`, `packages/recall/package.json`, and `.teammates/settings.json` (`cliVersion` field).
