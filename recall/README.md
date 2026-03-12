# @teammates/recall

Local semantic memory search for teammates. Indexes `MEMORIES.md` and daily logs (`memory/*.md`) using [Vectra](https://github.com/Stevenic/vectra) for vector search and [transformers.js](https://huggingface.co/docs/transformers.js) for embeddings.

**Zero cloud dependencies.** Everything runs locally — embeddings are generated on-device, indexes are stored as local files.

## Install

```bash
npm install -g @teammates/recall
```

Or use with npx:

```bash
npx @teammates/recall search "token budget issues" --dir ./.teammates
```

## How Agents Use It

The typical agent workflow:

```bash
# 1. Agent writes a memory file (normal file write, no special tool needed)
echo "## Notes\n- Fixed the auth token refresh bug" >> .teammates/atlas/memory/2026-03-11.md

# 2. Agent searches memories (auto-syncs new files before searching)
teammates-recall search "auth token refresh" --json

# 3. That's it. No manual index/sync step needed.
```

**Search auto-syncs by default** — any new or changed memory files are indexed before results are returned. For large indexes where sync latency matters, use `--no-sync` and manage syncing separately.

## Commands

### search

Search across teammate memories. Auto-syncs new/changed files before querying.

```bash
teammates-recall search "database migration pattern" --dir ./.teammates
teammates-recall search "rate limiting" --teammate atlas --results 3
teammates-recall search "auth token expiration" --json
teammates-recall search "deploy process" --no-sync    # skip auto-sync
```

Options:
- `--teammate <name>` — Search a specific teammate (default: all)
- `--results <n>` — Max results (default: 5)
- `--no-sync` — Skip auto-sync before searching
- `--json` — Output as JSON (useful for piping to agents)

### add

Add a single file to a teammate's index. Use this right after writing a memory file for immediate indexing without a full sync.

```bash
teammates-recall add .teammates/atlas/memory/2026-03-11.md --teammate atlas
```

### sync

Incrementally sync new/changed memory files into existing indexes. Faster than a full rebuild.

```bash
teammates-recall sync --dir ./.teammates
teammates-recall sync --teammate atlas
```

### index

Full rebuild of all indexes from scratch. Use when setting up for the first time or when indexes seem stale.

```bash
teammates-recall index --dir ./.teammates
teammates-recall index --teammate beacon
```

### status

Check which teammates have memory files and whether they're indexed.

```bash
teammates-recall status --dir ./.teammates
```

## How It Works

1. **Discovers** teammate directories (any folder under `.teammates/` with a `SOUL.md`)
2. **Collects** memory files: `MEMORIES.md` + `memory/*.md`
3. **Chunks and embeds** text using transformers.js (`Xenova/all-MiniLM-L6-v2`, 384-dim vectors)
4. **Stores** the index at `.teammates/.index/<teammate>/` (gitignored)
5. **Searches** using Vectra's semantic similarity matching

## Auto-Sync

Every `search` call automatically detects new or changed memory files and indexes them before returning results. This is on by default — no manual `sync` or `index` step is needed.

**How it works:** The indexer compares file modification times against stored metadata. Only files that are new or changed since the last sync get re-indexed, so the overhead is minimal for most queries.

**Skip it when you need speed:** Pass `--no-sync` (CLI) or `skipSync: true` (library) to skip the check entirely. Useful for hot loops or large indexes where you control sync timing separately.

**Why this matters for agents:** Agents write memory files as plain markdown — they shouldn't need to know about index state or remember to run a sync command. Auto-sync closes the gap between "file written" and "file searchable" so agents can write-then-search in a single workflow without extra steps.

## Use From Any Agent

Any AI coding tool that can run shell commands can use recall:

```bash
teammates-recall search "how does auth work" --dir ./.teammates --json
```

The `--json` flag returns structured results that agents can parse:

```json
[
  {
    "teammate": "atlas",
    "uri": "atlas/MEMORIES.md",
    "text": "### 2026-01-15: JWT Auth Pattern\n...",
    "score": 0.847
  }
]
```

## Use As a Library

```typescript
import { Indexer, search } from "@teammates/recall";

// Full index rebuild
const indexer = new Indexer({ teammatesDir: "./.teammates" });
await indexer.indexAll();

// Incremental sync
await indexer.syncTeammate("atlas");

// Add a single file after writing it
await indexer.upsertFile("atlas", ".teammates/atlas/memory/2026-03-11.md");

// Search (auto-syncs by default)
const results = await search("database migration", {
  teammatesDir: "./.teammates",
  teammate: "atlas",
  maxResults: 5,
  maxChunks: 3,    // max chunks per document (default: 3)
  maxTokens: 500,  // max tokens per section (default: 500)
});

// Search without auto-sync
const results2 = await search("database migration", {
  teammatesDir: "./.teammates",
  skipSync: true,
});
```

## Embedding Model

Default: `Xenova/all-MiniLM-L6-v2` (~23 MB, 384 dimensions)

- Downloaded automatically on first run, cached locally
- No API keys required
- Override with `--model <name>` for any transformers.js-compatible model

## Storage

Indexes live at `.teammates/.index/` and are gitignored. They're derived from the markdown source files and can be rebuilt at any time with `teammates-recall index`.
