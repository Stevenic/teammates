# Teammates Onboarding

> **This file contains instructions for an AI agent.** Point your agent at this file to set up teammates for a codebase.

You are going to analyze a codebase and create a set of AI teammates — persistent personas that each own a slice of the project. Follow these steps in order.

---

## Step 1: Analyze the Codebase

Read the project's entry points to understand its structure:

- README, CONTRIBUTING, or similar docs
- Package manifest (`package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `*.csproj`, etc.)
- Top-level directory structure
- Key configuration files

Identify:

1. **Major domains/subsystems** — What are the distinct areas of the codebase? (e.g., data layer, API layer, UI layer, CLI, shared libraries)
2. **Dependency flow** — Which layers depend on which? What's upstream vs downstream?
3. **Key technologies** — What languages, frameworks, and tools are used in each area?
4. **File patterns** — What glob patterns correspond to each domain? (e.g., `src/api/**`, `lib/core/**`)

**Present your analysis to the user and get confirmation before proceeding.**

---

## Step 2: Design the Team

Based on your analysis, propose a roster of teammates:

- **Aim for 3–7 teammates.** Fewer for small projects, more for monorepos. When in doubt, fewer teammates with broader domains is better than many narrow ones.
- **Each teammate owns a distinct domain** with minimal overlap.
- **One teammate per major subsystem** is the baseline.
- **Consider a cross-cutting teammate** for testing/quality if the codebase is large enough to warrant it.
- **Pick short, memorable names** — one word, evocative of the domain. (e.g., Atlas for backend, Pixel for UI, Forge for CI/CD)

For each proposed teammate, define:

- Name and one-line persona
- Primary ownership (file patterns)
- Key technologies they work with
- Boundaries (what they do NOT own)

**Present the proposed roster to the user for approval.** Adjust based on their feedback.

---

## Step 3: Create the Directory Structure

Once the user approves the roster, create the `.teammates/` directory in the target project.

### 3a: Copy and populate framework files

Copy the following files from this repo's `template/` directory into the target project's `.teammates/` directory:

| Source | Destination |
|---|---|
| `template/CROSS-TEAM.md` | `.teammates/CROSS-TEAM.md` |
| `template/TEMPLATE.md` | `.teammates/TEMPLATE.md` |
| `template/USER.md` | `.teammates/USER.md` |
| `template/.gitignore` | `.teammates/.gitignore` |
| `template/DECISIONS.md` | `.teammates/DECISIONS.md` |
| `template/services.json` | `.teammates/services.json` |

**Populate CROSS-TEAM.md immediately** — fill in the Ownership Scopes table with one row per teammate. Each row should list the teammate's self-owned folder (`.teammates/<name>/**`) and their codebase ownership paths (matching the Primary Ownership section of their SOUL.md). Do not leave the placeholder row.

### 3b: Create README.md

Create `.teammates/README.md` using `template/README.md` as the structure. Fill in:

- Project name and team description
- Roster table with all teammates, their personas, primary ownership paths, and today's date
- Dependency flow diagram showing the upstream → downstream relationships
- Routing guide mapping keywords to teammates

### 3c: Create PROTOCOL.md

Create `.teammates/PROTOCOL.md` using `template/PROTOCOL.md` as the structure. Customize:

- The dependency direction diagram with this project's actual layer names
- The conflict resolution table with domain-appropriate rules
- Cross-cutting concerns for this project's quality/testing teammate (if any)

### 3d: Create teammate folders

For each teammate, create a folder at `.teammates/<name>/` containing:

**SOUL.md** — Use the SOUL.md template from `template/TEMPLATE.md`. Fill in every section with project-specific details. Reference `template/example/SOUL.md` for the level of detail and tone expected.

**WISDOM.md** — Use the WISDOM.md template from `template/TEMPLATE.md`. Leave it in its initial empty state — wisdom entries emerge after the first compaction.

**memory/** — Create a `memory/` directory in each teammate's folder with `weekly/` and `monthly/` subdirectories. This is where daily logs (`YYYY-MM-DD.md`), episodic summaries (`weekly/YYYY-Wnn.md`, `monthly/YYYY-MM.md`), and typed memory files (`<type>_<topic>.md`) will accumulate over time. No need to create any files yet — just the directory structure.

---

## Step 4: Verify

Before finishing, check:

- [ ] Every teammate in the README roster has a corresponding folder with SOUL.md and WISDOM.md
- [ ] README.md roster matches the actual folders
- [ ] Ownership globs across all SOUL.md files collectively cover the codebase without major gaps or overlaps
- [ ] Boundaries in each SOUL.md correctly reference the teammate who DOES own that area
- [ ] Dependency flow in README.md and PROTOCOL.md are consistent
- [ ] PROTOCOL.md conflict resolution table makes sense for this project's domain structure
- [ ] CROSS-TEAM.md Ownership Scopes table has one row per teammate with correct paths
- [ ] `.gitignore` is in place (USER.md should not be committed)
- [ ] USER.md exists and the user has been prompted to fill it in

---

## Multi-Project Setup

The default onboarding assumes a single repository. For monorepos or multi-repo setups, adapt as follows.

### Monorepo (multiple packages, one repo)

A monorepo with distinct packages (e.g., `packages/api`, `packages/web`, `packages/shared`) benefits from teammates whose ownership aligns with package boundaries.

**How it differs from single-repo:**

1. **Step 1 (Analysis)** — Map packages, not just directories. Identify which packages are upstream (shared libraries) and which are downstream (apps/services). Note cross-package dependencies.

2. **Step 2 (Team Design)** — Assign teammates at the **package or package-group level**, not at the file level. For example:
   - One teammate for `packages/api` + `packages/shared` (if they share a maintainer)
   - One teammate for `packages/web`
   - One teammate for `packages/mobile`
   - One cross-cutting teammate for CI/CD and release automation

   Avoid assigning one teammate per package unless packages are large and independently maintained. Fewer teammates with broader scope is better.

3. **Step 3 (Directory Structure)** — Place `.teammates/` at the **repo root**, not inside individual packages. All teammates share one `.teammates/` directory, even if they own different packages.

4. **Step 3b (README.md)** — The dependency flow diagram should reflect the package dependency graph:
   ```
   shared (upstream)
     ↓
   api / web / mobile (downstream)
     ↓
   CI/CD (cross-cutting)
   ```

5. **Step 4 (Verify)** — Confirm that every package is covered by at least one teammate's ownership globs. Shared code (`packages/shared/**`) should have a clear primary owner.

### Multi-Repo (separate repositories, shared team)

When teammates span multiple repositories (e.g., a backend repo and a frontend repo maintained by the same team), each repo gets its own `.teammates/` directory.

**How it differs from single-repo:**

1. **Each repo has its own `.teammates/`** — Run onboarding independently in each repository. Teammates in repo A do not directly reference files in repo B.

2. **Shared teammates across repos** — If the same persona (e.g., "Atlas" for backend) exists in multiple repos, keep the SOUL.md files consistent but independent. Each repo's copy tracks its own memories and wisdom.

3. **Cross-repo handoffs** — When a task spans repos, the teammate in repo A should describe the needed change and tell the user to hand it off to the corresponding teammate in repo B. The handoff is manual (the user switches repos), not automatic.

4. **Shared framework files** — PROTOCOL.md, CROSS-TEAM.md, and TEMPLATE.md can be copied from this repo's `template/` directory into each repository independently. They don't need to stay in sync across repos, but starting from the same template keeps conventions consistent.

**Example — two repos:**
```
backend-repo/
  .teammates/
    README.md
    PROTOCOL.md
    atlas/         # Backend teammate
    forge/         # CI/CD teammate

frontend-repo/
  .teammates/
    README.md
    PROTOCOL.md
    pixel/         # UI teammate
    forge/         # CI/CD teammate (separate copy, same persona)
```

### When to Use Which

| Setup | When to use |
|---|---|
| **Single repo** (default) | One repo, one team, one `.teammates/` directory |
| **Monorepo** | Multiple packages in one repo. One `.teammates/` at root, teammates own package globs |
| **Multi-repo** | Separate repos. Each gets its own `.teammates/`, teammates don't cross repo boundaries |

---

## Tips

- **The `template/example/` folder** has a complete worked example of a filled-in teammate (SOUL.md, WISDOM.md, daily logs, typed memories, weekly and monthly summaries). Use it as a reference for tone, detail level, and file structure.
- **WISDOM.md starts empty.** Wisdom entries emerge after the first compaction of typed memories. Don't pre-populate it.
- **Not every SOUL.md section needs to be exhaustive.** Fill in what's known now. Teammates grow more detailed as the project evolves.
- **If the agent can't create directories**, ask the user to create the folder structure manually, then have the agent fill in the file contents.
- **Small projects are fine with 2–3 teammates.** Don't over-partition a small codebase.
- **Prompt the user to fill in USER.md.** It's gitignored and stays local. It helps teammates tailor their communication style and technical depth.
- **Daily logs start empty.** The `memory/` folders are created during onboarding but daily log files are created naturally as teammates work.
- **Souls evolve.** Teammates should update their own SOUL.md as they learn more about their domain. If a teammate changes their SOUL.md, they should tell the user what changed and why.
- **Boundaries are strict.** Teammates must never modify files outside their ownership, even for small or obvious fixes. If a task touches another teammate's domain, they should hand off that portion with a clear description. This prevents stepping on toes and keeps ownership clean.
- **Template versions.** Template files contain a `<!-- template-version: N -->` comment. When copying templates to a project, preserve this marker. It helps detect drift between the upstream framework and a project's local copies.
- **The cookbook has recipes for common tasks.** See `docs/cookbook.md` for step-by-step guides to adding teammates, running retros, recording decisions, handling handoffs, and more.
- **Template upgrades have a guide.** When the upstream `template/` files change version, consult `docs/migration-guide.md` for what changed and how to upgrade your project's `.teammates/` files.
- **Memory search is optional.** For projects that accumulate many memory files, suggest installing `@teammates/recall` for semantic search. It's not required — teammates work fine by reading files directly.
- **Typed memories replace MEMORIES.md.** The old monolithic MEMORIES.md is replaced by individual files in `memory/` with typed frontmatter. See TEMPLATE.md for the full format and examples.
- **Episodic compaction keeps memory lean.** The `/compact` command compacts completed weeks' daily logs into `memory/weekly/` summaries (kept 52 weeks) and old weekly summaries into `memory/monthly/` summaries (kept permanently). It also extracts durable facts as typed memories and distills typed memories into WISDOM.md. Run it periodically to keep the memory directory manageable.
