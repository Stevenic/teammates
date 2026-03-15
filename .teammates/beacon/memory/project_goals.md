---
name: Beacon Goals — March 2026
description: Current goals and priorities for @teammates/recall, @teammates/cli, and @teammates/consolonia
type: project
---

# Beacon Goals

Updated: 2026-03-15

## Current State Summary

| Package | Files | LOC | Tests | Test LOC |
|---------|-------|-----|-------|----------|
| @teammates/cli | 29 | 8,118 | 4 suites (~35 cases) | ~800 |
| @teammates/consolonia | 50 | ~8,200 | 9 suites (~1,122 cases) | ~6,700 |
| @teammates/recall | 5 | 812 | 0 | 0 |

All three packages compile cleanly with strict TypeScript. Zero TODO/FIXME/HACK markers across the entire codebase.

---

## @teammates/cli — Goals

### P0 — Test coverage for cli.ts
`cli.ts` is 3,156 lines of interactive CLI logic with zero tests. It's the largest untested surface in the monorepo. Need integration-style tests for slash command dispatch, event handling, queue management, and handoff rendering.

### P0 — Test coverage for compact.ts
`compact.ts` (309 lines) has no tests. Episodic compaction is critical to the memory system — weekly/monthly rollups must be correct.

### P1 — Test coverage for console/ utilities
12 console files (~2,000 lines) are untested: prompt-input, paste-handler, wordwheel, dropdown, markdown-table, file-drop, startup. These are complex interactive components.

### P1 — Configurable routing threshold
Routing threshold is hard-coded at 2 points (orchestrator.ts). Should be configurable per-project or per-teammate for tuning routing aggressiveness.

### P2 — Session persistence across restarts
Session files are created but lost on CLI restart. Investigate restoring session context (conversation history, last results) from the session file on startup.

### P2 — Improve output parsing resilience
`cli-proxy.ts` file detection regex only catches `diff --git` and a few verb patterns. Agent-specific parsers or a more flexible pattern set would reduce missed file detections.

### P2 — Theme persistence
Theme is a mutable singleton that resets on restart. Should persist to `services.json` or a dedicated config file.

### P3 — Daily log loading limits
Registry loads all daily logs without size limits. A teammate with 100+ logs could bloat the prompt. Cap at 7 (already done in adapter.ts) but also cap in registry discovery.

---

## @teammates/recall — Goals

### P0 — Add test suite
Zero test coverage. This is the highest priority for recall. Need tests for:
- Indexer: teammate discovery, file collection, incremental sync, daily log skipping
- Search: multi-pass retrieval, typed memory boost, dedup, auto-sync
- Embeddings: model loading, dimension validation
- CLI: command parsing, JSON output mode, watch debounce

### P1 — Search CLI flags
No CLI flags for recency depth, typed memory boost factor, or max tokens. These are configurable in the API but not exposed to users.

### P2 — Index health check
No way to verify index integrity or detect corruption. A `teammates-recall check` command would help.

### P2 — Progress reporting
CLI commands print nothing during long operations. Add spinners or progress indicators for full index rebuilds.

### P3 — Batch search API
No way to search multiple queries without repeated sync checks. Would improve performance for multi-query workflows.

---

## @teammates/consolonia — Goals

### P1 — Hit-testing framework
Each widget reimplements mouse handling independently. A standardized hit-testing system would reduce duplication and bugs in mouse-interactive widgets.

### P1 — Virtual scrolling for ChatView
ChatView stores all feed items in memory. With 10k+ items, performance will degrade. Windowed rendering would cap memory usage.

### P2 — Flex grow/shrink in Row/Column
Layout engine lacks CSS-like flex factors. Currently all children get equal space or fixed sizes. Proportional sizing would enable more sophisticated layouts.

### P2 — Undo/redo for TextInput
No undo stack in TextInput. Common expectation for text editing widgets.

### P3 — Clipboard write support
TextInput handles paste but has no copy/cut. Would need platform-specific clipboard access.

### P3 — Additional syntax highlighters
Only JS/TS, Python, and C# are built in. Adding Go, Rust, and shell would cover most teammate output.

---

## Cross-cutting Goals

### Linting & formatting
No linter or formatter configured in any package. Adding biome or eslint+prettier would enforce consistency, especially as the codebase grows.

### Integration tests
No end-to-end tests that exercise the full pipeline: CLI → orchestrator → adapter → agent → result parsing → handoff. Would catch regressions in the interaction between packages.
