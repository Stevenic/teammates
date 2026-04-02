import * as fs from "node:fs/promises";
import * as path from "node:path";
import { LocalDocumentIndex } from "vectra";
import { chunkMarkdown, chunkUri } from "./chunker.js";
import { LocalEmbeddings } from "./embeddings.js";

export interface IndexerConfig {
  /** Path to the .teammates directory */
  teammatesDir: string;
  /** Embedding model name (default: Xenova/all-MiniLM-L6-v2) */
  model?: string;
}

interface TeammateFiles {
  teammate: string;
  files: { uri: string; absolutePath: string }[];
}

/**
 * Indexes teammate memory files (WISDOM.md + memory/*.md) into Vectra.
 * One index per teammate, stored at .teammates/<name>/.index/
 */
export class Indexer {
  private _config: IndexerConfig;
  private _embeddings: LocalEmbeddings;

  constructor(config: IndexerConfig) {
    this._config = config;
    this._embeddings = new LocalEmbeddings(config.model);
  }

  /** Get the index path for a specific teammate */
  indexPath(teammate: string): string {
    return path.join(this._config.teammatesDir, teammate, ".index");
  }

  /**
   * Discover all teammate directories (folders containing SOUL.md).
   */
  async discoverTeammates(): Promise<string[]> {
    const entries = await fs.readdir(this._config.teammatesDir, {
      withFileTypes: true,
    });
    const teammates: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const soulPath = path.join(
        this._config.teammatesDir,
        entry.name,
        "SOUL.md",
      );
      try {
        await fs.access(soulPath);
        teammates.push(entry.name);
      } catch {
        // Not a teammate folder
      }
    }
    return teammates;
  }

  /**
   * Collect all indexable memory files for a teammate.
   */
  async collectFiles(teammate: string): Promise<TeammateFiles> {
    const teammateDir = path.join(this._config.teammatesDir, teammate);
    const files: TeammateFiles["files"] = [];

    // WISDOM.md
    const wisdomPath = path.join(teammateDir, "WISDOM.md");
    try {
      await fs.access(wisdomPath);
      files.push({ uri: `${teammate}/WISDOM.md`, absolutePath: wisdomPath });
    } catch {
      // No WISDOM.md
    }

    // memory/*.md — typed memories + daily logs (day 2+)
    // Today's daily log is excluded (still being written). Older dailies are
    // indexed so recall can surface high-resolution episodic context beyond
    // the 7-day prompt window. Dailies older than 30 days are purged elsewhere.
    const memoryDir = path.join(teammateDir, "memory");
    const today = new Date().toISOString().slice(0, 10);
    try {
      const memoryEntries = await fs.readdir(memoryDir);
      for (const entry of memoryEntries) {
        if (!entry.endsWith(".md")) continue;
        const stem = path.basename(entry, ".md");
        // Skip today's daily log — it's still being written and already in prompt context
        if (stem === today) continue;
        files.push({
          uri: `${teammate}/memory/${entry}`,
          absolutePath: path.join(memoryDir, entry),
        });
      }
    } catch {
      // No memory/ directory
    }

    // memory/weekly/*.md — weekly summaries (primary episodic search surface)
    const weeklyDir = path.join(memoryDir, "weekly");
    try {
      const weeklyEntries = await fs.readdir(weeklyDir);
      for (const entry of weeklyEntries) {
        if (!entry.endsWith(".md")) continue;
        files.push({
          uri: `${teammate}/memory/weekly/${entry}`,
          absolutePath: path.join(weeklyDir, entry),
        });
      }
    } catch {
      // No weekly/ directory
    }

    // memory/monthly/*.md — monthly summaries (long-term episodic context)
    const monthlyDir = path.join(memoryDir, "monthly");
    try {
      const monthlyEntries = await fs.readdir(monthlyDir);
      for (const entry of monthlyEntries) {
        if (!entry.endsWith(".md")) continue;
        files.push({
          uri: `${teammate}/memory/monthly/${entry}`,
          absolutePath: path.join(monthlyDir, entry),
        });
      }
    } catch {
      // No monthly/ directory
    }

    return { teammate, files };
  }

  /**
   * Build or rebuild the index for a single teammate.
   */
  async indexTeammate(teammate: string): Promise<number> {
    const { files } = await this.collectFiles(teammate);
    if (files.length === 0) return 0;

    const indexPath = this.indexPath(teammate);
    const index = new LocalDocumentIndex({
      folderPath: indexPath,
      embeddings: this._embeddings,
    });

    // Recreate index from scratch
    await index.createIndex({ version: 1, deleteIfExists: true });

    let count = 0;
    for (const file of files) {
      const text = await fs.readFile(file.absolutePath, "utf-8");
      if (text.trim().length === 0) continue;

      // Split into ~2k token chunks for granular retrieval
      const chunks = chunkMarkdown(text);
      for (const chunk of chunks) {
        const uri = chunkUri(file.uri, chunk);
        await index.upsertDocument(uri, chunk.text, "md");
        count++;
      }
    }

    return count;
  }

  /**
   * Build or rebuild indexes for all teammates.
   */
  async indexAll(): Promise<Map<string, number>> {
    const teammates = await this.discoverTeammates();
    const results = new Map<string, number>();
    for (const teammate of teammates) {
      const count = await this.indexTeammate(teammate);
      results.set(teammate, count);
    }
    return results;
  }

  /**
   * Upsert a single file into an existing teammate index.
   * Creates the index if it doesn't exist yet.
   */
  async upsertFile(teammate: string, filePath: string): Promise<void> {
    const teammateDir = path.join(this._config.teammatesDir, teammate);
    const absolutePath = path.resolve(filePath);
    const relativePath = path.relative(teammateDir, absolutePath);
    const baseUri = `${teammate}/${relativePath.replace(/\\/g, "/")}`;

    const text = await fs.readFile(absolutePath, "utf-8");
    if (text.trim().length === 0) return;

    const indexPath = this.indexPath(teammate);
    const index = new LocalDocumentIndex({
      folderPath: indexPath,
      embeddings: this._embeddings,
    });

    if (!(await index.isIndexCreated())) {
      await index.createIndex({ version: 1 });
    }

    // Split into chunks and upsert each
    const chunks = chunkMarkdown(text);
    for (const chunk of chunks) {
      const uri = chunkUri(baseUri, chunk);
      await index.upsertDocument(uri, chunk.text, "md");
    }
  }

  /**
   * Sync a teammate's index with their current memory files.
   * Upserts new/changed files without a full rebuild.
   */
  async syncTeammate(teammate: string): Promise<number> {
    const { files } = await this.collectFiles(teammate);
    if (files.length === 0) return 0;

    const indexPath = this.indexPath(teammate);
    const index = new LocalDocumentIndex({
      folderPath: indexPath,
      embeddings: this._embeddings,
    });

    if (!(await index.isIndexCreated())) {
      // No index yet — do a full build
      return this.indexTeammate(teammate);
    }

    // Upsert all files as chunks (Vectra handles dedup internally via URI)
    let count = 0;
    for (const file of files) {
      const text = await fs.readFile(file.absolutePath, "utf-8");
      if (text.trim().length === 0) continue;

      const chunks = chunkMarkdown(text);
      for (const chunk of chunks) {
        const uri = chunkUri(file.uri, chunk);
        await index.upsertDocument(uri, chunk.text, "md");
        count++;
      }
    }

    return count;
  }

  /**
   * Delete a document from a teammate's index by URI.
   * Used to purge stale daily logs after they age out on disk.
   */
  async deleteDocument(teammate: string, uri: string): Promise<void> {
    const indexPath = this.indexPath(teammate);
    const index = new LocalDocumentIndex({
      folderPath: indexPath,
      embeddings: this._embeddings,
    });

    if (!(await index.isIndexCreated())) return;

    const docId = await index.getDocumentId(uri);
    if (docId) {
      await index.deleteDocument(uri);
    }
  }

  /**
   * Sync indexes for all teammates.
   */
  async syncAll(): Promise<Map<string, number>> {
    const teammates = await this.discoverTeammates();
    const results = new Map<string, number>();
    for (const teammate of teammates) {
      const count = await this.syncTeammate(teammate);
      results.set(teammate, count);
    }
    return results;
  }
}
