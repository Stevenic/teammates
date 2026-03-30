---
layout: default
title: Adoption Guide
---

# Adopting Teammates in an Existing Project

A practical guide for introducing AI teammates to a team that's already shipping code.

---

## Who This Is For

You have a codebase, a team, and AI coding tools already in use. You want to move from ad-hoc AI sessions (where every conversation starts from scratch) to persistent AI personas that accumulate knowledge and respect ownership boundaries.

## Before You Start

**Prerequisites:**
- A git repository with at least a few hundred lines of code
- At least one person willing to run the onboarding process
- Node.js installed (for the CLI)

**Time commitment:** The initial onboarding takes 15-30 minutes of interaction with your AI tool. After that, teammates are self-maintaining.

## Step 1: Start Small

Don't try to cover your entire codebase on day one. Pick **2-3 teammates** that cover the areas you work in most. You can always add more later.

Good starting points:
- One teammate for your core domain logic
- One teammate for your API/infrastructure layer
- One teammate for your UI (if applicable)

**Skip** dedicated testing, DevOps, or documentation teammates unless your project is large enough to justify them.

## Step 2: Run Onboarding

Install and launch the CLI:

```bash
npm install -g @teammates/cli
cd your-project
teammates claude       # or codex, aider, copilot
```

On first run, the CLI walks you through two setup steps **before** the terminal UI starts:

1. **User profile** — You'll be asked for an alias (required, used for `@mentions`), plus optional fields like name, role, and preferences. This creates your user avatar — a `.teammates/<alias>/` folder with `SOUL.md` marked `**Type:** human` — so you appear in the roster alongside your AI teammates.

2. **Team setup** — Choose **New team** and the agent will analyze your codebase, propose a roster, get your approval, and scaffold everything. All onboarding agents run non-interactively (no additional prompts).

**Key moment:** When the agent proposes the roster, push back if the domains are too narrow. Fewer teammates with broader scope is almost always better than many narrow specialists.

**Tip:** The CLI includes 15 built-in personas (PM, SWE, DevOps, QA, Security, Designer, and more) as starting points. Each persona comes with a pre-filled SOUL.md scaffold — identity, principles, quality bar, and ownership structure — that the onboarding agent customizes to your project.

> **Without the CLI:** You can also point any AI tool at `ONBOARDING.md` directly. See the [README](https://github.com/Stevenic/teammates#framework-only-no-cli) for details.

## Step 3: Commit the `.teammates/` Directory

The `.teammates/` directory belongs in version control (except `USER.md`, which is gitignored automatically). This means:

- Everyone on the team sees the same teammates
- Teammate knowledge (WISDOM.md, memory files) persists across branches
- Code reviews can include teammate file changes

```bash
git add .teammates/
git commit -m "Add AI teammates"
```

## Step 4: Start Using Teammates

### With the CLI (recommended)

```bash
teammates claude   # or your preferred adapter
```

The CLI handles routing, handoffs, and memory injection automatically.

### With a standalone AI tool

Tell your agent at the start of each session:

> Read `.teammates/<name>/SOUL.md`, `.teammates/<name>/GOALS.md`, and `.teammates/<name>/WISDOM.md` before starting work.

Most tools support system prompts or project instructions where you can add this permanently.

## Step 5: Let Teammates Learn

The first few sessions will feel similar to normal AI usage. The value compounds over time:

- **Week 1** — Teammates learn your preferences and project context through daily logs and typed memories
- **Week 2-4** — Memory accumulates. Teammates stop asking questions they've already resolved
- **Month 2+** — Wisdom emerges from compacted memories. Teammates internalize patterns and principles

**Don't skip the memory step.** After each session, make sure the teammate wrote a daily log entry. If it didn't, remind it. The daily log is how knowledge persists.

## Rolling Out to a Team

### The gradual approach (recommended)

1. **One person** sets up teammates and uses them for a sprint
2. They share results with the team — show the before/after of AI sessions with and without teammates
3. **Interested team members** start using the same teammates (they're already in the repo)
4. The team adjusts ownership boundaries as they discover what works

### Common questions from teammates (the human ones)

**"Do I have to use these?"**
No. Teammates are opt-in. The `.teammates/` directory doesn't affect anyone who doesn't read it. People who prefer raw AI sessions can keep doing that.

**"Will this slow me down?"**
The overhead is near zero. You point your AI tool at a SOUL.md file. Everything else happens automatically. The time saved by not re-explaining your project every session far outweighs the setup.

**"What if two people use the same teammate at once?"**
Teammates write to their own memory files. If two people use the same teammate simultaneously, you might get a merge conflict in a daily log file. Resolve it like any other merge conflict — keep both entries.

**"Can I customize a teammate for my workflow?"**
`USER.md` is gitignored and local to each person. Fill it in with your preferences, and teammates will adapt their communication style and detail level to you specifically.

## When to Add More Teammates

Signs you need another teammate:
- One teammate's ownership scope has grown too broad (covering 3+ distinct subsystems)
- You frequently hand off between two domains that don't have clear owners
- A new package or service has been added to the monorepo

Signs you have too many teammates:
- Some teammates rarely get used
- Ownership boundaries create friction more than clarity
- Handoffs between teammates outnumber direct tasks

## When to Restructure

Teammates aren't permanent. Restructure when:
- **Merging** — Two teammates cover domains that have converged. Merge their SOUL.md files, combine their memories, and delete the redundant folder
- **Splitting** — One teammate's domain has grown too large. Create a new teammate and transfer the relevant ownership patterns
- **Retiring** — A subsystem has been removed from the codebase. Delete the teammate's folder and update the roster

## Troubleshooting

**"The AI doesn't read SOUL.md automatically"**
Add it to your tool's project instructions or system prompt. Most tools have a way to inject files at session start.

**"Memory files are getting huge"**
Run `/compact` (via the CLI) or tell the teammate to compact its memories. This rolls daily logs into weekly summaries and distills typed memories into wisdom.

**"Teammates give inconsistent answers"**
Check WISDOM.md — if it's empty, the teammate hasn't been compacted yet. Run `/compact` to distill patterns from accumulated memories.

**"Ownership boundaries feel wrong"**
Edit the SOUL.md files directly. Boundaries are just markdown — change them, update the roster in README.md, and the team adapts immediately.

---

## Summary

1. Start with 2-3 teammates covering your most-used domains
2. Commit `.teammates/` to version control
3. Let knowledge accumulate through daily logs and typed memories
4. Compact periodically to build wisdom
5. Add or restructure teammates as your project evolves
