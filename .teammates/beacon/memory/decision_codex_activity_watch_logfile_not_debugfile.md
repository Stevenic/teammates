---
name: codex-activity-watch-logfile-not-debugfile
description: Codex live activity must tail the adapter logFile, not debugFile, because Codex does not support --debug-file.
type: decision
---
# Codex activity must watch `logFile`, not `debugFile`

## Context
Codex live activity in the CLI comes from the paired `.teammates\.tmp\debug\*.md` file that the adapter appends during execution. Claude is different: Claude supports `--debug-file`, so its watcher path can key off `debugFile`.

## Decision
In `packages/cli/src/adapters/cli-proxy.ts`, start Codex activity watchers when `logFile` exists:

- Codex: `watchCodexDebugLog(logFile, taskStartTime, onActivity)`
- Claude and other `supportsDebugFile` presets: keep using `debugFile`

Do not gate Codex watcher startup on `debugFile`.

## Why
For Codex, `debugFile` is `undefined` by design because the preset does not support `--debug-file`. If watcher startup is gated by `debugFile`, the parser can be completely correct and activity will still never render because no watcher is running.

## Implication
When the user says the Codex debug log file is updating but the UI shows no activity, inspect watcher startup before touching parser logic again.
