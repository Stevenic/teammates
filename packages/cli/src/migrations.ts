/**
 * Migration guide — reads MIGRATIONS.md (shipped with the CLI package) and
 * builds a single agent prompt containing the relevant version sections.
 *
 * MIGRATIONS.md uses `## X.Y.0` headers to define what changes are needed
 * when upgrading TO that version. If upgrading from 0.5.0 to 0.7.0, the
 * prompt includes both the 0.6.0 and 0.7.0 sections.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Compare two semver strings. Returns true if `a` is strictly less than `b`.
 */
export function semverLessThan(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return false;
  }
  return false;
}

/** Parsed section from MIGRATIONS.md */
interface MigrationSection {
  version: string;
  body: string;
}

/**
 * Parse MIGRATIONS.md into version-keyed sections.
 * Each `## X.Y.Z` header starts a new section.
 */
function parseMigrationGuide(content: string): MigrationSection[] {
  const sections: MigrationSection[] = [];
  const headerRegex = /^## (\d+\.\d+\.\d+)\s*$/gm;
  let match: RegExpExecArray | null;
  const headers: { version: string; start: number; bodyStart: number }[] = [];

  while ((match = headerRegex.exec(content)) !== null) {
    headers.push({
      version: match[1],
      start: match.index,
      bodyStart: match.index + match[0].length,
    });
  }

  for (let i = 0; i < headers.length; i++) {
    const end = i + 1 < headers.length ? headers[i + 1].start : content.length;
    sections.push({
      version: headers[i].version,
      body: content.slice(headers[i].bodyStart, end).trim(),
    });
  }

  return sections;
}

/**
 * Build a migration prompt from MIGRATIONS.md for a given version transition.
 * Returns null if no migration sections apply.
 *
 * @param previousVersion - the version the teammate is upgrading FROM
 * @param teammateName - the teammate being migrated
 * @param teammateDir - path to the teammate's directory
 */
export function buildMigrationPrompt(
  previousVersion: string,
  teammateName: string,
  teammateDir: string,
): string | null {
  // MIGRATIONS.md ships with the CLI package — resolve relative to this file
  const guidePath = join(__dirname, "..", "MIGRATIONS.md");
  let content: string;
  try {
    content = readFileSync(guidePath, "utf-8");
  } catch {
    return null; // No migration guide — skip
  }

  const sections = parseMigrationGuide(content);

  // Include sections where the teammate's previous version is below the section version
  const applicable = previousVersion
    ? sections.filter((s) => semverLessThan(previousVersion, s.version))
    : sections; // Fresh install — run all

  if (applicable.length === 0) return null;

  const migrationSteps = applicable
    .map((s) => `## Upgrade to ${s.version}\n\n${s.body}`)
    .join("\n\n");

  return [
    `You are migrating teammate "${teammateName}" from v${previousVersion || "0.0.0"} to the latest version.`,
    `The teammate's directory is: ${teammateDir}`,
    "",
    "Apply ALL of the following migration steps in order:",
    "",
    migrationSteps,
    "",
    "Work through each step carefully. Report what you changed when done.",
  ].join("\n");
}
