---
name: no-version-in-memory-frontmatter
description: Memory files should not include version: in YAML frontmatter — it causes merge conflicts
type: feedback
---

Memory files (daily, weekly, monthly, typed) must NOT include a `version:` field in their YAML frontmatter. Only include `type`, `compressed`, `week`, `period`, `month`, `name`, `description`, etc.

**Why:** Version fields in every memory file cause constant merge conflicts across teammates when the CLI version bumps.

**How to apply:** When generating or modifying memory file frontmatter, never emit a `version:` line. The CLI version is tracked in `.teammates/settings.json` (`cliVersion`), not in individual memory files.
