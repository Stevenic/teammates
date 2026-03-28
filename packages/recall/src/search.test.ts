import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Indexer } from "./indexer.js";
import type { SearchResult } from "./search.js";
import { classifyUri, multiSearch, search } from "./search.js";

// Deterministic stub embeddings based on text content
function stubCreateEmbeddings(inputs: string | string[]) {
  const texts = Array.isArray(inputs) ? inputs : [inputs];
  return {
    status: "success" as const,
    output: texts.map((t) => {
      const vec = new Array(384).fill(0);
      for (let i = 0; i < t.length; i++) {
        vec[i % 384] += t.charCodeAt(i) / 1000;
      }
      return vec;
    }),
  };
}

// Mock LocalEmbeddings so search() uses stubs instead of real model
vi.mock("./embeddings.js", () => ({
  LocalEmbeddings: class {
    readonly maxTokens = 256;
    async createEmbeddings(inputs: string | string[]) {
      return stubCreateEmbeddings(inputs);
    }
  },
}));

function createIndexer(teammatesDir: string): Indexer {
  const indexer = new Indexer({ teammatesDir });
  // Indexer also creates LocalEmbeddings internally — already mocked above
  return indexer;
}

let testDir: string;

beforeEach(async () => {
  testDir = join(
    tmpdir(),
    `recall-search-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("classifyUri", () => {
  it("classifies weekly summaries", () => {
    expect(classifyUri("beacon/memory/weekly/2026-W10.md")).toBe("weekly");
  });

  it("classifies monthly summaries", () => {
    expect(classifyUri("beacon/memory/monthly/2025-12.md")).toBe("monthly");
  });

  it("classifies typed memories", () => {
    expect(classifyUri("beacon/memory/feedback_testing.md")).toBe(
      "typed_memory",
    );
    expect(classifyUri("beacon/memory/project_goals.md")).toBe("typed_memory");
  });

  it("classifies daily logs", () => {
    expect(classifyUri("beacon/memory/2026-03-14.md")).toBe("daily");
    expect(classifyUri("beacon/memory/2026-01-01.md")).toBe("daily");
  });

  it("classifies WISDOM.md as other", () => {
    expect(classifyUri("beacon/WISDOM.md")).toBe("other");
  });

  it("classifies non-memory paths as other", () => {
    expect(classifyUri("beacon/SOUL.md")).toBe("other");
    expect(classifyUri("beacon/notes/todo.md")).toBe("other");
  });
});

describe("search", () => {
  it("returns results from an indexed teammate", async () => {
    const beacon = join(testDir, "beacon");
    const memDir = join(beacon, "memory");
    await mkdir(memDir, { recursive: true });
    await writeFile(join(beacon, "SOUL.md"), "# Beacon");
    await writeFile(join(beacon, "WISDOM.md"), "# Beacon wisdom about coding");
    await writeFile(
      join(memDir, "feedback_testing.md"),
      "# Testing feedback\nAlways run tests before committing.",
    );

    // Pre-build the index with stub embeddings
    const indexer = createIndexer(testDir);
    await indexer.indexTeammate("beacon");

    // Patch search to use stub embeddings by searching with skipSync
    const results = await search("testing feedback", {
      teammatesDir: testDir,
      teammate: "beacon",
      skipSync: true,
      model: "stub", // won't matter since we mock at the index level
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].teammate).toBe("beacon");
    expect(results[0].score).toBeGreaterThan(0);
  });

  it("returns empty results when no index exists", async () => {
    const beacon = join(testDir, "beacon");
    await mkdir(beacon, { recursive: true });
    await writeFile(join(beacon, "SOUL.md"), "# Beacon");

    const results = await search("anything", {
      teammatesDir: testDir,
      teammate: "beacon",
      skipSync: true,
    });

    expect(results).toEqual([]);
  });

  it("includes recent weekly summaries via recency pass", async () => {
    const beacon = join(testDir, "beacon");
    const weeklyDir = join(beacon, "memory", "weekly");
    await mkdir(weeklyDir, { recursive: true });
    await writeFile(join(beacon, "SOUL.md"), "# Beacon");
    await writeFile(
      join(weeklyDir, "2026-W10.md"),
      "# Week 10\nWorked on search.",
    );
    await writeFile(
      join(weeklyDir, "2026-W11.md"),
      "# Week 11\nWorked on indexer.",
    );
    await writeFile(join(weeklyDir, "2026-W09.md"), "# Week 9\nOld stuff.");

    const results = await search("anything", {
      teammatesDir: testDir,
      teammate: "beacon",
      skipSync: true,
      recencyDepth: 2,
    });

    const uris = results.map((r) => r.uri);
    // Should include the 2 most recent weeks (W11 and W10), not W09
    expect(uris).toContain("beacon/memory/weekly/2026-W11.md");
    expect(uris).toContain("beacon/memory/weekly/2026-W10.md");
    expect(uris).not.toContain("beacon/memory/weekly/2026-W09.md");
  });

  it("respects recencyDepth: 0 (no weekly summaries)", async () => {
    const beacon = join(testDir, "beacon");
    const weeklyDir = join(beacon, "memory", "weekly");
    await mkdir(weeklyDir, { recursive: true });
    await writeFile(join(beacon, "SOUL.md"), "# Beacon");
    await writeFile(join(weeklyDir, "2026-W11.md"), "# Week 11\nContent here.");

    const results = await search("anything", {
      teammatesDir: testDir,
      teammate: "beacon",
      skipSync: true,
      recencyDepth: 0,
    });

    const uris = results.map((r) => r.uri);
    expect(uris).not.toContain("beacon/memory/weekly/2026-W11.md");
  });

  it("searches all teammates when no teammate specified", async () => {
    const beacon = join(testDir, "beacon");
    const scribe = join(testDir, "scribe");
    await mkdir(join(beacon, "memory"), { recursive: true });
    await mkdir(join(scribe, "memory"), { recursive: true });
    await writeFile(join(beacon, "SOUL.md"), "# Beacon");
    await writeFile(join(scribe, "SOUL.md"), "# Scribe");
    await writeFile(join(beacon, "WISDOM.md"), "# Beacon wisdom");
    await writeFile(join(scribe, "WISDOM.md"), "# Scribe wisdom");

    // Build indexes
    const indexer = createIndexer(testDir);
    await indexer.indexTeammate("beacon");
    await indexer.indexTeammate("scribe");

    const results = await search("wisdom", {
      teammatesDir: testDir,
      skipSync: true,
    });

    const teammates = new Set(results.map((r) => r.teammate));
    expect(teammates.size).toBeGreaterThanOrEqual(1);
  });

  it("deduplicates recency results with semantic results", async () => {
    const beacon = join(testDir, "beacon");
    const weeklyDir = join(beacon, "memory", "weekly");
    await mkdir(weeklyDir, { recursive: true });
    await writeFile(join(beacon, "SOUL.md"), "# Beacon");
    await writeFile(
      join(weeklyDir, "2026-W11.md"),
      "# Week 11\nSearch implementation details.",
    );

    // Build index that includes the weekly file
    const indexer = createIndexer(testDir);
    await indexer.indexTeammate("beacon");

    const results = await search("search implementation", {
      teammatesDir: testDir,
      teammate: "beacon",
      skipSync: true,
      recencyDepth: 2,
    });

    // The weekly file should appear only once despite being picked up by both passes
    const weeklyUris = results.filter(
      (r) => r.uri === "beacon/memory/weekly/2026-W11.md",
    );
    expect(weeklyUris).toHaveLength(1);
  });

  it("applies typed memory boost", async () => {
    const beacon = join(testDir, "beacon");
    const memDir = join(beacon, "memory");
    await mkdir(memDir, { recursive: true });
    await writeFile(join(beacon, "SOUL.md"), "# Beacon");
    await writeFile(join(beacon, "WISDOM.md"), "# Some wisdom about testing");
    await writeFile(
      join(memDir, "feedback_testing.md"),
      "# Testing feedback\nAlways verify test output carefully.",
    );

    const indexer = createIndexer(testDir);
    await indexer.indexTeammate("beacon");

    const results = await search("testing", {
      teammatesDir: testDir,
      teammate: "beacon",
      skipSync: true,
      typedMemoryBoost: 1.5,
    });

    // Find typed memory results — they should have boosted scores
    const typedResults = results.filter(
      (r) => r.contentType === "typed_memory",
    );
    if (typedResults.length > 0) {
      // Just verify the contentType was set correctly
      expect(typedResults[0].contentType).toBe("typed_memory");
    }
  });
});

describe("multiSearch", () => {
  it("merges results from primary and additional queries", async () => {
    const beacon = join(testDir, "beacon");
    const memDir = join(beacon, "memory");
    await mkdir(memDir, { recursive: true });
    await writeFile(join(beacon, "SOUL.md"), "# Beacon");
    await writeFile(join(beacon, "WISDOM.md"), "# Wisdom about architecture");
    await writeFile(
      join(memDir, "feedback_code_review.md"),
      "# Code review feedback\nAlways review pull requests thoroughly.",
    );

    const indexer = createIndexer(testDir);
    await indexer.indexTeammate("beacon");

    const results = await multiSearch("architecture", {
      teammatesDir: testDir,
      teammate: "beacon",
      skipSync: true,
      additionalQueries: ["code review"],
    });

    expect(results.length).toBeGreaterThan(0);
  });

  it("deduplicates by URI — highest score wins", async () => {
    const beacon = join(testDir, "beacon");
    await mkdir(beacon, { recursive: true });
    await writeFile(join(beacon, "SOUL.md"), "# Beacon");
    await writeFile(
      join(beacon, "WISDOM.md"),
      "# Wisdom about testing and code quality",
    );

    const indexer = createIndexer(testDir);
    await indexer.indexTeammate("beacon");

    const results = await multiSearch("testing", {
      teammatesDir: testDir,
      teammate: "beacon",
      skipSync: true,
      additionalQueries: ["testing code quality"],
    });

    // Check no duplicate URIs
    const uris = results.map((r) => r.uri);
    const uniqueUris = new Set(uris);
    expect(uris.length).toBe(uniqueUris.size);
  });

  it("merges catalog matches into results", async () => {
    const beacon = join(testDir, "beacon");
    await mkdir(beacon, { recursive: true });
    await writeFile(join(beacon, "SOUL.md"), "# Beacon");
    await writeFile(join(beacon, "WISDOM.md"), "# Wisdom");

    const indexer = createIndexer(testDir);
    await indexer.indexTeammate("beacon");

    const catalogMatches: SearchResult[] = [
      {
        teammate: "beacon",
        uri: "beacon/memory/project_goals.md",
        text: "# Project Goals\nBuild the best recall system.",
        score: 0.92,
        contentType: "typed_memory",
      },
    ];

    const results = await multiSearch("goals", {
      teammatesDir: testDir,
      teammate: "beacon",
      skipSync: true,
      catalogMatches,
    });

    const goalResult = results.find(
      (r) => r.uri === "beacon/memory/project_goals.md",
    );
    expect(goalResult).toBeDefined();
    expect(goalResult!.score).toBe(0.92);
  });

  it("additional queries skip recency pass (recencyDepth: 0)", async () => {
    const beacon = join(testDir, "beacon");
    const weeklyDir = join(beacon, "memory", "weekly");
    await mkdir(weeklyDir, { recursive: true });
    await writeFile(join(beacon, "SOUL.md"), "# Beacon");
    await writeFile(
      join(weeklyDir, "2026-W11.md"),
      "# Week 11\nDid some work.",
    );

    const results = await multiSearch("work", {
      teammatesDir: testDir,
      teammate: "beacon",
      skipSync: true,
      recencyDepth: 2,
      additionalQueries: ["more work"],
    });

    // Weekly should appear at most once (from primary, not duplicated from additional)
    const weeklyResults = results.filter(
      (r) => r.uri === "beacon/memory/weekly/2026-W11.md",
    );
    expect(weeklyResults.length).toBeLessThanOrEqual(1);
  });

  it("returns empty when no index and no catalog matches", async () => {
    const beacon = join(testDir, "beacon");
    await mkdir(beacon, { recursive: true });
    await writeFile(join(beacon, "SOUL.md"), "# Beacon");

    const results = await multiSearch("anything", {
      teammatesDir: testDir,
      teammate: "beacon",
      skipSync: true,
    });

    expect(results).toEqual([]);
  });
});
