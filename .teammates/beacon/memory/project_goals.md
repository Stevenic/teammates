---
name: Beacon Goals — March 2026
description: Current goals and priorities for @teammates/recall, @teammates/cli, and @teammates/consolonia
type: project
---

# Beacon Goals

Updated: 2026-03-15

## Current State Summary (updated 2026-03-15 evening)

| Package | Source Files | LOC (src) | Test Suites | Tests | Untested LOC |
|---------|-------------|-----------|-------------|-------|-------------|
| @teammates/cli | 25 | ~8,200 | 10 | 155 | ~2,900 (73%) |
| @teammates/consolonia | 50 | ~8,200 | 9 | 561 | ~3,500 (4 big widgets) |
| @teammates/recall | 5 | 812 | 3 | 47 | ~460 |

All three packages compile cleanly with strict TypeScript. Zero TODO/FIXME/HACK markers across the entire codebase. cli.ts is 3,963 lines — still the largest file in the repo.

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

## New Goals (2026-03-15)

### N1 — Decompose cli.ts (3,963 lines) ⭐
The single largest file in the monorepo. Extract `handleEvent()` switch arms, `AnimatedBanner`, retro/handoff approval UI, and `/debug`/`/log`/`/status` renderers into focused modules. Unlocks testability for the ~73% of CLI source that's currently untested. **Impact: high. Effort: large.**

### N2 — Error observability — replace 6 silent catches ⭐
6 `.catch(() => {})` patterns in cli.ts silently swallow failures. Two are on critical paths (startup maintenance line ~2120, adapter calls line ~3326). Add structured logging so background failures are debuggable. **Impact: high. Effort: small.**

### N3 — cli-proxy.ts test suite (603 lines, zero tests) ⭐
The subprocess adapter that spawns agents — handles process streaming, temp file I/O, output capture, handoff block parsing. No tests at all. Mock `child_process.spawn` and test the output parser, timeout handling, and handoff extraction. **Impact: high. Effort: medium.**

### N4 — prompt-input.ts test suite (719 lines, zero tests)
Consolonia-based readline replacement handling raw input, paste events, history, multi-row wrapping. Complex behavior, no tests. **Impact: medium. Effort: medium.**

### N5 — onboard.ts test suite (215 lines, zero tests)
Template copying, directory creation, agent prompt generation. Testable pure functions. **Impact: medium. Effort: small.**

### N6 — End-to-end integration tests
No cross-package tests exercising CLI → orchestrator → adapter → agent → result parsing → handoff. Would catch interaction regressions. **Impact: high. Effort: medium.**

### N7 — Consolonia widget tests: ChatView (1,096 lines), Markdown (880), Syntax (800), TextInput (712)
4 large widgets with zero dedicated tests (3,488 lines total). Only generic widget tests exist in `widgets.test.ts`. Markdown and Syntax are the biggest untested surfaces in consolonia. **Impact: high. Effort: large.**

### N8 — Adapter binary validation
`cli-proxy.ts` spawns agent subprocesses without checking if the binary exists first. Add a preflight `which`/`where` check with clear "install X to use this adapter" messaging. **Impact: medium. Effort: small.**

### N9 — Search quality improvements (recall)
- Token estimation uses `text.slice(0, maxTokens * 4)` — a proper tiktoken-style estimator would be more accurate
- Content classification is path-based only — reading frontmatter `type:` field would be more reliable
- Temporal decay — older results at same semantic score should rank lower
- Query normalization — no stemming or case handling currently
**Impact: medium. Effort: medium.**

### N10 — Pre-commit hooks (Husky + lint-staged)
No pre-commit hooks configured. A hook running `biome check` and `tsc --noEmit` on staged files would catch issues before CI. **Impact: medium. Effort: small.**

### N11 — Root `clean` script
No way to wipe all `dist/` directories at once. Minor but useful for fresh rebuilds. **Impact: low. Effort: tiny.**

### N12 — paste-handler.ts test suite (243 lines, zero tests)
Handles multi-line paste detection and processing. Testable logic. **Impact: low. Effort: small.**

### N13 — wordwheel.ts + dropdown.ts tests (244 lines combined, zero tests)
Autocomplete and dropdown rendering logic. **Impact: low. Effort: small.**

---

## Completed Goals

### ~~Linting & formatting~~ DONE
Biome configured at repo root. 0 errors, 18 warnings. `npm run lint` and `npm run lint:fix` scripts.

### ~~P0 — Test coverage for cli.ts~~ DONE
### ~~P0 — Test coverage for compact.ts~~ DONE
### ~~P1 — Test coverage for console/ utilities~~ DONE
### ~~P1 — Configurable routing~~ DONE
### ~~P0 — Recall test suite~~ DONE
### ~~P1 — Search CLI flags~~ DONE
