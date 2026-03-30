---
version: 0.7.0
name: non_claude_debug_logs_created_eagerly
description: Non-Claude adapter debug logs should be created before process completion so paired prompt and log files exist during task execution.
type: decision
---
# Non-Claude debug logs are created eagerly

## Decision
For adapters that do not own their own debug log file (Codex, Aider, similar CLI proxies), create the `.teammates/.tmp/debug/<base>.md` file at task start rather than waiting until process close.

## Why
- The prompt file is written immediately, so users expect the paired log file to exist immediately too.
- Waiting until close means there is no visible `<base>.md` while the task is running.
- If spawn fails early, the close-only write path may never produce a useful log artifact.

## Implementation notes
- `executeTask()` writes an empty log file right after the prompt file for non-Claude presets.
- `spawnAndProxy()` appends stdout/stderr chunks for non-Claude presets during execution.
- `spawnAndProxy()` appends a `[SPAWN ERROR]` marker on child process spawn failure.
- The close handler still overwrites the file with final captured output for a deterministic final artifact.
