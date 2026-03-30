# Beacon - Wisdom

Distilled principles. Read this first every session (after SOUL.md).

Last compacted: 2026-03-30

---

## Prompt & Context

**Prompt structure drives compliance**
Put context first, the concrete task next, and hard rules last. Restate the user request near the bottom so the model ends on the actual ask, not on background instructions.

**Prompt stack order is IDENTITY → GOALS → WISDOM → TEAM → ...**
GOALS.md was added between SOUL.md and WISDOM.md in `buildTeammatePrompt()`. Every `TeammateConfig` must include a `goals` field (empty string if no file exists). Missing it causes `undefined.trim()` crashes.

**Budgets must be explicit**
Prompt context needs fixed budgets, not intuition. Daily logs, recall results, and conversation history should each have bounded allocations so one source cannot starve the rest.

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
`preDispatchCompress()` runs before every task dispatch — if conversation history exceeds the budget (96k tokens / 384k chars), it mechanically compresses the oldest entries into bullet summaries. Async agent summarization runs post-task for quality. Keep both paths; they serve different timing needs.

## Memory & Persistence

**Memory is three-tier**
WISDOM.md stores durable rules, typed memories store reusable decisions and feedback, and daily logs store chronology. Keep full YAML frontmatter in prompt context; the metadata is part of the memory.

**System tasks must not write memories**
Maintenance work like compaction, summarization, and wisdom distillation should not touch daily logs or typed memories. The prompt path must explicitly suppress memory-update instructions for system tasks.

**Migrations are markdown and commit last**
Keep upgrade instructions in `packages/cli/MIGRATIONS.md`, parse them by version heading, and persist the new version only after every migration succeeds. Interrupted upgrades should rerun cleanly on next startup. Resolve the file via `import.meta.url`, never `__dirname`.

**Wisdom distillation must be idempotent**
`buildWisdomPrompt()` checks `Last compacted: YYYY-MM-DD` in WISDOM.md. If today's date is already present, return `null` (skip). Without this guard, wisdom distillation fires on every startup, burning tokens for no reason.

## Feed & Rendering

**Feed state should be identity-based**
Inside `ChatView`, track feed items by stable IDs through `FeedStore`, not parallel index-keyed arrays. `FeedItem` carries `id`, `content`, `actions`, `hidden`. Height caching lives in `VirtualList`, not on `FeedItem`.

**Virtualized height caches need explicit invalidation**
`VirtualList` caches geometry by item ID, so any item whose rendered height can change must be invalidated deliberately. The banner (`__banner__`) is the canonical case — invalidate it every render during animation.

**Shift every related index in one place**
Any feed insertion that shifts thread ranges must also shift adjacent bookkeeping like activity-line indices and blank-line indices. The `shiftAllContainers` getter is the single coordination point — extend it, never duplicate the shift logic elsewhere.

**Rendered actions need unique IDs**
Every clickable action needs its own ID plus a side lookup for payload state. Reused IDs make later clicks act on the newest handler state instead of the rendered item.

**Progress belongs behind a tiny API**
Keep progress behind `startTask()`, `stopTask()`, and `showNotification()`. `StatusTracker` owns animation, truncation, and terminal-width budgeting; callers should not manage lifecycle details themselves. Never create custom spinners that duplicate StatusTracker's job.

**Terminal width must be measured, not assumed**
Use `process.stdout.columns || 80` for layout math. Hardcoded `80` causes suffix clipping and stray characters on narrower terminals. When the elapsed-time suffix won't fit, omit it entirely.

## Threads

**Thread container must exist before placeholders**
`renderThreadHeader()` creates the `ThreadContainer`. Always call it before `renderTaskPlaceholder()`. Reversing the order causes placeholders to silently not render because the container doesn't exist yet.

**Thread insertion must be non-destructive**
Use `peekInsertPoint()` to inspect where thread content should go and reserve `getInsertPoint()` for the actual write. Reading with the destructive path pushes content past the thread action line.

**Thread action ownership is fixed**
Thread-level verbs are only `[reply] [copy thread]`, and they live at the bottom of the thread container. Per-item verbs are `[show/hide] [copy]` on the subject line, never between subject and body.

**Thread-local content stays in the container**
Anything that belongs to a thread — including handoffs, activity blocks, and replies — must insert through the thread container context. Appending to the global feed breaks thread boundaries and verb placement.

**Container context pattern for scoped insertion**
When a subsystem (handoffs, activity) needs to insert lines within a thread, pass a container context interface (`insertLine()`/`insertActions()`) rather than always appending to the global feed. This keeps thread boundaries intact without coupling the subsystem to `ThreadContainer` internals.

## Activity Tracking

**Activity pipelines are adapter-specific**
Claude activity comes from its debug log (`--debug-file`). Codex and Copilot activity come from tailing their paired JSONL debug log files. All three agents write paired debug files under `.teammates/.tmp/debug/`. The PostToolUse hook system was removed — it never worked because Claude doesn't propagate custom env vars to hook subprocesses.

**Activity watchers must start from byte zero**
Each task's debug log file is unique. Start per-task file watchers from byte `0`, not from the current file size. Otherwise, early commands written before the watcher attaches are silently dropped.

**Codex activity is a multi-shape JSONL stream**
Parse `command_execution`, `file_change`, `exec_command_begin`, `patch_apply_begin`, `web_search_begin`, `mcp_tool_call_begin`, `item.started`, `item.completed`, `response.output_item.added/done`, `custom_tool_call`/`function_call`. Arguments may arrive as objects or stringified JSON. Unwrap PowerShell `-Command "..."` wrappers before classifying. De-dup start/completed pairs and flush the final buffered line on close.

**Codex activity must watch logFile, not debugFile**
Codex does not support `--debug-file`. The adapter creates and appends to `logFile` during execution. Gate Codex watcher startup on `logFile` existing, not `debugFile`. This is the #1 cause of "parser works but UI shows nothing."

**Copilot activity uses tool.execution_start events**
`parseCopilotJsonlLine()` maps `tool.execution_start` events (`view`, `shell`, `grep`, `glob`, `edit`, `write`) into standard activity labels. Copilot tails its paired debug log file, same as Codex.

**Collapse activity but preserve singles**
Group consecutive research runs of 2+ events into `Exploring (N× Read, ...)`. Merge repeated edits to the same file. Filter out TodoWrite and ToolSearch. Never collapse errors. But preserve a single research event (`Read`, `Grep`) as a first-class line — collapsing one event into `Exploring (1× Read)` hides useful evidence.

**Activity cleanup must be thorough**
When a task completes or is cancelled, hide all activity display lines and delete all bookkeeping state (buffers, indices, blank lines, shown flags). Stale indices from prior feed insertions are the #1 cause of leftover activity lines.

## Architecture

**cli.ts is decomposed into 12 focused modules**
Original 6815 lines → 1986 lines (-71%). Modules: `status-tracker`, `handoff-manager`, `retro-manager`, `wordwheel`, `service-config`, `thread-manager`, `onboard-flow`, `activity-manager`, `startup-manager`, `commands`, `conversation`, `feed-renderer`. Each receives deps via typed interface with closure-backed getters for shared mutable state.

**All three agents use the CLI proxy adapter pattern**
Claude, Codex, and Copilot are all `CliProxyAdapter` subclasses with agent-specific presets in `presets.ts`. The Copilot SDK was removed — copilot uses stdin piping in interactive mode (no `-p` flag) to avoid Windows command-line length limits.

**Adapter presets live outside the base class**
Keep shared preset definitions in `presets.ts` and agent-specific adapters in their own files (`claude.ts`, `codex.ts`, `copilot.ts`). Putting presets inside `cli-proxy.ts` creates circular imports that can leave the base class undefined at extension time.

**Copilot requires stdin piping, not -p**
`copilot -p <text>` passes the prompt as a command-line argument, which exceeds Windows' ~32K char limit for large prompts. `copilot -p -` treats `-` as literal text, not stdin. Interactive mode (no `-p`) with stdin piping is the only working path. Use `stdinPrompt: true` on the preset.

**Codex has no -a (approval) flag**
`codex exec` only supports `-s` (sandbox), not `-a` (approval). Passing `-a never` causes "unexpected argument" errors. Use `-s danger-full-access` for non-interactive mode.

**Cancellation uses AbortSignal, not adapter killAgent**
`cli.ts` creates an `AbortController` per running task. The signal flows through `TaskAssignment` → orchestrator → adapter → `spawnAndProxy()`. Adapters react to abort by killing the child process (SIGTERM → 5s → SIGKILL). `controller.abort()` is synchronous from the caller's perspective.

**Cross-folder write boundaries are two-layer**
Layer 1 is the prompt rule in `adapter.ts` for AI teammates. Layer 2 is a post-task audit with `[revert]` and `[allow]` actions. Relying on either layer alone is too weak.

**Handoffs are fenced blocks first**
Structured handoffs should be fenced `handoff` blocks. Natural-language detection is only an emergency fallback and should not be treated as a normal path.

**Registry discovery skips special folders**
Inside `.teammates\`, bare names are teammates, `_` prefixes are shared checked-in folders, and `.` prefixes are local ephemeral folders. Discovery logic must ignore `_` and `.` entries when resolving teammates.

**Human avatars are not teammates**
When importing teammates from another project, skip folders where SOUL.md has `**Type:** human`. Never copy USER.md during import — it is user-specific and gitignored.

**Debug logging is paired files per task**
Each adapter writes two files under `.teammates/.tmp/debug/`: `<teammate>-<timestamp>-prompt.md` (full prompt sent) and `<teammate>-<timestamp>.md` (activity/debug log). Non-Claude log files are pre-created at task start and appended incrementally during execution so the pair exists immediately. Claude's log file is passed as `--debug-file` so the agent writes directly.

**Persona templates are folder-based with alias as canonical name**
Bundled personas live under `packages/cli/personas/<alias>/` with `SOUL.md` and `WISDOM.md`. The loader only accepts folders whose directory name matches `alias:` in the frontmatter. The frontmatter parser must accept CRLF line endings for Windows compatibility.

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
Resolve sibling files with `fileURLToPath(new URL(..., import.meta.url))`, never `__dirname`. Path-sensitive startup code should fail loudly or log clearly; silent catches hide broken behavior too long.

**Spawned stdin needs EOF protection**
Whenever the CLI writes to a child process stdin, attach an error handler that swallows `EPIPE` and `EOF`. Some agents close stdin early and that should not crash the parent.

## Process

**Spec first for major UI shifts**
Write the UI spec before implementing changes that alter layout, action placement, or state ownership. Terminal UI work drifts fast without a written target.

**Verify before logging**
Do not record a fix until the file is actually written and verified. False "done" entries poison future debugging by sending the next pass after behavior that never shipped.

**Restart the CLI after rebuilds**
Node.js caches modules at startup. After rebuilding packages, the running CLI still uses old code until it is restarted.
