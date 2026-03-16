---
layout: default
title: Vision
---

# Teammates: Persistent AI Specialists with Institutional Memory

## Executive Summary

Teammates is a framework for organizing AI agents into persistent, specialized roles with accumulated knowledge, clear ownership boundaries, and structured collaboration protocols. Today it orchestrates coding agents across tools like Claude Code, Codex, and Aider. The same architecture — identity, memory, ownership routing, and cross-domain handoffs — maps directly to Microsoft Teams, where it would transform stateless AI copilots into durable, context-rich team members that build institutional knowledge over time.

---

## How Teammates Works Today

### The Problem with AI Agents

AI coding agents are powerful but ephemeral. Every session starts from zero — no memory of past decisions, no understanding of who owns what, no awareness of team conventions. Developers repeat the same context-setting every time. When multiple agents work on the same codebase, there's no coordination, no routing, and no knowledge sharing.

### The Teammates Solution

Teammates introduces a thin layer of structure — plain markdown files stored in a `.teammates/` directory — that gives AI agents persistent identity, memory, and team awareness. Any agent that can read files can participate.

#### Core Primitives

**Identity (SOUL.md)**
Each teammate has a SOUL file defining who they are: their role, core principles, quality bar, and ethical boundaries. Crucially, it also defines **ownership** — the specific file patterns, technologies, and domains they are responsible for. This isn't a system prompt that gets copy-pasted; it's a living document that evolves as the teammate's understanding deepens.

```
Example: "Beacon" — Teammates Platform Engineer
- Owns: recall/src/**, cli/src/**
- Principles: Zero Cloud, Agent-First Design, Handoff Integrity
- Boundaries: Does NOT modify templates (that's Scribe's domain)
```

**Memory (Three Tiers)**
Teammates accumulate knowledge across sessions through a layered memory system:

| Layer | Purpose | Lifecycle |
|---|---|---|
| SOUL.md | Identity, principles, ownership | Evolves slowly over weeks/months |
| MEMORIES.md | Curated lessons, decisions, patterns | Updated when durable insights emerge |
| Daily Logs | Session-level context and notes | Append-only, one file per day |

At the start of every session, an agent reads its SOUL, its curated memories, and recent daily logs. At the end, it writes back what it learned. Knowledge compounds over time.

**Ownership Routing**
When a task arrives, the orchestrator scores it against each teammate's ownership patterns and routes it to the best fit. A bug in the API layer goes to the backend specialist. A CSS issue goes to the frontend owner. No manual triage needed.

**Structured Handoffs**
When a task crosses domain boundaries, teammates produce a handoff envelope — a structured payload containing the task description, changed files, acceptance criteria, and open questions. The receiving teammate picks up exactly where the first left off, with full context. Approval gates let humans review handoffs before they execute.

**Semantic Recall**
As daily logs accumulate, teammates can't read every file at session start. The Recall package provides local semantic search over all teammate memories using on-device embeddings — no cloud calls, no API keys. A teammate can query "what did we decide about the auth migration?" and get relevant context from weeks ago.

#### Architecture

```
User Input (CLI)
      │
      ▼
┌──────────────┐     ┌──────────┐
│ Orchestrator │────▶│ Registry │  Discovers teammates from .teammates/
│              │     └──────────┘  Parses SOUL.md, loads memories
│  Routes task │
│  Manages     │     ┌───────────────┐
│  handoffs    │────▶│ Agent Adapter  │  Spawns any coding agent:
│              │     │               │  Claude Code, Codex, Aider, etc.
└──────────────┘     └───────────────┘
```

The Agent Adapter is a pluggable interface. Today there are presets for Claude, Codex, and Aider, but any CLI tool that accepts a prompt and produces output can be wired in. The orchestrator doesn't care which agent runs — it cares about identity, memory, and routing.

#### What Makes This Different

Most agent frameworks focus on tool use and chain-of-thought. Teammates focuses on something more fundamental: **persistence and specialization**. The insight is that a team of specialists with accumulated knowledge outperforms a single generalist that starts fresh every time — for the same reasons this is true of human teams.

---

## Translating Teammates to Microsoft Teams

The primitives that make Teammates work for coding agents are domain-agnostic. Identity, memory, ownership, routing, and handoffs are organizational concepts, not programming concepts. Microsoft Teams is a natural next surface.

### From Files to Channels: Mapping the Primitives

| Primitive | Coding Agents | Microsoft Teams |
|---|---|---|
| **Identity** | SOUL.md in a git repo | Teammate profile scoped to a team/channel |
| **Ownership** | File glob patterns (`src/api/**`) | Topic patterns, channel scopes, document types |
| **Memory** | Markdown files in `.teammates/` | Structured storage (SharePoint, Graph) |
| **Routing** | Keyword matching on file paths | Semantic matching on message content and channel context |
| **Handoffs** | JSON envelopes between coding agents | Structured task transfers between channel-scoped teammates |
| **Recall** | Local semantic search over memory files | Semantic search over accumulated team knowledge |
| **Adapter** | Spawns Claude/Codex/Aider subprocess | Calls M365 Copilot runtime or Azure OpenAI |

### What This Looks Like in Practice

#### Persistent Channel-Scoped Specialists

Today's Teams bots are stateless — they answer questions based on their training data and whatever context fits in the current conversation window. A Teammates-style agent in the `#customer-escalations` channel would be fundamentally different:

- **It has a SOUL**: "I own initial triage and severity classification for customer-reported issues. I do NOT own engineering root cause analysis — that's the Engineering Triage teammate in `#incidents`."
- **It builds memory**: After handling dozens of escalations, it knows that "Customer X files vague tickets but they're almost always auth-related" and "APAC escalations spike on Monday mornings due to timezone overlap with Friday deployments."
- **It has a quality bar**: "Done means: severity classified, initial response sent within SLA, and routed to the correct engineering team if SEV2+."

This isn't a chatbot with a system prompt. It's a team member that gets better at its job over time.

#### Topic-Based Routing

In the coding world, routing works by matching task descriptions against file ownership patterns. In Teams, the same algorithm operates over richer signals:

- **Channel context** — a message in `#design-reviews` routes to the Design Feedback teammate
- **Message content** — semantic matching against teammate expertise areas
- **Document type** — a `.docx` shared in `#legal` routes to the Contract Reviewer
- **@mentions** — direct routing, same as `@teammate` syntax in the CLI today
- **Conversation thread** — continuity within an ongoing discussion

A message like "Can someone review the SLA terms for the Contoso deal?" in a general channel would auto-route to the Legal teammate based on ownership patterns matching "SLA", "terms", and "deal" — the same scoring algorithm the CLI uses today, applied to natural language instead of file paths.

#### Cross-Functional Handoffs

Today in Teams, cross-functional work is a mess of @mentions, forwarded messages, and lost context. People tag five colleagues, context gets scattered across threads, and someone inevitably asks "wait, what was the original ask?"

The handoff envelope pattern formalizes this:

```
Sales teammate in #deals:
  "Contoso wants custom SLA terms — 99.99% uptime guarantee"

      │
      ▼  Structured handoff

Legal teammate in #contracts:
  Receives: {
    from: "Sales",
    task: "Review custom SLA terms for Contoso",
    context: "Enterprise deal, $2M ARR, 99.99% uptime request",
    acceptanceCriteria: ["Terms reviewed", "Risk assessment complete"],
    openQuestions: ["Do we have precedent for 99.99% in this tier?"]
  }
```

The Legal teammate has full context without anyone re-explaining. It can search its own memories for precedent ("We offered 99.95% to Fabrikam last quarter — check MEMORIES.md entry from January"). When it's done, it hands back a structured result with the risk assessment attached.

Approval gates mean a human reviews the handoff before execution when the stakes warrant it. The max handoff depth (configurable, default 5) prevents infinite loops across departments.

#### Institutional Memory That Survives Reorgs

This is the most significant capability gap in enterprise AI today. Organizational knowledge lives in people's heads, scattered documents, and buried chat threads. When people change roles or leave, that knowledge evaporates.

The three-tier memory model addresses this directly:

| Layer | Enterprise Example | Lifecycle |
|---|---|---|
| **SOUL** | Team charter, operating principles, definition of done | Updated quarterly or during reorgs |
| **Curated Memories** | "Q4 budget requests need VP approval if >$50K"; "The APAC team prefers async updates over meetings"; "Contoso's procurement cycle takes 6 weeks minimum" | Evolves over months as patterns emerge |
| **Daily Logs** | Session notes from each interaction — decisions made, context shared, actions taken | Append-only, searchable via Recall |

When a new teammate (AI or human) joins a channel, they read the SOUL and curated memories to get up to speed. They don't need to scroll through six months of chat history. The Recall system lets them semantically search across all accumulated knowledge: "What did we decide about the auth migration timeline?" returns relevant context from weeks or months ago.

### Architecture in Teams

```
Teams Message / Event
        │
        ▼
┌────────────────┐
│  Orchestrator   │  Same routing + handoff logic as the CLI
│  (Teams Bot /   │  Triggered by Teams events instead of
│   M365 Agent)   │  terminal input
└───────┬────────┘
        │
        ▼
┌────────────────┐
│   Registry      │  Teammate definitions stored in
│                 │  SharePoint / Graph instead of
│                 │  .teammates/ on disk
└───────┬────────┘
        │
        ▼
┌────────────────┐
│  Agent Adapter  │  Calls M365 Copilot runtime or
│                 │  Azure OpenAI instead of spawning
│                 │  CLI subprocesses
└────────────────┘
```

The architecture is the same three layers — Orchestrator, Registry, Agent Adapter — with different backing implementations. The Orchestrator's routing algorithm, handoff management, and approval gates are identical. The Registry reads teammate definitions from SharePoint instead of the filesystem. The Agent Adapter calls Azure OpenAI or the Copilot runtime instead of spawning `claude -p` as a subprocess.

This isn't a rewrite. It's a new adapter layer over the same core.

### Why This Matters

| Current State | With Teammates |
|---|---|
| Bots are stateless — every interaction starts from zero | Teammates accumulate knowledge across every interaction |
| One generic copilot handles everything | Specialized teammates with clear ownership boundaries |
| Cross-functional work requires manual context transfer | Structured handoffs preserve full context automatically |
| Institutional knowledge lives in people's heads | Externalized, searchable, durable memory |
| AI assistants are interchangeable commodities | AI teammates are differentiated by their accumulated expertise |

The fundamental shift: **from AI as a tool you use to AI as a team member that grows.**

Stateless copilots are interchangeable — any vendor's model can answer generic questions. But a teammate that has accumulated six months of context about your customers, your processes, and your team's preferences is not interchangeable. That accumulated knowledge is the moat.

---

## Path Forward

Teammates is open source and working today for coding agents. The path to Microsoft Teams involves:

1. **Adapter layer for Teams** — Implement the `AgentAdapter` interface against the M365 Copilot runtime or Azure OpenAI, and the Registry against SharePoint/Graph for teammate storage.

2. **Orchestrator as a Teams bot** — The existing routing, handoff, and approval logic runs as a Teams bot (or M365 agent) triggered by channel messages instead of CLI input.

3. **Recall over Graph** — The same on-device semantic search, but indexing teammate memories stored in SharePoint rather than local markdown files.

4. **Admin surface for SOUL management** — A lightweight UI for creating and editing teammate identities, ownership patterns, and memory — the equivalent of editing `.teammates/beacon/SOUL.md` in a text editor, but accessible to non-developers.

The core framework — identity, memory, ownership, routing, handoffs, and recall — is built and tested. The work is in the adapter layer, not the architecture.
