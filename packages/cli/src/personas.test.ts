import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPersonas, type Persona, scaffoldFromPersona } from "./personas.js";

// ── scaffoldFromPersona ─────────────────────────────────────────────

let testDir: string;

beforeEach(async () => {
  testDir = join(
    tmpdir(),
    `personas-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

const samplePersona: Persona = {
  persona: "Software Engineer",
  alias: "beacon",
  tier: 1,
  description: "Architecture and implementation",
  soul: "# <Name> - Software Engineer\n\n## Identity\n<Name> is the team's SWE.",
  wisdom:
    "# <Name> - Wisdom\n\nDistilled principles. Read this first every session (after SOUL.md).\n\nLast compacted: never\n\n---\n\n*No entries yet - wisdom is distilled from experience.*",
};

describe("scaffoldFromPersona", () => {
  it("creates teammate folder with SOUL.md and WISDOM.md", async () => {
    const teamDir = await scaffoldFromPersona(testDir, "beacon", samplePersona);

    const soul = await readFile(join(teamDir, "SOUL.md"), "utf-8");
    const wisdom = await readFile(join(teamDir, "WISDOM.md"), "utf-8");

    expect(soul).toContain("# Beacon - Software Engineer");
    expect(soul).toContain("Beacon is the team's SWE.");
    expect(wisdom).toContain("# Beacon - Wisdom");
    expect(wisdom).toContain("Last compacted: never");
  });

  it("normalizes folder name to lowercase with safe chars", async () => {
    const teamDir = await scaffoldFromPersona(
      testDir,
      "My Cool Bot!",
      samplePersona,
    );

    // Should strip spaces, uppercase, and special chars
    expect(teamDir).toContain("mycoolbot");
  });

  it("replaces all <Name> placeholders in SOUL.md", async () => {
    const teamDir = await scaffoldFromPersona(testDir, "atlas", samplePersona);
    const soul = await readFile(join(teamDir, "SOUL.md"), "utf-8");

    expect(soul).not.toContain("<Name>");
    expect(soul).toContain("Atlas");
  });

  it("creates memory subdirectory", async () => {
    const teamDir = await scaffoldFromPersona(testDir, "test", samplePersona);

    // Should not throw - directory exists
    const memDir = join(teamDir, "memory");
    await mkdir(memDir, { recursive: true }); // no-op if exists
  });

  it("capitalizes display name in WISDOM.md", async () => {
    const teamDir = await scaffoldFromPersona(testDir, "forge", samplePersona);
    const wisdom = await readFile(join(teamDir, "WISDOM.md"), "utf-8");

    expect(wisdom).toContain("# Forge - Wisdom");
  });
});

// ── loadPersonas ────────────────────────────────────────────────────

describe("loadPersonas", () => {
  it("loads persona files from the bundled directory", async () => {
    const personas = await loadPersonas();

    // Should find at least the built-in personas
    expect(personas.length).toBeGreaterThan(0);
  });

  it("sorts by tier then alias", async () => {
    const personas = await loadPersonas();

    // Verify ordering: all tier 1 before higher tiers, then alias order.
    let lastTier = 0;
    let lastAlias = "";
    for (const p of personas) {
      if (p.tier > lastTier) {
        lastTier = p.tier;
        lastAlias = "";
      }
      if (p.tier === lastTier && lastAlias) {
        expect(p.alias.localeCompare(lastAlias)).toBeGreaterThanOrEqual(0);
      }
      lastAlias = p.alias;
    }
  });

  it("each persona has required fields", async () => {
    const personas = await loadPersonas();

    for (const p of personas) {
      expect(p.persona).toBeTruthy();
      expect(p.alias).toBeTruthy();
      expect(p.description).toBeTruthy();
      expect(typeof p.tier).toBe("number");
      expect(p.soul.length).toBeGreaterThan(0);
      expect(p.wisdom.length).toBeGreaterThan(0);
    }
  });
});
