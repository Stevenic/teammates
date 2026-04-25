# Steve Ickman — Wisdom

Last compacted: 2026-04-25
Distilled from work history. Updated during compaction.

---

## Output Protocol (CRITICAL)

**Users cannot see daily logs or memory writes**
The user only sees the text returned in the current turn. Writing a great daily log entry but returning a meta-status body like "Task completed" or "Logged in memory" leaves the user with nothing useful. Every response must include the actual deliverable in the visible text — even if it is also persisted elsewhere. This is the #1 recurring failure mode.

## Build & Deploy

**Global install lag**
Source changes in `packages/cli/src` don't take effect for the globally installed CLI until rebuild + reinstall (`npm run build && npm install -g .` in `packages/cli`). Always reinstall globally after building.

**ESM compliance**
The CLI is ESM-only. `require()` in ESM context throws "require is not defined". Unit tests for ESM compliance were added in v0.8.1 — keep them passing.

**Dual prompt builders**
Two system-prompt builders must stay in sync: `packages/cli/src/system-prompt.ts` (primary) and `packages/cli/src/adapter.ts` (fallback inline). When updating one, mirror to the other.

## Architecture

**Recall is a separate repo**
The recall service & API live in `C:\source\recall`. Code changes to recall no longer happen in the teammates monorepo.

**CLI: /add, /remove, /update**
These replaced the original `/init` command. Wordwheel over bundled personas with a `[teammate]` placeholder. An `isSolo` setting tracks users who explicitly skip adding teammates.

**Tabs (v0.9.x)**
Tabs (formerly threads) render as a box-drawn bar docked under the banner — banner scrolls off, tabs stick to top. First tab is "Task" (was "Default"); auto-named after first message. `[x]` closes (except first tab), `[+]` adds. `/clear` wipes content but preserves the tab; `/close` deletes the tab. Each tab owns its own task queue so the same teammate can work on two things in parallel — the shared status bar rotates through all active tasks. The legacy per-thread `[reply]` action is removed; `[copy thread]` stays.

**Tab paging rules**
Treat `[+]` as another tab for paging. Always show both `<` and `>` when scrolling is needed. Always keep at least one tab visible when paging — do NOT force the focused tab to stay in view; let the user page away from it.

**TUI perf with many tabs**
Rendering cost scales badly when multiple tabs are active. Suspect redundant re-renders of inactive tabs. Investigate before adding more tab-level features.

**Claude Code plugin exploration**
Folding teammates into Claude Code as a plugin that adds subagent personas is a potential future direction.

## UX Patterns

**Hover feedback is required**
All clickable elements must highlight with the accent color on hover — tab `[x]`/`[+]`, file links, URLs, tab labels. Files and links also get an underline on hover. Missing hover state is a bug, not polish.

**Local links need full paths**
Clicking a local file link with a relative path fails. Always resolve to an absolute path before opening.

## Prompt & Model Behavior

**Models re-read injected files**
Claude re-reads files via tool calls even when content is already in the system prompt. Mitigate by stripping file-path references from injected content or adding "do not re-read" guidance in SOUL.md.

**Version awareness gap**
Teammates don't naturally track what's changed since the last shipped version of an app/package. They tend to build bridges and migration paths for intermediate (unshipped) changes nobody else has seen. Anchor refactors and breaking changes to the last shipped version, not the current working state.

## Memory & Token Management

**Memory token budget**
Total memory/wisdom/soul/goals across all 5 teammates was ~150K tokens as of March 2026; Beacon is heaviest. Weekly compaction rolls dailies at ~30% compression; monthly rolls weeklies with aggressive theme extraction.

**Metadata hygiene**
All memory files need `type:` and `version:` in frontmatter. `.teammates/stevenic/scripts/fix-memory-metadata.sh` bulk-stamps missing metadata.

## Team Operations

**No auto-commits**
Teammates never auto-commit. Steve reviews and commits manually.

**Work is done by agents, not humans**
Don't break work into human-scale tasks. Group by logical units / checkpoints, not by what fits a person's day.

**Handoff discipline**
Hand off with full context: what was tried, what failed, exact file paths and line numbers, expected outcome. Be deliberate about sequential vs. parallel handoffs. Sequential handoffs should include instructions for onward routing.

**Hooks must be per-teammate**
Multiple teammates run in parallel; hooks must be scoped per-teammate. Install on first use since teammates come and go.

**Dead config cleanup needs Steve**
Vestigial blocks in `.claude/settings.local.json` can't be removed by teammates due to permission constraints. Flag them.

## Templates & Safety

**No real identities in templates**
Onboarding templates and example prompts use placeholder names (e.g., "alex"), not real teammate aliases.
