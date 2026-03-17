# S16 — Hooks / Lifecycle Events

Spec for a hook system that lets users run shell commands or scripts in response to orchestrator lifecycle events.

**Status:** Draft
**Owner:** Scribe (spec) → Beacon (implementation)
**Priority:** P0 — foundational; F5, F6, F9 all depend on lifecycle hooks

---

## Problem

Users cannot automate reactions to teammate activity. There's no way to:
- Run linters after a teammate edits files
- Send notifications when a task completes
- Trigger CI checks after handoffs
- Collect metrics on teammate behavior

## Design

### Hook Configuration

Hooks are defined in `.teammates/hooks.json` (project-level, checked in) or `~/.teammates/hooks.json` (user-level, not checked in). Project hooks run first, then user hooks. Both files use the same format.

```json
{
  "hooks": [
    {
      "event": "post_task",
      "command": "npm run lint -- --fix",
      "name": "auto-lint",
      "filter": {
        "teammate": "beacon"
      }
    },
    {
      "event": "session_start",
      "command": ".teammates/_scripts/notify.sh start",
      "name": "start-notification"
    }
  ]
}
```

### Hook Object

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `event` | string | Yes | Lifecycle event name (see catalog below) |
| `command` | string | Yes | Shell command to execute. Runs from the project root. |
| `name` | string | No | Human-readable label for logging/debugging |
| `filter.teammate` | string | No | Only fire for this teammate. Omit = all teammates. |
| `filter.result` | `"success"` \| `"failure"` | No | Only fire on this outcome (for `post_task`, `post_compact`). |
| `timeout` | number | No | Max execution time in ms. Default: 30000 (30s). |
| `blocking` | boolean | No | If `true`, the orchestrator waits for the hook to finish before proceeding. Default: `true` for `pre_*` events, `false` for `post_*` events. |

### Event Catalog

| Event | When it fires | Blocking default | Environment variables |
|-------|--------------|------------------|----------------------|
| `session_start` | CLI starts, after teammate discovery | Yes | `TEAMMATES_DIR` |
| `session_end` | CLI shuts down (graceful exit) | Yes | `TEAMMATES_DIR` |
| `pre_task` | Before a task is sent to an agent | Yes | `TEAMMATE`, `TASK_PROMPT`, `SESSION_ID` |
| `post_task` | After a task completes (success or failure) | No | `TEAMMATE`, `TASK_PROMPT`, `SESSION_ID`, `TASK_SUCCESS` (`true`/`false`), `CHANGED_FILES` (newline-separated) |
| `pre_handoff` | Before a handoff is executed | Yes | `TEAMMATE_FROM`, `TEAMMATE_TO`, `HANDOFF_TASK` |
| `post_handoff` | After a handoff chain completes | No | `TEAMMATE_FROM`, `TEAMMATE_TO`, `HANDOFF_TASK`, `TASK_SUCCESS` |
| `pre_compact` | Before `/compact` runs | Yes | `TEAMMATE` |
| `post_compact` | After `/compact` finishes | No | `TEAMMATE`, `TASK_SUCCESS` |
| `error` | When a task fails with a non-zero exit code | No | `TEAMMATE`, `ERROR_MESSAGE`, `EXIT_CODE` |

### Environment Variables

Every hook receives these base variables in addition to the event-specific ones:

| Variable | Description |
|----------|-------------|
| `TEAMMATES_DIR` | Absolute path to `.teammates/` |
| `TEAMMATES_EVENT` | The event name that triggered this hook |
| `TEAMMATES_HOOK_NAME` | The hook's `name` field (or `"unnamed"`) |

### Execution Model

1. **Shell execution.** Hooks run via the system shell (`/bin/sh -c` on Unix, `cmd /c` on Windows). The working directory is the project root.
2. **Ordering.** Multiple hooks on the same event run in array order. Project hooks run before user hooks.
3. **Blocking behavior.** `pre_*` hooks are blocking by default — the orchestrator waits for them to complete. If a blocking `pre_*` hook exits with a non-zero code, the operation is **aborted** and the user is notified. `post_*` hooks are non-blocking by default — they run in the background.
4. **Timeout.** Hooks that exceed their timeout are killed. A killed hook is treated as a failure (non-zero exit).
5. **Stdout/stderr.** Hook output is captured and logged to the debug file. It is not shown to the user unless the hook fails.
6. **No stdin.** Hooks do not receive stdin. They cannot prompt the user.

### Blocking Pre-Hook Abort

When a blocking `pre_task` or `pre_handoff` hook exits non-zero:
- The task/handoff is **not executed**
- The user sees: `Hook "<name>" blocked <event>: <stderr last line>`
- The event is logged with the hook's exit code and stderr

This enables gates like "don't run tasks if the working tree is dirty" or "require approval before cross-team handoffs."

## CLI Integration

### New command: `/hooks`

| Subcommand | Description |
|------------|-------------|
| `/hooks` | List all registered hooks (project + user) with status |
| `/hooks run <name>` | Manually trigger a hook by name (for testing) |
| `/hooks test <event>` | Dry-run all hooks for an event with mock env vars (see defaults below) |

### `/hooks test` Mock Environment Variables

When running `/hooks test <event>`, the CLI populates env vars with these defaults so hooks can be exercised without a real task:

| Variable | Mock value |
|----------|-----------|
| `TEAMMATES_DIR` | *(actual `.teammates/` path)* |
| `TEAMMATES_EVENT` | *(the tested event)* |
| `TEAMMATES_HOOK_NAME` | *(the hook's name)* |
| `TEAMMATE` | `"test-teammate"` |
| `TASK_PROMPT` | `"Hook dry-run test"` |
| `SESSION_ID` | `"test-session-000"` |
| `TASK_SUCCESS` | `"true"` |
| `CHANGED_FILES` | `""` (empty) |
| `TEAMMATE_FROM` | `"test-teammate"` |
| `TEAMMATE_TO` | `"test-teammate"` |
| `HANDOFF_TASK` | `"Hook dry-run handoff"` |
| `ERROR_MESSAGE` | `"Simulated error for hook testing"` |
| `EXIT_CODE` | `"1"` |

Only variables relevant to the tested event are set (per the Event Catalog table). The rest are omitted.

### OrchestratorEvent Extension

Add new event types to `OrchestratorEvent`:

```typescript
| { type: "hook_start"; event: string; hookName: string }
| { type: "hook_complete"; event: string; hookName: string; exitCode: number }
| { type: "hook_timeout"; event: string; hookName: string }
| { type: "hook_abort"; event: string; hookName: string; stderr: string }
```

## Documentation Updates (Scribe)

- Add "Hooks" section to PROTOCOL.md (both live and template) with config format and event catalog
- Add `/hooks` to CLI README slash commands table
- Add "Configure lifecycle hooks" recipe to cookbook
- Add hooks to ARCHITECTURE.md data flow diagram

## Implementation Notes (for Beacon)

- Hook runner should be a standalone module (`hooks.ts`) imported by the orchestrator
- Load hooks from both config paths at init, merge into a single sorted array
- Use `child_process.spawn` with shell option, not `exec` (better timeout/kill handling)
- The `CHANGED_FILES` env var for `post_task` comes from `TaskResult.changedFiles`
- Consider a `--no-hooks` CLI flag for debugging

## Future Extensions (not in v1)

- **JS callback hooks** — `"handler": "./scripts/my-hook.js"` instead of `"command"`. Runs in-process. Deferred until there's demand.
- **Hook chaining** — one hook's output piped to the next. Too complex for v1.
- **Remote hooks** — webhook URLs instead of local commands. Needs auth design.
