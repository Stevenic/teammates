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

**MEMORIES.md** — Use the MEMORIES.md template from `template/TEMPLATE.md`. Add a single initial entry recording the teammate's creation and any key decisions made during setup.

**memory/** — Create an empty `memory/` directory in each teammate's folder. This is where daily logs (`YYYY-MM-DD.md`) will accumulate over time. No need to create any files yet.

---

## Step 4: Verify

Before finishing, check:

- [ ] Every teammate in the README roster has a corresponding folder with SOUL.md and MEMORIES.md
- [ ] README.md roster matches the actual folders
- [ ] Ownership globs across all SOUL.md files collectively cover the codebase without major gaps or overlaps
- [ ] Boundaries in each SOUL.md correctly reference the teammate who DOES own that area
- [ ] Dependency flow in README.md and PROTOCOL.md are consistent
- [ ] PROTOCOL.md conflict resolution table makes sense for this project's domain structure
- [ ] CROSS-TEAM.md Ownership Scopes table has one row per teammate with correct paths
- [ ] `.gitignore` is in place (USER.md should not be committed)
- [ ] USER.md exists and the user has been prompted to fill it in

---

## Tips

- **The `template/example/` folder** has a worked example of a filled-in teammate. Use it as a reference for tone and detail level.
- **MEMORIES.md starts light.** Just one entry recording initial creation. Memories accumulate naturally over time as the team works.
- **Not every SOUL.md section needs to be exhaustive.** Fill in what's known now. Teammates grow more detailed as the project evolves.
- **If the agent can't create directories**, ask the user to create the folder structure manually, then have the agent fill in the file contents.
- **Small projects are fine with 2–3 teammates.** Don't over-partition a small codebase.
- **Prompt the user to fill in USER.md.** It's gitignored and stays local. It helps teammates tailor their communication style and technical depth.
- **Daily logs start empty.** The `memory/` folders are created during onboarding but daily log files are created naturally as teammates work.
- **Souls evolve.** Teammates should update their own SOUL.md as they learn more about their domain. If a teammate changes their SOUL.md, they should tell the user what changed and why.
- **Boundaries are strict.** Teammates must never modify files outside their ownership, even for small or obvious fixes. If a task touches another teammate's domain, they should hand off that portion with a clear description. This prevents stepping on toes and keeps ownership clean.
- **Memory search is optional.** For projects that accumulate many daily logs, suggest installing `@teammates/recall` for semantic search. It's not required — teammates work fine by reading files directly.
