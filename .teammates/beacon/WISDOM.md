# Beacon — Wisdom

Distilled principles. Read this first every session (after SOUL.md).

Last compacted: 2026-03-17

---

### Codebase map — three packages, ~28k LOC
CLI has 26 source files (~11,800 lines); consolonia has 43 files (~14,800 lines); recall has 5 files (~1,500 lines). The big files are `cli.ts` (~4,800 lines), `chat-view.ts` (~1,400 lines), `markdown.ts` (~970 lines), and `cli-proxy.ts` (~690 lines). When debugging, start with cli.ts and cli-proxy.ts.

### Three-tier memory system
The framework uses WISDOM.md (distilled, read-only except during compaction), typed memory files (`memory/<type>_<topic>.md`), and daily logs (`memory/YYYY-MM-DD.md`). MEMORIES.md no longer exists. The CLI reads WISDOM.md, the indexer indexes WISDOM.md + memory/*.md, and the prompt tells teammates to write typed memories.

### Wordwheel commands without args execute on Enter
No-arg commands (/exit, /status, /help) execute immediately when selected from the wordwheel dropdown. Enter key handler accepts the highlighted item before readline processes it.

### Assignment works via @mention, not /assign
There's no `/assign` slash command. Assignment goes through the `@mention` dispatch path in `queueTask()`. Multi-mention dispatches to all mentioned teammates.

### Route threshold prevents weak matches
`Orchestrator.route()` requires a minimum score of 2 (at least one primary keyword match). Single secondary keyword matches (score 1) fall through to the base coding agent.

### Clean dist before rebuild
After modifying any TypeScript source, run `rm -rf dist && npm run build` in the package. Stale artifacts in dist/ can mask compile errors.

### Folder naming convention in .teammates/
No prefix = teammate folder (contains SOUL.md). `_` prefix = shared non-teammate folder, checked in. `.` prefix = local/ephemeral, gitignored. Registry skips `_` and `.` prefixed dirs when scanning for teammates.

### Debug logging lives in .tmp/debug/
Every task writes a structured debug log to `.teammates/.tmp/debug/<teammate>-<timestamp>.md`. Claude adapter also generates `--debug-file` agent logs in the same directory. Files >24h are cleaned on startup. `/debug` reads the last log and queues analysis to the coding agent.

### Default routing follows last responder
Un-mentioned messages route to `lastResult.teammate` first, then `orchestrator.route()`, then the base coding agent. Explicit `@mentions` always override.
