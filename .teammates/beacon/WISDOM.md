# Beacon — Wisdom

Distilled principles. Read this first every session (after SOUL.md).

Last compacted: 2026-03-28

---

### Codebase map — three packages
CLI has 45 source files (~6,650 lines in cli.ts); consolonia has 51 files; recall has 13 files. The big files are `cli.ts` (~6,650 lines), `chat-view.ts` (~1,660 lines), `markdown.ts` (~970 lines), and `adapters/cli-proxy.ts` (~810 lines). Key extracted modules: `adapter.ts` (~570), `compact.ts` (~800), `banner.ts` (~410), `log-parser.ts` (~290), `thread-container.ts` (~276), `cli-utils.ts` (~240), `cli-args.ts` (~155), `personas.ts` (~140). When debugging, start with cli.ts and adapters/cli-proxy.ts.

### Three-tier memory system
WISDOM.md (distilled, read-only except during compaction), typed memory files (`memory/<type>_<topic>.md`), and daily logs (`memory/YYYY-MM-DD.md`). The CLI reads WISDOM.md, the indexer indexes WISDOM.md + memory/*.md, and the prompt tells teammates to write typed memories.

### Memory frontmatter convention
All memory files include YAML frontmatter with `version: <current>` as the first field (currently `0.6.3`). Daily logs add `type: daily`, typed memories add their type. Metadata fields pass through to the model intact — no stripping. Compression prompts and adapter instructions both enforce this convention.

### Context window budget model
Target context window is 128k tokens. Fixed sections always included (identity, wisdom, today's log, roster, protocol, USER.md). Daily logs (days 2-7) get 12k token pool. Recall gets min 8k + unused daily budget, with 4k overflow grace. Conversation history budget is derived dynamically: `(TARGET_CONTEXT_TOKENS - PROMPT_OVERHEAD_TOKENS) * CHARS_PER_TOKEN`. Weekly summaries excluded (recall indexes them). USER.md placed just before the task.

### Prompt section ordering — instructions at the end
Context/reference material (identity, wisdom, logs, recall, roster, services, handoff, date/time, user profile) stays at the top. Task sits in the middle. Instructions (output protocol, session state, memory updates, reminder) go at the end — leverages recency effect for agent attention.

### Attention dilution defenses
Five fixes to prevent agents from spending all tool calls on housekeeping instead of the task: (1) Dedup recall against daily logs already in the prompt. (2) Daily log budget halved (24K->12K) — past logs are reference, not active context. (3) Echo user's request at bottom of instructions (<500 chars verbatim, else pointer). (4) Task-first priority statement at top of instructions. (5) Conversation context always inlined in the prompt (file offload removed — pre-dispatch compression keeps it within budget).

### Two-stage conversation compression
**Pre-dispatch (mechanical):** `preDispatchCompress()` runs before every task dispatch — if history exceeds budget, oldest entries are mechanically compressed into bullet summaries via `compressConversationEntries()`. **Post-task (quality):** `maybeQueueSummarization` still runs async for better summaries. The running summary is invisible to the user. Reset on `/clear`.

### Conversation history stores full bodies
`storeResult()` stores the full cleaned `rawOutput` (protocol artifacts stripped), not just `result.summary`. `buildConversationContext()` formats multi-line entries with body on the next line. When history exceeds token budget, pre-dispatch compression fires before the next task.

### @everyone concurrent dispatch — snapshot isolation
`queueTask()` freezes `conversationHistory` + `conversationSummary` into a `contextSnapshot` once before pushing all @everyone entries (each gets a shallow copy). `drainAgentQueue()` skips `preDispatchCompress()` when an entry has a snapshot and passes it directly to `buildConversationContext()`. Context is always inlined (no file offload). This prevents race conditions where the first drain loop mutates shared state before concurrent drains read it.

### Threaded task view — data model
Tasks and responses are grouped by thread ID. `TaskThread` and `ThreadEntry` interfaces in types.ts. `threadId` field on all `QueueEntry` variants. Every user task creates a new thread; `#id` prefix in input targets an existing thread. Thread IDs are short auto-incrementing integers (`#1`, `#2`, `#3`) — session-scoped, reset on `/clear`. Handoff approval propagates `threadId` across single, bulk, and auto-approve paths.

### Threaded task view — feed rendering (reorder design)
Thread dispatch line (`#id  -> @names`) renders as a `feedUserLine` with dark background — visually part of the user message block. Working placeholders show `  @name: working on task...` (accent name + dim status). On completion, the original placeholder is **hidden** (not removed) and a new response header (`@name: subject`) is inserted at the reply insert point (before remaining working placeholders). Body content follows the header. Result: first to complete appears at top, still-working placeholders stay at bottom. `displayTaskResult()` split into `displayFlatResult()` + `displayThreadedResult()`. Collapse arrow only shown when collapsed. Thread content indented 2 spaces (header) / 4 spaces (body) — no box-drawing borders.

### Threaded task view — verb system
Per-item `[reply]`/`[copy]` action lines replaced with two levels. **Inline subject-line actions:** each response header is an action list `@name: Subject  [show/hide] [copy]` — clicking subject text or `[show/hide]` toggles body visibility. **Thread-level verbs:** `[reply] [copy thread]` rendered once at bottom of thread container via `ThreadContainer.insertThreadActions()`. `[reply]` sets `focusedThreadId`; `[copy thread]` copies all entries. Action ID prefixes: `thread-reply-*`, `thread-copy-*`, `reply-collapse-*`, `item-copy-*`.

### Threaded task view — routing and context
Thread-local conversation context via `buildThreadContext()` fully replaces global context when `threadId` is set — keeps agents focused on the thread. Auto-focus: un-mentioned messages without `#id` prefix target `focusedThreadId` if set; `@mention` or `@everyone` breaks focus and creates a new thread. Auto-focus fallback picks thread with highest `focusedAt` timestamp when no thread is focused. `#id` wordwheel completion on `#` at line start. `/status` shows active threads with reply count, pending agents, and focused indicator. Footer hint shows `replying to #N` when focused.

### ThreadContainer — per-thread feed index management
`ThreadContainer` class in `thread-container.ts` (~276 LOC) encapsulates all per-thread feed-line index management. Replaces the old scattered maps and methods that were in cli.ts. Key methods: `insertLine`, `insertActions`, `addPlaceholder`, `hidePlaceholder`, `trackReplyBody`, `toggleCollapse`, `toggleReplyCollapse`, `insertThreadActions`, `getInsertPoint`/`setInsertAt`/`clearInsertAt`. Takes a `ShiftCallback` for cross-container index shifting. `/clear` reset is just `containers.clear()`.

### Thread feed insertions — use container methods, not feedLine
When inserting content within a thread range, always use `container.insertLine()`/`container.insertActions()` or the CLI wrappers (`threadFeedMarkdown`) — never `feedLine()`/`feedMarkdown()`. The latter appends to the feed end, but container inserts go at the correct position within the thread range. Using `feedLine()` inside a thread causes content to appear after all thread content instead of at the intended position.

### Thread feed endIdx — guard against double-increment
`shiftIndices()` in ThreadContainer already extends `endIdx` for inserts inside the range. After calling it, only manually increment `endIdx++` if the shift didn't already extend it (check `oldEnd === endIdx`). Without this guard, each insert double-increments, and the drift accumulates — corrupting `getInsertPoint()` positions.

### ChatView insert and visibility APIs
`insertToFeed()`, `insertStyledToFeed()`, `insertActionList()` insert lines at arbitrary feed positions. `_shiftFeedIndices()` maintains action map, hidden set, and height cache coherence on insert — threshold must match the splice position (`clamped`, not `clamped + 1`). `setFeedLineHidden()` / `setFeedLinesHidden()` / `isFeedLineHidden()` control line visibility for collapse. `_renderFeed()` skips hidden lines.

### Smart auto-scroll
`_userScrolledAway` flag in ChatView tracks whether user has scrolled up. `_autoScrollToBottom()` is a no-op when the flag is set — new content won't yank the viewport. Flag set in `scrollFeed()`, scrollbar click, and scrollbar drag when offset < maxScroll. Cleared in `scrollToBottom()`, `clear()`, and when user scrolls back to bottom. User message submit explicitly calls `scrollToBottom()` to reset scroll.

### User avatar system (Campfire Phase 1)
Users are represented as avatar teammates with `**Type:** human` in SOUL.md. The adapter is hidden — not registered when user has an alias. `selfName` (user alias) is the display identity everywhere; `adapterName` is for internal execution only. `@everyone` excludes both avatar and adapter. Display surfaces (roster, picker, status, errors) show `adapterName` while `selfName` is used for sender label, conversation history, internal routing, and memory folder. Import skips human avatar folders (checks SOUL.md for `**Type:** human`).

### Onboarding happens pre-TUI
User setup (GitHub or manual) runs before the TUI is created via `console.log` + `askInput`/`askChoice`. No mouse tracking issues. Team onboarding only runs if `.teammates/` was missing. `askInline()` is used for in-TUI prompts (e.g., `/configure`) to avoid stdin conflicts with consolonia. Persona templates (`packages/cli/personas/`) provide scaffolding — `/init pick` for in-TUI selection.

### Assignment works via @mention, not /assign
No `/assign` slash command. Assignment goes through `queueTask()`. Multi-mention dispatches to all mentioned teammates. Paste @mentions are pre-resolved from raw input before placeholder expansion to prevent routing on pasted content.

### Default routing follows last responder
Un-mentioned messages route to `lastResult.teammate` first, then `orchestrator.route()`, then `selfName`. Explicit `@mentions` always override. When threads are active, focused thread's last responder is checked before global `lastResult`.

### Route threshold prevents weak matches
`Orchestrator.route()` requires a minimum score of 2 (at least one primary keyword match). Single secondary keyword matches (score 1) fall through.

### Recall two-pass architecture
**Pass 1 (pre-task, no LLM):** `buildQueryVariations()` generates 1-3 queries from task + conversation context. `matchMemoryCatalog()` does frontmatter text matching. `multiSearch()` fuses results with dedup by URI. **Pass 2 (mid-task):** Every teammate prompt includes a recall tool section documenting `teammates-recall search` CLI usage for agent-driven iterative queries.

### Empty response defense — three layers
1. **Two-phase prompt** — Output protocol before session/memory instructions; agents write text first, then do housekeeping. 2. **Raw retry** — If `rawOutput` is empty and `success` is true, fire retry with `raw: true` (no prompt wrapping). Second retry with minimal "just say Done" prompt. 3. **Synthetic fallback** — `displayTaskResult` generates body from `changedFiles` + `summary` metadata when text is still empty.

### Lazy response guardrails
Three prompt additions in adapter.ts prevent agents from short-circuiting when they find prior entries in session files or daily logs: (1) "Task completed" / "already logged" / "no updates needed" is NOT a valid response body. (2) Prior session entries don't mean the user received output — always redo work and produce full text. (3) Only log work actually performed in THIS turn — never log assumed or prior-turn work.

### Handoff format requires fenced code blocks
Agents must use ` ```handoff\n@name\ntask\n``` ` format. Natural-language handoff fallback (`findNaturalLanguageHandoffs()`) catches "hand off to @name" patterns as a safety net, but only fires when zero fenced blocks are found.

### Recall is bundled infrastructure
`@teammates/recall` is a direct dependency of `@teammates/cli`. Pre-task recall queries use `skipSync: true` for speed. Sync runs after every task completion and on startup. No watch process needed.

### Workspace deps use wildcard, not pinned versions
`packages/cli/package.json` uses `"*"` for `@teammates/consolonia` and `@teammates/recall` dependencies. Pinned versions (e.g., `"0.6.0"`) cause npm workspace resolution failures when local packages are at a different version — npm marks them as **invalid** and may resolve to registry versions that lack newer APIs. `"*"` always resolves to the local workspace copy regardless of version bumps.

### Banner is segmented — left footer + right footer
Left: product name + version + adapter name + project directory path (smart-truncated via `truncatePath()`). Right: `? /help` by default, temporarily replaced by ESC/Ctrl+C hints or `replying to #N` thread hint. Services show presence-colored dots (green/yellow/red). `updateServices()` refreshes the banner live after `/configure`.

### Debug logging lives in .tmp/debug/
Every task writes a structured debug log to `.teammates/.tmp/debug/<teammate>-<timestamp>.md` including the full prompt sent to the agent (via `fullPrompt` on `TaskResult`). Files >24h are cleaned on startup. `/debug [teammate] [focus]` reads the last log and queues analysis to the coding agent — optional focus text narrows the analysis scope. Adapters set `result.fullPrompt` after building the prompt; `lastTaskPrompts` stores it for `/debug`.

### Two-tier compaction — scheduled + budget-driven
`compactDailies()` runs on startup for completed past weeks. `autoCompactForBudget()` runs pre-task in adapters when daily logs exceed `DAILY_LOG_BUDGET_TOKENS` (12k) — it compacts oldest weeks first, including the current week with `partial: true` frontmatter. Partial weeklies are merged by `compactDailies()` when more dailies arrive. Startup compaction uses silent mode — progress bar only unless actual work was done. `runCompact()` also triggers `autoCompactForBudget` before episodic compaction.

### Daily compression via system tasks
`buildDailyCompressionPrompt()` checks if yesterday's log needs compression on new day boundary. Compressed logs marked with `compressed: true` frontmatter. Keeps task headers + one-line summaries + key decisions + file lists (3-5 lines per task). `buildMigrationCompressionPrompt()` handles bulk compression of historical logs during version migration.

### Version tracking and migration
`checkVersionUpdate()` is read-only; `commitVersionUpdate()` writes. Version persisted LAST — only after all migration tasks complete (or immediately if no migration needed). Migration logic (v0.6.0): finds uncompressed dailies per teammate, queues system tasks with `migration: true`, re-indexes after all complete via `pendingMigrationSyncs` counter. `semverLessThan()` is a reusable utility for future migrations.

### Non-blocking system task lane
System-initiated tasks (compaction, summarization, wisdom distillation) run concurrently without blocking user tasks via task-level `system` flag on `TaskAssignment` and `TaskResult`. An agent can run 0+ system tasks and 0-1 user tasks simultaneously. System tasks use unique `sys-<teammate>-<timestamp>` IDs, tracked in `systemActive` map. `kickDrain()` extracts them from the queue before processing user tasks. System tasks are fully background — no progress bar, no `/status` display, errors only (with `(system)` label in the feed). The `system` flag on events allows concurrent system + user tasks for the same agent without interference.

### No system tasks in daily logs
Never log system tasks (compaction, wisdom distillation, summarization, auto-compaction) in daily logs or weekly summaries. They clutter logs with noise and waste context window budget. Only log user-requested work, feature implementations, bug fixes, discussions, and handoffs.

### Progress bar — 80-char target with elapsed time
Active user tasks display as `<spinner> <teammate>... <task text> (2m 5s)`. Format targets 80 chars total — task text is dynamically truncated to fit. `formatElapsed()` escalates: `(5s)` -> `(2m 5s)` -> `(1h 2m 5s)`. Multiple concurrent tasks show cycling tag: `(1/3 - 2m 5s)`. Both ChatView and fallback PromptInput paths share the same format.

### Filter by task, not by agent
When suppressing events for background/system tasks, filter at the task level (via flags on `TaskAssignment`/`TaskResult`), never at the agent level. Agent-level suppression (`silentAgents`) blocks ALL events for that agent — including concurrent user tasks. The `system` flag on events is the correct pattern. `silentAgents` is only used for the short-lived defensive retry window.

### Cross-folder write boundary enforcement
AI teammates must not write to another teammate's folder. Two layers: (1) prompt rule in `adapter.ts` — `### Folder Boundaries (ENFORCED)` section injected for `type: "ai"` only, (2) post-task audit via `auditCrossFolderWrites()` in `cli.ts` — scans `changedFiles` for paths inside `.teammates/<other>/`, shows `[revert]`/`[allow]` actions. Allowed: own folder, `_` prefix (shared), `.` prefix (ephemeral), root-level `.teammates/` files.

### Interrupt-and-resume — deferred promise pattern
`/interrupt [teammate] [message]` kills a running agent and resumes with context. `spawnAndProxy` uses a deferred promise — `done` is shared between `executeTask` (normal await) and `killAgent` (SIGTERM -> 5s -> SIGKILL, then await `done`). `activeProcesses` map tracks `{ child, done, debugFile }` per teammate. Resume prompt wraps the parsed conversation log in `<RESUME_CONTEXT>` and goes through normal `buildTeammatePrompt` wrapping. The `killAgent?()` method is optional on `AgentAdapter`.

### Log parser extracts structure, not content
`log-parser.ts` parses Claude debug logs, Codex JSONL, and raw agent output into a timeline of actions (Read, Write, Search, etc.). `formatLogTimeline()` groups 4+ consecutive same-action entries to collapse bulk operations. `buildConversationLog()` orchestrates parsing with token budget truncation. Extracts file paths and search queries, NOT full file contents — keeps resume prompts compact.

### ChatView performance — cached heights + coalesced refresh
Feed line height cache (`_feedHeightCache[]`) stores measured heights per line, invalidated on width change or content mutation. Prevents O(N) re-measurement on every render frame. `app.scheduleRefresh()` coalesces rapid progress updates into a single render via `setImmediate`. Spinner interval is 200ms (not 80ms) to avoid saturating the event loop under concurrent task load.

### /script command — user-defined reusable scripts
Scripts stored under the user's twin folder (`.teammates/<selfName>/scripts/`). Three modes: `/script list`, `/script run <name>`, `/script <description>` (create + run new). The coding agent always handles `/script` tasks — routes to `selfName`.

### Clean dist before rebuild
After modifying any TypeScript source, run `rm -rf dist && npm run build` in the package. Stale artifacts in dist/ can mask compile errors. Running CLI must be restarted after rebuilds — Node.js caches modules at startup.

### Lint after every build
After every build, run `npx biome check --write --unsafe` on changed files. If fixes are applied, rebuild to verify they compile cleanly. This is mandatory — lint errors should never be left behind.

### Bump all version references on version bump
When bumping package versions, update ALL references — not just the three package.json files. Also update `cliVersion` in `.teammates/settings.json`. Grep for the old version string to catch any other references. Known sites: `packages/cli/package.json`, `packages/consolonia/package.json`, `packages/recall/package.json`, `.teammates/settings.json`.

### Folder naming convention in .teammates/
No prefix = teammate folder (contains SOUL.md). `_` prefix = shared non-teammate folder, checked in. `.` prefix = local/ephemeral, gitignored. Registry skips `_` and `.` prefixed dirs when scanning for teammates.

### Wordwheel commands without args execute on Enter
No-arg commands (/exit, /status, /help) execute immediately when selected from the wordwheel dropdown. Enter key handler accepts the highlighted item before readline processes it. Commands with arg placeholders should use single tokens (e.g., `[description]` not multi-word usage strings) so the hint clears after the first typed arg.

### Emoji spacing convention
All ✔/✖/⚠ emojis get double-space after them for consistent rendering across terminals. Applied globally in cli.ts.

### Persona template system
15 persona templates in `packages/cli/personas/` with YAML frontmatter (persona, alias, tier, description) and SOUL.md body with `<Name>` placeholders. `loadPersonas()` reads and sorts by tier. `scaffoldFromPersona()` creates teammate folder. Tier 1 = Core (SWE, PM, QA, DevOps), Tier 2 = Specialized. Wired into both pre-TUI onboarding and `/init pick`.

### Action buttons need unique IDs
Feed action buttons (e.g., `[copy]`, `[revert]`, `[allow]`) must have unique IDs tied to their context. Static IDs cause all buttons to share a single handler — clicking any button executes against the most recent context. Pattern: `<action>-<teammate>-<timestamp>` with a `Map` storing per-ID context. Handler looks up by ID, falls back to latest.

### Extracted pure functions live in cli-utils.ts
Testable pure functions extracted from cli.ts: `relativeTime`, `wrapLine`, `findAtMention`, `isImagePath`, `cleanResponseBody`, `formatConversationEntry`, `buildConversationContext`, `findSummarizationSplit`, `buildSummarizationPrompt`, `preDispatchCompress`, `compressConversationEntries`, `buildThreadContext`. New extractions should follow this pattern — pure logic in cli-utils.ts, wired into cli.ts via imports.
