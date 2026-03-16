import { describe, expect, it } from "vitest";
import type { TeammateConfig } from "../types.js";
import { EchoAdapter } from "./echo.js";

const teammate: TeammateConfig = {
  name: "beacon",
  role: "Platform engineer.",
  soul: "# Beacon\n\nBeacon owns the recall package.",
  wisdom: "",
  dailyLogs: [],
  weeklyLogs: [],
  ownership: { primary: [], secondary: [] },
  routingKeywords: [],
};

describe("EchoAdapter", () => {
  it("has name 'echo'", () => {
    const adapter = new EchoAdapter();
    expect(adapter.name).toBe("echo");
  });

  it("returns unique session IDs", async () => {
    const adapter = new EchoAdapter();
    const s1 = await adapter.startSession(teammate);
    const s2 = await adapter.startSession(teammate);
    expect(s1).not.toBe(s2);
    expect(s1).toContain("echo-beacon-");
  });

  it("returns success with prompt length in summary", async () => {
    const adapter = new EchoAdapter();
    const sessionId = await adapter.startSession(teammate);
    const result = await adapter.executeTask(
      sessionId,
      teammate,
      "do the thing",
    );
    expect(result.success).toBe(true);
    expect(result.teammate).toBe("beacon");
    expect(result.summary).toContain("[echo]");
    expect(result.summary).toContain("beacon");
    expect(result.changedFiles).toEqual([]);
  });

  it("includes full built prompt in rawOutput", async () => {
    const adapter = new EchoAdapter();
    const sessionId = await adapter.startSession(teammate);
    const result = await adapter.executeTask(sessionId, teammate, "test task");
    expect(result.rawOutput).toContain("# You are beacon");
    expect(result.rawOutput).toContain("test task");
  });
});
