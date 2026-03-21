# Recall Query Architecture — Two-Pass Design

## Summary

Recall has a chicken-and-egg problem: the pre-task query must retrieve relevant memories *before* the agent has context to know what's relevant. This spec defines a two-pass architecture that breaks the cycle — a fast, LLM-free priming pass before the task starts, and an agent-driven precision pass during task execution.

## The Problem

### Current Behavior

The CLI adapter passes the raw `taskPrompt` (the user's message) as a single embedding query to recall. This works for explicit requests ("update the hooks spec") but fails for:

- **Indirect relevance** — "let's talk about CI" doesn't surface the hooks spec, even though hooks are CI-relevant
- **Contextual gaps** — the query has no awareness of what the teammate has discussed earlier in the conversation
- **Unknown unknowns** — the teammate can't search for memories it doesn't know exist

### Three Knowledge Sources

At query time, three sources of knowledge are available:

| Source | Available to adapter? | Available to agent? | Notes |
|---|---|---|---|
| **User's current message** | Yes (taskPrompt) | Yes | The only input today |
| **Conversation history** | Yes (conversation context) | Yes | Rich context, but noisy — not all of it is task-relevant |
| **Teammate's own memories** | Yes (memory file index) | Yes (via recall) | The teammate *knows what it knows* — but this signal is unused |

### The Constraint

Query expansion (turning one query into multiple smart queries) typically requires an LLM. But:

- **Recall can't bundle an LLM** — adding even a small local model is a heavy dependency for a search package
- **Recall can't call the coding agent** — the architecture flows one way: adapter → agent. Recall is downstream infrastructure, not an orchestrator.

This means Pass 1 must work without any neural model. The LLM reasoning happens in Pass 2, where the agent itself drives the queries.

---

## Design: Two-Pass Architecture

### Pass 1 — Pre-Task Priming (No LLM)

**When:** Before the task prompt is sent to the coding agent.
**Who runs it:** The CLI adapter (already calls recall today).
**Goal:** Get a "good enough" set of relevant memories into the agent's context so it can self-correct from there.

#### Improvements over current behavior (incremental, no LLM needed):

1. **Keyword extraction** — Extract key terms from the taskPrompt using lightweight NLP (stopword removal, noun phrase extraction). Generate multiple embedding queries from different keyword combinations.

2. **Conversation-aware queries** — If there's conversation history, extract the most recent topic/theme and include it as a secondary query. The adapter already has access to conversation context.

3. **Memory index scanning** — Read the teammate's memory file index (the list of memory files with their `name` and `description` frontmatter). Do a fast text match against the taskPrompt to identify potentially relevant memory files. This is the key insight: **the teammate's memory catalog is a lightweight relevance signal that doesn't require embeddings.**

4. **Multi-query fusion** — Fire 2-3 queries (keyword-based, conversation-based, index-matched) and deduplicate/merge results by cosine similarity threshold (e.g., 0.90).

#### Token budget (unchanged)

Pass 1 results are injected into the prompt under the existing 32k context budget — daily logs get up to 24k, recall gets at least 8k plus any unused daily budget.

#### What this does NOT solve

Pass 1 still can't reason about what's relevant. If the user says "let's continue where we left off," keyword extraction won't help. That's what Pass 2 is for.

---

### Pass 2 — Agent-Driven Recall (During Task)

**When:** During task execution, whenever the agent needs more context.
**Who runs it:** The coding agent itself, by invoking recall as a tool.
**Goal:** Let the agent craft precise, context-aware queries using its full understanding of the task.

#### How it works

Expose recall as a **tool the agent can call mid-task**. The agent has:
- The full conversation history
- The Pass 1 recall results already in context
- Its own SOUL.md, WISDOM.md, and daily logs
- The user's current message and all prior messages

With all of this, the agent can:
- Formulate precise queries ("find memories about the hooks lifecycle event naming decision")
- Search iteratively (query → read result → refine query)
- Cross-reference results with what it already knows
- Decide when it has enough context to proceed

#### Implementation options

| Option | Mechanism | Dependency |
|---|---|---|
| **MCP server** | Recall exposed as an MCP tool server. Agent calls it like any MCP tool. | Requires S26 (MCP Passthrough) to ship first |
| **CLI tool** | Recall exposed as a slash command or built-in tool the adapter maps to a tool call. | Works today, no S26 dependency |
| **Both** | CLI tool as v1, MCP server as v2 once S26 ships. | Incremental delivery |

**Recommendation:** Ship as a CLI tool first (no external dependencies), then add MCP server support when S26 lands. The MCP path is the long-term answer because it works across all agents that support MCP.

---

## Architecture Principles

1. **Recall stays LLM-free.** It's a search engine, not a reasoning engine. Embedding generation is the only ML operation, and that uses a pre-trained model with no inference-time reasoning.

2. **The agent does the reasoning.** Query expansion, relevance judgment, and "what else should I look for?" are all agent responsibilities. Recall provides the search infrastructure.

3. **Two passes break the chicken-and-egg.** You don't need a perfect first query — just a good-enough one. The agent self-corrects during execution. This is how humans work: you start with a rough idea, then refine as you learn more.

4. **The memory index is the missing signal.** A teammate's catalog of what it knows (file names, descriptions, types) is a cheap, no-LLM way to improve Pass 1 relevance. It's not semantic search — it's "here's a menu of what I might know about."

---

## Pass 1 Enhancement: Memory Index as Search Guide

The teammate's memory directory contains files with frontmatter like:

```yaml
---
name: project_goals
description: Stack-ranked feature goals for the teammates project
type: project
---
```

The adapter can:
1. Read all memory file frontmatter for the target teammate
2. Text-match the taskPrompt against `name` and `description` fields
3. For matches, include the file's content as a recall result (or boost its embedding score)

This turns the memory catalog into a **topic index** — a lightweight "what might be relevant" signal that requires zero ML. It's especially powerful for vague queries like "what are we working on?" where the keyword `project_goals` wouldn't appear in the embedding space but would match against a file named `project_goals.md` with description "Stack-ranked feature goals."

---

## Interaction with Existing Systems

| System | Interaction |
|---|---|
| **Context window budget (32k)** | Pass 1 results consume the recall portion of the budget (8k minimum). Pass 2 results are returned as tool call responses — they're part of the conversation, not the injected prompt. |
| **S26 — MCP Passthrough** | Pass 2's long-term delivery mechanism. Recall as an MCP server means any MCP-capable agent gets mid-task recall for free. |
| **RESUME.md** | RESUME.md content is indexed in the vector DB. Pass 1 can surface past-project experience; Pass 2 lets the agent explicitly search career history. |
| **Episodic compaction** | Compacted weekly/monthly summaries are in the vector DB. Pass 1 may surface them; Pass 2 lets the agent search across time ranges. |
| **Daily log injection** | Daily logs are injected directly (up to 24k). They're NOT searched via recall — they're already in context. No overlap. |

---

## Open Questions

1. **Pass 2 token accounting** — When the agent calls recall mid-task, those results add to the conversation length. Should there be a per-query result limit? Or trust the agent to manage its own context?

2. **Memory index format** — Should the adapter build a lightweight in-memory index of all memory files at startup, or read frontmatter on-demand per query? Startup cost vs. query-time cost.

3. **Cross-teammate search in Pass 2** — Should the agent be able to search other teammates' memories via recall? This ties into F3 (Decision Synthesis) which defines authority ranking for cross-teammate results.

---

## Handoff

- **Pass 1 improvements:** Spec complete. Hand off to @beacon for implementation in the adapter's recall query logic.
- **Pass 2 (CLI tool):** Spec complete. Hand off to @beacon for a `/recall` or tool-based search command.
- **Pass 2 (MCP server):** Blocked on S26. Design is ready; implementation deferred.
