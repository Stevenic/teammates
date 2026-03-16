import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Indexer } from "./indexer.js";

// Stub embeddings — we don't want to load the real model in tests
class StubEmbeddings {
  readonly maxTokens = 256;
  async createEmbeddings(inputs: string | string[]) {
    const texts = Array.isArray(inputs) ? inputs : [inputs];
    return {
      status: "success" as const,
      output: texts.map(() => new Array(384).fill(0).map(() => Math.random())),
    };
  }
}

// Create an Indexer with stubbed embeddings
function createIndexer(teammatesDir: string): Indexer {
  const indexer = new Indexer({ teammatesDir });
  // Swap out the real embeddings with our stub
  (indexer as any)._embeddings = new StubEmbeddings();
  return indexer;
}

let testDir: string;

beforeEach(async () => {
  testDir = join(
    tmpdir(),
    `recall-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("Indexer", () => {
  describe("discoverTeammates", () => {
    it("finds directories containing SOUL.md", async () => {
      const beacon = join(testDir, "beacon");
      const scribe = join(testDir, "scribe");
      const notTeammate = join(testDir, "random");

      await mkdir(beacon, { recursive: true });
      await mkdir(scribe, { recursive: true });
      await mkdir(notTeammate, { recursive: true });

      await writeFile(join(beacon, "SOUL.md"), "# Beacon");
      await writeFile(join(scribe, "SOUL.md"), "# Scribe");
      // notTeammate has no SOUL.md

      const indexer = createIndexer(testDir);
      const teammates = await indexer.discoverTeammates();

      expect(teammates).toContain("beacon");
      expect(teammates).toContain("scribe");
      expect(teammates).not.toContain("random");
    });

    it("ignores dot-prefixed directories", async () => {
      const hidden = join(testDir, ".tmp");
      await mkdir(hidden, { recursive: true });
      await writeFile(join(hidden, "SOUL.md"), "# Hidden");

      const indexer = createIndexer(testDir);
      const teammates = await indexer.discoverTeammates();

      expect(teammates).not.toContain(".tmp");
      expect(teammates).toHaveLength(0);
    });

    it("returns empty array when no teammates exist", async () => {
      const indexer = createIndexer(testDir);
      const teammates = await indexer.discoverTeammates();
      expect(teammates).toEqual([]);
    });
  });

  describe("collectFiles", () => {
    it("collects WISDOM.md", async () => {
      const beacon = join(testDir, "beacon");
      await mkdir(beacon, { recursive: true });
      await writeFile(join(beacon, "WISDOM.md"), "# Wisdom");

      const indexer = createIndexer(testDir);
      const { files } = await indexer.collectFiles("beacon");

      expect(files).toHaveLength(1);
      expect(files[0].uri).toBe("beacon/WISDOM.md");
    });

    it("collects typed memory files from memory/", async () => {
      const memDir = join(testDir, "beacon", "memory");
      await mkdir(memDir, { recursive: true });
      await writeFile(join(memDir, "feedback_testing.md"), "# Feedback");
      await writeFile(join(memDir, "project_goals.md"), "# Goals");

      const indexer = createIndexer(testDir);
      const { files } = await indexer.collectFiles("beacon");

      const uris = files.map((f) => f.uri);
      expect(uris).toContain("beacon/memory/feedback_testing.md");
      expect(uris).toContain("beacon/memory/project_goals.md");
    });

    it("skips daily logs (YYYY-MM-DD.md pattern)", async () => {
      const memDir = join(testDir, "beacon", "memory");
      await mkdir(memDir, { recursive: true });
      await writeFile(join(memDir, "2026-03-14.md"), "# Day 1");
      await writeFile(join(memDir, "2026-03-15.md"), "# Day 2");
      await writeFile(join(memDir, "feedback_testing.md"), "# Feedback");

      const indexer = createIndexer(testDir);
      const { files } = await indexer.collectFiles("beacon");

      const uris = files.map((f) => f.uri);
      expect(uris).not.toContain("beacon/memory/2026-03-14.md");
      expect(uris).not.toContain("beacon/memory/2026-03-15.md");
      expect(uris).toContain("beacon/memory/feedback_testing.md");
    });

    it("collects weekly summaries from memory/weekly/", async () => {
      const weeklyDir = join(testDir, "beacon", "memory", "weekly");
      await mkdir(weeklyDir, { recursive: true });
      await writeFile(join(weeklyDir, "2026-W10.md"), "# Week 10");
      await writeFile(join(weeklyDir, "2026-W11.md"), "# Week 11");

      const indexer = createIndexer(testDir);
      const { files } = await indexer.collectFiles("beacon");

      const uris = files.map((f) => f.uri);
      expect(uris).toContain("beacon/memory/weekly/2026-W10.md");
      expect(uris).toContain("beacon/memory/weekly/2026-W11.md");
    });

    it("collects monthly summaries from memory/monthly/", async () => {
      const monthlyDir = join(testDir, "beacon", "memory", "monthly");
      await mkdir(monthlyDir, { recursive: true });
      await writeFile(join(monthlyDir, "2025-12.md"), "# Dec 2025");

      const indexer = createIndexer(testDir);
      const { files } = await indexer.collectFiles("beacon");

      const uris = files.map((f) => f.uri);
      expect(uris).toContain("beacon/memory/monthly/2025-12.md");
    });

    it("skips non-md files", async () => {
      const memDir = join(testDir, "beacon", "memory");
      await mkdir(memDir, { recursive: true });
      await writeFile(join(memDir, "notes.txt"), "not markdown");
      await writeFile(join(memDir, "feedback_test.md"), "# Feedback");

      const indexer = createIndexer(testDir);
      const { files } = await indexer.collectFiles("beacon");

      expect(files).toHaveLength(1);
      expect(files[0].uri).toBe("beacon/memory/feedback_test.md");
    });

    it("returns empty files when teammate has no content", async () => {
      await mkdir(join(testDir, "beacon"), { recursive: true });

      const indexer = createIndexer(testDir);
      const { files } = await indexer.collectFiles("beacon");
      expect(files).toEqual([]);
    });
  });

  describe("indexPath", () => {
    it("returns correct path under teammate directory", () => {
      const indexer = createIndexer(testDir);
      const p = indexer.indexPath("beacon");
      expect(p).toBe(join(testDir, "beacon", ".index"));
    });
  });

  describe("indexTeammate", () => {
    it("creates an index and returns file count", async () => {
      const beacon = join(testDir, "beacon");
      const memDir = join(beacon, "memory");
      await mkdir(memDir, { recursive: true });
      await writeFile(join(beacon, "WISDOM.md"), "# Wisdom content");
      await writeFile(join(memDir, "feedback_test.md"), "# Feedback content");

      const indexer = createIndexer(testDir);
      const count = await indexer.indexTeammate("beacon");

      expect(count).toBe(2);
    });

    it("returns 0 when no files to index", async () => {
      await mkdir(join(testDir, "beacon"), { recursive: true });

      const indexer = createIndexer(testDir);
      const count = await indexer.indexTeammate("beacon");
      expect(count).toBe(0);
    });

    it("skips empty files", async () => {
      const beacon = join(testDir, "beacon");
      await mkdir(beacon, { recursive: true });
      await writeFile(join(beacon, "WISDOM.md"), "   "); // whitespace only

      const indexer = createIndexer(testDir);
      const count = await indexer.indexTeammate("beacon");
      expect(count).toBe(0);
    });
  });

  describe("indexAll", () => {
    it("indexes all discovered teammates", async () => {
      const beacon = join(testDir, "beacon");
      const scribe = join(testDir, "scribe");
      await mkdir(beacon, { recursive: true });
      await mkdir(scribe, { recursive: true });
      await writeFile(join(beacon, "SOUL.md"), "# Beacon");
      await writeFile(join(beacon, "WISDOM.md"), "# Beacon wisdom");
      await writeFile(join(scribe, "SOUL.md"), "# Scribe");

      const indexer = createIndexer(testDir);
      const results = await indexer.indexAll();

      expect(results.get("beacon")).toBe(1); // WISDOM.md only (SOUL.md not collected)
      expect(results.get("scribe")).toBe(0); // no indexable files
    });
  });

  describe("syncTeammate", () => {
    it("falls back to full index when no index exists", async () => {
      const beacon = join(testDir, "beacon");
      await mkdir(beacon, { recursive: true });
      await writeFile(join(beacon, "WISDOM.md"), "# Wisdom");

      const indexer = createIndexer(testDir);
      const count = await indexer.syncTeammate("beacon");
      expect(count).toBe(1);
    });

    it("upserts files into existing index", async () => {
      const beacon = join(testDir, "beacon");
      const memDir = join(beacon, "memory");
      await mkdir(memDir, { recursive: true });
      await writeFile(join(beacon, "WISDOM.md"), "# Wisdom");

      const indexer = createIndexer(testDir);
      // First build the index
      await indexer.indexTeammate("beacon");

      // Add a new file
      await writeFile(join(memDir, "project_goals.md"), "# Goals");

      // Sync should pick up the new file
      const count = await indexer.syncTeammate("beacon");
      expect(count).toBe(2); // WISDOM + project_goals
    });
  });
});
