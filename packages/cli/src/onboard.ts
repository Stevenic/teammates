/**
 * Onboarding flow — guides users through setting up .teammates/ when none exists.
 *
 * Ships with a copy of the template/ folder. Framework files (CROSS-TEAM.md,
 * PROTOCOL.md, TEMPLATE.md, USER.md, .gitignore, example/) are copied into the
 * target .teammates/ directory before the agent runs, so the agent only needs to
 * analyze the codebase and create teammate-specific folders.
 */

import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
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
    const gitignoreContent = "USER.md\n.*/\n";
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
 * Check if a directory entry name is a non-teammate entry.
 * Directories starting with "." are local/ephemeral (gitignored).
 * Directories starting with "_" are shared non-teammate folders.
 * Files (non-directories) and special names are also excluded.
 */
const NON_TEAMMATE_NAMES = new Set(["example", "services.json"]);
function isNonTeammateEntry(name: string): boolean {
  return (
    name.startsWith(".") || name.startsWith("_") || NON_TEAMMATE_NAMES.has(name)
  );
}

/**
 * Detect whether a directory entry is a teammate folder (has SOUL.md).
 */
async function isTeammateFolder(dirPath: string): Promise<boolean> {
  try {
    await stat(join(dirPath, "SOUL.md"));
    return true;
  } catch {
    return false;
  }
}

/**
 * Import teammates from another project's .teammates/ dir.
 *
 * Only copies SOUL.md and WISDOM.md per teammate (identity + wisdom carry over).
 * Creates an empty memory/ dir for each (fresh start — no daily logs or typed memories).
 * Also copies USER.md if present. Framework files (CROSS-TEAM.md, README.md, etc.)
 * are project-specific and NOT copied — they get created fresh from the template.
 *
 * Skips teammates that already exist in the target (idempotent).
 * Returns { teammates: string[], files: string[] }.
 */
export async function importTeammates(
  sourceDir: string,
  targetDir: string,
): Promise<{ teammates: string[]; files: string[] }> {
  // Validate source exists and looks like a .teammates/ dir
  try {
    await stat(sourceDir);
  } catch {
    throw new Error(`Source directory not found: ${sourceDir}`);
  }

  await mkdir(targetDir, { recursive: true });

  const teammates: string[] = [];
  const files: string[] = [];
  const entries = await readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = join(sourceDir, entry.name);
    const destPath = join(targetDir, entry.name);

    if (entry.isDirectory() && !isNonTeammateEntry(entry.name)) {
      // Check if it's a teammate folder
      if (await isTeammateFolder(srcPath)) {
        // Skip if teammate already exists in target
        try {
          await stat(destPath);
          continue;
        } catch {
          /* doesn't exist, proceed */
        }

        // Create teammate dir and copy only SOUL.md + WISDOM.md
        await mkdir(destPath, { recursive: true });

        // SOUL.md (required — isTeammateFolder confirmed it exists)
        await copyFile(join(srcPath, "SOUL.md"), join(destPath, "SOUL.md"));
        files.push(`${entry.name}/SOUL.md`);

        // WISDOM.md (optional)
        try {
          await copyFile(
            join(srcPath, "WISDOM.md"),
            join(destPath, "WISDOM.md"),
          );
          files.push(`${entry.name}/WISDOM.md`);
        } catch {
          /* no WISDOM.md in source, skip */
        }

        // Create empty memory/ dir (fresh start)
        await mkdir(join(destPath, "memory"), { recursive: true });

        teammates.push(entry.name);
      }
    } else if (entry.isFile() && entry.name === "USER.md") {
      // Only USER.md transfers — framework files (CROSS-TEAM.md, README.md,
      // PROTOCOL.md, TEMPLATE.md) are project-specific and get created fresh
      // from the template by copyTemplateFiles().
      try {
        await stat(destPath);
      } catch {
        await copyFile(srcPath, destPath);
        files.push(entry.name);
      }
    }
  }

  // Ensure .gitignore exists
  const gitignoreDest = join(targetDir, ".gitignore");
  try {
    await stat(gitignoreDest);
  } catch {
    await writeFile(gitignoreDest, "USER.md\n.*/\n", "utf-8");
    files.push(".gitignore");
  }

  return { teammates, files };
}

/**
 * Build the adaptation prompt for a single imported teammate.
 * Tells the agent to update ownership patterns, file paths, and boundaries
 * for the new codebase while preserving identity, principles, and wisdom.
 *
 * @param teammatesDir - The .teammates/ directory in the target project
 * @param teammateName - The name of the teammate to adapt
 */
export async function buildAdaptationPrompt(
  teammatesDir: string,
  teammateName: string,
): Promise<string> {
  const teammateDir = join(teammatesDir, teammateName);

  // Read the teammate's current SOUL.md and WISDOM.md
  let soulContent = "";
  let wisdomContent = "";
  try {
    soulContent = await readFile(join(teammateDir, "SOUL.md"), "utf-8");
  } catch {
    /* missing — agent will create from scratch */
  }
  try {
    wisdomContent = await readFile(join(teammateDir, "WISDOM.md"), "utf-8");
  } catch {
    /* missing — that's fine */
  }

  const soulSection = soulContent
    ? `\n\n## Current SOUL.md\n\n\`\`\`markdown\n${soulContent}\n\`\`\``
    : "\n\n*No SOUL.md found — create one from the template.*";

  const wisdomSection = wisdomContent
    ? `\n\n## Current WISDOM.md\n\n\`\`\`markdown\n${wisdomContent}\n\`\`\``
    : "";

  return `You are adapting the imported teammate **${teammateName}** to this new codebase.

**Teammate directory:** \`${teammateDir}\`

This teammate was imported from another project. Their SOUL.md and WISDOM.md contain identity, principles, and accumulated wisdom that should be preserved, but their **ownership patterns**, **file paths**, **boundaries**, **capabilities**, and **routing keywords** need to be updated for this codebase.
${soulSection}${wisdomSection}

## Your job:

1. **Analyze this codebase** — read the project structure, entry points, package manifest, and key files to understand the architecture.

2. **Update ${teammateName}'s SOUL.md**:
   - **Preserve**: Identity, Core Principles, Ethics, personality, tone
   - **Update**: Ownership patterns (primary/secondary file globs), Boundaries (reference correct teammate names), Capabilities (commands, file patterns, technologies), Routing keywords, Quality Bar
   - **Adapt**: Any codebase-specific references (paths, package names, tools)

3. **Update ${teammateName}'s WISDOM.md**:
   - **Preserve**: Wisdom entries that are universal (principles, patterns, lessons)
   - **Remove or update**: Entries referencing old project paths, file names, or architecture
   - **Add**: A creation entry noting this teammate was imported and adapted

4. **Verify** that ownership globs are valid for this codebase.

Present your proposed changes before applying them. Focus only on **${teammateName}** — other teammates will be adapted separately.`;
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
