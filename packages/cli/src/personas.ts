/**
 * Persona loader — reads bundled persona templates from the personas/ directory.
 *
 * Each persona file is a markdown file with YAML frontmatter:
 *   ---
 *   persona: Software Engineer
 *   alias: beacon
 *   tier: 1
 *   description: Architecture, implementation, and code quality
 *   ---
 *   # <Name> — Software Engineer
 *   ...body (SOUL.md scaffold)...
 *
 * The `<Name>` placeholder in the body is replaced with the user's chosen
 * teammate name during scaffolding.
 */

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface Persona {
  /** Display name, e.g. "Software Engineer" */
  persona: string;
  /** Suggested alias, e.g. "beacon" */
  alias: string;
  /** Tier for ordering: 1 = core, 2 = specialized */
  tier: number;
  /** One-line description shown in selection UI */
  description: string;
  /** Raw SOUL.md body (everything after the closing ---) */
  body: string;
}

/**
 * Resolve the bundled personas/ directory.
 * Works from both dist/ (compiled) and src/ (dev).
 */
function getPersonasDir(): string {
  const candidates = [
    resolve(__dirname, "../personas"), // dist/ → cli/personas
    resolve(__dirname, "../../personas"), // src/ → cli/personas (dev)
  ];
  return candidates[0]; // both resolve to cli/personas
}

/**
 * Parse a persona file's frontmatter and body.
 */
function parsePersonaFile(content: string): Persona | null {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;

  const frontmatter = match[1];
  const body = match[2].trim();

  const persona = extractField(frontmatter, "persona");
  const alias = extractField(frontmatter, "alias");
  const tierStr = extractField(frontmatter, "tier");
  const description = extractField(frontmatter, "description");

  if (!persona || !alias || !description) return null;

  return {
    persona,
    alias,
    tier: tierStr ? parseInt(tierStr, 10) : 2,
    description,
    body,
  };
}

function extractField(frontmatter: string, field: string): string | undefined {
  const re = new RegExp(`^${field}:\\s*(.+)$`, "m");
  const m = frontmatter.match(re);
  return m?.[1]?.trim();
}

/**
 * Load all personas from the bundled personas/ directory.
 * Returns sorted by tier (ascending), then alphabetically.
 */
export async function loadPersonas(): Promise<Persona[]> {
  const dir = getPersonasDir();
  const personas: Persona[] = [];

  try {
    const files = await readdir(dir);
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      try {
        const content = await readFile(join(dir, file), "utf-8");
        const persona = parsePersonaFile(content);
        if (persona) personas.push(persona);
      } catch {
        /* skip unreadable files */
      }
    }
  } catch {
    /* personas dir missing — return empty */
  }

  personas.sort((a, b) => a.tier - b.tier || a.persona.localeCompare(b.persona));
  return personas;
}

/**
 * Scaffold a teammate folder from a persona template.
 *
 * @param teammatesDir - The .teammates/ directory
 * @param name - The teammate name (used as folder name and replaces <Name>)
 * @param persona - The persona to scaffold from
 * @returns The path to the created teammate folder
 */
export async function scaffoldFromPersona(
  teammatesDir: string,
  name: string,
  persona: Persona,
): Promise<string> {
  const folderName = name.toLowerCase().replace(/[^a-z0-9_-]/g, "");
  const teamDir = join(teammatesDir, folderName);

  await mkdir(teamDir, { recursive: true });
  await mkdir(join(teamDir, "memory"), { recursive: true });

  // Replace <Name> placeholder with the chosen name (capitalize first letter)
  const displayName = name.charAt(0).toUpperCase() + name.slice(1);
  const soulContent = persona.body.replace(/<Name>/g, displayName);

  await writeFile(join(teamDir, "SOUL.md"), soulContent, "utf-8");
  await writeFile(
    join(teamDir, "WISDOM.md"),
    `# ${displayName} — Wisdom\n\nDistilled principles. Read this first every session (after SOUL.md).\n\nLast compacted: never\n\n---\n\n*No entries yet — wisdom is distilled from experience.*\n`,
    "utf-8",
  );

  return teamDir;
}
