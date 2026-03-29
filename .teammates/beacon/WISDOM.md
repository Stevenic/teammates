# Beacon — Wisdom

Distilled principles. Read this first every session (after SOUL.md).

Last compacted: 2026-03-29

---

### Codebase map — three packages
CLI has 52 source files (~4,100 lines in cli.ts after Phase 1 extraction); consolonia has 51 files; recall has 13 files. Big files: `cli.ts` (~4,100), `chat-view.ts` (~1,670), `markdown.ts` (~970), `compact.ts` (~800), `cli-proxy.ts` (~810). Key extracted modules: `adapter.ts` (~570), `onboard.ts` (~470), `wordwheel.ts` (~430), `handoff-manager.ts` (~420), `banner.ts` (~410), `thread-container.ts` (~340), `retro-manager.ts` (~320), `log-parser.ts` (~290), `cli-utils.ts` (~240), `service-config.ts` (~220), `status-tracker.ts` (~170), `cli-args.ts` (~155), `personas.ts` (~140). When debugging, start with cli.ts and cli-proxy.ts.

### cli.ts decomposition — extracted module pattern
Phase 1 extracted 5 modules (6815 -> ~4100 lines): `status-tracker.ts`, `handoff-manager.ts`, `retro-manager.ts`, `wordwheel.ts`, `service-config.ts`. Each module receives deps via a typed interface (e.g., `HandoffView`, `RetroView`). cli.ts creates instances after orchestrator/chatView init, passing closure-based getters for dynamic state. Thin delegation wrappers maintain the original internal API. Phase 2 targets: onboarding (~950 lines), slash commands (~2100 lines), thread management (~650 lines).

### Three-tier memory system
WISDOM.md (distilled, read-only except during compaction), typed memory files (`memory/<type>_<topic>.md`), and daily logs (`memory/YYYY-MM-DD.md`). WISDOM entries should be decision rationale and gotchas — not API docs or implementation recipes. If it's derivable from code, it doesn't belong here.

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

### Threaded task view — data model and rendering
Tasks grouped by thread ID (`TaskThread`/`ThreadEntry` in types.ts). Short auto-incrementing IDs (`#1`, `#2`), session-scoped. Dispatch line renders as `feedUserLine` with dark bg. Working placeholders show `@name: working on task...`. On completion, placeholder is **hidden** and response header inserted at reply insert point (reorder design — first to complete at top). `displayTaskResult()` split into `displayFlatResult()` + `displayThreadedResult()`. Thread content indented 2 spaces (header) / 4 spaces (body).

### Threaded task view — verb system
Two levels: **Inline subject-line actions** (`@name: Subject  [show/hide] [copy]`) and **Thread-level verbs** (`[reply] [copy thread]` at bottom via `ThreadContainer.insertThreadActions()`). `[reply]` sets `focusedThreadId` and populates input with `#id `. Thread verbs hidden while agents working, shown when `placeholderCount === 0`. Dynamic `[show]`/`[hide]` toggle via `updateActionList()`.

### Threaded task view — routing and context
Thread-local context via `buildThreadContext()` fully replaces global context when `threadId` is set. Auto-focus: un-mentioned messages target `focusedThreadId`; `@mention`/`@everyone` breaks focus and creates new thread. Auto-focus fallback picks thread with highest `focusedAt` timestamp. Footer hint shows `replying to #N`. User replies render inside thread via `renderThreadReply()` with 4-space indent on all lines.

### ThreadContainer — per-thread feed index management
`ThreadContainer` class (~340 LOC) encapsulates all per-thread feed-line index management. Key methods: `insertLine`, `insertActions`, `addPlaceholder`, `hidePlaceholder`, `trackReplyBody`, `toggleCollapse`, `toggleReplyCollapse`, `insertThreadActions`, `hideThreadActions`/`showThreadActions`, `getInsertPoint`/`peekInsertPoint`/`setInsertAt`/`clearInsertAt`. Takes a `ShiftCallback` for cross-container index shifting. `/clear` reset is just `containers.clear()`.

### Feed index gotchas — three bugs that burned hours
(1) **Use container methods, not feedLine** — `feedLine()`/`feedMarkdown()` append to feed end; inside threads, use `container.insertLine()`/`threadFeedMarkdown()` which insert at the correct position. (2) **endIdx double-increment** — `shiftIndices()` already extends `endIdx` for inserts inside range; only manually increment if `oldEnd === endIdx`. (3) **ChatView shift threshold** — `_shiftFeedIndices()` must use `clamped`, not `clamped + 1`; the off-by-one corrupts hidden set alignment and makes inserted lines invisible.

### peekInsertPoint vs getInsertPoint
`getInsertPoint()` auto-increments `_insertAt` — use only when actually inserting. `peekInsertPoint()` reads position without consuming it — use for tracking body range indices in `displayThreadedResult`. Using `getInsertPoint()` to read indices without inserting pushes subsequent inserts past `replyActionIdx`, causing body content to appear after `[reply] [copy thread]`.

### Smart auto-scroll
`_userScrolledAway` flag in ChatView tracks whether user has scrolled up. `_autoScrollToBottom()` is a no-op when the flag is set. Flag set in `scrollFeed()`, scrollbar click/drag. Cleared in `scrollToBottom()`, `clear()`, and when user scrolls back to bottom.

### ChatView performance — cached heights + coalesced refresh
Feed line height cache prevents O(N) re-measurement per render frame. `app.scheduleRefresh()` coalesces rapid updates via `setImmediate`. Spinner interval is 200ms (not 80ms) to avoid event loop saturation under concurrent task load.

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

### Extract pure functions to cli-utils.ts
Testable pure functions go in cli-utils.ts, wired into cli.ts via imports. Current contents: `relativeTime`, `wrapLine`, `findAtMention`, `isImagePath`, `cleanResponseBody`, `formatConversationEntry`, `buildConversationContext`, `findSummarizationSplit`, `buildSummarizationPrompt`, `preDispatchCompress`, `compressConversationEntries`, `buildThreadContext`.

### Spec-first for UI features
Write a design spec before starting any multi-phase visual feature. The thread view took 18+ rounds partly because the first implementation had to be thrown away when the spec arrived mid-feature.

### Verify before logging
Never log a fix as done in daily logs or session files without confirming the source file was actually written. The `_shiftFeedIndices` off-by-one was logged as fixed on 03-28 but never committed — wasting an entire round re-diagnosing on 03-29.
