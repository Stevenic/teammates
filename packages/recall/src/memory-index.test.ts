import * as fs from "node:fs/promises";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { matchMemoryCatalog, scanMemoryCatalog } from "./memory-index.js";

const TEST_DIR = path.join(process.cwd(), ".test-memory-index");
const TEAMMATE = "testmate";

beforeAll(async () => {
  const memoryDir = path.join(TEST_DIR, TEAMMATE, "memory");
  await fs.mkdir(memoryDir, { recursive: true });

  // Create typed memory files with frontmatter
  await fs.writeFile(
    path.join(memoryDir, "project_goals.md"),
    `---
name: project_goals
description: Stack-ranked feature goals for the teammates project
type: project
---

## Goals

1. Recall query architecture
2. CLI improvements
`,
  );

  await fs.writeFile(
    path.join(memoryDir, "feedback_testing.md"),
    `---
name: feedback_testing
description: Integration tests must hit a real database, not mocks
type: feedback
---

Use real databases in tests. Mocks hide migration bugs.
`,
  );

  // Create a file without frontmatter (should be skipped)
  await fs.writeFile(
    path.join(memoryDir, "notes.md"),
    "Just some notes without frontmatter.\n",
  );

  // Create a daily log (should be skipped)
  await fs.writeFile(
    path.join(memoryDir, "2026-03-21.md"),
    "# 2026-03-21\nDaily log content.\n",
  );
});

afterAll(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

describe("scanMemoryCatalog", () => {
  it("returns entries with frontmatter", async () => {
    const entries = await scanMemoryCatalog(TEST_DIR, TEAMMATE);
    expect(entries.length).toBe(2);
    const names = entries.map((e) => e.name);
    expect(names).toContain("project_goals");
    expect(names).toContain("feedback_testing");
  });

  it("skips files without frontmatter", async () => {
    const entries = await scanMemoryCatalog(TEST_DIR, TEAMMATE);
    const uris = entries.map((e) => e.uri);
    expect(uris).not.toContain(`${TEAMMATE}/memory/notes.md`);
  });

  it("skips daily logs", async () => {
    const entries = await scanMemoryCatalog(TEST_DIR, TEAMMATE);
    const uris = entries.map((e) => e.uri);
    expect(uris).not.toContain(`${TEAMMATE}/memory/2026-03-21.md`);
  });

  it("returns empty array for nonexistent teammate", async () => {
    const entries = await scanMemoryCatalog(TEST_DIR, "nobody");
    expect(entries).toEqual([]);
  });
});

describe("matchMemoryCatalog", () => {
  it("matches files whose frontmatter overlaps with the query", async () => {
    const results = await matchMemoryCatalog(
      TEST_DIR,
      TEAMMATE,
      "what are our project goals and features?",
    );
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].uri).toContain("project_goals");
  });

  it("matches on description keywords", async () => {
    const results = await matchMemoryCatalog(
      TEST_DIR,
      TEAMMATE,
      "database testing integration",
    );
    expect(results.length).toBeGreaterThanOrEqual(1);
    const uris = results.map((r) => r.uri);
    expect(uris).toContain(`${TEAMMATE}/memory/feedback_testing.md`);
  });

  it("returns empty for unrelated queries", async () => {
    const results = await matchMemoryCatalog(
      TEST_DIR,
      TEAMMATE,
      "quantum physics dark matter",
    );
    expect(results.length).toBe(0);
  });

  it("strips frontmatter from result text", async () => {
    const results = await matchMemoryCatalog(
      TEST_DIR,
      TEAMMATE,
      "project goals features",
    );
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].text).not.toContain("---");
    expect(results[0].text).toContain("Goals");
  });

  it("assigns scores in the 0.85-0.95 range", async () => {
    const results = await matchMemoryCatalog(
      TEST_DIR,
      TEAMMATE,
      "project goals features teammates",
    );
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0.85);
      expect(r.score).toBeLessThanOrEqual(0.95);
    }
  });

  it("sets contentType to typed_memory", async () => {
    const results = await matchMemoryCatalog(
      TEST_DIR,
      TEAMMATE,
      "project goals",
    );
    for (const r of results) {
      expect(r.contentType).toBe("typed_memory");
    }
  });
});
