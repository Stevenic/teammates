---
name: Recall v2 Feature Specs
description: Implementation specs for temporal decay, MMR re-ranking, file watching, memory flush, and session transcript indexing
type: project
---

# Recall v2 Feature Specs

Spec'd 2026-04-02. These features were identified from the OpenClaw vs Teammates comparison (see `docs/OpenClaw_vs_Teammates_Memory_Comparison.docx`). Embedding cache was explicitly ruled out by the user.

---

## 1. Temporal Decay with Configurable Half-Life

### Problem
Recall search treats a 6-month-old typed memory identically to yesterday's. For project-type memories especially, freshness matters — stale project context actively misleads agents.

### Design

**Where it hooks in:** Post-retrieval score multiplier in `search.ts`, applied alongside the existing `typedMemoryBoost`.

**Formula:**
```
decayedScore = rawScore × 2^(-ageInDays / halfLife)
```

Where:
- `ageInDays` = days between now and the memory's date
- `halfLife` = configurable decay rate (days until score is halved)

**Date extraction priority:**
1. Filename date: `YYYY-MM-DD.md` → parse directly
2. Weekly/monthly filename: `YYYY-W##.md` → start of that week; `YYYY-MM.md` → start of that month
3. Frontmatter `date:` field (if present)
4. File `mtime` (fallback)

**Per-content-type half-lives (defaults):**

| Content Type | Default Half-Life | Rationale |
|---|---|---|
| `daily` | 14 days | Raw episodic logs lose relevance fast |
| `weekly` | 30 days | Summaries stay relevant longer |
| `monthly` | 90 days | High-level summaries are slow-decay |
| `typed_memory` | 60 days | Decisions/feedback are durable but not permanent |
| `other` | 30 days | WISDOM.md, SOUL.md — moderate decay |

**Interaction with existing boosts:**
```
finalScore = rawScore × typedMemoryBoost × temporalDecay
```

The typed memory boost (1.2×) and temporal decay are independent multipliers. A fresh typed memory gets both boosts. An old typed memory gets the type boost but temporal decay pulls it down.

**Recency pass (Pass 1) is exempt:** Weekly summaries loaded in the recency pass already have a fixed 0.9 score and are selected by recency, not relevance. Temporal decay does NOT apply to Pass 1 results — they're already recency-sorted.

### API Changes

```typescript
// New fields on SearchOptions
interface SearchOptions {
  // ... existing fields ...
  /** Enable temporal decay scoring (default: true) */
  temporalDecay?: boolean;
  /** Per-type half-life overrides in days */
  temporalHalfLife?: Partial<Record<string, number>>;
}
```

CLI flags:
```
--no-decay              Disable temporal decay
--half-life <json>      JSON object of type→days overrides
```

### New Module: `temporal.ts`

```typescript
/** Extract a date from a URI or file metadata. */
export function extractDate(uri: string, mtime?: Date): Date | null;

/** Compute the temporal decay multiplier for a given age and half-life. */
export function computeDecay(ageInDays: number, halfLifeDays: number): number;

/** Default half-lives per content type. */
export const DEFAULT_HALF_LIVES: Record<string, number>;

/** Apply temporal decay to a SearchResult. */
export function applyTemporalDecay(
  result: SearchResult,
  now: Date,
  halfLifeOverrides?: Partial<Record<string, number>>,
): SearchResult;
```

### Integration Points
- `search.ts` → After Pass 2 scoring (after `typedMemoryBoost`), before final sort
- `search.ts` → `multiSearch()` → same position, applied to all merged results before final sort
- `cli.ts` → New `--no-decay` and `--half-life` flags

### Test Cases
1. A 0-day-old result gets decay multiplier ≈ 1.0
2. A result exactly `halfLife` days old gets decay multiplier ≈ 0.5
3. A 365-day-old daily log (halfLife=14) gets multiplier ≈ 0.0 (effectively invisible)
4. Pass 1 recency results are NOT decayed
5. Type boost and decay compose correctly: `rawScore × 1.2 × decay`
6. Filename date extraction: daily, weekly, monthly patterns
7. Fallback to mtime when no date in filename
8. `--no-decay` disables the feature entirely

---

## 2. MMR Re-Ranking (Maximal Marginal Relevance)

### Problem
Multi-query fusion deduplicates by URI, but two *different* memory files can contain heavily overlapping content (e.g., a daily log entry and the typed decision it spawned). Both get high scores and consume context budget on redundant information.

### Design

**Where it hooks in:** Final re-ranking step in `search.ts`, after all scoring (type boost + temporal decay) and deduplication, but before the final `slice(0, maxResults)`.

**Algorithm:**
```
MMR(dᵢ) = λ × Sim(dᵢ, q) - (1 - λ) × max(Sim(dᵢ, dⱼ)) for dⱼ in S
```

Where:
- `Sim(dᵢ, q)` = the result's existing score (already computed by Vectra + our boosts)
- `Sim(dᵢ, dⱼ)` = cosine similarity between result i and result j's text embeddings
- `S` = the set of already-selected results
- `λ` = diversity parameter (0.0 = max diversity, 1.0 = pure relevance, default: 0.7)

**Greedy selection:**
1. Start with the highest-scoring result (add to selected set S)
2. For each remaining candidate, compute MMR score
3. Add the candidate with the highest MMR score to S
4. Repeat until we have `maxResults` items

**Embedding reuse:** The query embedding is already computed by Vectra. For inter-document similarity, we need embeddings of each result's text. Two options:
- **Option A:** Re-embed each result's `text` field using `LocalEmbeddings` (simple, ~50ms per result)
- **Option B:** Store chunk embeddings in the SearchResult and reuse them (faster, requires Vectra API change)

**Recommendation: Option A.** We're re-ranking at most ~20 results (maxResults + recencyDepth across all passes). At 50ms/embed, that's ~1 second. Acceptable for the quality gain, and keeps the implementation self-contained.

**Cosine similarity:** Since `LocalEmbeddings` returns L2-normalized vectors, cosine similarity is just the dot product:
```typescript
function cosineSim(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}
```

### API Changes

```typescript
interface SearchOptions {
  // ... existing fields ...
  /** Enable MMR diversity re-ranking (default: true) */
  mmr?: boolean;
  /** MMR lambda: 0.0 = max diversity, 1.0 = pure relevance (default: 0.7) */
  mmrLambda?: number;
}
```

CLI flags:
```
--no-mmr                Disable MMR re-ranking
--mmr-lambda <float>    Set diversity parameter (default: 0.7)
```

### New Module: `mmr.ts`

```typescript
import type { SearchResult } from "./search.js";
import type { LocalEmbeddings } from "./embeddings.js";

/** Cosine similarity between two L2-normalized vectors. */
export function cosineSim(a: number[], b: number[]): number;

/**
 * Re-rank results using Maximal Marginal Relevance.
 * Returns top-K results optimizing for both relevance and diversity.
 */
export async function mmrRerank(
  results: SearchResult[],
  query: string,
  embeddings: LocalEmbeddings,
  options: {
    maxResults: number;
    lambda?: number;  // default: 0.7
  },
): Promise<SearchResult[]>;
```

### Integration Points
- `search.ts` → After temporal decay, as the final step before returning results
- `multiSearch()` → Same position, after all merging and decay
- Needs the `LocalEmbeddings` instance (already created in `search()`)

### Test Cases
1. With λ=1.0, order matches pure score-sorted order (no diversity penalty)
2. With λ=0.0, results maximize diversity (most dissimilar to each other)
3. Two near-identical results: MMR suppresses the lower-scored duplicate
4. Single result: returned as-is
5. `--no-mmr` returns pure score-sorted results
6. Cosine similarity of identical vectors = 1.0
7. Cosine similarity of orthogonal vectors = 0.0

---

## 3. File Watching for Warm Index

### Problem
Currently recall syncs on every search (`--sync` before returning results). This adds latency to each search call, especially when many files have changed. The `watch` CLI command exists but is a standalone process — it's not integrated into the library API for programmatic use.

### Design

**Two modes:**

**Mode 1: CLI `watch` command (already exists)**
The existing `cmdWatch()` in `cli.ts` uses `node:fs.watch` with recursive option and 2-second debounce. This works. No changes needed to the CLI command itself.

**Mode 2: Library API `IndexWatcher` class (new)**
A programmatic watcher that the CLI orchestrator (or any consumer) can start/stop. The orchestrator would start the watcher when it boots and stop it on exit, keeping the index warm in the background.

```typescript
export class IndexWatcher extends EventEmitter {
  constructor(config: IndexerConfig);
  
  /** Start watching all discovered teammates. Performs initial sync. */
  async start(): Promise<void>;
  
  /** Stop watching and clean up file watchers. */
  async stop(): Promise<void>;
  
  /** Whether the watcher is currently running. */
  get running(): boolean;
}
```

**Events emitted:**
- `sync` → `{ teammate: string, filesChanged: number }`
- `error` → `{ teammate: string, error: Error }`

**Debounce strategy:**
- Per-teammate debounce timers (2 seconds of quiet)
- Changes during an active sync are queued for the next cycle
- Uses `node:fs.watch` (recursive) — same as existing `cmdWatch`

**Integration with search:**
When the watcher is running, `search()` can skip its sync step (`skipSync: true`) because the index is already warm. The caller (CLI orchestrator) is responsible for setting `skipSync` when the watcher is active.

**Graceful shutdown:**
- `stop()` closes all `FSWatcher` handles
- Pending sync timers are cleared
- In-flight syncs are awaited before resolving

### API Changes

```typescript
// New export from index.ts
export { IndexWatcher } from "./watcher.js";
```

No changes to `SearchOptions` — the caller decides whether to set `skipSync` based on whether a watcher is running.

### New Module: `watcher.ts`

```typescript
import { EventEmitter } from "node:events";
import { type FSWatcher, watch as fsWatch } from "node:fs";
import { Indexer, type IndexerConfig } from "./indexer.js";

export class IndexWatcher extends EventEmitter {
  private indexer: Indexer;
  private watchers: FSWatcher[] = [];
  private _running = false;
  
  constructor(config: IndexerConfig);
  async start(): Promise<void>;
  async stop(): Promise<void>;
  get running(): boolean;
}
```

### Integration Points
- `packages/recall/src/index.ts` → Export `IndexWatcher`
- `packages/cli/src/cli.ts` → Start `IndexWatcher` at boot, stop on exit. Set `skipSync: true` when watcher is active.
- `packages/recall/src/cli.ts` → Refactor `cmdWatch` to use `IndexWatcher` internally (DRY)

### Test Cases
1. Watcher emits `sync` event when a `.md` file is created
2. Watcher ignores non-`.md` files
3. Watcher ignores `.index/` directory changes
4. Debounce: multiple rapid changes result in a single sync
5. `stop()` cleans up all watchers
6. `running` property reflects current state
7. Creating a new teammate directory mid-watch gets picked up on next sync

---

## 4. Memory Flush Before Compaction

### Problem
`preDispatchCompress()` is purely mechanical — it compresses older conversation entries into terse bullet summaries. If the conversation contains an important decision, novel insight, or feedback that hasn't been saved as a typed memory yet, that nuance is lost in compression.

### Design

**Where it hooks in:** In the CLI orchestrator, BEFORE `preDispatchCompress()` runs. This is a new step in the compression pipeline:

```
conversation exceeds budget
  → [NEW] memoryFlush(conversation, teammate)
  → preDispatchCompress()
```

**How it works:**
1. Extract the conversation entries that are about to be compressed (the oldest entries up to the budget threshold)
2. Build a prompt asking the LLM to identify any important decisions, feedback, or knowledge that should be preserved as typed memories
3. Dispatch this as a `system` task to the teammate's agent (suppresses memory updates and feed output)
4. Parse the response for memory file operations (create/update typed memories)
5. Execute the file operations
6. Proceed with mechanical compression

**Prompt structure:**
```
You are reviewing a conversation that is about to be compressed. 
Extract any important decisions, feedback, or knowledge that should 
be preserved as typed memories.

For each piece of knowledge, output a fenced block:

\`\`\`memory
---
name: <name>
description: <one-line description>
type: <decision|feedback|reference|project>
---
<content>
\`\`\`

If nothing needs preserving, output: NO_FLUSH_NEEDED

Conversation to review:
<entries>
```

**Gating:** Only runs when:
- Conversation exceeds the compression threshold (384k chars / 96k tokens)
- The entries being compressed contain at least 3 entries (not worth flushing 1-2 entries)
- A cooldown of 30 minutes since last flush (prevent rapid re-flushing)

**Token cost:** One LLM call per flush. The input is bounded by the compression budget (entries being compressed). Expected cost: ~2-5k input tokens, ~500-1k output tokens. Acceptable given it runs at most once per 30 minutes.

**Fire-and-forget with timeout:** The flush has a 30-second timeout. If the LLM doesn't respond in time, proceed with compression anyway. The flush is best-effort — we never block compression on it.

### API Changes

```typescript
// New option on the Orchestrator or conversation manager
interface FlushOptions {
  /** Enable LLM memory flush before compression (default: true) */
  memoryFlush?: boolean;
  /** Minimum entries to trigger flush (default: 3) */
  memoryFlushMinEntries?: number;
  /** Cooldown between flushes in ms (default: 1800000 / 30 min) */
  memoryFlushCooldown?: number;
}
```

### New Module: `memory-flush.ts` (in packages/cli/src/)

```typescript
/** Parse memory blocks from LLM flush response. */
export function parseFlushResponse(response: string): MemoryBlock[];

/** Build the flush prompt from conversation entries. */
export function buildFlushPrompt(entries: ConversationEntry[]): string;

/** Execute a memory flush: prompt the LLM, parse response, write files. */
export async function executeMemoryFlush(
  entries: ConversationEntry[],
  teammate: string,
  teammatesDir: string,
  dispatchFn: (prompt: string) => Promise<string>,
  options?: FlushOptions,
): Promise<{ flushed: number; skipped: boolean }>;
```

### Integration Points
- `packages/cli/src/conversation.ts` → Call `executeMemoryFlush()` before `preDispatchCompress()`
- `packages/cli/src/cli.ts` → Wire up the dispatch function and options
- Writes to `.teammates/<teammate>/memory/` — typed memory files

### Test Cases
1. Parses valid memory blocks from LLM response
2. Handles `NO_FLUSH_NEEDED` response (no files written)
3. Respects cooldown (skips if flushed recently)
4. Respects minimum entry threshold
5. Times out after 30 seconds without blocking compression
6. Written memory files have valid frontmatter
7. Disabled with `memoryFlush: false`

---

## 5. Session Transcript Indexing

### Problem
Daily logs are summaries — they lose the exact phrasing, reasoning chains, and back-and-forth that happened during a conversation. When debugging why a decision was made or understanding the user's exact intent, the summary isn't enough.

### Design

**Opt-in only.** This is gated behind a setting in `.teammates/settings.json`:

```json
{
  "indexTranscripts": false
}
```

**What gets indexed:** The CLI already writes debug prompt files under `.teammates/.tmp/debug/`. These contain the full prompt sent to the agent for each task. However, these are ephemeral and get cleaned up.

**New persistent transcript path:**
```
.teammates/<teammate>/transcripts/YYYY-MM-DD-HHMMSS.md
```

Each task completion writes a transcript file containing:
- Task prompt (what was asked)
- Agent response (what was returned)
- Timestamp
- Changed files (if any)

**Indexing integration:**
- `Indexer.collectFiles()` adds `transcripts/*.md` to the file list when `indexTranscripts` is enabled
- Transcript files are classified as `contentType: "transcript"` via `classifyUri()`
- Transcripts get a lower `typedMemoryBoost` (no boost, raw score only) — they're supplementary, not primary

**Retention:** Transcripts older than 30 days are auto-purged during the startup maintenance cycle (same pattern as stale daily log purge). This prevents unbounded index growth.

**Size control:** Transcript files are capped at 8000 characters (~2000 tokens). If the response exceeds this, it's truncated with a `[truncated]` marker. The prompt portion is capped at 2000 characters.

### API Changes

```typescript
// New field on IndexerConfig (or read from settings.json)
interface IndexerConfig {
  // ... existing ...
  /** Include transcripts in the index (default: false) */
  indexTranscripts?: boolean;
}

// New content type in classifyUri
// uri.includes("/transcripts/") → "transcript"
```

### New Module: `transcript-writer.ts` (in packages/cli/src/)

```typescript
/** Write a task transcript to the teammate's transcripts directory. */
export async function writeTranscript(
  teammatesDir: string,
  teammate: string,
  task: {
    prompt: string;
    response: string;
    changedFiles?: string[];
    timestamp: Date;
  },
): Promise<string>; // returns the written file path
```

### Integration Points
- `packages/cli/src/cli.ts` → After task completion, call `writeTranscript()` if `indexTranscripts` is enabled
- `packages/recall/src/indexer.ts` → `collectFiles()` includes `transcripts/*.md` when enabled
- `packages/recall/src/search.ts` → `classifyUri()` recognizes `transcripts/` path
- `packages/cli/src/startup-manager.ts` → Purge transcripts older than 30 days during startup

### Test Cases
1. Transcript file written with correct format and frontmatter
2. Prompt and response are truncated at limits
3. Transcripts appear in index when `indexTranscripts: true`
4. Transcripts excluded from index when `indexTranscripts: false` (default)
5. `classifyUri()` returns "transcript" for transcript paths
6. Transcripts older than 30 days are purged on startup
7. Transcript directory created on first write

---

## Implementation Priority

| # | Feature | Effort | Impact | Package |
|---|---|---|---|---|
| 1 | Temporal Decay | Low | High (search quality) | recall |
| 2 | MMR Re-Ranking | Moderate | High (context efficiency) | recall |
| 3 | File Watching (library API) | Moderate | Medium (latency) | recall + cli |
| 4 | Memory Flush | Moderate | Medium (knowledge retention) | cli |
| 5 | Session Transcripts | Low-Moderate | Low-Medium (debugging) | cli + recall |

Recommended build order: 1 → 2 → 3 → 4 → 5. Features 1 and 2 are independent and could be built in parallel. Feature 3 is independent. Features 4 and 5 depend on the CLI but not on each other.
