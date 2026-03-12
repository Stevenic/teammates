# Beacon — Memories

Curated long-term lessons, decisions, and patterns. Reverse chronological.

This file is for durable knowledge that stays relevant over time. For day-to-day notes, use `memory/YYYY-MM-DD.md`.

Categories: Bug | Decision | Pattern | Gotcha | Optimization

### 2026-03-11: Initial Setup
**Category:** Decision | **Last updated:** 2026-03-11

Beacon created to own the `@teammates/recall` package. Key initial decisions:
- Vectra for local vector search (simple file-based index, no server needed)
- transformers.js with `Xenova/all-MiniLM-L6-v2` for embeddings (384-dim, ~23 MB, runs on-device)
- One index per teammate, stored at `.teammates/.index/<name>/`
- Auto-sync before search by default — agents shouldn't need to manually manage index state
- CLI designed for agent consumption: `--json` flag for structured output, no interactive prompts
