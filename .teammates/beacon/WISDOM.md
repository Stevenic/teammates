# Beacon — Wisdom

Distilled principles. Read this first every session (after SOUL.md).

Last compacted: 2026-03-29

---

### Codebase map — three packages
CLI has ~61 source files (~4,100 lines in cli.ts after Phase 2 extraction); consolonia has ~51 files; recall has ~13 files. Big files: `cli.ts` (~4,100), `onboard-flow.ts` (~1,089), `chat-view.ts` (~1,670), `markdown.ts` (~970), `compact.ts` (~800), `cli-proxy.ts` (~810), `thread-manager.ts` (~579), `adapter.ts` (~570). Extracted modules from cli.ts: `status-tracker.ts`, `handoff-manager.ts`, `retro-manager.ts`, `wordwheel.ts`, `service-config.ts`, `thread-manager.ts`, `onboard-flow.ts`, `activity-watcher.ts`, `activity-hook.ts`. When debugging, start with cli.ts and cli-proxy.ts.

### Three-tier memory system
WISDOM.md (distilled, ~20 entry cap), typed memory files (`memory/<type>_<topic>.md`), and daily logs (`memory/YYYY-MM-DD.md`). All memory files include YAML frontmatter with `version: <current>` (currently `0.7.0`). Daily logs add `type: daily`, typed memories add their type. Metadata fields pass through to the model intact — no stripping. Entries should be decision rationale and gotchas — not API docs. If `grep` can find it, it doesn't belong here.

### Context window budget model
Target 128k tokens. Daily logs (days 2-7) get 12k pool. Recall gets min 8k + unused daily budget. Conversation history budget derived dynamically. Weekly summaries excluded (recall indexes them). USER.md placed just before the task.

### Prompt architecture — two key decisions
(1) Instructions at the end (after context/task) — leverages recency effect for agent attention. (2) Five attention dilution defenses: dedup recall vs daily logs, 12k daily budget, echo user request at bottom, task-first priority statement, always-inline conversation context.

### @everyone — snapshot isolation required
`queueTask()` must freeze `conversationHistory` + `conversationSummary` into a `contextSnapshot` before pushing @everyone entries. Without this, the first drain loop's `preDispatchCompress()` mutates shared state before concurrent drains read it. This race condition caused 3/6 teammates to fail with empty context.

### Empty response defense — four layers
(1) Two-phase prompt — output protocol before housekeeping instructions. (2) Raw retry on empty `rawOutput`. (3) Synthetic fallback from `changedFiles` + `summary` metadata. (4) Three lazy-response guardrails: "Task completed" is not a valid body, prior session entries don't mean user received output, only log work from THIS turn. All layers needed — agents find creative ways to produce nothing or short-circuit with "already logged."

### Feed index gotchas — three bugs that burned hours
(1) **Use container methods, not feedLine** — `feedLine()`/`feedMarkdown()` append to feed end; inside threads, use `container.insertLine()`/`threadFeedMarkdown()` which insert at the correct position. (2) **endIdx double-increment** — `shiftIndices()` already extends `endIdx` for inserts inside range; only manually increment if `oldEnd === endIdx`. (3) **ChatView shift threshold** — `_shiftFeedIndices()` must use `clamped`, not `clamped + 1`; the off-by-one corrupts hidden set alignment and makes inserted lines invisible.

### ThreadContainer — thread feed encapsulation
`ThreadContainer` class (~230 LOC) encapsulates per-thread feed-line index management. Replaced 5 scattered maps + 10+ methods in cli.ts. Provides `insertLine()`, `insertActions()`, `addPlaceholder()`, `getInsertPoint()`/`peekInsertPoint()`, and thread-level action management. Thread-level `[reply] [copy thread]` verbs ONLY at the bottom — per-response actions are `[show/hide] [copy]` on the subject line. Key: `getInsertPoint()` auto-increments `_insertAt` — use only when actually inserting. `peekInsertPoint()` reads without consuming — use for tracking body range indices. Using `getInsertPoint()` to read without inserting pushes body content past `replyActionIdx`.

### HandoffContainerCtx — render inside thread containers
`HandoffManager.renderHandoffs()` accepts an optional `HandoffContainerCtx` with `insertLine()`/`insertActions()` methods. When provided, handoff boxes insert within the thread range instead of appending globally. Without this, handoff boxes land AFTER the thread's `[reply] [copy thread]` verbs.

### StatusTracker — clean 3-method public API
`startTask(id, teammate, description)`, `stopTask(id)`, `showNotification(content: StyledLine)`. Tasks rotate with spinner + elapsed time. Notifications are one-shot styled messages that auto-purge on next rotation. Animation lifecycle is fully private — callers never manage start/stop. Use `showNotification()` for transient feedback (clipboard, compact results), not `feedLine()`. For migration progress, add a synthetic `activeTasks` entry — don't duplicate with custom spinner code.

### Activity tracking — dual-watcher with PostToolUse hook
Two-layer architecture: (1) `scripts/activity-hook.mjs` — a PostToolUse hook auto-installed in `.claude/settings.local.json` by `ensureActivityHook()` at CLI startup. Reads `{tool_name, tool_input}` from stdin, extracts detail (file_path, command, pattern), appends to `$TEAMMATES_ACTIVITY_LOG`. (2) `activity-watcher.ts` — `watchActivityLog()` polls the hook log for tool details, `watchDebugLogErrors()` polls Claude's debug log for errors only. Both use `fs.watchFile` (1s interval) for Windows reliability. `cli-proxy.ts` sets `TEAMMATES_ACTIVITY_LOG` env var pointing to per-agent file in `.teammates/.tmp/activity/`. Activity lines render inside thread containers via `insertStyledToFeed` + `shiftAllContainers`. Key gotchas: always `cleanupActivityLines()` (hide + delete state) on both task completion and cancel paths; cancel uses `killAgent()` with SIGTERM → SIGKILL escalation. Claude-only for now.

### System task isolation — filter by flag, not agent
When suppressing events for system tasks, filter on the `system` flag on `TaskAssignment`/`TaskResult` — never by agent name. Agent-level suppression (`silentAgents`) blocks ALL events for that agent including concurrent user tasks. The `system` flag threads through to `buildTeammatePrompt()` and `AgentAdapter.executeTask()` — when true, the prompt tells agents "Do NOT update daily logs, typed memories, or WISDOM.md." Never log system tasks (compaction, wisdom distillation, summarization) in daily logs or weekly summaries.

### Workspace deps — use wildcard, not pinned versions
Pinned versions cause npm workspace resolution failures when local packages bump — npm marks them **invalid** and may resolve to registry versions missing newer APIs. `"*"` always resolves to the local workspace copy.

### Action buttons need unique IDs
Static IDs cause all buttons to share one handler. Pattern: `<action>-<teammate>-<timestamp>` with a `Map` storing per-ID context. Handler looks up by ID, falls back to latest.

### Handoff format — fenced code blocks only
Agents must use ` ```handoff\n@name\ntask\n``` `. Natural-language fallback catches "hand off to @name" as a safety net, but only fires when zero fenced blocks found.

### Folder naming convention in .teammates/
No prefix = teammate folder (contains SOUL.md). `_` prefix = shared, checked in. `.` prefix = local/ephemeral, gitignored. Registry skips `_` and `.` prefixed dirs.

### Migrations are just markdown
MIGRATIONS.md lives in `packages/cli/` (ships with npm package). Plain markdown with `## <version>` sections. `buildMigrationPrompt()` parses it, filters by previous version, queues one agent task per teammate. Don't over-engineer this — the first attempt with a typed Migration interface + programmatic/agent types was ripped out the same day. `commitVersionUpdate()` only fires when ALL migrations complete — interrupted CLI re-runs on next startup.

### ESM path resolution — no __dirname
`__dirname` is undefined in ESM modules. Use `fileURLToPath(new URL("../relative/path", import.meta.url))` instead. Silent `catch` on `readFileSync` masked this for days — migrations silently skipped because the path resolved to nothing.

### Spec-first for UI features
Write a design spec before starting any multi-phase visual feature. The thread view took 18+ rounds partly because the first implementation had to be thrown away when the spec arrived mid-feature.

### Verify before logging
Never log a fix as done in daily logs or session files without confirming the source file was actually written. The `_shiftFeedIndices` off-by-one was logged as fixed on 03-28 but never committed — wasting an entire round re-diagnosing on 03-29.
