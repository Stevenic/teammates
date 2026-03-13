/**
 * Onboarding flow — guides users through setting up .teammates/ when none exists.
 *
 * Embeds a condensed version of ONBOARDING.md so the CLI works regardless of
 * installation method (monorepo, global install, npx).
 */

import { readFile } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Load ONBOARDING.md from the project dir, package root, or built-in fallback.
 */
export async function getOnboardingPrompt(projectDir: string): Promise<string> {
  const candidates = [
    join(projectDir, "ONBOARDING.md"),                // user's project
    resolve(__dirname, "../../ONBOARDING.md"),         // monorepo: cli/dist/ → root
    resolve(__dirname, "../../../ONBOARDING.md"),      // extra nesting fallback
  ];

  for (const path of candidates) {
    try {
      const content = await readFile(path, "utf-8");
      if (content.includes("## Step 1")) {
        return wrapPrompt(content, projectDir);
      }
    } catch { /* not found, try next */ }
  }

  return wrapPrompt(BUILTIN_ONBOARDING, projectDir);
}

function wrapPrompt(onboardingContent: string, projectDir: string): string {
  return `You are setting up the teammates framework for a project.

**Target project directory:** ${projectDir}

Follow the onboarding instructions below. Work through each step, pausing after Step 1 and Step 2 to present your analysis and proposed roster to the user for approval before proceeding.

Create all files inside \`${projectDir}/.teammates/\`.

---

${onboardingContent}`;
}

const BUILTIN_ONBOARDING = `# Teammates Onboarding

You are going to analyze a codebase and create a set of AI teammates — persistent personas that each own a slice of the project. Follow these steps in order.

## Step 1: Analyze the Codebase

Read the project's entry points to understand its structure:
- README, CONTRIBUTING, or similar docs
- Package manifest (package.json, Cargo.toml, pyproject.toml, go.mod, etc.)
- Top-level directory structure
- Key configuration files

Identify:
1. **Major domains/subsystems** — distinct areas of the codebase
2. **Dependency flow** — which layers depend on which
3. **Key technologies** — languages, frameworks, tools per area
4. **File patterns** — glob patterns for each domain

**Present your analysis to the user and get confirmation before proceeding.**

## Step 2: Design the Team

Propose a roster of teammates:
- **Aim for 3–7 teammates.** Fewer for small projects, more for monorepos.
- **Each teammate owns a distinct domain** with minimal overlap.
- **Pick short, memorable names** — one word, evocative of the domain.

For each proposed teammate, define:
- Name and one-line persona
- Primary ownership (file patterns)
- Key technologies
- Boundaries (what they do NOT own)

**Present the proposed roster to the user for approval.**

## Step 3: Create the Directory Structure

Once approved, create \`.teammates/\` containing:

### Framework files
- \`.teammates/.gitignore\` — should contain: USER.md and .index/
- \`.teammates/CROSS-TEAM.md\` — shared notes between teammates
- \`.teammates/USER.md\` — user profile (gitignored, stays local)

### README.md
Create \`.teammates/README.md\` with:
- Project name and team description
- Roster table (name, persona, ownership paths, date)
- Dependency flow diagram
- Routing guide mapping keywords to teammates

### PROTOCOL.md
Create \`.teammates/PROTOCOL.md\` with:
- Dependency direction diagram
- Conflict resolution rules
- Cross-cutting concerns

### Teammate folders
For each teammate, create \`.teammates/<name>/\` with:

**SOUL.md** — Identity, core principles, boundaries, capabilities, ownership, ethics. This is the teammate's persona definition.

**MEMORIES.md** — Start with one entry recording creation and key decisions.

**memory/** — Empty directory for daily logs.

## Step 4: Verify

Check:
- Every roster teammate has a folder with SOUL.md and MEMORIES.md
- Ownership globs cover the codebase without major gaps
- Boundaries reference the correct owning teammate
- .gitignore is in place (USER.md not committed)

## Tips
- Small projects are fine with 2–3 teammates
- MEMORIES.md starts light — just one creation entry
- Prompt the user to fill in USER.md after setup
`;
