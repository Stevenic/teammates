# Attention Dilution Fix — Spec

**Author:** Lexicon
**Date:** 2026-03-27
**Status:** Proposed
**Failure:** Scribe failed to process conversation history in `<TASK>`, spent all tool calls on continuity housekeeping, and couldn't even recognize itself despite SOUL.md being at the top of the prompt.

---

## Diagnosis

Three layers are broken simultaneously:

### 1. Distance Problem — Task instruction buried
The actual user request (`@scribe create a list of all the ideas`) sits at the very bottom of `<TASK>`, **after** ~3000+ words of conversation history. The model's attention anchored on daily logs and continuity instructions rather than traversing down to find the instruction.

### 2. Compression Problem — Noise ratio too high
- `<DAILY_LOGS>` contained ~29 entries for 3/26 alone — thousands of tokens of detailed task summaries
- `<RECALL_RESULTS>` duplicated content already present in `<DAILY_LOGS>` (recall indexes daily logs, so they get retrieved again)
- Combined noise overwhelmed the signal (the 6 brainstorm responses + the instruction)

### 3. Decompression Problem — Continuity housekeeping hijacked the turn
The `<INSTRUCTIONS>` block tells the model to read/update session files and daily logs. Under heavy context pressure, the model prioritized these mechanical steps (4 tool calls on file I/O) and exhausted its turn before reaching the actual task.

---

## Fixes (5 changes to `adapter.ts`)

### Fix 1: Deduplicate recall results against daily logs
**Layer:** Compression (noise reduction)
**Location:** `buildTeammatePrompt()`, recall results section (~line 318)

Before injecting recall results, filter out any result whose `uri` matches a daily log file pattern (`memory/YYYY-MM-DD.md`) that's already included in `<DAILY_LOGS>`. The daily logs are already in the prompt — re-injecting them via recall wastes tokens and creates duplicate attention targets.

```typescript
// Filter recall results that duplicate daily log content already in the prompt
const dailyLogDates = new Set(
  teammate.dailyLogs.slice(0, 7).map(log => log.date)
);
const dedupedResults = recallResults.filter(r => {
  // Match daily log URIs like "scribe/memory/2026-03-26.md"
  const dailyMatch = r.uri.match(/memory\/(\d{4}-\d{2}-\d{2})\.md/);
  if (dailyMatch && dailyLogDates.has(dailyMatch[1])) return false;
  return true;
});
```

### Fix 2: Cut daily log budget in half
**Layer:** Compression (noise reduction)
**Location:** `DAILY_LOG_BUDGET_TOKENS` constant (~line 168)

Reduce from 24,000 to 12,000 tokens. Past daily logs are reference material, not active context. 12K is still generous for 6 days of history. The freed budget flows to recall (which is task-relevant) via the existing spillover mechanism.

```typescript
export const DAILY_LOG_BUDGET_TOKENS = 12_000;
```

### Fix 3: Add task instruction echo at the bottom of `<INSTRUCTIONS>`
**Layer:** Distance (proximity + positional attention)
**Location:** `buildTeammatePrompt()`, at the very end of `instrLines` (~line 486)

Extract the last user message from the task prompt and echo it at the bottom edge. This creates a bidirectional attention bridge: the instruction appears both where the conversation history is (inside `<TASK>`) AND at the bottom edge (inside `<INSTRUCTIONS>`) where positional attention is strongest.

Implementation: Extract the text after the last `**stevenic:**` (or `**<username>:**`) marker in the taskPrompt. If the extracted text is under 500 chars, echo it verbatim. Otherwise, include just a pointer: "The user's request is at the end of `<TASK>` — read it carefully before doing anything else."

```typescript
// Echo the actual task instruction at the bottom edge for maximum attention
const lastUserMsg = taskPrompt.match(/\*\*\w+:\*\*\s*(.+?)$/s);
if (lastUserMsg) {
  const instruction = lastUserMsg[1].trim();
  if (instruction.length < 500) {
    instrLines.push("", `**THE USER'S REQUEST:** ${instruction}`);
  } else {
    instrLines.push("", "**IMPORTANT: The user's actual request is at the end of \\`<TASK>\\`. Read and address it before doing anything else.**");
  }
}
```

**Wait — better approach:** Instead of regex extraction, the orchestrator already knows the raw user message (it's what gets passed as `taskPrompt` before conversation history is prepended). Pass the raw user instruction as a separate field and echo it at the bottom.

### Fix 4: Deprioritize continuity housekeeping in instructions
**Layer:** Decompression (prevent housekeeping from hijacking the turn)
**Location:** `buildTeammatePrompt()`, Session State and Memory Updates sections

Change the language from imperative ("Always read it, always update it") to deferred:
- Session State: "**After completing the task**, update your session file..." (already says this, but reinforce)
- Add at the TOP of Instructions: **"Your FIRST priority is answering the user's request in `<TASK>`. Session updates, memory writes, and continuity housekeeping are SECONDARY — do them AFTER producing your response, not before."**

This doesn't remove continuity — it just ensures the model processes the task first and does housekeeping after.

### Fix 5: Conversation history as a file reference (optional, for very long conversations)
**Layer:** Compression (reduce inline noise)
**Location:** Orchestrator (not adapter.ts — wherever conversation history is prepended to taskPrompt)

When conversation history exceeds a threshold (e.g., 2000 tokens), write it to a temp file and inject a pointer instead of inlining it:
```
## Conversation History
The full conversation is in `.teammates/.tmp/conversation-<id>.md`. Read it before responding.
```

This moves bulk content out of the token stream and lets the model decide when to load it via a tool call. **Tradeoff:** adds a tool call but dramatically reduces prompt noise. Should be optional / behind a threshold.

---

## Priority Order

1. **Fix 4** (deprioritize housekeeping) — zero-cost, immediate impact, prevents the "4 tool calls on file I/O" failure mode
2. **Fix 1** (dedup recall vs daily logs) — eliminates the most obvious waste
3. **Fix 2** (cut daily log budget) — reduces noise floor
4. **Fix 3** (task instruction echo) — ensures the actual request gets bottom-edge attention
5. **Fix 5** (conversation-as-file) — biggest structural change, most risk, do last

---

## Acceptance Criteria

- Recall results never duplicate content already present in `<DAILY_LOGS>`
- Daily log budget is 12K tokens (down from 24K)
- `<INSTRUCTIONS>` opens with a priority statement putting the task first
- The user's actual request is echoed or referenced at the bottom edge of the prompt
- All existing tests pass
