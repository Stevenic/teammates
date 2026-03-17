# S17 — Non-Interactive Mode (`-p`)

Spec for headless CLI execution — run a single task against a teammate without the REPL.

**Status:** Draft
**Owner:** Scribe (spec) → Beacon (implementation)
**Priority:** P0 — enables CI integration; prerequisite for F4 (code review), F5 (boundary CI), F6 (memory CI)

---

## Problem

The CLI currently requires an interactive REPL session. This prevents:
- CI/CD pipelines from assigning tasks to teammates
- Scripts from automating teammate workflows
- Non-interactive environments (cron jobs, GitHub Actions, pre-commit hooks)
- Piping input/output to/from teammates

## Design

### Basic Usage

```bash
# Run a task against a specific teammate
teammates -p "Review the auth module for security issues" --teammate beacon

# Auto-route (let the orchestrator pick the teammate)
teammates -p "Update the onboarding docs for the new memory format"

# Pipe input
echo "Explain this error" | teammates -p --teammate beacon

# JSON output
teammates -p "List all ownership gaps" --teammate scribe --format json
```

### CLI Flags

| Flag | Short | Type | Description |
|------|-------|------|-------------|
| `--print` | `-p` | string (optional) | Enable non-interactive mode. If a value is provided, it's the task prompt. If omitted, read from stdin. |
| `--teammate` | `-t` | string | Target teammate name. If omitted, auto-route using `orchestrator.route()`. |
| `--format` | `-f` | `text` \| `json` | Output format. Default: `text`. |
| `--no-handoffs` | | boolean | Disable handoff following. The task runs on the specified teammate only. Default: false. |
| `--timeout` | | number | Max execution time in seconds. Default: 300 (5 min). |
| `--quiet` | `-q` | boolean | Suppress progress indicators (spinners, status lines). Only print the final result. Default: false in TTY, true in pipes. |

### Input Resolution

Priority order for the task prompt:
1. `-p "inline prompt"` — prompt is the flag value
2. `-p` (no value) + stdin — read stdin to EOF
3. `-p` (no value) + no stdin — error: "No task provided. Pass a prompt or pipe input."

When reading from stdin, the CLI reads until EOF. There is no interactive prompt.

### Output Format: `text`

Print the teammate's text response to stdout. Structured metadata (changed files, handoff info) goes to stderr so it doesn't pollute piped output.

```
$ teammates -p "What files do you own?" -t scribe
I own the following file patterns:
- template/**/*.md
- ONBOARDING.md
- README.md
- docs/**
- .teammates/README.md, PROTOCOL.md, CROSS-TEAM.md, TEMPLATE.md, DECISIONS.md
```

Stderr (only if not `--quiet`):
```
[scribe] Task completed in 12.3s — 0 files changed
```

### Output Format: `json`

Print a JSON object to stdout matching the `TaskResult` structure:

```json
{
  "teammate": "scribe",
  "success": true,
  "summary": "I own the following file patterns: ...",
  "changedFiles": [],
  "handoffs": [],
  "duration": 12300
}
```

If handoffs were followed, include the full chain:

```json
{
  "teammate": "scribe",
  "success": true,
  "summary": "...",
  "changedFiles": ["docs/cookbook.md"],
  "handoffs": [
    {
      "from": "scribe",
      "to": "beacon",
      "task": "Update recall indexer for new format",
      "result": {
        "teammate": "beacon",
        "success": true,
        "summary": "...",
        "changedFiles": ["packages/recall/src/indexer.ts"]
      }
    }
  ],
  "duration": 45200
}
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Task completed successfully |
| 1 | Task failed (agent returned failure or non-zero exit) |
| 2 | Routing failed (no teammate matched and none specified) |
| 3 | Timeout exceeded |
| 4 | Invalid arguments |
| 5 | Pre-task hook aborted (see S16) |

### Process Lifecycle

Non-interactive mode follows a simplified lifecycle compared to the REPL:

1. **Init** — discover teammates, load hooks, sync recall index
2. **Route** — resolve target teammate (from `--teammate` or auto-route)
3. **Fire `pre_task` hooks** — abort if any blocking hook fails
4. **Execute task** — send prompt to agent via adapter, stream output
5. **Follow handoffs** — unless `--no-handoffs` is set
6. **Fire `post_task` hooks**
7. **Print result** — text or JSON to stdout
8. **Exit** — with appropriate exit code

No session file is created. No REPL is started. The CLI exits after one task.

### Stdin Detection

The CLI should detect whether stdin is a TTY:
- **TTY** — `-p` without a value is an error (no interactive prompt in non-interactive mode)
- **Pipe** — `-p` without a value reads from pipe until EOF

### Interaction with Hooks (S16)

Non-interactive mode fires the same hook events as the REPL: `pre_task`, `post_task`, `error`. It does NOT fire `session_start`/`session_end` (there is no session). Hooks can distinguish non-interactive runs via `TEAMMATES_INTERACTIVE=false` env var.

### Interaction with Memory

- Recall is queried before the task (same as REPL mode)
- Recall index is synced after the task (same as REPL mode)
- The teammate writes to its daily log and memory files as normal
- No session file is created or injected (session files are REPL-only)

## CI/CD Examples

### GitHub Actions: Code Review

```yaml
- name: Review PR with teammates
  run: |
    teammates -p "Review the changes in this PR for security and ownership violations. The diff is:
    $(git diff origin/main...HEAD)" \
      --teammate beacon --format json --no-handoffs --timeout 120
```

### Pre-commit Hook

```bash
#!/bin/sh
# .git/hooks/pre-commit
teammates -p "Check if these staged files violate any ownership boundaries:
$(git diff --cached --name-only)" --teammate pipeline --format text --quiet
```

### Cron Job: Daily Health Check

```bash
# Run daily via cron
teammates -p "/health" --teammate scribe --format json >> /var/log/teammates-health.json
```

## Documentation Updates (Scribe)

- Add "Non-Interactive Mode" section to CLI README with usage examples
- Add CI/CD recipes to cookbook (GitHub Actions, pre-commit, cron)
- Document exit codes in CLI README
- Update ARCHITECTURE.md with non-interactive flow path

## Implementation Notes (for Beacon)

- Parse `-p` in the existing CLI entry point (`cli.ts`) — if present, skip REPL setup entirely
- Reuse `orchestrator.assign()` for task execution — the orchestrator doesn't care about interactivity
- `--format json` should use `JSON.stringify(result, null, 2)` for readability when stdout is a TTY, compact when piped
- `--quiet` should default based on `process.stdout.isTTY`
- Consider `--dry-run` flag that shows routing decision without executing (useful for debugging)
