# Beacon — Wisdom

Distilled principles. Read this first every session (after SOUL.md).

Last compacted: 2026-03-29

---

### Codebase map — three packages
CLI has ~52 source files (~4,100 lines in cli.ts after Phase 2 extraction); consolonia has ~51 files; recall has ~13 files. Big files: `cli.ts` (~4,100), `onboard-flow.ts` (~1,089), `chat-view.ts` (~1,670), `markdown.ts` (~970), `compact.ts` (~800), `cli-proxy.ts` (~810), `thread-manager.ts` (~579), `adapter.ts` (~570). When debugging, start with cli.ts and cli-proxy.ts.

### cli.ts decomposition — extracted module pattern
Phase 1+2 extracted 7 modules (6815 → ~4,100 lines): `status-tracker.ts`, `handoff-manager.ts`, `retro-manager.ts`, `wordwheel.ts`, `service-config.ts`, `thread-manager.ts`, `onboard-flow.ts`. Each receives deps via a typed interface. cli.ts creates instances after orchestrator/chatView init, passing closure-based getters. Slash commands (~2,100 lines) were NOT extracted — too entangled with private state.

### Three-tier memory system
WISDOM.md (distilled, ~20 entry cap), typed memory files (`memory/<type>_<topic>.md`), and daily logs (`memory/YYYY-MM-DD.md`). Entries should be decision rationale and gotchas — not API docs. If `grep` can find it, it doesn't belong here.

### Memory frontmatter convention
All memory files include YAML frontmatter with `version: <current>` as the first field (currently `0.7.0`). Daily logs add `type: daily`, typed memories add their type. Metadata fields pass through to the model intact — no stripping.

### Context window budget model
Target 128k tokens. Daily logs (days 2-7) get 12k pool. Recall gets min 8k + unused daily budget. Conversation history budget derived dynamically. Weekly summaries excluded (recall indexes them). USER.md placed just before the task.

### Prompt architecture — two key decisions
(1) Instructions at the end (after context/task) — leverages recency effect for agent attention. (2) Five attention dilution defenses: dedup recall vs daily logs, 12k daily budget, echo user request at bottom, task-first priority statement, always-inline conversation context.

### @everyone — snapshot isolation required
`queueTask()` must freeze `conversationHistory` + `conversationSummary` into a `contextSnapshot` before pushing @everyone entries. Without this, the first drain loop's `preDispatchCompress()` mutates shared state before concurrent drains read it. This race condition caused 3/6 teammates to fail with empty context.

### Empty response defense — three layers
(1) Two-phase prompt — output protocol before housekeeping instructions. (2) Raw retry on empty `rawOutput`. (3) Synthetic fallback from `changedFiles` + `summary` metadata. All three are needed — agents find creative ways to produce nothing.

### Lazy response guardrails
Agents short-circuit with "already logged" when they find prior session/log entries. Three prompt rules prevent this: (1) "Task completed" is not a valid body. (2) Prior session entries don't mean the user received output. (3) Only log work from THIS turn.

### Feed index gotchas — three bugs that burned hours
(1) **Use container methods, not feedLine** — `feedLine()`/`feedMarkdown()` append to feed end; inside threads, use `container.insertLine()`/`threadFeedMarkdown()` which insert at the correct position. (2) **endIdx double-increment** — `shiftIndices()` already extends `endIdx` for inserts inside range; only manually increment if `oldEnd === endIdx`. (3) **ChatView shift threshold** — `_shiftFeedIndices()` must use `clamped`, not `clamped + 1`; the off-by-one corrupts hidden set alignment and makes inserted lines invisible.

### peekInsertPoint vs getInsertPoint
`getInsertPoint()` auto-increments `_insertAt` — use only when actually inserting. `peekInsertPoint()` reads without consuming — use for tracking body range indices. Using `getInsertPoint()` to read without inserting pushes subsequent inserts past `replyActionIdx`, causing body content to appear after thread-level verbs.

### Workspace deps — use wildcard, not pinned versions
Pinned versions cause npm workspace resolution failures when local packages bump — npm marks them **invalid** and may resolve to registry versions missing newer APIs. `"*"` always resolves to the local workspace copy.

### Filter by task flag, not by agent
When suppressing events for system tasks, filter on the `system` flag on `TaskAssignment`/`TaskResult`. Agent-level suppression (`silentAgents`) blocks ALL events for that agent — including concurrent user tasks.

### Action buttons need unique IDs
Static IDs cause all buttons to share one handler. Pattern: `<action>-<teammate>-<timestamp>` with a `Map` storing per-ID context. Handler looks up by ID, falls back to latest.

### Handoff format — fenced code blocks only
Agents must use ` ```handoff\n@name\ntask\n``` `. Natural-language fallback catches "hand off to @name" as a safety net, but only fires when zero fenced blocks found.

### No system tasks in daily logs
Never log compaction, wisdom distillation, summarization, or auto-compaction in daily logs or weekly summaries. Only log user-requested work.

### Folder naming convention in .teammates/
No prefix = teammate folder (contains SOUL.md). `_` prefix = shared, checked in. `.` prefix = local/ephemeral, gitignored. Registry skips `_` and `.` prefixed dirs.

### Build process — clean + lint
After modifying TypeScript source: `rm -rf dist && npm run build`, then `npx biome check --write --unsafe` on changed files. If lint fixes, rebuild to verify. Stale dist/ artifacts mask compile errors. Running CLI must be restarted after rebuilds.

### Bump all version references
Update ALL references on version bump — not just the three package.json files. Also update `cliVersion` in `.teammates/settings.json`. Grep for old version string to catch stragglers.

### Migrations are just markdown
MIGRATIONS.md lives in `packages/cli/` (ships with npm package). Plain markdown with `## <version>` sections. `buildMigrationPrompt()` parses it, filters by previous version, queues one agent task per teammate. Don't over-engineer this — the first attempt with a typed Migration interface + programmatic/agent types was ripped out the same day.

### Spec-first for UI features
Write a design spec before starting any multi-phase visual feature. The thread view took 18+ rounds partly because the first implementation had to be thrown away when the spec arrived mid-feature.

### Verify before logging
Never log a fix as done in daily logs or session files without confirming the source file was actually written. The `_shiftFeedIndices` off-by-one was logged as fixed on 03-28 but never committed — wasting an entire round re-diagnosing on 03-29.
