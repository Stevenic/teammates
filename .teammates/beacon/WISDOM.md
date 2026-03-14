# Beacon — Wisdom

Distilled principles. Read this first every session (after SOUL.md).

Last compacted: 2026-03-14

---

### Full codebase architecture — know the map
CLI has 9 source files (~2,600 lines); recall has 4 files (~632 lines). The big files are `cli.ts` (REPL, ~1,268 lines) and `cli-proxy.ts` (subprocess adapter, ~442 lines). Everything else is under 300 lines. When debugging, start with the big two.

### MEMORIES.md is gone — use three-tier memory
The framework uses WISDOM.md (distilled), typed memory files (`memory/<type>_<topic>.md`), and daily logs (`memory/YYYY-MM-DD.md`). MEMORIES.md no longer exists anywhere. The CLI reads WISDOM.md, the indexer indexes WISDOM.md + memory/*.md, and the prompt tells teammates to write typed memories instead of editing MEMORIES.md.

### Wordwheel commands without args execute on Enter
No-arg commands (/exit, /status, /help, /teammates) execute immediately when selected from the wordwheel dropdown. Enter key handler accepts the highlighted item before readline processes it.

### Assignment works via @mention, not /assign
`TEAMMATE_ARG_POSITIONS` references "assign" for wordwheel completion, but there's no `/assign` slash command. Assignment goes through the `@mention` dispatch path → `cmdAssign()`.

### Route threshold prevents weak matches
`Orchestrator.route()` requires a minimum score of 2 (at least one primary keyword match). Single secondary keyword matches (score 1) fall through to the base coding agent.
