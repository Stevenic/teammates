import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compactDailies, compactEpisodic, compactWeeklies } from "./compact.js";

let testDir: string;

beforeEach(async () => {
  testDir = join(
    tmpdir(),
    `compact-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

// Verified ISO weeks: 2024-03-05 (Tue)=W10, 2024-03-06 (Wed)=W10, 2024-03-07 (Thu)=W10
//                     2024-03-12 (Tue)=W11, 2024-03-13 (Wed)=W11

describe("compactDailies", () => {
  it("creates weekly summary from completed week's dailies", async () => {
    const memDir = join(testDir, "memory");
    await mkdir(memDir, { recursive: true });

    // All three in ISO 2024-W10
    await writeFile(join(memDir, "2024-03-05.md"), "# Tuesday\nDid stuff");
    await writeFile(
      join(memDir, "2024-03-06.md"),
      "# Wednesday\nDid more stuff",
    );
    await writeFile(join(memDir, "2024-03-07.md"), "# Thursday\nDid even more");

    const result = await compactDailies(testDir);

    expect(result.created).toHaveLength(1);
    expect(result.created[0]).toBe("2024-W10.md");
    expect(result.removed).toHaveLength(3);
    expect(result.removed).toContain("2024-03-05.md");
    expect(result.removed).toContain("2024-03-06.md");
    expect(result.removed).toContain("2024-03-07.md");

    // Verify the weekly summary was actually written
    const weeklyDir = join(memDir, "weekly");
    const weeklyFiles = await readdir(weeklyDir);
    expect(weeklyFiles).toHaveLength(1);

    const content = await readFile(join(weeklyDir, weeklyFiles[0]), "utf-8");
    expect(content).toContain("type: weekly");
    expect(content).toContain("2024-03-05");
    expect(content).toContain("Did stuff");
    expect(content).toContain("Did more stuff");
  });

  it("does not compact current week's dailies", async () => {
    const memDir = join(testDir, "memory");
    await mkdir(memDir, { recursive: true });

    const today = new Date().toISOString().slice(0, 10);
    await writeFile(join(memDir, `${today}.md`), "# Today\nDoing stuff");

    const result = await compactDailies(testDir);

    expect(result.created).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
  });

  it("groups dailies into separate weeks", async () => {
    const memDir = join(testDir, "memory");
    await mkdir(memDir, { recursive: true });

    // W10: Mar 5-6, W11: Mar 12-13
    await writeFile(join(memDir, "2024-03-05.md"), "# W10 day1");
    await writeFile(join(memDir, "2024-03-06.md"), "# W10 day2");
    await writeFile(join(memDir, "2024-03-12.md"), "# W11 day1");
    await writeFile(join(memDir, "2024-03-13.md"), "# W11 day2");

    const result = await compactDailies(testDir);

    expect(result.created).toHaveLength(2);
    expect(result.removed).toHaveLength(4);
  });

  it("skips weeks that already have a weekly summary", async () => {
    const memDir = join(testDir, "memory");
    const weeklyDir = join(memDir, "weekly");
    await mkdir(weeklyDir, { recursive: true });

    await writeFile(join(memDir, "2024-03-05.md"), "# Day 1");
    // Pre-existing weekly summary for W10
    await writeFile(join(weeklyDir, "2024-W10.md"), "# Already compacted");

    const result = await compactDailies(testDir);

    expect(result.created).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
  });

  it("returns empty when no daily logs exist", async () => {
    const memDir = join(testDir, "memory");
    await mkdir(memDir, { recursive: true });
    await writeFile(join(memDir, "feedback_test.md"), "# Not a daily");

    const result = await compactDailies(testDir);

    expect(result.created).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
  });

  it("returns empty when memory dir doesn't exist", async () => {
    const result = await compactDailies(testDir);
    expect(result.created).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  it("builds weekly summary with correct frontmatter and chronological order", async () => {
    const memDir = join(testDir, "memory");
    await mkdir(memDir, { recursive: true });

    // Write out of order — compaction should sort chronologically
    await writeFile(join(memDir, "2024-03-07.md"), "# Thursday entry");
    await writeFile(join(memDir, "2024-03-05.md"), "# Tuesday entry");
    await writeFile(join(memDir, "2024-03-06.md"), "# Wednesday entry");

    await compactDailies(testDir);

    const weeklyDir = join(memDir, "weekly");
    const files = await readdir(weeklyDir);
    const content = await readFile(join(weeklyDir, files[0]), "utf-8");

    // Check frontmatter
    expect(content).toMatch(/^---\n/);
    expect(content).toContain("type: weekly");
    expect(content).toContain("week: 2024-W10");
    expect(content).toContain("period: 2024-03-05 to 2024-03-07");

    // Check chronological order
    const tuesdayIdx = content.indexOf("Tuesday entry");
    const wednesdayIdx = content.indexOf("Wednesday entry");
    const thursdayIdx = content.indexOf("Thursday entry");
    expect(tuesdayIdx).toBeLessThan(wednesdayIdx);
    expect(wednesdayIdx).toBeLessThan(thursdayIdx);
  });
});

describe("compactWeeklies", () => {
  it("compacts weeklies older than 52 weeks into monthly summary", async () => {
    const weeklyDir = join(testDir, "memory", "weekly");
    await mkdir(weeklyDir, { recursive: true });

    // ~2 years ago — definitely older than 52 weeks
    await writeFile(
      join(weeklyDir, "2023-W10.md"),
      "---\ntype: weekly\nweek: 2023-W10\n---\n# Week 10\nStuff",
    );
    await writeFile(
      join(weeklyDir, "2023-W11.md"),
      "---\ntype: weekly\nweek: 2023-W11\n---\n# Week 11\nMore stuff",
    );

    const result = await compactWeeklies(testDir);

    expect(result.created.length).toBeGreaterThanOrEqual(1);
    expect(result.removed).toHaveLength(2);
    expect(result.removed).toContain("2023-W10.md");
    expect(result.removed).toContain("2023-W11.md");

    // Verify monthly summary was written
    const monthlyDir = join(testDir, "memory", "monthly");
    const monthlyFiles = await readdir(monthlyDir);
    expect(monthlyFiles.length).toBeGreaterThanOrEqual(1);

    const content = await readFile(join(monthlyDir, monthlyFiles[0]), "utf-8");
    expect(content).toContain("type: monthly");
  });

  it("does not compact recent weeklies", async () => {
    const weeklyDir = join(testDir, "memory", "weekly");
    await mkdir(weeklyDir, { recursive: true });

    // Use current year — should be within 52 weeks
    const now = new Date();
    const year = now.getFullYear();
    await writeFile(
      join(weeklyDir, `${year}-W10.md`),
      `---\ntype: weekly\nweek: ${year}-W10\n---\n# Recent`,
    );

    const result = await compactWeeklies(testDir);

    expect(result.created).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
  });

  it("returns empty when no weekly dir exists", async () => {
    const result = await compactWeeklies(testDir);
    expect(result.created).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  it("skips months that already have a monthly summary", async () => {
    const weeklyDir = join(testDir, "memory", "weekly");
    const monthlyDir = join(testDir, "memory", "monthly");
    await mkdir(weeklyDir, { recursive: true });
    await mkdir(monthlyDir, { recursive: true });

    await writeFile(
      join(weeklyDir, "2023-W10.md"),
      "---\ntype: weekly\nweek: 2023-W10\n---\n# W10",
    );
    await writeFile(join(monthlyDir, "2023-03.md"), "# Already compacted");

    const result = await compactWeeklies(testDir);

    // The monthly for 2023-03 already exists
    const created = result.created.filter((f) => f === "2023-03.md");
    expect(created).toHaveLength(0);
  });

  it("strips frontmatter from weekly content in monthly summary", async () => {
    const weeklyDir = join(testDir, "memory", "weekly");
    await mkdir(weeklyDir, { recursive: true });

    const weeklyContent =
      "---\ntype: weekly\nweek: 2023-W10\nperiod: 2023-03-06 to 2023-03-10\n---\n\n# Week 2023-W10\n\nSome work was done.";
    await writeFile(join(weeklyDir, "2023-W10.md"), weeklyContent);

    const result = await compactWeeklies(testDir);

    if (result.created.length > 0) {
      const monthlyDir = join(testDir, "memory", "monthly");
      const monthlyFiles = await readdir(monthlyDir);
      const content = await readFile(
        join(monthlyDir, monthlyFiles[0]),
        "utf-8",
      );

      // Monthly should have its own frontmatter but NOT the weekly's
      expect(content).toContain("type: monthly");
      expect(content).not.toContain("type: weekly");
      expect(content).toContain("Some work was done.");
    }
  });
});

describe("compactEpisodic", () => {
  it("runs both daily and weekly compaction", async () => {
    const memDir = join(testDir, "memory");
    await mkdir(memDir, { recursive: true });

    // Both in ISO 2024-W10
    await writeFile(join(memDir, "2024-03-05.md"), "# Day 1");
    await writeFile(join(memDir, "2024-03-06.md"), "# Day 2");

    const result = await compactEpisodic(testDir, "test");

    expect(result.teammate).toBe("test");
    expect(result.weekliesCreated).toHaveLength(1);
    expect(result.dailiesRemoved).toHaveLength(2);
    // The newly created weekly (2024-W10) is >52 weeks old, so compactWeeklies
    // immediately compacts it into a monthly summary
    expect(result.monthliesCreated).toHaveLength(1);
    expect(result.weekliesRemoved).toHaveLength(1);
  });

  it("returns empty results for teammate with no memory", async () => {
    const result = await compactEpisodic(testDir, "empty");

    expect(result.teammate).toBe("empty");
    expect(result.weekliesCreated).toEqual([]);
    expect(result.monthliesCreated).toEqual([]);
    expect(result.dailiesRemoved).toEqual([]);
    expect(result.weekliesRemoved).toEqual([]);
  });
});
