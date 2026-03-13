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
}

export interface SearchResult {
  teammate: string;
  uri: string;
  text: string;
  score: number;
}

/**
 * Search teammate memories using semantic + keyword search.
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

  for (const teammate of teammates) {
    const indexPath = indexer.indexPath(teammate);
    try {
      await fs.access(indexPath);
    } catch {
      continue; // No index for this teammate
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
      const sections = await doc.renderSections(maxTokens, 1);
      for (const section of sections) {
        allResults.push({
          teammate,
          uri: doc.uri,
          text: section.text,
          score: section.score,
        });
      }
    }
  }

  // Sort by score descending, return top results
  allResults.sort((a, b) => b.score - a.score);
  return allResults.slice(0, maxResults);
}
