---
name: Beacon Goals — March 2026
description: Current goals and priorities for @teammates/recall, @teammates/cli, and @teammates/consolonia
type: project
---

# Beacon Goals

Updated: 2026-03-15

## Current State Summary

| Package | Files | LOC | Test Suites | Tests |
|---------|-------|-----|-------------|-------|
| @teammates/cli | 29 | 8,118 | 10 | 153 |
| @teammates/consolonia | 50 | ~8,200 | 9 | 561 |
| @teammates/recall | 5 | 812 | 3 | 47 |

All three packages compile cleanly with strict TypeScript. Zero TODO/FIXME/HACK markers across the entire codebase.

---

## @teammates/cli — Goals

### ~~P0 — Test coverage for cli.ts~~ DONE
Extracted pure functions to `cli-utils.ts` (relativeTime, wrapLine, findAtMention, isImagePath). 33 tests in `cli-utils.test.ts`.

### ~~P0 — Test coverage for compact.ts~~ DONE
14 tests covering compactDailies, compactWeeklies, compactEpisodic.

### ~~P1 — Test coverage for console/ utilities~~ DONE
4 test suites (49 tests): ansi.test.ts (15), file-drop.test.ts (21), markdown-table.test.ts (7), startup.test.ts (6).

### ~~P1 — Configurable routing~~ DONE
Added `### Routing` section parsing in SOUL.md. Teammates declare explicit routing keywords that get primary weight (2pts) in `route()`. Registry parses `routingKeywords` from SOUL.md; orchestrator scores them before ownership patterns. 4 new tests.

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

### ~~P0 — Add test suite~~ DONE
3 test suites, 47 tests: indexer.test.ts (18), search.test.ts (6), cli.test.ts (23).

### ~~P1 — Search CLI flags~~ DONE
Added --max-chunks, --max-tokens, --recency-depth, --typed-memory-boost flags. All pass through to search API.

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

### ~~Linting & formatting~~ DONE
Biome configured at repo root. 0 errors, 18 warnings. `npm run lint` and `npm run lint:fix` scripts.

### Integration tests
No end-to-end tests that exercise the full pipeline: CLI → orchestrator → adapter → agent → result parsing → handoff. Would catch regressions in the interaction between packages.
