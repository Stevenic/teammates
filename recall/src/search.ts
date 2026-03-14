import { LocalDocumentIndex } from "vectra";
import { LocalEmbeddings } from "./embeddings.js";
import { Indexer } from "./indexer.js";
import * as path from "node:path";
import * as fs from "node:fs/promises";

export interface SearchOptions {
  /** Path to the .teammates directory */
  teammatesDir: string;
  /** Teammate name to search (searches all if omitted) */
  teammate?: string;
  /** Max results per teammate (default: 5) */
  maxResults?: number;
  /** Max chunks per document (default: 3) */
  maxChunks?: number;
  /** Max tokens per section (default: 500) */
  maxTokens?: number;
  /** Embedding model name */
  model?: string;
  /** Skip auto-sync before searching (default: false) */
  skipSync?: boolean;
  /** Number of recent weekly summaries to always include (default: 2) */
  recencyDepth?: number;
  /** Relevance boost multiplier for typed memories over episodic summaries (default: 1.2) */
  typedMemoryBoost?: number;
}

export interface SearchResult {
  teammate: string;
  uri: string;
  text: string;
  score: number;
  /** Content type: "typed_memory", "weekly", "monthly", or "other" */
  contentType?: string;
}

/**
 * Classify a URI into a content type for priority scoring.
 */
function classifyUri(uri: string): string {
  if (uri.includes("/memory/weekly/")) return "weekly";
  if (uri.includes("/memory/monthly/")) return "monthly";
  // Typed memories are in memory/ but not daily logs (YYYY-MM-DD) and not in subdirs
  const memoryMatch = uri.match(/\/memory\/([^/]+)\.md$/);
  if (memoryMatch) {
    const stem = memoryMatch[1];
    if (/^\d{4}-\d{2}-\d{2}$/.test(stem)) return "daily";
    return "typed_memory";
  }
  return "other";
}

/**
 * Search teammate memories using multi-pass retrieval.
 *
 * Pass 1 (Recency): Always returns the N most recent weekly summaries.
 * Pass 2 (Semantic): Query-driven search across all indexed content.
 * Results are merged, deduped, and typed memories get a relevance boost.
 */
export async function search(
  query: string,
  options: SearchOptions
): Promise<SearchResult[]> {
  const embeddings = new LocalEmbeddings(options.model);
  const indexer = new Indexer({ teammatesDir: options.teammatesDir, model: options.model });
  const maxResults = options.maxResults ?? 5;
  const maxChunks = options.maxChunks ?? 3;
  const maxTokens = options.maxTokens ?? 500;
  const recencyDepth = options.recencyDepth ?? 2;
  const typedMemoryBoost = options.typedMemoryBoost ?? 1.2;

  // Auto-sync: upsert any new/changed files before searching
  if (!options.skipSync) {
    if (options.teammate) {
      await indexer.syncTeammate(options.teammate);
    } else {
      await indexer.syncAll();
    }
  }

  // Determine which teammates to search
  let teammates: string[];
  if (options.teammate) {
    teammates = [options.teammate];
  } else {
    teammates = await indexer.discoverTeammates();
  }

  const allResults: SearchResult[] = [];
  const seenUris = new Set<string>();

  // ── Pass 1: Recency (recent weekly summaries, always included) ───
  for (const teammate of teammates) {
    const weeklyDir = path.join(options.teammatesDir, teammate, "memory", "weekly");
    try {
      const entries = await fs.readdir(weeklyDir);
      const weeklyFiles = entries
        .filter((e) => e.endsWith(".md"))
        .sort()
        .reverse()
        .slice(0, recencyDepth);

      for (const file of weeklyFiles) {
        const uri = `${teammate}/memory/weekly/${file}`;
        const text = await fs.readFile(path.join(weeklyDir, file), "utf-8");
        if (text.trim().length === 0) continue;
        seenUris.add(uri);
        allResults.push({
          teammate,
          uri,
          text: text.slice(0, maxTokens * 4), // rough token estimate
          score: 0.9, // high base score for recency results
          contentType: "weekly",
        });
      }
    } catch {
      // No weekly/ directory for this teammate
    }
  }

  // ── Pass 2: Semantic (query-driven across all indexed content) ───
  for (const teammate of teammates) {
    const indexPath = indexer.indexPath(teammate);
    try {
      await fs.access(indexPath);
    } catch {
      continue;
    }

    const index = new LocalDocumentIndex({
      folderPath: indexPath,
      embeddings,
    });

    if (!(await index.isIndexCreated())) continue;

    const docs = await index.queryDocuments(query, {
      maxDocuments: maxResults,
      maxChunks,
    });

    for (const doc of docs) {
      if (seenUris.has(doc.uri)) continue; // dedup with recency pass
      seenUris.add(doc.uri);

      const sections = await doc.renderSections(maxTokens, 1);
      const contentType = classifyUri(doc.uri);

      for (const section of sections) {
        let score = section.score;
        // Apply type-based priority boost for typed memories
        if (contentType === "typed_memory") {
          score *= typedMemoryBoost;
        }

        allResults.push({
          teammate,
          uri: doc.uri,
          text: section.text,
          score,
          contentType,
        });
      }
    }
  }

  // Sort by score descending, return top results
  allResults.sort((a, b) => b.score - a.score);
  return allResults.slice(0, maxResults + recencyDepth); // allow extra slots for recency results
}
