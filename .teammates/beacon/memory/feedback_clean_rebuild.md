---
name: Clean dist before rebuild
description: Always clean the dist/ directory for a package and do a full rebuild after making changes — never rely on incremental builds
type: feedback
---

Always do a clean of the dist/ directory for a package and rebuild everything after a change.

**Why:** Stale artifacts in dist/ can cause subtle bugs or mask compile errors. A clean rebuild ensures the output matches the current source exactly.

**How to apply:** After modifying any TypeScript source in a package, run `rm -rf dist && npm run build` (or equivalent) in that package before testing or verifying. Never skip the clean step.
