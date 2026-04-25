# Beacon - Wisdom

Distilled principles. Read this first every session (after SOUL.md).

Last compacted: 2026-04-25

---

## Prompt & Context

**Prompt pipeline is two-tier: static system prompt + dynamic user message**
Each teammate has a pre-built `SYSTEM-PROMPT.md` (generated at startup by `system-prompt.ts`). It contains all stable sections: IDENTITY, GOALS, WISDOM, TEAM, SERVICES, RECALL_TOOL, ENVIRONMENT, USER_PROFILE, INSTRUCTIONS. Claude receives this via `--append-system-prompt-file` (preserves Claude Code's built-in system prompt). The dynamic user message carries conversation history, daily log snapshot, recalled memories, handoff context, and the task. Non-Claude agents get the full prompt combined via stdin.

**Prompt stack order is IDENTITY -> GOALS -> WISDOM -> TEAM -> ...**
GOALS.md was added between SOUL.md and WISDOM.md in `buildTeammatePrompt()`. Every `TeammateConfig` must include a `goals` field (empty string if no file exists). Missing it causes `undefined.trim()` crashes.

**User message budget is 20k tokens, priority-ordered**
Priority order: (1) user's message (unbounded), (2) conversation history (highest), (3) daily log snapshot from before conversation started (medium), (4) recalled memories in `MEMORY:` format (lowest). As conversation grows, it naturally pushes out recall and daily logs. `buildUserMessage()` handles allocation.

**Conversation context stays inline**
Do not offload conversation history into temp markdown files. Inline context is more reliable, avoids concurrent file races, and works better with deterministic compression. Pre-dispatch compression keeps history within budget.

**Concurrent fan-out needs snapshots**
When dispatching `@everyone` or any parallel queue, capture immutable `conversationHistory` and `conversationSummary` per entry at queue time. Shared mutable context will bleed across drain loops.

**Empty-response defense is layered**
Use response-first prompting, retry in raw mode when `rawOutput` is empty, and synthesize a fallback from `changedFiles` plus `summary` if needed. Reject lazy bodies and stale session recaps.

**Task behavior flags are purpose-specific**
`system` suppresses memory updates and feed output for maintenance tasks. `skipMemoryUpdates` suppresses only memory instructions (used by `/btw` for ephemeral questions). `raw` skips `buildTeammatePrompt` entirely for retries. Do not overload one flag for multiple purposes.

**Session state belongs in-process, not in files**
Do not persist session state to per-teammate markdown files. Session files waste tokens, create phantom agent activity, and add no value over inline conversation context. The Orchestrator's in-memory `sessions` Map is sufficient.

**Pre-dispatch compression is mechanical**
`preDispatchCompress()` runs before every task dispatch -- if conversation history exceeds the budget (96k tokens / 384k chars), it mechanically compresses the oldest entries into bullet summaries. Async agent summarization runs post-task for quality. Keep both paths; they serve different timing needs.

## Memory & Persistence

**Memory is three-tier**
WISDOM.md stores durable rules, typed memories store reusable decisions and feedback, and daily logs store chronology. Keep full YAML frontmatter in prompt context; the metadata is part of the memory.

**System tasks must not write memories**
Maintenance work like compaction, summarization, and wisdom distillation should not touch daily logs or typed memories. The prompt path must explicitly suppress memory-update instructions for system tasks.

**Migrations are markdown and commit last**
Keep upgrade instructions in `packages/cli/MIGRATIONS.md`, parse them by version heading, and persist the new version only after every migration succeeds. Interrupted upgrades should rerun cleanly on next startup. Resolve the file via `import.meta.url`, never `__dirname`.

**Wisdom distillation must be idempotent**
`buildWisdomPrompt()` checks `Last compacted: YYYY-MM-DD` in WISDOM.md. If today's date is already present, return `null` (skip). Without this guard, wisdom distillation fires on every startup, burning tokens for no reason.

**Memory files must not include version: in frontmatter**
The `version:` field was removed from all memory file frontmatter and from the code that generates it (`compact.ts`, `adapter.ts`). Version is tracked centrally in `.teammates/settings.json` (`cliVersion`), not per-file.

**Index versioning triggers full rebuilds**
`indexVersion` in `.teammates/settings.json` tracks the index format. `StartupManager.INDEX_VERSION` is the current expected version. When the persisted version is lower (or missing), startup runs `indexer.indexAll()` for a full rebuild instead of incremental sync. Bump `INDEX_VERSION` whenever the indexing format changes (e.g., chunking was v1->v2).

**User twin gets logged and compacted**
`logUserTask()` writes task entries to the user's twin daily memory (`.teammates/<userAlias>/memory/YYYY-MM-DD.md`) after each task completes. The user's twin is included in startup compaction, daily compression, and stale daily purge cycles. Logging is fire-and-forget to never block task flow.

## Recall & Search

**Recall indexes markdown in chunks**
`chunker.ts` splits memory files into ~2k token chunks (~8k chars) on markdown heading boundaries, then paragraph boundaries. Each chunk is a separate Vectra document with URI suffix `#0`, `#1`, etc. `classifyUri()` strips `#N` suffix before classification. `isChunkUri()` and `uriToRelativePath()` are the helpers.

**Recalled memories use structured MEMORY: format**
Results are formatted as `MEMORY:` blocks with `file:`, `type:`, `period:`, `partial:` metadata fields. This replaces the old `<RECALL_RESULTS>` XML block in the system prompt -- recall results now go in the user message under the budget system.

**SYSTEM-PROMPT.md is generated, not committed**
`**/SYSTEM-PROMPT.md` is gitignored. Generated at startup by `writeAllSystemPrompts()` in `system-prompt.ts`. Claude uses it directly via `--append-system-prompt-file`. Falls back to inline generation for tests and first-run scenarios.

**Recall v2 features are spec'd and ready to build**
Five features in priority order: (1) temporal decay with configurable half-lives per content type, (2) MMR re-ranking for diversity, (3) file watching via `IndexWatcher` class, (4) memory flush before compaction, (5) opt-in session transcript indexing. Specs live in `spec_recall_v2_features.md`. Features 1+2 are independent and can parallelize. Build order: temporal -> MMR -> file watching -> memory flush -> transcripts.

## Tabs & Threading

**Tab-based model replaces single shared feed**
Thread UX v2 (0.9.0) replaced the single-shared-feed threading model with per-thread tab-based feeds. Each thread owns its own `FeedStore` instance. Cross-thread index shifting is eliminated -- the #1 source of complexity in the old model. Commands: `/tab [description]` creates a tab, `#id` switches focus, `/close [#id]` removes a tab, `/tabs` lists all.

**FeedAdapter wraps FeedStore for thread content**
`feed-adapter.ts` wraps a FeedStore and provides the `ThreadFeedView` interface. Replaces ChatView as the mutation target for thread content. ThreadContainer works with any feed (active or background) through this adapter. Activity tracking uses per-thread adapters so activity lines go into the correct thread even when viewing a different tab.

**ThreadBar is a 3-row box-drawn docked widget**
`thread-bar.ts` renders as a 3-row layout docked between banner and chat feed. Focused tab has a full box: `┌─┐` top border, `│ │` side borders on content row, `┴` connectors into the separator line. Unfocused tabs are inline on the content row. Features: unread badges, working indicators, [x] close on all tabs, [+] new tab button, `<` `>` pagination arrows. Always visible (even with one tab). `measure()` returns height 3, ChatView's `dockedBar` maxHeight is 3.

**Seed thread must always exist**
Session starts with thread #1 ("Task") and the tab bar visible. Any code path that wipes all threads must re-seed the seed thread afterward. Three touchpoints: (1) startup in `cli.ts`, (2) `/tab` / [+] button when `threads.size === 0` (seed first, then create the new tab as #2), (3) `/clear` full-reset path in `commands.ts` (after `threadManager.clear()` + `orchestrator.reset()`, create the seed thread and append an empty user entry so the tab bar refreshes). Closing the last remaining tab is blocked (not specifically #1). The seed label was renamed "Default" -> "Task" in 0.9.1; the architectural rule is unchanged.

**Thread container owns `[copy thread]` only**
In the tab model, `[reply]` is redundant -- each tab is a thread, and replying is just typing in the focused thread. ThreadContainer renders only `[copy thread]` as the thread-level verb at the bottom of the container. Per-item verbs (`[show/hide] [copy]`) on the subject line. When removing actions, also remove their click handlers in `cli.ts` (e.g. `thread-reply-` was deleted alongside the verb).

**Thread container still useful within a tab's feed**
ThreadContainer is kept for per-thread index management -- insert-point tracking within a thread's own FeedStore. `replyActionIdx` field was kept despite the rename to avoid a wider refactor; it now tracks the `[copy thread]` action line's feed index.

**Thread insertion must be non-destructive**
Use `peekInsertPoint()` to inspect where thread content should go and reserve `getInsertPoint()` for the actual write. Reading with the destructive path pushes content past the thread action line.

**Container context pattern for scoped insertion**
When a subsystem (handoffs, activity) needs to insert lines within a thread, pass a container context interface (`insertLine()`/`insertActions()`) rather than always appending to the global feed. This keeps thread boundaries intact without coupling the subsystem to `ThreadContainer` internals.

**Virtual-trailing-sentinel for paginated lists**
When a paginated list ends with an always-last item (the `[+]` button in ThreadBar), include it as a virtual sentinel in the fit loop rather than reserving a fixed gap. Iterate over `itemCount = items.length + 1`, treat the sentinel as index `items.length`, clamp `pageStart` to `[0, items.length - 1]` so at least one real item is always visible, and disable `>` once the sentinel is in view. Nav arrows stay always-rendered and swap between enabled (accent) and disabled (separator) styles.

**One-shot auto-scroll flag preserves manual pagination**
Widgets that auto-scroll to focus on change must NOT clamp `pageStart` to focus on every render. Otherwise `<`/`>` clicks are clobbered on the next invalidate. Pattern: cache `_lastFocusedId`, set a one-shot `_scrollToFocused = true` only when focus id changes vs. the cache, gate both render-time focus-clamp blocks behind the flag, and clear the flag after consumption. Focus-change auto-scroll still works; manual paging survives subsequent re-renders.

## Task Queues & Concurrency

**Task serialization is per-slot, not per-teammate**
A slot is a `(threadId, teammate)` pair. The same teammate in two different tabs runs concurrently as two slots. `slotKey(threadId, teammate)` returns `"t{threadId ?? 0}:{teammate}"`. Three core maps in `cli.ts` are keyed this way: `agentActive: Map<string, QueueEntry>`, `abortControllers: Map<string, AbortController>`, `agentDrainLocks: Map<string, Promise<void>>`. `isSlotBusy(threadId, teammate)` checks one slot; `drainSlot(threadId, teammate)` filters the queue by both keys; `kickDrain()` iterates unique `(threadId, teammate)` pairs from the queue. When adding any new per-agent map, ask whether it needs per-teammate or per-slot semantics -- almost always per-slot now.

**StatusTracker lifecycle is driven from the drain loop, keyed by entry.id**
`startTask(entry.id, ...)` at the top of `drainSlot` and `stopTask(entry.id)` in finally. Do NOT drive lifecycle from orchestrator events keyed by teammate -- two concurrent tasks for the same teammate would clobber each other's StatusTracker IDs and `stopTask(teammate)` would kill both. `handleEvent` only handles the `error` case for display now. StatusTracker's animation already rotates across all active task IDs, so the status bar shows both tabs' tasks without further changes.

**Activity manager is keyed by taskId, not teammate**
`buffers`, `shown`, `lineIndices`, `threadIds`, `blankIdx` are all keyed by `taskId` (the queue entry ID). `handleActivityEvents(taskId, events)`, `cleanupActivityLines(taskId)`, `initForTask(taskId, threadId)`, `insertActivityHeader`, `insertActivityLines`, `rerenderActivityLines`, `toggleActivity` all take `taskId`. Two concurrent tasks for the same teammate would otherwise collide on every map. The `onActivity` callback in `drainSlot` captures `entry.id` and passes it through.

**Concurrency-safe pieces that already worked**
Adapters spawn fresh child processes per `executeTask()` call, so two tasks naturally run in isolation. `orchestrator.sessions: Map<teammate, sessionId>` is safe to share -- session IDs are synthetic tokens that `cli-proxy.executeTask` ignores anyway. Per-thread `pendingTasks: Set<string>` was already taskId-based. Don't refactor what isn't broken.

## Feed & Rendering

**Feed state is identity-based**
Inside `ChatView`, track feed items by stable IDs through `FeedStore`, not parallel index-keyed arrays. `FeedItem` carries `id`, `content`, `actions`, `hidden`. Height caching lives in `VirtualList`, not on `FeedItem`.

**VirtualList is the scrollable rendering primitive**
`VirtualList` manages scroll state, ID-keyed height caching, screen-to-item mapping, and scrollbar rendering. ChatView builds `VirtualListItem[]` (banner + docked bar + feed items) each render. Items array is cheap -- just references, heights cached by ID.

**Banner stays fixed above a visible docked bar**
When a `dockedBar` is present, ChatView renders the banner as a fixed element above the bar, NOT inside the VirtualList. Otherwise the docked bar (pinned outside the list) floats above the banner (scrolling inside). `_buildVirtualListItems()` must exclude the banner from the VirtualList items when the dockedBar is visible. Layout order: fixed banner -> fixed docked bar -> scrollable feed.

**Virtualized height caches need explicit invalidation**
`VirtualList` caches geometry by item ID, so any item whose rendered height can change must be invalidated deliberately. The banner (`__banner__`) is the canonical case -- invalidate it every render during animation.

**Refreshes must be coalesced, not synchronous**
`refreshView()` in `cli.ts` must call `app.scheduleRefresh()`, NOT `app.refresh()`. `refresh()` runs a synchronous measure->arrange->render pass every call; with N agents working concurrently across tabs, every feed update / activity event / handoff triggers its own full render and the TUI visibly slows. `scheduleRefresh()` uses `setImmediate` to coalesce multiple refreshes within the same tick into a single render. Safe because all feed/chat-view mutations already call `invalidate()` (marks dirty) and `setImmediate` is effectively instant. Only hot synchronous paths (`showPrompt`, banner animation `onDirty`) should use `app.refresh()` directly.

**Shift every related index in one place**
Any feed insertion that shifts thread ranges must also shift adjacent bookkeeping like activity-line indices and blank-line indices. The `shiftAllContainers` callback on ThreadManager is the single coordination point -- extend it, never duplicate the shift logic elsewhere. Activity index shifting must be wired into this callback so ALL feed insertions (from ThreadManager, ActivityManager, or anywhere else) correctly update activity indices.

**Rendered actions need unique IDs**
Every clickable action needs its own ID plus a side lookup for payload state. Reused IDs make later clicks act on the newest handler state instead of the rendered item.

**Progress belongs behind a tiny API**
Keep progress behind `startTask()`, `stopTask()`, and `showNotification()`. `StatusTracker` owns animation, truncation, and terminal-width budgeting; callers should not manage lifecycle details themselves. Never create custom spinners that duplicate StatusTracker's job.

**Terminal width must be measured, not assumed**
Use `process.stdout.columns || 80` for layout math. Hardcoded `80` causes suffix clipping and stray characters on narrower terminals. When the elapsed-time suffix won't fit, omit it entirely.

**charWidth must respect Windows Terminal wide overrides**
`charWidth()` in `symbol.ts` has three tiers: (1) standard CJK/fullwidth -> width 2, (2) `Emoji_Presentation=Yes` characters -> width 2, (3) 17 Windows Terminal wide overrides (e.g. info, star, suits, flags, gear, warning, check, x-mark, arrows, play, stopwatch) -> width 2. Characters with text presentation (checkmark, scissors, copyright, registered) remain width 1. Getting this wrong causes "tracer" ghost characters from the continuation cell.

## Mouse & Hover

**ChatView delegates mouse-move to the docked bar**
When a `dockedBar` is visible, ChatView forwards `handleMouseMove` / `handleMouseLeave` to it so docked widgets (ThreadBar) can track their own hover state. Pattern: docked widget stores `_hoveredKey`, invalidates on hover change, renders hovered interactive elements in the `hover` (accent) style. Don't try to do hover highlighting from ChatView's side.

**Hover-underline overlay is non-destructive**
To underline a hovered range inside an item's content (URLs, file paths), cache the item's original `content.lines`, build an overlay where segments intersecting the hover range are split and given `{ underline: true }`, swap in the overlay, then restore on mouse leave. Helpers: `_linkTargetAt(x, y)` reuses the same regex + charOffset math as the click handler; `_applyUnderlineOverlay(lines, start, length)` walks segments and splits intersecting ones. Skip items with action entries -- the action hover subsystem owns their content mutation. Clear the link-hover state alongside `_hoveredItemId` in `setStore`, `clear`, `updateFeedLine`, `updateActionList`.

**File-path clicks must resolve to absolute paths**
Before passing a clicked file path to the OS opener (`start`/`open`/`xdg-open`), always `resolvePath(process.cwd(), ...)` to an absolute path. On Windows, Unix-style `/foo/bar` paths are drive-relative (resolve to `C:\foo\bar`) and usually don't exist; relative paths fail the same way. Windows drive-letter paths (`C:\foo`) pass through normalized. Strip leading slashes before joining with CWD.

**Mouse tracking is pure ANSI -- no Win32 SetConsoleMode**
Consolonia uses ANSI DECSET escape sequences only for mouse tracking. Do not call Win32 `SetConsoleMode()` via FFI. The Consolonia creator confirmed ANSI codes are more accurate. Node.js/libuv drops `MOUSE_EVENT` records from `ReadConsoleInputW`, making `ENABLE_MOUSE_INPUT` useless and potentially counterproductive.

**Six mouse protocols are supported**
Consolonia parses SGR (`ESC [ < ...`), classic xterm (`ESC [ M ...`), and URXVT (`ESC [ Cb;Cx;Cy M` without `<`). UTF-8 mode needs no separate parser (Node.js decodes automatically). SGR-Pixels uses the same wire format as SGR. Mouse enable requests all six DECSET modes: `?1000h`, `?1003h`, `?1005h`, `?1006h`, `?1015h`, `?1016h`. Terminals pick the highest they support.

**Terminal environment detection tailors init sequences**
`detectTerminal()` in `terminal-env.ts` probes `process.env` and `process.platform` to identify the terminal (Windows Terminal, VS Code, ConEmu, mintty, conhost, tmux, screen, iTerm2, Alacritty, etc.) and returns `TerminalCaps`. `initSequence()`/`restoreSequence()` compose escape strings based on detected caps. Full mouse modes when SGR is supported; minimal `?1000h + ?1003h` fallback otherwise.

## Activity Tracking

**Claude activity uses PostToolUse hooks + debug log parsing**
`ensurePostToolUseHook()` in `hook-installer.ts` installs a no-op hook (`node -e "" /* teammates-activity */`) into `.claude/settings.local.json`. The hook does nothing -- its presence triggers Claude Code to log `Hook PostToolUse:<Tool>` lines to `--debug-file`, which `parseClaudeActivity()` parses. Without hooks, Read/Grep/Glob have NO debug log signal and are invisible.

**Claude activity parser is multi-signal**
`parseClaudeActivity()` handles three signal types: (1) `HOOK_POSTTOOLUSE_RE` for hook-based tool events (primary), (2) `SUBAGENT_API_RE` for subagent API turns (`Agent (Explore, 12 turns)`), (3) hook-free fallbacks -- `SPAWNING_SHELL_RE` for Bash, file renames for Edit/Write. Dedup logic prevents double-counting when both hook and hook-free signals fire for the same event.

**Codex and Copilot activity come from JSONL debug logs**
Both agents write paired debug files under `.teammates/.tmp/debug/`. Codex uses `parseCodexJsonlLine()` to handle `command_execution`, `file_change`, and various `item.started/completed` shapes. Copilot uses `parseCopilotJsonlLine()` to map `tool.execution_start` events. All three agents' watchers tail their respective log files.

**Activity watchers must start from byte zero**
Each task's debug log file is unique. Start per-task file watchers from byte `0`, not from the current file size. Otherwise, early commands written before the watcher attaches are silently dropped.

**Codex activity is a multi-shape JSONL stream**
Parse `command_execution`, `file_change`, `exec_command_begin`, `patch_apply_begin`, `web_search_begin`, `mcp_tool_call_begin`, `item.started`, `item.completed`, `response.output_item.added/done`, `custom_tool_call`/`function_call`. Arguments may arrive as objects or stringified JSON. Unwrap PowerShell `-Command "..."` wrappers before classifying. De-dup start/completed pairs and flush the final buffered line on close.

**Codex activity must watch logFile, not debugFile**
Codex does not support `--debug-file`. The adapter creates and appends to `logFile` during execution. Gate Codex watcher startup on `logFile` existing, not `debugFile`. This is the #1 cause of "parser works but UI shows nothing."

**Copilot activity parses tool.execution_start events with expanded mappings**
`parseCopilotJsonlLine()` maps `tool.execution_start` events into standard activity labels. Mappings include: `view`->Read, `shell`/`bash`/`powershell`->Bash, `grep`/`search`->Grep, `glob`->Glob, `edit`/`write`/`create`->Edit/Write, `task`/`read_agent`/`write_agent`->Agent, `web_search`->WebSearch, `web_fetch`->WebFetch, `github-mcp-server-*` prefix->Search/Read. `COPILOT_PLUMBING` set filters internal tools. Uses event `timestamp` field for elapsed time.

**Collapse activity but preserve singles**
Group consecutive research runs of 2+ events into `Exploring (Nx Read, ...)`. Merge repeated edits to the same file. Filter out TodoWrite and ToolSearch. Never collapse errors. But preserve a single research event (`Read`, `Grep`) as a first-class line -- collapsing one event into `Exploring (1x Read)` hides useful evidence.

**Activity cleanup must be thorough**
When a task completes or is cancelled, hide all activity display lines and delete all bookkeeping state (buffers, indices, blank lines, shown flags). Stale indices from prior feed insertions are the #1 cause of leftover activity lines.

## Architecture

**cli.ts is decomposed into 12 focused modules**
Original 6815 lines -> 1986 lines (-71%). Modules: `status-tracker`, `handoff-manager`, `retro-manager`, `wordwheel`, `service-config`, `thread-manager`, `onboard-flow`, `activity-manager`, `startup-manager`, `commands`, `conversation`, `feed-renderer`. Each receives deps via typed interface with closure-backed getters for shared mutable state.

**Closure declarations must precede getter references in cli.ts**
Closures referenced via getters in object literals (e.g. `defaultFooterRightRef`, `userBgRef`) must be declared BEFORE the object literal that uses them. If any constructor triggered during object creation calls the getter, it hits the temporal dead zone (TDZ). Move closure declarations to the existing closure block before the constructor call.

**All three agents use the CLI proxy adapter pattern**
Claude, Codex, and Copilot are all `CliProxyAdapter` subclasses with agent-specific presets in `presets.ts`. The Copilot SDK was removed -- copilot uses stdin piping in interactive mode (no `-p` flag) to avoid Windows command-line length limits.

**Adapter presets live outside the base class**
Keep shared preset definitions in `presets.ts` and agent-specific adapters in their own files (`claude.ts`, `codex.ts`, `copilot.ts`). Putting presets inside `cli-proxy.ts` creates circular imports that can leave the base class undefined at extension time.

**Copilot requires stdin piping, not -p**
`copilot -p <text>` passes the prompt as a command-line argument, which exceeds Windows' ~32K char limit for large prompts. `copilot -p -` treats `-` as literal text, not stdin. Interactive mode (no `-p`) with stdin piping is the only working path. Use `stdinPrompt: true` on the preset.

**Codex has no -a (approval) flag**
`codex exec` only supports `-s` (sandbox), not `-a` (approval). Passing `-a never` causes "unexpected argument" errors. Use `-s danger-full-access` for non-interactive mode.

**Cancellation uses AbortSignal, not adapter killAgent**
`cli.ts` creates an `AbortController` per running task. The signal flows through `TaskAssignment` -> orchestrator -> adapter -> `spawnAndProxy()`. Adapters react to abort by killing the child process (SIGTERM -> 5s -> SIGKILL). `controller.abort()` is synchronous from the caller's perspective.

**Cross-folder write boundaries are two-layer**
Layer 1 is the prompt rule in `adapter.ts` for AI teammates. Layer 2 is a post-task audit with `[revert]` and `[allow]` actions. Relying on either layer alone is too weak.

**Handoffs are fenced blocks first**
Structured handoffs should be fenced `handoff` blocks. Natural-language detection is only an emergency fallback and should not be treated as a normal path. Parallel handoffs use multiple blocks in one response; sequential chains embed forwarding instructions in the first handoff's task description.

**Registry discovery skips special folders**
Inside `.teammates\`, bare names are teammates, `_` prefixes are shared checked-in folders, and `.` prefixes are local ephemeral folders. Discovery logic must ignore `_` and `.` entries when resolving teammates.

**Human avatars are not teammates**
When importing teammates from another project, skip folders where SOUL.md has `**Type:** human`. Never copy USER.md during import -- it is user-specific and gitignored.

**Debug logging is paired files per task**
Each adapter writes two files under `.teammates/.tmp/debug/`: `<teammate>-<timestamp>-prompt.md` (full prompt sent) and `<teammate>-<timestamp>.md` (activity/debug log). Non-Claude log files are pre-created at task start and appended incrementally during execution so the pair exists immediately. Claude's log file is passed as `--debug-file` so the agent writes directly.

**Persona templates are folder-based with alias as canonical name**
Bundled personas live under `packages/cli/personas/<alias>/` with `SOUL.md` and `WISDOM.md`. The loader only accepts folders whose directory name matches `alias:` in the frontmatter. The frontmatter parser must accept CRLF line endings for Windows compatibility.

**Teammate management uses /add, /remove, /update**
The monolithic `/init` was replaced with three focused commands. `/add` scaffolds from bundled personas with optional rename. `/remove` deletes agentic teammates (filters humans). `/update` overwrites SOUL.md and WISDOM.md from persona templates while preserving memory. All three accept optional name args and offer wordwheel completion.

**isSolo persists the skip-teammates choice**
`isSolo` in `.teammates/settings.json` records when the user chose solo mode during onboarding. Startup checks both `isSolo` and `hasAgenticTeammates` -- re-prompts only when neither is true. Cleared when `/add` successfully adds teammates.

## Build & Ship

**Clean dist before rebuilding**
Always remove `dist` before `npm run build`. Stale build artifacts hide compile problems and can make a broken source tree look healthy.

**Lint after every build**
Run Biome with auto-fix after the build, then rebuild if lint changed code. Build-clean-build is the required verification loop, not an optional polish step.

**Version bumps touch every reference**
When bumping package versions, update all package manifests, `.teammates/settings.json` (`cliVersion`), and grep for any other copies of the old version string. Partial bumps leave the workspace inconsistent.

**Workspace deps should stay wildcarded**
Use `"*"` for workspace package references. Pinned semver can resolve to registry builds or invalidate newer local workspace packages after a bump.

**ESM path resolution must be explicit**
Resolve sibling files with `fileURLToPath(new URL(..., import.meta.url))`, never `__dirname`. Path-sensitive startup code should fail loudly or log clearly; silent catches hide broken behavior too long. All packages are `"type": "module"` -- bare `require()` calls cause `ReferenceError` at runtime. ESM compliance tests enforce this across all three packages.

**Spawned stdin needs EOF protection**
Whenever the CLI writes to a child process stdin, attach an error handler that swallows `EPIPE` and `EOF`. Some agents close stdin early and that should not crash the parent.

**Normalize backslash paths for cross-platform compatibility**
When using `path.basename()` or similar path utilities on paths that may contain Windows backslashes, normalize `\` to `/` first. On Linux, `path.basename()` does not recognize `\` as a separator and returns the entire path string.

## Process

**Spec first for major UI shifts**
Write the UI spec before implementing changes that alter layout, action placement, or state ownership. Terminal UI work drifts fast without a written target.

**Verify before logging**
Do not record a fix until the file is actually written and verified. False "done" entries poison future debugging by sending the next pass after behavior that never shipped.

**Restart the CLI after rebuilds**
Node.js caches modules at startup. After rebuilding packages, the running CLI still uses old code until it is restarted.
