/**
 * Persona loader — reads bundled persona templates from the personas/ directory.
 *
 * Each persona lives in its own folder named after its alias:
 *   personas/<alias>/SOUL.md
 *   personas/<alias>/WISDOM.md
 *
 * The SOUL.md file carries the template metadata in YAML frontmatter:
 *   ---
 *   persona: Software Engineer
 *   alias: beacon
 *   tier: 1
 *   description: Architecture, implementation, and code quality
 *   ---
 *   # <Name> - Software Engineer
 *   ...body (SOUL.md scaffold)...
 *
 * The `<Name>` placeholder in both files is replaced with the user's chosen
 * teammate name during scaffolding.
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface Persona {
  /** Role label, e.g. "Software Engineer" */
  persona: string;
  /** Persona alias and default installed teammate name, e.g. "beacon" */
  alias: string;
  /** Tier for ordering: 1 = core, 2 = specialized */
  tier: number;
  /** One-line description shown in selection UI */
  description: string;
  /** Raw SOUL.md template body (everything after the closing ---) */
  soul: string;
  /** Raw WISDOM.md template */
  wisdom: string;
}

/**
 * Resolve the bundled personas/ directory.
 * Works from both dist/ (compiled) and src/ (dev).
 */
function getPersonasDir(): string {
  const candidates = [
    resolve(__dirname, "../personas"), // dist/ -> cli/personas
    resolve(__dirname, "../../personas"), // src/ -> cli/personas (dev)
  ];
  return candidates[0];
}

/**
 * Parse a persona SOUL.md file's frontmatter and body.
 */
function parsePersonaSoul(
  soulContent: string,
  wisdomContent: string,
): Persona | null {
  const match = soulContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
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
    soul: body,
    wisdom: wisdomContent.trim(),
  };
}

function extractField(frontmatter: string, field: string): string | undefined {
  const re = new RegExp(`^${field}:\\s*(.+)$`, "m");
  const m = frontmatter.match(re);
  return m?.[1]?.trim();
}

/**
 * Load all personas from the bundled personas/ directory.
 * Only directories whose name matches the persona alias are considered valid.
 * Returns sorted by tier (ascending), then by alias.
 */
export async function loadPersonas(): Promise<Persona[]> {
  const dir = getPersonasDir();
  const personas: Persona[] = [];

  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const soulPath = join(dir, entry.name, "SOUL.md");
        const wisdomPath = join(dir, entry.name, "WISDOM.md");
        const [soulContent, wisdomContent] = await Promise.all([
          readFile(soulPath, "utf-8"),
          readFile(wisdomPath, "utf-8"),
        ]);
        const persona = parsePersonaSoul(soulContent, wisdomContent);
        if (persona && persona.alias === entry.name) personas.push(persona);
      } catch {
        /* skip unreadable persona directories */
      }
    }
  } catch {
    /* personas dir missing - return empty */
  }

  personas.sort((a, b) => a.tier - b.tier || a.alias.localeCompare(b.alias));
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

  // Replace <Name> placeholders with the chosen display name.
  const displayName = name.charAt(0).toUpperCase() + name.slice(1);
  const soulContent = persona.soul.replace(/<Name>/g, displayName);
  const wisdomContent = persona.wisdom.replace(/<Name>/g, displayName);

  await writeFile(join(teamDir, "SOUL.md"), soulContent, "utf-8");
  await writeFile(join(teamDir, "WISDOM.md"), wisdomContent, "utf-8");

  return teamDir;
}

/**
 * Update an existing teammate's SOUL.md and WISDOM.md from a persona template.
 * Preserves the teammate's memory/ directory and other files.
 *
 * @param teammatesDir - The .teammates/ directory
 * @param name - The teammate folder name
 * @param persona - The persona to update from
 */
export async function updateFromPersona(
  teammatesDir: string,
  name: string,
  persona: Persona,
): Promise<void> {
  const teamDir = join(teammatesDir, name);
  const displayName = name.charAt(0).toUpperCase() + name.slice(1);
  const soulContent = persona.soul.replace(/<Name>/g, displayName);
  const wisdomContent = persona.wisdom.replace(/<Name>/g, displayName);

  await writeFile(join(teamDir, "SOUL.md"), soulContent, "utf-8");
  await writeFile(join(teamDir, "WISDOM.md"), wisdomContent, "utf-8");
}
