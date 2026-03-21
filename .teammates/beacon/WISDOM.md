# Beacon — Wisdom

Distilled principles. Read this first every session (after SOUL.md).

Last compacted: 2026-03-20

---

### Codebase map — three packages, ~30k LOC
CLI has 38 source files (~12,700 lines); consolonia has 51 files (~15,500 lines); recall has 8 files (~1,500 lines). The big files are `cli.ts` (~4,700 lines), `chat-view.ts` (~1,500 lines), `markdown.ts` (~970 lines), and `cli-proxy.ts` (~700 lines). Key extracted modules: `banner.ts` (~390), `adapter.ts` (~345), `cli-args.ts` (~155). When debugging, start with cli.ts and cli-proxy.ts.

### Three-tier memory system
WISDOM.md (distilled, read-only except during compaction), typed memory files (`memory/<type>_<topic>.md`), and daily logs (`memory/YYYY-MM-DD.md`). The CLI reads WISDOM.md, the indexer indexes WISDOM.md + memory/*.md, and the prompt tells teammates to write typed memories.

### Context window budget model
Fixed sections always included (identity, wisdom, today's log, roster, protocol, USER.md). Daily logs (days 2-7) get 24k token pool. Recall gets min 8k + unused daily budget, with 4k overflow grace. Conversation history gets 24k tokens of recent entries + an agent-maintained running summary of older history. Weekly summaries excluded (recall indexes them). USER.md placed just before the task.

### Conversation auto-summarization
When conversation history exceeds 24k tokens, oldest entries are spliced out and queued as a `"summarize"` task to the coding agent. The running summary is invisible to the user. Reset on `/clear`.

### User avatar system (Campfire Phase 1)
Users are represented as avatar teammates with `**Type:** human` in SOUL.md. The adapter is hidden — not registered when user has an alias. `selfName` (user alias) is the display identity everywhere; `adapterName` is for internal execution only. `@everyone` excludes both avatar and adapter.

### Onboarding happens pre-TUI
User setup (GitHub or manual) runs before the TUI is created via `console.log` + `askInput`/`askChoice`. No mouse tracking issues. Team onboarding only runs if `.teammates/` was missing. `askInline()` is used for in-TUI prompts (e.g., `/configure`) to avoid stdin conflicts with consolonia.

### Assignment works via @mention, not /assign
No `/assign` slash command. Assignment goes through `queueTask()`. Multi-mention dispatches to all mentioned teammates. Paste @mentions are pre-resolved from raw input before placeholder expansion to prevent routing on pasted content.

### Default routing follows last responder
Un-mentioned messages route to `lastResult.teammate` first, then `orchestrator.route()`, then `selfName`. Explicit `@mentions` always override.

### Route threshold prevents weak matches
`Orchestrator.route()` requires a minimum score of 2 (at least one primary keyword match). Single secondary keyword matches (score 1) fall through.

### Recall is bundled infrastructure
`@teammates/recall` is a direct dependency of `@teammates/cli`. Pre-task recall queries use `skipSync: true` for speed. Sync runs after every task completion and on startup. No watch process needed.

### Banner is segmented — left footer + right footer
Left: product name + version + adapter name. Right: `? /help` by default, temporarily replaced by ESC/Ctrl+C hints. Services show presence-colored dots (green/yellow/red). `updateServices()` refreshes the banner live after `/configure`.

### Debug logging lives in .tmp/debug/
Every task writes a structured debug log to `.teammates/.tmp/debug/<teammate>-<timestamp>.md`. Claude adapter generates `--debug-file` agent logs in the same directory. Files >24h are cleaned on startup. `/debug` reads the last log and queues analysis to the coding agent.

### Clean dist before rebuild
After modifying any TypeScript source, run `rm -rf dist && npm run build` in the package. Stale artifacts in dist/ can mask compile errors.

### Folder naming convention in .teammates/
No prefix = teammate folder (contains SOUL.md). `_` prefix = shared non-teammate folder, checked in. `.` prefix = local/ephemeral, gitignored. Registry skips `_` and `.` prefixed dirs when scanning for teammates.

### Wordwheel commands without args execute on Enter
No-arg commands (/exit, /status, /help) execute immediately when selected from the wordwheel dropdown. Enter key handler accepts the highlighted item before readline processes it.

### Emoji spacing convention
All ✔/✖/⚠ emojis get double-space after them for consistent rendering across terminals. Applied globally in cli.ts.
