---
layout: default
title: Migration Guide
---

# Template Version Migration Guide

When the upstream `template/` files change, projects bootstrapped from those templates need to catch up. This guide documents what changed in each version and how to upgrade.

---

## How to check your version

Template files contain a `<!-- template-version: N -->` HTML comment near the top. Open any of these files in your `.teammates/` directory and look for it:

- `TEMPLATE.md`
- `PROTOCOL.md`
- `README.md`
- `CROSS-TEAM.md`
- `DECISIONS.md`

If you don't see a version comment, you're on version 1 (pre-versioning).

## How to upgrade

1. Find your current version (or assume v1 if no marker exists).
2. Read each version section below, starting from your current version + 1.
3. Apply the changes in order. Don't skip versions — some changes build on previous ones.
4. After applying all changes, update the `<!-- template-version: N -->` comment in each file to the latest version.

---

## Version 1 → Version 2

**Released:** 2026-03-14

This was the first versioned release. It introduced the three-tier memory system, episodic compaction, and template versioning itself.

### What changed

| File | Change |
|---|---|
| `TEMPLATE.md` | Full rewrite of memory templates. Added WISDOM.md template, typed memory format with frontmatter, weekly/monthly summary templates. Added `<!-- template-version: 2 -->` marker. |
| `PROTOCOL.md` | Rewrote Memory section with three tiers (daily logs, typed memories, wisdom) + two-axis model (episodic + semantic). Added compaction pipelines, read order, sharing rules. Added `<!-- template-version: 2 -->` marker. |
| `README.md` (template) | Updated Structure section to include `weekly/` and `monthly/` subdirectories. Added `<!-- template-version: 2 -->` marker. |
| `CROSS-TEAM.md` (template) | Added Ownership Scopes section with placeholder table. Added Shared Docs section. Added `<!-- template-version: 2 -->` marker. |
| `USER.md` (template) | Restructured from flat bullet list into sections: About You, How You Work, Current Focus, Anything Else. |
| `DECISIONS.md` (template) | **New file.** Lightweight decision log with ADR-lite format. |

### Step-by-step upgrade

**1. Add template version markers**

Add `<!-- template-version: 2 -->` after the `# Title` line in each of these `.teammates/` files:
- `TEMPLATE.md`
- `PROTOCOL.md`
- `README.md`
- `CROSS-TEAM.md`

**2. Migrate from MEMORIES.md to typed memories**

If any teammate still has a `MEMORIES.md` file:

a. Read through the entries and classify each as `user`, `feedback`, `project`, or `reference`.

b. Create individual files in `memory/` with frontmatter:
   ```markdown
   ---
   name: <memory name>
   description: <one-line description>
   type: <user|feedback|project|reference>
   ---

   <memory content>
   ```

c. Delete the old `MEMORIES.md` file.

**3. Create WISDOM.md for each teammate**

If any teammate doesn't have a `WISDOM.md` file, create one:
```markdown
# <Name> — Wisdom

Distilled principles. Read this first every session (after SOUL.md).

Last compacted: <today's date>

---
```

Leave it empty initially — wisdom entries emerge after the first compaction.

**4. Create memory subdirectories**

For each teammate, ensure these directories exist:
```
.teammates/<name>/memory/weekly/
.teammates/<name>/memory/monthly/
```

**5. Update PROTOCOL.md Memory section**

Replace the Memory section in your `.teammates/PROTOCOL.md` with the version from `template/PROTOCOL.md`. Key additions:
- Two-axis model (episodic + semantic)
- Session startup read order
- Tier 1b (episodic summaries)
- Compaction pipelines (episodic + semantic)

**6. Update CROSS-TEAM.md**

Add an Ownership Scopes table if you don't have one:
```markdown
## Ownership Scopes

| Teammate | Self-owned folder | Codebase ownership |
|---|---|---|
| **<Name>** | `.teammates/<name>/**` | `<paths>` |
```

**7. Update Continuity section in each SOUL.md**

Ensure each teammate's Continuity section includes:
- Read WISDOM.md at startup (after SOUL.md)
- Read today's and yesterday's daily logs
- Private docs guidance (create under own folder, share via CROSS-TEAM.md)

**8. Create DECISIONS.md**

Copy `template/DECISIONS.md` to `.teammates/DECISIONS.md`. Optionally backfill any major decisions already made.

**9. Update USER.md**

If desired, restructure your local `USER.md` to use the new sections: About You, How You Work, Current Focus, Anything Else.

---

## Future versions

New version entries will be added here as the framework evolves. Each entry will follow the same format: what changed, and step-by-step upgrade instructions.

When you release a new template version:
1. Bump `<!-- template-version: N -->` in all template files
2. Add a new section to this guide
3. Record the version bump in `.teammates/DECISIONS.md`
