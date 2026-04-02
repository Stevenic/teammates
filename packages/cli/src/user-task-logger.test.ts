import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { logUserTask } from "./user-task-logger.js";

describe("logUserTask", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `user-log-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await mkdir(join(testDir, "stevenic", "memory"), { recursive: true });
  });

  afterEach(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  it("creates a new daily log with frontmatter", async () => {
    await logUserTask(testDir, "stevenic", "beacon", "fix the login bug");
    const today = new Date().toISOString().slice(0, 10);
    const content = await readFile(
      join(testDir, "stevenic", "memory", `${today}.md`),
      "utf-8",
    );
    expect(content).toMatch(/^---\ntype: daily\n---/);
    expect(content).toContain(`# ${today}`);
    expect(content).toContain("Assigned @beacon");
    expect(content).toContain("fix the login bug");
  });

  it("appends to an existing daily log", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const logFile = join(testDir, "stevenic", "memory", `${today}.md`);
    await writeFile(
      logFile,
      `---\ntype: daily\n---\n\n# ${today}\n\n## 09:00 — Assigned @scribe\nwrite the docs\n`,
      "utf-8",
    );

    await logUserTask(testDir, "stevenic", "beacon", "add feature X");
    const content = await readFile(logFile, "utf-8");
    // Should have both entries
    expect(content).toContain("Assigned @scribe");
    expect(content).toContain("Assigned @beacon");
    expect(content).toContain("add feature X");
  });

  it("includes result details for coding agent tasks", async () => {
    await logUserTask(testDir, "stevenic", "stevenic", "refactor auth", {
      summary: "Refactored auth module to use JWT",
      changedFiles: ["src/auth.ts", "src/middleware.ts"],
    });
    const today = new Date().toISOString().slice(0, 10);
    const content = await readFile(
      join(testDir, "stevenic", "memory", `${today}.md`),
      "utf-8",
    );
    expect(content).toContain("**Result:** Refactored auth module to use JWT");
    expect(content).toContain("**Files changed:**");
    expect(content).toContain("- src/auth.ts");
    expect(content).toContain("- src/middleware.ts");
  });

  it("omits result details for delegated tasks", async () => {
    await logUserTask(testDir, "stevenic", "beacon", "fix the bug");
    const today = new Date().toISOString().slice(0, 10);
    const content = await readFile(
      join(testDir, "stevenic", "memory", `${today}.md`),
      "utf-8",
    );
    expect(content).not.toContain("**Result:**");
    expect(content).not.toContain("**Files changed:**");
  });

  it("truncates very long task descriptions", async () => {
    const longTask = "x".repeat(500);
    await logUserTask(testDir, "stevenic", "beacon", longTask);
    const today = new Date().toISOString().slice(0, 10);
    const content = await readFile(
      join(testDir, "stevenic", "memory", `${today}.md`),
      "utf-8",
    );
    expect(content).toContain("...");
    expect(content.length).toBeLessThan(600);
  });

  it("creates memory directory if missing", async () => {
    const { rm } = await import("node:fs/promises");
    await rm(join(testDir, "newuser"), { recursive: true, force: true }).catch(
      () => {},
    );
    await logUserTask(testDir, "newuser", "beacon", "hello");
    const today = new Date().toISOString().slice(0, 10);
    const content = await readFile(
      join(testDir, "newuser", "memory", `${today}.md`),
      "utf-8",
    );
    expect(content).toContain("Assigned @beacon");
  });
});
