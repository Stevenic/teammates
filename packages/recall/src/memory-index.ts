/**
 * Memory frontmatter scanning for Pass 1 recall queries.
 *
 * Reads the teammate's memory file catalog (name + description from frontmatter)
 * and does fast text matching against the task prompt. This is a lightweight,
 * no-embedding relevance signal — "here's a menu of what I might know about."
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { SearchResult } from "./search.js";

interface MemoryEntry {
  /** Relative URI (e.g. "beacon/memory/project_goals.md") */
  uri: string;
  /** Absolute file path */
  absolutePath: string;
  /** Frontmatter name field */
  name: string;
  /** Frontmatter description field */
  description: string;
}

/**
 * Parse YAML-ish frontmatter from a markdown file's content.
 * Returns name and description fields, or null if no frontmatter found.
 */
function parseFrontmatter(content: string): { name: string; description: string } | null {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return null;

  const fm = match[1];
  const nameMatch = fm.match(/^name:\s*(.+)$/m);
  const descMatch = fm.match(/^description:\s*(.+)$/m);

  if (!nameMatch) return null;

  return {
    name: nameMatch[1].trim(),
    description: descMatch?.[1]?.trim() ?? "",
  };
}

/**
 * Scan a teammate's memory directory and build a catalog of memory entries
 * with their frontmatter metadata.
 */
export async function scanMemoryCatalog(
  teammatesDir: string,
  teammate: string,
): Promise<MemoryEntry[]> {
  const memoryDir = path.join(teammatesDir, teammate, "memory");
  const entries: MemoryEntry[] = [];

  try {
    const files = await fs.readdir(memoryDir);
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      // Skip daily logs (YYYY-MM-DD.md)
      const stem = path.basename(file, ".md");
      if (/^\d{4}-\d{2}-\d{2}$/.test(stem)) continue;

      const absolutePath = path.join(memoryDir, file);
      const content = await fs.readFile(absolutePath, "utf-8");
      const fm = parseFrontmatter(content);
      if (!fm) continue;

      entries.push({
        uri: `${teammate}/memory/${file}`,
        absolutePath,
        name: fm.name,
        description: fm.description,
      });
    }
  } catch {
    // No memory/ directory
  }

  return entries;
}

/**
 * Match task prompt text against memory catalog entries.
 * Returns memory files whose name or description has significant word overlap
 * with the task prompt. Each match is returned as a SearchResult with the
 * file's full content.
 *
 * Matching is case-insensitive. A match requires at least one word from the
 * task prompt appearing in the name or description.
 */
export async function matchMemoryCatalog(
  teammatesDir: string,
  teammate: string,
  taskPrompt: string,
  maxTokens = 500,
): Promise<SearchResult[]> {
  const catalog = await scanMemoryCatalog(teammatesDir, teammate);
  if (catalog.length === 0) return [];

  // Tokenize the task prompt into lowercase words (3+ chars)
  const promptWords = new Set(
    taskPrompt
      .toLowerCase()
      .replace(/[^\w\s@/-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );

  const results: SearchResult[] = [];

  for (const entry of catalog) {
    const catalogText = `${entry.name} ${entry.description}`.toLowerCase();
    const catalogWords = catalogText
      .replace(/[^\w\s@/_-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2);

    // Count overlapping words
    let overlap = 0;
    for (const w of catalogWords) {
      if (promptWords.has(w)) overlap++;
    }

    // Also check if prompt words appear as substrings in the catalog text
    // (e.g., "goal" matches "project_goals")
    for (const pw of promptWords) {
      if (catalogText.includes(pw) && !catalogWords.includes(pw)) {
        overlap += 0.5;
      }
    }

    if (overlap >= 1) {
      // Read full file content for matched entries
      const content = await fs.readFile(entry.absolutePath, "utf-8");
      // Strip frontmatter from the content
      const body = content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "").trim();

      results.push({
        teammate,
        uri: entry.uri,
        text: body.slice(0, maxTokens * 4), // rough token limit
        score: 0.85 + Math.min(overlap * 0.02, 0.1), // 0.85-0.95 range
        contentType: "typed_memory",
      });
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);
  return results;
}
