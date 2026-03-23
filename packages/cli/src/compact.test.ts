import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DAILY_LOG_RETENTION_DAYS,
  autoCompactForBudget,
  buildWisdomPrompt,
  compactDailies,
  compactEpisodic,
  compactWeeklies,
  purgeStaleDailies,
} from "./compact.js";

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
    // Daily logs are no longer deleted during compaction (kept 30 days)
    expect(result.removed).toHaveLength(0);

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
    // Daily logs are no longer deleted during compaction (kept 30 days)
    expect(result.removed).toHaveLength(0);
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
    // Daily logs are no longer deleted during compaction (kept 30 days)
    expect(result.dailiesRemoved).toHaveLength(0);
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

describe("buildWisdomPrompt", () => {
  it("returns null when no typed memories or daily logs exist", async () => {
    const memDir = join(testDir, "memory");
    await mkdir(memDir, { recursive: true });

    const result = await buildWisdomPrompt(testDir, "test");
    expect(result).toBeNull();
  });

  it("returns null when memory dir does not exist", async () => {
    const result = await buildWisdomPrompt(testDir, "test");
    expect(result).toBeNull();
  });

  it("includes typed memory files in the prompt", async () => {
    const memDir = join(testDir, "memory");
    await mkdir(memDir, { recursive: true });

    await writeFile(
      join(memDir, "feedback_testing.md"),
      "---\nname: Testing feedback\ntype: feedback\n---\nAlways run tests before committing.",
    );

    const result = await buildWisdomPrompt(testDir, "beacon");
    expect(result).not.toBeNull();
    expect(result).toContain("## Typed Memories");
    expect(result).toContain("feedback_testing.md");
    expect(result).toContain("Always run tests before committing.");
  });

  it("includes recent daily logs in the prompt", async () => {
    const memDir = join(testDir, "memory");
    await mkdir(memDir, { recursive: true });

    const today = new Date().toISOString().slice(0, 10);
    await writeFile(join(memDir, `${today}.md`), "# Today\n\nDid some work.");

    const result = await buildWisdomPrompt(testDir, "beacon");
    expect(result).not.toBeNull();
    expect(result).toContain("## Recent Daily Logs");
    expect(result).toContain("Did some work.");
  });

  it("includes current WISDOM.md in the prompt when it exists", async () => {
    const memDir = join(testDir, "memory");
    await mkdir(memDir, { recursive: true });

    await writeFile(
      join(testDir, "WISDOM.md"),
      "# Beacon — Wisdom\n\n### Important pattern\nAlways check types.",
    );
    await writeFile(
      join(memDir, "decision_types.md"),
      "---\nname: Type checking\ntype: decision\n---\nUse strict mode.",
    );

    const result = await buildWisdomPrompt(testDir, "beacon");
    expect(result).not.toBeNull();
    expect(result).toContain("## Current WISDOM.md");
    expect(result).toContain("Important pattern");
  });

  it("skips daily log files from typed memories", async () => {
    const memDir = join(testDir, "memory");
    await mkdir(memDir, { recursive: true });

    await writeFile(join(memDir, "2026-03-20.md"), "# Daily log content");
    await writeFile(
      join(memDir, "feedback_test.md"),
      "---\nname: Test\ntype: feedback\n---\nSome feedback.",
    );

    const result = await buildWisdomPrompt(testDir, "beacon");
    expect(result).not.toBeNull();

    // Typed memories should NOT include the daily log
    const typedSection = result!.indexOf("## Typed Memories");
    const dailySection = result!.indexOf("## Recent Daily Logs");
    if (typedSection >= 0) {
      const typedContent = result!.slice(
        typedSection,
        dailySection > typedSection ? dailySection : undefined,
      );
      expect(typedContent).not.toContain("2026-03-20.md");
    }
  });

  it("includes distillation rules", async () => {
    const memDir = join(testDir, "memory");
    await mkdir(memDir, { recursive: true });

    await writeFile(
      join(memDir, "ref_test.md"),
      "---\nname: Ref\ntype: reference\n---\nA reference.",
    );

    const result = await buildWisdomPrompt(testDir, "beacon");
    expect(result).not.toBeNull();
    expect(result).toContain("## Rules");
    expect(result).toContain("distilled principles");
    expect(result).toContain("Last compacted:");
  });

  it("limits daily logs to 7 most recent", async () => {
    const memDir = join(testDir, "memory");
    await mkdir(memDir, { recursive: true });

    // Create 10 daily logs
    for (let i = 1; i <= 10; i++) {
      const day = i.toString().padStart(2, "0");
      await writeFile(join(memDir, `2026-03-${day}.md`), `# Day ${i}`);
    }

    const result = await buildWisdomPrompt(testDir, "beacon");
    expect(result).not.toBeNull();

    // Should include most recent 7, not all 10
    // Count the day headers in the Recent Daily Logs section
    const dailySection = result!.slice(result!.indexOf("## Recent Daily Logs"));
    const dayHeaders = dailySection.match(/### 2026-03-\d{2}/g);
    expect(dayHeaders).toHaveLength(7);
  });

  it("includes teammate name in instructions", async () => {
    const memDir = join(testDir, "memory");
    await mkdir(memDir, { recursive: true });

    await writeFile(
      join(memDir, "ref_x.md"),
      "---\nname: X\ntype: reference\n---\nContent.",
    );

    const result = await buildWisdomPrompt(testDir, "mybot");
    expect(result).not.toBeNull();
    expect(result).toContain(".teammates/mybot/WISDOM.md");
  });
});

describe("autoCompactForBudget", () => {
  it("returns null when daily logs are under budget", async () => {
    const memDir = join(testDir, "memory");
    await mkdir(memDir, { recursive: true });

    // Write a small daily log from a past week
    await writeFile(join(memDir, "2024-03-05.md"), "# Short log");

    const result = await autoCompactForBudget(testDir, 100_000);
    expect(result).toBeNull();
  });

  it("compacts oldest weeks when over budget", async () => {
    const memDir = join(testDir, "memory");
    await mkdir(memDir, { recursive: true });

    // Create large daily logs in two past weeks (W10 and W11)
    const bigContent = "x".repeat(50_000); // ~12,500 tokens each
    await writeFile(join(memDir, "2024-03-05.md"), bigContent); // W10
    await writeFile(join(memDir, "2024-03-06.md"), bigContent); // W10
    await writeFile(join(memDir, "2024-03-12.md"), bigContent); // W11
    await writeFile(join(memDir, "2024-03-13.md"), bigContent); // W11

    // Budget that fits ~2 logs but not 4
    const result = await autoCompactForBudget(testDir, 30_000);
    expect(result).not.toBeNull();
    expect(result!.created.length).toBeGreaterThanOrEqual(1);
    // Oldest week (W10) should be compacted first
    expect(result!.created[0]).toContain("2024-W10");
    expect(result!.compactedDates).toContain("2024-03-05");
    expect(result!.compactedDates).toContain("2024-03-06");

    // Verify weekly file was written
    const weeklyDir = join(memDir, "weekly");
    const files = await readdir(weeklyDir);
    expect(files).toContain("2024-W10.md");
  });

  it("marks current week compaction as partial", async () => {
    const memDir = join(testDir, "memory");
    await mkdir(memDir, { recursive: true });

    // Create a large daily log in a past week and one for today's week
    const bigContent = "x".repeat(100_000); // ~25,000 tokens
    await writeFile(join(memDir, "2024-03-05.md"), bigContent); // W10

    // Create a log in current week (not today specifically)
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);
    await writeFile(join(memDir, `${yesterdayStr}.md`), bigContent);

    // Very tight budget forces compacting both weeks
    const result = await autoCompactForBudget(testDir, 1_000);
    expect(result).not.toBeNull();

    // Check if any entry is marked partial (current week)
    const weeklyDir = join(memDir, "weekly");
    const files = await readdir(weeklyDir);

    let hasPartial = false;
    for (const f of files) {
      const content = await readFile(join(weeklyDir, f), "utf-8");
      if (content.includes("partial: true")) {
        hasPartial = true;
      }
    }

    // If yesterday is in a different week than today, there may not be a partial
    // But W10 should always be compacted
    expect(result!.created.some((c) => c.includes("2024-W10"))).toBe(true);
    // If the current week was compacted, it should be partial
    const currentWeekCompacted = result!.created.find((c) =>
      c.includes("(partial)"),
    );
    if (currentWeekCompacted) {
      expect(hasPartial).toBe(true);
    }
  });

  it("skips today's log when calculating budget", async () => {
    const memDir = join(testDir, "memory");
    await mkdir(memDir, { recursive: true });

    // Write today's log (should not be compacted)
    const today = new Date().toISOString().slice(0, 10);
    const bigContent = "x".repeat(200_000);
    await writeFile(join(memDir, `${today}.md`), bigContent);

    // Even with a tiny budget, today should not trigger compaction
    const result = await autoCompactForBudget(testDir, 1_000);
    // No past dailies to compact, so result should be null
    expect(result).toBeNull();
  });

  it("returns null when memory dir does not exist", async () => {
    const result = await autoCompactForBudget(testDir, 24_000);
    expect(result).toBeNull();
  });

  it("does not compact weeks that already have a weekly summary", async () => {
    const memDir = join(testDir, "memory");
    const weeklyDir = join(memDir, "weekly");
    await mkdir(weeklyDir, { recursive: true });

    const bigContent = "x".repeat(100_000);
    await writeFile(join(memDir, "2024-03-05.md"), bigContent); // W10
    await writeFile(join(memDir, "2024-03-12.md"), bigContent); // W11

    // Pre-existing weekly for W10
    await writeFile(join(weeklyDir, "2024-W10.md"), "# Already compacted");

    const result = await autoCompactForBudget(testDir, 1_000);
    expect(result).not.toBeNull();
    // Should compact W11, not W10
    expect(result!.created.some((c) => c.includes("2024-W11"))).toBe(true);
    expect(result!.created.some((c) => c.includes("2024-W10"))).toBe(false);
  });
});

describe("compactDailies — partial merge", () => {
  it("merges new dailies into a partial weekly", async () => {
    const memDir = join(testDir, "memory");
    const weeklyDir = join(memDir, "weekly");
    await mkdir(weeklyDir, { recursive: true });

    // Create a partial weekly for W10 with only 2024-03-05
    const partialContent = [
      "---",
      "type: weekly",
      "week: 2024-W10",
      "period: 2024-03-05 to 2024-03-05",
      "partial: true",
      "---",
      "",
      "# Week 2024-W10",
      "",
      "## 2024-03-05",
      "",
      "# Tuesday work",
      "",
    ].join("\n");
    await writeFile(join(weeklyDir, "2024-W10.md"), partialContent);

    // Add new dailies for the same week
    await writeFile(join(memDir, "2024-03-06.md"), "# Wednesday work");
    await writeFile(join(memDir, "2024-03-07.md"), "# Thursday work");

    const result = await compactDailies(testDir);

    expect(result.created).toHaveLength(1);
    expect(result.created[0]).toBe("2024-W10.md (merged)");

    // Verify the merged weekly has all 3 days and no partial flag
    const content = await readFile(join(weeklyDir, "2024-W10.md"), "utf-8");
    expect(content).toContain("2024-03-05");
    expect(content).toContain("2024-03-06");
    expect(content).toContain("2024-03-07");
    expect(content).toContain("Tuesday work");
    expect(content).toContain("Wednesday work");
    expect(content).toContain("Thursday work");
    expect(content).not.toContain("partial: true");
  });

  it("does not duplicate dates when merging", async () => {
    const memDir = join(testDir, "memory");
    const weeklyDir = join(memDir, "weekly");
    await mkdir(weeklyDir, { recursive: true });

    // Partial weekly with 2024-03-05
    const partialContent = [
      "---",
      "type: weekly",
      "week: 2024-W10",
      "period: 2024-03-05 to 2024-03-05",
      "partial: true",
      "---",
      "",
      "# Week 2024-W10",
      "",
      "## 2024-03-05",
      "",
      "# Original Tuesday",
      "",
    ].join("\n");
    await writeFile(join(weeklyDir, "2024-W10.md"), partialContent);

    // Same date exists as a daily log (shouldn't duplicate)
    await writeFile(join(memDir, "2024-03-05.md"), "# Updated Tuesday");
    await writeFile(join(memDir, "2024-03-06.md"), "# Wednesday");

    const result = await compactDailies(testDir);

    const content = await readFile(join(weeklyDir, "2024-W10.md"), "utf-8");
    // Should contain the original (from partial), not duplicated
    const tuesdayMatches = content.match(/## 2024-03-05/g);
    expect(tuesdayMatches).toHaveLength(1);
  });

  it("skips non-partial existing weeklies", async () => {
    const memDir = join(testDir, "memory");
    const weeklyDir = join(memDir, "weekly");
    await mkdir(weeklyDir, { recursive: true });

    // Complete (non-partial) weekly
    const completeContent = [
      "---",
      "type: weekly",
      "week: 2024-W10",
      "period: 2024-03-05 to 2024-03-07",
      "---",
      "",
      "# Week 2024-W10",
      "",
      "## 2024-03-05",
      "",
      "# Content",
      "",
    ].join("\n");
    await writeFile(join(weeklyDir, "2024-W10.md"), completeContent);

    await writeFile(join(memDir, "2024-03-06.md"), "# New daily");

    const result = await compactDailies(testDir);

    expect(result.created).toHaveLength(0);
  });
});

describe("purgeStaleDailies", () => {
  it("deletes daily logs older than retention period", async () => {
    const memDir = join(testDir, "memory");
    await mkdir(memDir, { recursive: true });

    // Create a daily log well past the retention period
    const old = new Date();
    old.setDate(old.getDate() - DAILY_LOG_RETENTION_DAYS - 5);
    const oldDate = old.toISOString().slice(0, 10);
    await writeFile(join(memDir, `${oldDate}.md`), "# Old log");

    // Create a recent daily log
    const recent = new Date();
    recent.setDate(recent.getDate() - 2);
    const recentDate = recent.toISOString().slice(0, 10);
    await writeFile(join(memDir, `${recentDate}.md`), "# Recent log");

    // Create a typed memory (should not be touched)
    await writeFile(join(memDir, "feedback_test.md"), "# Feedback");

    const purged = await purgeStaleDailies(testDir);

    expect(purged).toContain(`${oldDate}.md`);
    expect(purged).not.toContain(`${recentDate}.md`);
    expect(purged).not.toContain("feedback_test.md");

    // Verify the old file is gone and others remain
    const remaining = await readdir(memDir);
    expect(remaining).not.toContain(`${oldDate}.md`);
    expect(remaining).toContain(`${recentDate}.md`);
    expect(remaining).toContain("feedback_test.md");
  });

  it("returns empty array when no stale logs exist", async () => {
    const memDir = join(testDir, "memory");
    await mkdir(memDir, { recursive: true });

    const today = new Date().toISOString().slice(0, 10);
    await writeFile(join(memDir, `${today}.md`), "# Today");

    const purged = await purgeStaleDailies(testDir);
    expect(purged).toHaveLength(0);
  });
});
