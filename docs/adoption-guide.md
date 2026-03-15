# Adopting Teammates in an Existing Project

A practical guide for introducing AI teammates to a team that's already shipping code.

---

## Who This Is For

You have a codebase, a team, and AI coding tools already in use. You want to move from ad-hoc AI sessions (where every conversation starts from scratch) to persistent AI personas that accumulate knowledge and respect ownership boundaries.

## Before You Start

**Prerequisites:**
- A git repository with at least a few hundred lines of code
- At least one person willing to run the onboarding process
- An AI coding tool that can read and write files (Claude Code, Cursor, Windsurf, Aider, etc.)

**Time commitment:** The initial onboarding takes 15-30 minutes of interaction with your AI tool. After that, teammates are self-maintaining.

## Step 1: Start Small

Don't try to cover your entire codebase on day one. Pick **2-3 teammates** that cover the areas you work in most. You can always add more later.

Good starting points:
- One teammate for your core domain logic
- One teammate for your API/infrastructure layer
- One teammate for your UI (if applicable)

**Skip** dedicated testing, DevOps, or documentation teammates unless your project is large enough to justify them.

## Step 2: Run Onboarding

Point your AI tool at `ONBOARDING.md` from the teammates repo. The agent will:

1. Analyze your codebase structure
2. Propose a team roster
3. Ask for your approval
4. Create the `.teammates/` directory with all the files

**Key moment:** When the agent proposes the roster, push back if the domains are too narrow. Fewer teammates with broader scope is almost always better than many narrow specialists.

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

### If you use the CLI orchestrator

```bash
cd cli && npm install && npm run build
teammates claude   # or your preferred adapter
```

The CLI handles routing, handoffs, and memory injection automatically.

### If you use a standalone AI tool

Tell your agent at the start of each session:

> Read `.teammates/<name>/SOUL.md` and `.teammates/<name>/WISDOM.md` before starting work.

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
