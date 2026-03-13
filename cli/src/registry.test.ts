import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Registry } from "./registry.js";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "teammates-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

async function createTeammate(
  name: string,
  soul: string,
  options?: { memories?: string; dailyLogs?: { date: string; content: string }[] }
) {
  const dir = join(tempDir, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SOUL.md"), soul);

  if (options?.memories) {
    await writeFile(join(dir, "MEMORIES.md"), options.memories);
  }

  if (options?.dailyLogs) {
    const memDir = join(dir, "memory");
    await mkdir(memDir, { recursive: true });
    for (const log of options.dailyLogs) {
      await writeFile(join(memDir, `${log.date}.md`), log.content);
    }
  }
}

describe("Registry.loadAll", () => {
  it("discovers teammates with SOUL.md", async () => {
    await createTeammate("beacon", "# Beacon\n\nPlatform engineer.");
    await createTeammate("scribe", "# Scribe\n\nDocumentation writer.");
    const registry = new Registry(tempDir);
    await registry.loadAll();
    expect(registry.list().sort()).toEqual(["beacon", "scribe"]);
  });

  it("skips directories without SOUL.md", async () => {
    await createTeammate("beacon", "# Beacon\n\nPlatform engineer.");
    await mkdir(join(tempDir, "not-a-teammate"), { recursive: true });
    const registry = new Registry(tempDir);
    await registry.loadAll();
    expect(registry.list()).toEqual(["beacon"]);
  });

  it("skips dot directories", async () => {
    await createTeammate("beacon", "# Beacon\n\nPlatform engineer.");
    await mkdir(join(tempDir, ".hidden"), { recursive: true });
    await writeFile(join(tempDir, ".hidden", "SOUL.md"), "hidden");
    const registry = new Registry(tempDir);
    await registry.loadAll();
    expect(registry.list()).toEqual(["beacon"]);
  });
});

describe("Registry.loadTeammate", () => {
  it("loads soul content", async () => {
    const soul = "# Beacon\n\nBeacon owns the recall package.";
    await createTeammate("beacon", soul);
    const registry = new Registry(tempDir);
    const config = await registry.loadTeammate("beacon");
    expect(config?.soul).toBe(soul);
  });

  it("loads memories", async () => {
    await createTeammate("beacon", "# Beacon", {
      memories: "Important decision made",
    });
    const registry = new Registry(tempDir);
    const config = await registry.loadTeammate("beacon");
    expect(config?.memories).toBe("Important decision made");
  });

  it("loads daily logs sorted most recent first", async () => {
    await createTeammate("beacon", "# Beacon", {
      dailyLogs: [
        { date: "2026-03-11", content: "Day 1" },
        { date: "2026-03-13", content: "Day 3" },
        { date: "2026-03-12", content: "Day 2" },
      ],
    });
    const registry = new Registry(tempDir);
    const config = await registry.loadTeammate("beacon");
    expect(config?.dailyLogs.map((l) => l.date)).toEqual([
      "2026-03-13",
      "2026-03-12",
      "2026-03-11",
    ]);
  });

  it("returns null for missing teammate", async () => {
    const registry = new Registry(tempDir);
    const config = await registry.loadTeammate("nonexistent");
    expect(config).toBeNull();
  });

  it("returns empty memories when MEMORIES.md is missing", async () => {
    await createTeammate("beacon", "# Beacon");
    const registry = new Registry(tempDir);
    const config = await registry.loadTeammate("beacon");
    expect(config?.memories).toBe("");
  });

  it("returns empty daily logs when memory/ is missing", async () => {
    await createTeammate("beacon", "# Beacon");
    const registry = new Registry(tempDir);
    const config = await registry.loadTeammate("beacon");
    expect(config?.dailyLogs).toEqual([]);
  });
});

describe("Registry role parsing", () => {
  it("parses role from ## Identity paragraph", async () => {
    await createTeammate(
      "beacon",
      "# Beacon\n\n## Identity\n\nBeacon owns the recall package. It does stuff."
    );
    const registry = new Registry(tempDir);
    const config = await registry.loadTeammate("beacon");
    expect(config?.role).toBe("Beacon owns the recall package.");
  });

  it("parses role from **Persona:** line", async () => {
    await createTeammate("beacon", "# Beacon\n\n**Persona:** The platform engineer.");
    const registry = new Registry(tempDir);
    const config = await registry.loadTeammate("beacon");
    expect(config?.role).toBe("The platform engineer.");
  });

  it("falls back to first non-heading line", async () => {
    await createTeammate("beacon", "# Beacon\n\nSome role description here.");
    const registry = new Registry(tempDir);
    const config = await registry.loadTeammate("beacon");
    expect(config?.role).toBe("Some role description here.");
  });

  it("returns 'teammate' when no role found", async () => {
    await createTeammate("beacon", "# Beacon\n\n---");
    const registry = new Registry(tempDir);
    const config = await registry.loadTeammate("beacon");
    expect(config?.role).toBe("teammate");
  });
});

describe("Registry ownership parsing", () => {
  it("parses primary ownership patterns", async () => {
    const soul = `# Beacon

## Ownership

### Primary

- \`recall/src/**\` — All source files
- \`recall/package.json\` — Package manifest

### Secondary

- \`.teammates/.index/**\` — Vector indexes
`;
    await createTeammate("beacon", soul);
    const registry = new Registry(tempDir);
    const config = await registry.loadTeammate("beacon");
    expect(config?.ownership.primary).toEqual(["recall/src/**", "recall/package.json"]);
    expect(config?.ownership.secondary).toEqual([".teammates/.index/**"]);
  });

  it("returns empty arrays when no ownership section", async () => {
    await createTeammate("beacon", "# Beacon\n\nJust a description.");
    const registry = new Registry(tempDir);
    const config = await registry.loadTeammate("beacon");
    expect(config?.ownership.primary).toEqual([]);
    expect(config?.ownership.secondary).toEqual([]);
  });
});

describe("Registry.register", () => {
  it("registers a teammate programmatically", () => {
    const registry = new Registry(tempDir);
    registry.register({
      name: "test",
      role: "Test role.",
      soul: "# Test",
      memories: "",
      dailyLogs: [],
      ownership: { primary: [], secondary: [] },
    });
    expect(registry.list()).toEqual(["test"]);
    expect(registry.get("test")?.role).toBe("Test role.");
  });
});
