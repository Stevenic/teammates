/**
 * Onboarding flow — guides users through setting up .teammates/ when none exists.
 *
 * Ships with a copy of the template/ folder. Framework files (CROSS-TEAM.md,
 * PROTOCOL.md, TEMPLATE.md, USER.md, .gitignore, example/) are copied into the
 * target .teammates/ directory before the agent runs, so the agent only needs to
 * analyze the codebase and create teammate-specific folders.
 */

import { copyFile, mkdir, readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the bundled template/ directory.
 * Works from both dist/ (compiled) and src/ (dev).
 */
function getTemplateDir(): string {
  const candidates = [
    resolve(__dirname, "../template"), // dist/ → cli/template
    resolve(__dirname, "../../template"), // src/ → cli/template (dev)
  ];
  return candidates[0]; // both resolve to the same cli/template
}

/**
 * Copy framework files from the bundled template into the target .teammates/ dir.
 * Skips files that already exist (idempotent).
 * Returns the list of files that were copied.
 */
export async function copyTemplateFiles(
  teammatesDir: string,
): Promise<string[]> {
  const templateDir = getTemplateDir();
  const copied: string[] = [];

  // Framework files to copy at the top level
  const frameworkFiles = [
    "CROSS-TEAM.md",
    "PROTOCOL.md",
    "TEMPLATE.md",
    "USER.md",
    "README.md",
  ];

  for (const file of frameworkFiles) {
    const src = join(templateDir, file);
    const dest = join(teammatesDir, file);
    try {
      await stat(dest);
      // Already exists, skip
    } catch {
      try {
        await copyFile(src, dest);
        copied.push(file);
      } catch {
        /* template file missing, skip */
      }
    }
  }

  // Create .gitignore if it doesn't exist
  const gitignoreDest = join(teammatesDir, ".gitignore");
  try {
    await stat(gitignoreDest);
  } catch {
    const gitignoreContent = "USER.md\n.index/\n";
    const { writeFile } = await import("node:fs/promises");
    await writeFile(gitignoreDest, gitignoreContent, "utf-8");
    copied.push(".gitignore");
  }

  // Copy example/ directory if it doesn't exist
  const exampleDir = join(teammatesDir, "example");
  try {
    await stat(exampleDir);
  } catch {
    const templateExampleDir = join(templateDir, "example");
    try {
      await mkdir(exampleDir, { recursive: true });
      const exampleFiles = await readdir(templateExampleDir);
      for (const file of exampleFiles) {
        await copyFile(join(templateExampleDir, file), join(exampleDir, file));
        copied.push(`example/${file}`);
      }
    } catch {
      /* template example dir missing, skip */
    }
  }

  return copied;
}

/**
 * Load ONBOARDING.md from the project dir, package root, or built-in fallback.
 */
export async function getOnboardingPrompt(projectDir: string): Promise<string> {
  const candidates = [
    join(projectDir, "ONBOARDING.md"), // user's project
    resolve(__dirname, "../../ONBOARDING.md"), // monorepo: cli/dist/ → root
    resolve(__dirname, "../../../ONBOARDING.md"), // extra nesting fallback
  ];

  for (const path of candidates) {
    try {
      const content = await readFile(path, "utf-8");
      if (content.includes("## Step 1")) {
        return wrapPrompt(content, projectDir);
      }
    } catch {
      /* not found, try next */
    }
  }

  return wrapPrompt(BUILTIN_ONBOARDING, projectDir);
}

function wrapPrompt(onboardingContent: string, projectDir: string): string {
  return `You are setting up the teammates framework for a project.

**Target project directory:** ${projectDir}

**Framework files have already been copied** into \`${projectDir}/.teammates/\` from the template. The following files are already in place:
- CROSS-TEAM.md — fill in the Ownership Scopes table as you create teammates
- PROTOCOL.md — team protocol (ready to use)
- TEMPLATE.md — reference for creating teammate SOUL.md and WISDOM.md files
- USER.md — user profile (gitignored, user fills in later)
- README.md — update with project-specific roster and info
- .gitignore — configured for USER.md and .index/
- example/ — example SOUL.md and WISDOM.md for reference

**Your job is to:**
1. Analyze the codebase (Step 1)
2. Design the team roster (Step 2)
3. Create teammate folders with SOUL.md and WISDOM.md (Step 3) — use TEMPLATE.md for the structure
4. Update README.md and CROSS-TEAM.md with the roster info (Step 3)
5. Verify everything is in place (Step 4)

You do NOT need to create the framework files listed above — they're already there.

Follow the onboarding instructions below. Work through each step, pausing after Step 1 and Step 2 to present your analysis and proposed roster to the user for approval before proceeding.

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

Once approved, create teammate folders under \`.teammates/\`:

### Teammate folders
For each teammate, create \`.teammates/<name>/\` with:

**SOUL.md** — Use the template from \`.teammates/TEMPLATE.md\`. Fill in identity, core principles, boundaries, capabilities, ownership, ethics.

**WISDOM.md** — Start with one entry recording creation and key decisions.

**memory/** — Empty directory for daily logs.

### Update framework files
- Update \`.teammates/README.md\` with the roster table, dependency flow, and routing guide
- Update \`.teammates/CROSS-TEAM.md\` Ownership Scopes table with one row per teammate

## Step 4: Verify

Check:
- Every roster teammate has a folder with SOUL.md and WISDOM.md
- Ownership globs cover the codebase without major gaps
- Boundaries reference the correct owning teammate
- CROSS-TEAM.md Ownership Scopes table has one row per teammate with correct paths
- .gitignore is in place (USER.md not committed)

## Tips
- Small projects are fine with 2–3 teammates
- WISDOM.md starts light — just one creation entry
- Prompt the user to fill in USER.md after setup
`;
