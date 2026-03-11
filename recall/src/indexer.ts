import { LocalDocumentIndex } from "vectra";
import { LocalEmbeddings } from "./embeddings.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

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
 * Indexes teammate memory files (MEMORIES.md + memory/*.md) into Vectra.
 * One index per teammate, stored at .teammates/.index/<name>/
 */
export class Indexer {
  private _config: IndexerConfig;
  private _embeddings: LocalEmbeddings;

  constructor(config: IndexerConfig) {
    this._config = config;
    this._embeddings = new LocalEmbeddings(config.model);
  }

  get indexRoot(): string {
    return path.join(this._config.teammatesDir, ".index");
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
        "SOUL.md"
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

    // MEMORIES.md
    const memoriesPath = path.join(teammateDir, "MEMORIES.md");
    try {
      await fs.access(memoriesPath);
      files.push({ uri: `${teammate}/MEMORIES.md`, absolutePath: memoriesPath });
    } catch {
      // No MEMORIES.md
    }

    // memory/*.md (daily logs)
    const memoryDir = path.join(teammateDir, "memory");
    try {
      const memoryEntries = await fs.readdir(memoryDir);
      for (const entry of memoryEntries) {
        if (!entry.endsWith(".md")) continue;
        files.push({
          uri: `${teammate}/memory/${entry}`,
          absolutePath: path.join(memoryDir, entry),
        });
      }
    } catch {
      // No memory/ directory
    }

    return { teammate, files };
  }

  /**
   * Build or rebuild the index for a single teammate.
   */
  async indexTeammate(teammate: string): Promise<number> {
    const { files } = await this.collectFiles(teammate);
    if (files.length === 0) return 0;

    const indexPath = path.join(this.indexRoot, teammate);
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
      await index.upsertDocument(file.uri, text, "md");
      count++;
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
    const uri = `${teammate}/${relativePath.replace(/\\/g, "/")}`;

    const text = await fs.readFile(absolutePath, "utf-8");
    if (text.trim().length === 0) return;

    const indexPath = path.join(this.indexRoot, teammate);
    const index = new LocalDocumentIndex({
      folderPath: indexPath,
      embeddings: this._embeddings,
    });

    if (!(await index.isIndexCreated())) {
      await index.createIndex({ version: 1 });
    }

    await index.upsertDocument(uri, text, "md");
  }

  /**
   * Sync a teammate's index with their current memory files.
   * Upserts new/changed files without a full rebuild.
   */
  async syncTeammate(teammate: string): Promise<number> {
    const { files } = await this.collectFiles(teammate);
    if (files.length === 0) return 0;

    const indexPath = path.join(this.indexRoot, teammate);
    const index = new LocalDocumentIndex({
      folderPath: indexPath,
      embeddings: this._embeddings,
    });

    if (!(await index.isIndexCreated())) {
      // No index yet — do a full build
      return this.indexTeammate(teammate);
    }

    // Upsert all files (Vectra handles dedup internally via URI)
    let count = 0;
    for (const file of files) {
      const text = await fs.readFile(file.absolutePath, "utf-8");
      if (text.trim().length === 0) continue;
      await index.upsertDocument(file.uri, text, "md");
      count++;
    }

    return count;
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
