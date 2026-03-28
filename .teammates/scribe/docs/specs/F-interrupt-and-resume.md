# F — Interrupt and Resume

**Status:** Draft
**Author:** Scribe
**Date:** 2026-03-27
**Implements:** Agent-agnostic interrupt/resume using conversation logs as checkpoints

---

## Problem

When an agent hits the 600s timeout (or hangs for any reason), the process is force-killed and all in-flight work is lost. The user must manually re-assign the task from scratch, losing:

- All tool calls the agent already completed (file writes, searches, etc.)
- The agent's reasoning context and partial progress
- Any decisions the agent made during execution

This is especially painful for long-running tasks like bulk file creation (42+ files) where the agent may have completed 80% of the work before being killed.

## Solution

**Checkpoint/restore using the conversation log as state.** Every agent session already produces a log of tool calls and responses. On interrupt (manual or automatic), we:

1. Kill the running agent process
2. Capture the conversation log up to the kill point
3. Append the user's interruption text (or an automatic "wrap up" message)
4. Re-submit everything as a new prompt with the original context preserved

The resumed agent sees its own prior work and the user's steering, and picks up where it left off.

## Why This Works

Claude (and other agents) are stateless per invocation — they build context from the prompt. The conversation log IS the state. By replaying it, we reconstruct the agent's full context without any special checkpoint infrastructure.

Key insight: the agent's tool call log is already a complete record of what happened. File writes are on disk. Searches were already performed. The log tells the resumed agent "you already did X, Y, Z — now continue from here."

## Architecture

### Data Flow

```
                    ┌──────────────────────────┐
                    │   Original Prompt         │
                    │   (identity + memory +    │
                    │    task + context)         │
                    └──────────┬───────────────┘
                               │
                               ▼
                    ┌──────────────────────────┐
                    │   Agent Execution         │
                    │   (tool calls streaming   │
                    │    to debug log)           │
                    │                           │
                    │   ⚡ INTERRUPT ⚡          │
                    └──────────┬───────────────┘
                               │
                    ┌──────────▼───────────────┐
                    │   Log Capture             │
                    │   - Claude: --debug-file  │
                    │   - Codex: --json JSONL   │
                    │   - Other: stdout capture │
                    └──────────┬───────────────┘
                               │
                    ┌──────────▼───────────────┐
                    │   Resume Prompt Assembly  │
                    │                           │
                    │   [Original full prompt]  │
                    │   [Conversation log]      │
                    │   [User interruption]     │
                    │   [Resume instructions]   │
                    └──────────┬───────────────┘
                               │
                               ▼
                    ┌──────────────────────────┐
                    │   New Agent Invocation    │
                    │   (picks up from where    │
                    │    it left off)            │
                    └──────────────────────────┘
```

### Log Sources by Agent

| Agent | Log Source | Format | Location |
|-------|-----------|--------|----------|
| Claude | `--debug-file` | Structured debug log with tool calls | `.teammates/.tmp/debug/agent-<name>-<ts>.log` |
| Codex | `--json` stdout | JSONL with `item.completed` events | Captured in `SpawnResult.stdout` |
| Aider | stdout | Unstructured text output | Captured in `SpawnResult.output` |
| Generic | stdout/stderr | Raw output | Captured in `SpawnResult.output` |

### Log Parsing: What to Extract

The resume prompt needs a condensed version of what happened, not the raw log. Extract:

1. **Tool calls and their results** — "You wrote file X with content Y", "You searched for Z and found W"
2. **Agent's reasoning text** — Visible thinking/planning output between tool calls
3. **Partial progress indicators** — "You completed 28 of 42 file writes"
4. **Error states** — Any errors encountered before the interrupt

For Claude specifically, the `--debug-file` contains structured JSON with each tool call, its parameters, and result. This is the richest source.

### Resume Prompt Structure

```markdown
<RESUME_CONTEXT>
This is a resumed task. You were previously working on this task but were interrupted.
Below is the log of what you accomplished before the interruption.

DO NOT repeat work that is already done. Check the filesystem for files you already wrote.
Continue from where you left off.

## What You Did Before Interruption

[Condensed conversation log — tool calls, results, reasoning]

## Interruption

[User's message OR automatic timeout message]

## Your Task Now

Continue the original task from where you left off. The original task was:

[Original task prompt]
</RESUME_CONTEXT>
```

## Implementation

### Phase 1: Manual Interrupt (`/interrupt`)

**New slash command:** `/interrupt <teammate> [message]`

| Parameter | Required | Description |
|-----------|----------|-------------|
| `teammate` | Yes | The teammate to interrupt |
| `message` | No | Steering text appended to the resume prompt. Default: "Wrap up your current work and report what you've done so far." |

**Behavior:**

1. Check if the named teammate has an active task (`agentActive` map)
2. Kill the agent process (SIGTERM → 5s → SIGKILL, same as timeout)
3. Wait for the process to exit and capture output
4. Parse the conversation log from the debug file (Claude) or captured stdout (others)
5. Build the resume prompt: original full prompt + condensed log + user's interruption text + resume instructions
6. Queue a new task for the same teammate with the resume prompt
7. Display status: `"Interrupted @beacon — resuming with: <message>"`

**Implementation location:** `TeammatesREPL` in `cli.ts`

**New methods:**

```typescript
// Kill the active agent process and capture its state
private async interruptAgent(teammate: string): Promise<InterruptState | null>

// Parse a debug/output log into a condensed conversation summary
private parseAgentLog(teammate: string, spawnResult: SpawnResult): string

// Build a resume prompt from original context + log + interruption
private buildResumePrompt(
  originalPrompt: string,
  conversationLog: string,
  interruptionMessage: string
): string
```

**New type:**

```typescript
interface InterruptState {
  teammate: string;
  originalTask: string;
  originalFullPrompt: string;
  conversationLog: string;
  elapsedMs: number;
  toolCallCount: number;
  filesWritten: string[];
}
```

**Key requirement:** The adapter needs to expose the running child process so the REPL can kill it on demand. Currently `spawnAndProxy` returns a Promise — it needs to also expose a `kill()` handle.

### Phase 2: Automatic Interrupt on Timeout

**Trigger:** When an agent reaches 80% of its timeout (480s of 600s default), instead of waiting for the hard kill at 100%, automatically interrupt with a "wrap up" message.

**Soft timeout message:**
```
You are running low on time. You have approximately 2 minutes remaining.
Stop starting new work. Finish any in-progress file writes, update your
session notes with what you've accomplished so far, and produce your
text response now.
```

**Hard timeout (100%):** If the agent doesn't finish within the remaining 20%, proceed with the full interrupt-and-resume flow using the automatic message: "Your previous session timed out. Continue from where you left off."

**Implementation:** Add a second timer in `spawnAndProxy` at 80% of the timeout. This timer doesn't kill the process — it triggers the soft interrupt flow.

However, there's a constraint: **we cannot inject messages into a running Claude `-p` session.** The stdin pipe is closed after sending the initial prompt. So the soft timeout must work differently:

**Option A — Pre-task budget hint:** Include a time budget in the original prompt: "You have approximately 10 minutes. If your task involves creating many files, batch them into groups of 10 and produce a checkpoint response after each batch."

**Option B — Kill and resume at 80%:** At the 80% mark, kill the agent and immediately resume with the timeout warning + conversation log. The agent gets a fresh 10-minute window to finish.

**Recommended: Option B** — it's clean, uses the same mechanism as manual interrupt, and doesn't rely on the agent honoring a time hint.

### Phase 3: Log Compaction for Long Sessions

For agents that run for 8+ minutes before interrupt, the conversation log may be too large to replay in full. Add a compaction step:

1. **Count tokens** in the parsed conversation log
2. If under 8k tokens, use as-is
3. If over 8k, summarize:
   - List all tool calls with file paths (not full content)
   - List all files written/modified (verify they exist on disk)
   - Summarize reasoning into 2-3 sentences
   - Note the last completed action

This keeps the resume prompt within budget while preserving the critical "what was done" information.

## Adapter Changes Required

### CliProxyAdapter

The adapter currently returns `Promise<TaskResult>` from `executeTask` — it blocks until the agent finishes or times out. For interrupt support, we need the ability to kill a running agent mid-execution.

**Option 1: Expose the child process**

Add a method to get (or kill) the active child process:

```typescript
// New on CliProxyAdapter
private activeProcesses: Map<string, ChildProcess> = new Map();

async killAgent(teammate: string): Promise<SpawnResult | null> {
  const child = this.activeProcesses.get(teammate);
  if (!child || child.killed) return null;
  child.kill("SIGTERM");
  // Wait for process exit and return captured output
  return this.waitForExit(child);
}
```

**Option 2: AbortController pattern**

Pass an `AbortSignal` to `executeTask` that the REPL can trigger:

```typescript
async executeTask(
  sessionId: string,
  teammate: TeammateConfig,
  prompt: string,
  options?: { raw?: boolean; signal?: AbortSignal }
): Promise<TaskResult>
```

**Recommended: Option 1** — simpler, more direct, and we need the SpawnResult back for log capture.

### AgentAdapter Interface

Add to the interface:

```typescript
interface AgentAdapter {
  // ... existing methods ...

  /** Kill a running agent and return its partial output. */
  killAgent?(teammate: string): Promise<SpawnResult | null>;
}
```

Optional method — adapters that don't support interruption simply don't implement it.

## Claude Debug Log Parsing

The Claude `--debug-file` contains structured entries. Key patterns to extract:

```
Tool call: Write { file_path: "...", content: "..." }
Tool result: { success: true }
Tool call: Read { file_path: "..." }
Tool result: { content: "..." }
```

The parser should:
1. Read the debug file
2. Extract tool call name + key parameters (file paths, search queries — NOT full file contents)
3. Extract tool results (success/failure, file paths found — NOT full content)
4. Build a condensed timeline: "1. Wrote `foo.json` 2. Read `bar.md` 3. Searched for 'baz' ..."

Full file contents are NOT included in the resume — the agent can re-read files if needed. This keeps the log compact.

## Token Budget

| Component | Budget |
|-----------|--------|
| Original full prompt (identity + memory + task) | ~12-16k |
| Conversation log (condensed) | ≤ 8k |
| Resume instructions | ~500 |
| User interruption text | ~200 |
| **Total resume prompt** | **~21-25k** |

This fits within Claude's context window with plenty of room for the agent to work.

## Edge Cases

### Idempotency
The resumed agent must not re-write files that already exist with the correct content. The resume instructions explicitly say "DO NOT repeat work that is already done. Check the filesystem." For bulk file creation, the agent can `ls` the target directory to see what's already been written.

### Partial File Writes
If the agent was killed mid-write, the file may be truncated or corrupt. The resume log should note "last action was writing file X — verify it's complete." The agent can then check and re-write if needed.

### Multiple Interrupts
A task can be interrupted and resumed multiple times. Each resume adds another layer of context. After 2+ resumes, the log should be aggressively compacted to avoid context bloat.

### Handoff Mid-Task
If an agent was about to hand off when interrupted, the handoff block won't have been parsed. The resume prompt should include: "If you were about to hand off work, include the handoff block in your response."

### Non-Claude Agents
Codex's `--json` JSONL output is parseable. Aider's stdout is less structured but still captures tool usage. The parser should have per-preset strategies with a fallback to raw output truncation.

## Open Questions

1. **Debug file availability:** Is the Claude `--debug-file` flushed in real-time, or only on process exit? If only on exit, we may need to rely on captured stdout instead for agents killed by SIGTERM.

2. **Resume prompt injection point:** Should the resume context go inside `<TASK>` (as part of the task prompt) or as a separate `<RESUME_CONTEXT>` section? Separate section is cleaner but requires changes to `buildTeammatePrompt`.

3. **Conversation history on resume:** Should the resumed task be stored as a continuation of the original conversation history entry, or as a new entry? New entry is simpler; continuation preserves the "one task, one thread" model.

## Work Allocation

| Teammate | Work |
|----------|------|
| **Scribe** | Spec (this doc), resume prompt template, documentation updates |
| **Beacon** | Adapter changes (killAgent, activeProcesses), log parser per preset, `/interrupt` command, auto-interrupt timer, resume prompt assembly, token counting/compaction |
| **Pipeline** | Test scenarios for interrupt/resume (timeout simulation, multi-interrupt, cross-agent) |

## Dependency

- No external dependencies. Uses existing debug log infrastructure.
- Phase 2 auto-interrupt should ship alongside or after Phase 1 manual interrupt.

---

## Review Log

| Date | Reviewer | Notes |
|------|----------|-------|
| 2026-03-27 | stevenic | Initial design discussion — approved concept |
