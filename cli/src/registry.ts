/**
 * Teammate registry.
 *
 * Discovers teammates from .teammates/ and loads their configs
 * (SOUL.md, MEMORIES.md, daily logs, ownership rules).
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import type { TeammateConfig, DailyLog, OwnershipRules } from "./types.js";

export class Registry {
  private teammatesDir: string;
  private teammates: Map<string, TeammateConfig> = new Map();

  constructor(teammatesDir: string) {
    this.teammatesDir = teammatesDir;
  }

  /** Discover and load all teammates from .teammates/ */
  async loadAll(): Promise<Map<string, TeammateConfig>> {
    const entries = await readdir(this.teammatesDir, { withFileTypes: true });
    const dirs = entries.filter(
      (e) => e.isDirectory() && !e.name.startsWith(".")
    );

    for (const dir of dirs) {
      const config = await this.loadTeammate(dir.name);
      if (config) {
        this.teammates.set(dir.name, config);
      }
    }

    return this.teammates;
  }

  /** Load a single teammate by name */
  async loadTeammate(name: string): Promise<TeammateConfig | null> {
    const dir = join(this.teammatesDir, name);
    const soulPath = join(dir, "SOUL.md");

    try {
      await stat(soulPath);
    } catch {
      return null; // Not a teammate folder
    }

    const soul = await readFile(soulPath, "utf-8");
    const memories = await readFileSafe(join(dir, "MEMORIES.md"));
    const dailyLogs = await loadDailyLogs(join(dir, "memory"));
    const ownership = parseOwnership(soul);
    const role = parseRole(soul);

    const config: TeammateConfig = {
      name,
      role,
      soul,
      memories,
      dailyLogs,
      ownership,
    };

    this.teammates.set(name, config);
    return config;
  }

  /** Get a loaded teammate by name */
  get(name: string): TeammateConfig | undefined {
    return this.teammates.get(name);
  }

  /** List all loaded teammate names */
  list(): string[] {
    return Array.from(this.teammates.keys());
  }

  /** Get the full roster */
  all(): Map<string, TeammateConfig> {
    return this.teammates;
  }
}

/** Read a file, return empty string if missing */
async function readFileSafe(path: string): Promise<string> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return "";
  }
}

/** Load daily logs from memory/ directory, most recent first */
async function loadDailyLogs(memoryDir: string): Promise<DailyLog[]> {
  try {
    const entries = await readdir(memoryDir);
    const logs: DailyLog[] = [];

    for (const entry of entries) {
      if (entry.endsWith(".md")) {
        const date = basename(entry, ".md");
        const content = await readFile(join(memoryDir, entry), "utf-8");
        logs.push({ date, content });
      }
    }

    // Most recent first
    logs.sort((a, b) => b.date.localeCompare(a.date));
    return logs;
  } catch {
    return [];
  }
}

/** Extract role from SOUL.md — uses ## Identity paragraph or **Persona:** line */
function parseRole(soul: string): string {
  // Look for a line like "**Persona:** Some role description"
  const personaMatch = soul.match(/\*\*Persona:\*\*\s*(.+)/);
  if (personaMatch) return personaMatch[1].trim();

  // Look for the paragraph under ## Identity
  const identityMatch = soul.match(/## Identity\s*\n\s*\n(.+)/);
  if (identityMatch) {
    // Return just the first sentence
    const firstSentence = identityMatch[1].split(/\.\s/)[0];
    return firstSentence.endsWith(".") ? firstSentence : firstSentence + ".";
  }

  // Fallback: first non-heading, non-empty line
  const lines = soul.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("---")) {
      const firstSentence = trimmed.split(/\.\s/)[0];
      return firstSentence.endsWith(".") ? firstSentence : firstSentence + ".";
    }
  }

  return "teammate";
}

/** Parse ownership patterns from SOUL.md */
function parseOwnership(soul: string): OwnershipRules {
  const rules: OwnershipRules = { primary: [], secondary: [] };

  const primaryMatch = soul.match(
    /### Primary[\s\S]*?(?=###|## |$)/
  );
  if (primaryMatch) {
    rules.primary = extractPatterns(primaryMatch[0]);
  }

  const secondaryMatch = soul.match(
    /### Secondary[\s\S]*?(?=###|## |$)/
  );
  if (secondaryMatch) {
    rules.secondary = extractPatterns(secondaryMatch[0]);
  }

  return rules;
}

/** Extract file patterns (backtick-wrapped) from a markdown section */
function extractPatterns(section: string): string[] {
  const patterns: string[] = [];
  const regex = /`([^`]+)`/g;
  let match;
  while ((match = regex.exec(section)) !== null) {
    patterns.push(match[1]);
  }
  return patterns;
}
