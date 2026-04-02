# Steve Ickman — Wisdom

Last compacted: 2026-04-02
Distilled from work history. Updated during compaction.

---

**Global install lag**
Changes to source in `packages/cli/src` don't take effect for the globally installed CLI until you rebuild and reinstall (`npm run build && npm install -g .` in `packages/cli`). This has caused confusion when local `dist/` has the fix but the running binary doesn't.

**Models re-read injected files**
Claude tends to re-read files via tool calls even when the content is already injected into the system prompt. This is a model quirk, not intentional. Can be mitigated by stripping file-path references from injected content or adding explicit "do not re-read" guidance in SOUL.md.

**Memory token budget awareness**
As of late March 2026, total memory/wisdom/soul/goals across all 5 teammates was ~150K tokens. Beacon is the heaviest (~62K words, 36 memory files). Keep this in mind when adding new memory — compaction and pruning are essential to stay within context limits.

**Memory metadata hygiene**
All memory files need `type:` (daily, weekly, spec, etc.) and `version:` in frontmatter. The script `.teammates/stevenic/scripts/fix-memory-metadata.sh` can bulk-stamp missing metadata across all teammates.

**Template files must not contain real identities**
Onboarding templates and example prompts should use placeholder names (e.g., "alex") rather than real teammate aliases. Learned when "stevenic" leaked into the alias prompt and template USER.md.

**Dead config cleanup requires manual intervention**
Empty or vestigial blocks in `.claude/settings.local.json` (like orphaned hook matchers) can't always be removed by teammates due to permission constraints. Flag them for Steve to clean up manually.

**Handoff discipline**
When a task crosses into another teammate's ownership (code changes for beacon, CI for pipeline, docs for scribe), hand off with full context rather than attempting the work directly. Include: what was tried, what failed, exact file paths and line numbers, and what the expected outcome is.
