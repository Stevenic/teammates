# Beacon — Wisdom

Distilled principles. Read this first every session (after SOUL.md).

Last compacted: 2026-03-27

---

### Codebase map — three packages
CLI has 24 source files (~6,000 lines in cli.ts); consolonia has 51 files; recall has 13 files. The big files are `cli.ts` (~6,000 lines), `chat-view.ts` (~1,520 lines), `markdown.ts` (~970 lines), and `cli-proxy.ts` (~810 lines). Key extracted modules: `adapter.ts` (~560), `compact.ts` (~800), `banner.ts` (~410), `log-parser.ts` (~290), `cli-utils.ts` (~195), `cli-args.ts` (~155), `personas.ts` (~140). When debugging, start with cli.ts and cli-proxy.ts.

### Three-tier memory system
WISDOM.md (distilled, read-only except during compaction), typed memory files (`memory/<type>_<topic>.md`), and daily logs (`memory/YYYY-MM-DD.md`). The CLI reads WISDOM.md, the indexer indexes WISDOM.md + memory/*.md, and the prompt tells teammates to write typed memories.

### Memory frontmatter convention
All memory files include YAML frontmatter with `version: 0.6.0` as the first field. Daily logs add `type: daily`, typed memories add their type. Metadata fields pass through to the model intact — no stripping. Compression prompts and adapter instructions both enforce this convention.

### Context window budget model
Target context window is 128k tokens. Fixed sections always included (identity, wisdom, today's log, roster, protocol, USER.md). Daily logs (days 2-7) get 12k token pool. Recall gets min 8k + unused daily budget, with 4k overflow grace. Conversation history budget is derived dynamically: `(TARGET_CONTEXT_TOKENS - PROMPT_OVERHEAD_TOKENS) * CHARS_PER_TOKEN`. Weekly summaries excluded (recall indexes them). USER.md placed just before the task.

### Prompt section ordering — instructions at the end
Context/reference material (identity, wisdom, logs, recall, roster, services, handoff, date/time, user profile) stays at the top. Task sits in the middle. Instructions (output protocol, session state, memory updates, reminder) go at the end — leverages recency effect for agent attention.

### Attention dilution defenses
Five fixes to prevent agents from spending all tool calls on housekeeping instead of the task: (1) Dedup recall against daily logs already in the prompt. (2) Daily log budget halved (24K→12K) — past logs are reference, not active context. (3) Echo user's request at bottom of instructions (<500 chars verbatim, else pointer). (4) Task-first priority statement at top of instructions. (5) Conversation context always inlined in the prompt (file offload removed — pre-dispatch compression keeps it within budget).

### Two-stage conversation compression
**Pre-dispatch (mechanical):** `preDispatchCompress()` runs before every task dispatch — if history exceeds budget, oldest entries are mechanically compressed into bullet summaries via `compressConversationEntries()`. **Post-task (quality):** `maybeQueueSummarization` still runs async for better summaries. The running summary is invisible to the user. Reset on `/clear`.

### Conversation history stores full bodies
`storeResult()` stores the full cleaned `rawOutput` (protocol artifacts stripped), not just `result.summary`. `buildConversationContext()` formats multi-line entries with body on the next line. When history exceeds token budget, pre-dispatch compression fires before the next task.

### @everyone concurrent dispatch — snapshot isolation
`queueTask()` freezes `conversationHistory` + `conversationSummary` into a `contextSnapshot` once before pushing all @everyone entries (each gets a shallow copy). `drainAgentQueue()` skips `preDispatchCompress()` when an entry has a snapshot and passes it directly to `buildConversationContext()`. Per-agent temp files (`conversation-<teammate>.md`) eliminated by removing file offload entirely — context is always inlined. This prevents race conditions where the first drain loop mutates shared state before concurrent drains read it.

### User avatar system (Campfire Phase 1)
Users are represented as avatar teammates with `**Type:** human` in SOUL.md. The adapter is hidden — not registered when user has an alias. `selfName` (user alias) is the display identity everywhere; `adapterName` is for internal execution only. `@everyone` excludes both avatar and adapter. Display surfaces (roster, picker, status, errors) show `adapterName` while `selfName` is used for sender label, conversation history, internal routing, and memory folder.

### Onboarding happens pre-TUI
User setup (GitHub or manual) runs before the TUI is created via `console.log` + `askInput`/`askChoice`. No mouse tracking issues. Team onboarding only runs if `.teammates/` was missing. `askInline()` is used for in-TUI prompts (e.g., `/configure`) to avoid stdin conflicts with consolonia. Persona templates (`packages/cli/personas/`) provide scaffolding — `/init pick` for in-TUI selection.

### Assignment works via @mention, not /assign
No `/assign` slash command. Assignment goes through `queueTask()`. Multi-mention dispatches to all mentioned teammates. Paste @mentions are pre-resolved from raw input before placeholder expansion to prevent routing on pasted content.

### Default routing follows last responder
Un-mentioned messages route to `lastResult.teammate` first, then `orchestrator.route()`, then `selfName`. Explicit `@mentions` always override.

### Route threshold prevents weak matches
`Orchestrator.route()` requires a minimum score of 2 (at least one primary keyword match). Single secondary keyword matches (score 1) fall through.

### Recall two-pass architecture
**Pass 1 (pre-task, no LLM):** `buildQueryVariations()` generates 1-3 queries from task + conversation context. `matchMemoryCatalog()` does frontmatter text matching. `multiSearch()` fuses results with dedup by URI. **Pass 2 (mid-task):** Every teammate prompt includes a recall tool section documenting `teammates-recall search` CLI usage for agent-driven iterative queries.

### Empty response defense — three layers
1. **Two-phase prompt** — Output protocol before session/memory instructions; agents write text first, then do housekeeping. 2. **Raw retry** — If `rawOutput` is empty and `success` is true, fire retry with `raw: true` (no prompt wrapping). Second retry with minimal "just say Done" prompt. 3. **Synthetic fallback** — `displayTaskResult` generates body from `changedFiles` + `summary` metadata when text is still empty.

### Handoff format requires fenced code blocks
Agents must use ` ```handoff\n@name\ntask\n``` ` format. Natural-language handoff fallback (`findNaturalLanguageHandoffs()`) catches "hand off to @name" patterns as a safety net, but only fires when zero fenced blocks are found.

### Recall is bundled infrastructure
`@teammates/recall` is a direct dependency of `@teammates/cli`. Pre-task recall queries use `skipSync: true` for speed. Sync runs after every task completion and on startup. No watch process needed.

### Banner is segmented — left footer + right footer
Left: product name + version + adapter name + project directory path (smart-truncated via `truncatePath()`). Right: `? /help` by default, temporarily replaced by ESC/Ctrl+C hints. Services show presence-colored dots (green/yellow/red). `updateServices()` refreshes the banner live after `/configure`.

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

### Progress bar — 80-char target with elapsed time
Active user tasks display as `<spinner> <teammate>... <task text> (2m 5s)`. Format targets 80 chars total — task text is dynamically truncated to fit. `formatElapsed()` escalates: `(5s)` → `(2m 5s)` → `(1h 2m 5s)`. Multiple concurrent tasks show cycling tag: `(1/3 - 2m 5s)`. Both ChatView and fallback PromptInput paths share the same format.

### Filter by task, not by agent
When suppressing events for background/system tasks, filter at the task level (via flags on `TaskAssignment`/`TaskResult`), never at the agent level. Agent-level suppression (`silentAgents`) blocks ALL events for that agent — including concurrent user tasks. The `system` flag on events is the correct pattern. `silentAgents` is only used for the short-lived defensive retry window.

### Cross-folder write boundary enforcement
AI teammates must not write to another teammate's folder. Two layers: (1) prompt rule in `adapter.ts` — `### Folder Boundaries (ENFORCED)` section injected for `type: "ai"` only, (2) post-task audit via `auditCrossFolderWrites()` in `cli.ts` — scans `changedFiles` for paths inside `.teammates/<other>/`, shows `[revert]`/`[allow]` actions. Allowed: own folder, `_` prefix (shared), `.` prefix (ephemeral), root-level `.teammates/` files.

### Interrupt-and-resume — deferred promise pattern
`/interrupt [teammate] [message]` kills a running agent and resumes with context. `spawnAndProxy` uses a deferred promise — `done` is shared between `executeTask` (normal await) and `killAgent` (SIGTERM → 5s → SIGKILL, then await `done`). `activeProcesses` map tracks `{ child, done, debugFile }` per teammate. Resume prompt wraps the parsed conversation log in `<RESUME_CONTEXT>` and goes through normal `buildTeammatePrompt` wrapping. The `killAgent?()` method is optional on `AgentAdapter`.

### Log parser extracts structure, not content
`log-parser.ts` parses Claude debug logs, Codex JSONL, and raw agent output into a timeline of actions (Read, Write, Search, etc.). `formatLogTimeline()` groups 4+ consecutive same-action entries to collapse bulk operations. `buildConversationLog()` orchestrates parsing with token budget truncation. Extracts file paths and search queries, NOT full file contents — keeps resume prompts compact.

### /script command — user-defined reusable scripts
Scripts stored under the user's twin folder (`.teammates/<selfName>/scripts/`). Three modes: `/script list`, `/script run <name>`, `/script <description>` (create + run new). The coding agent always handles `/script` tasks — routes to `selfName`.

### Clean dist before rebuild
After modifying any TypeScript source, run `rm -rf dist && npm run build` in the package. Stale artifacts in dist/ can mask compile errors. Running CLI must be restarted after rebuilds — Node.js caches modules at startup.

### Lint after every build
After every build, run `npx biome check --write --unsafe` on changed files. If fixes are applied, rebuild to verify they compile cleanly. This is mandatory — lint errors should never be left behind.

### Folder naming convention in .teammates/
No prefix = teammate folder (contains SOUL.md). `_` prefix = shared non-teammate folder, checked in. `.` prefix = local/ephemeral, gitignored. Registry skips `_` and `.` prefixed dirs when scanning for teammates.

### Wordwheel commands without args execute on Enter
No-arg commands (/exit, /status, /help) execute immediately when selected from the wordwheel dropdown. Enter key handler accepts the highlighted item before readline processes it.

### Emoji spacing convention
All ✔/✖/⚠ emojis get double-space after them for consistent rendering across terminals. Applied globally in cli.ts.

### Persona template system
15 persona templates in `packages/cli/personas/` with YAML frontmatter (persona, alias, tier, description) and SOUL.md body with `<Name>` placeholders. `loadPersonas()` reads and sorts by tier. `scaffoldFromPersona()` creates teammate folder. Tier 1 = Core (SWE, PM, QA, DevOps), Tier 2 = Specialized. Wired into both pre-TUI onboarding and `/init pick`.

### Action buttons need unique IDs
Feed action buttons (e.g., `[copy]`, `[revert]`, `[allow]`) must have unique IDs tied to their context. Static IDs cause all buttons to share a single handler — clicking any button executes against the most recent context. Pattern: `<action>-<teammate>-<timestamp>` with a `Map` storing per-ID context. Handler looks up by ID, falls back to latest.

### Extracted pure functions live in cli-utils.ts
Testable pure functions extracted from cli.ts: `relativeTime`, `wrapLine`, `findAtMention`, `isImagePath`, `cleanResponseBody`, `formatConversationEntry`, `buildConversationContext`, `findSummarizationSplit`, `buildSummarizationPrompt`, `preDispatchCompress`, `compressConversationEntries`. New extractions should follow this pattern — pure logic in cli-utils.ts, wired into cli.ts via imports.
