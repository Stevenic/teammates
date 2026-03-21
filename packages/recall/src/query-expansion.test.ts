import { describe, expect, it } from "vitest";
import { buildQueryVariations, extractKeywords } from "./query-expansion.js";

describe("extractKeywords", () => {
  it("removes stopwords", () => {
    const result = extractKeywords("the quick brown fox jumps over the lazy dog");
    expect(result).toContain("quick");
    expect(result).toContain("brown");
    expect(result).toContain("fox");
    expect(result).toContain("jumps");
    expect(result).toContain("lazy");
    expect(result).toContain("dog");
    expect(result).not.toContain("the");
    expect(result).not.toContain("over");
  });

  it("filters short tokens (length <= 2)", () => {
    const result = extractKeywords("an AI is a type of ML system");
    expect(result).not.toContain("an");
    expect(result).not.toContain("is");
    // "type" and "system" stay, "AI" and "ML" filtered (length 2)
    expect(result).toContain("type");
    expect(result).toContain("system");
  });

  it("deduplicates while preserving order", () => {
    const result = extractKeywords("recall search recall index search");
    expect(result).toEqual(["recall", "search", "index"]);
  });

  it("lowercases all output", () => {
    const result = extractKeywords("Update the HOOKS spec");
    expect(result).toContain("update");
    expect(result).toContain("hooks");
    expect(result).toContain("spec");
  });

  it("returns empty array for all-stopword input", () => {
    const result = extractKeywords("the is a");
    expect(result).toEqual([]);
  });

  it("preserves @mentions and paths", () => {
    const result = extractKeywords("deploy @pipeline src/hooks");
    expect(result).toContain("deploy");
    expect(result).toContain("@pipeline");
    expect(result).toContain("src/hooks");
  });
});

describe("buildQueryVariations", () => {
  it("always includes the original prompt as the first query", () => {
    const result = buildQueryVariations("fix the authentication bug");
    expect(result[0]).toBe("fix the authentication bug");
  });

  it("generates a keyword-focused query when prompt is verbose", () => {
    const verbose = "I want you to please update the recall search system so that it handles multiple queries at the same time and deduplicates the results properly";
    const result = buildQueryVariations(verbose);
    expect(result.length).toBeGreaterThanOrEqual(2);
    // The keyword query should be shorter than the original
    if (result.length > 1) {
      expect(result[1].length).toBeLessThan(verbose.length);
    }
  });

  it("adds a conversation-derived query when context is provided", () => {
    const conversationContext = `## Conversation History

**stevenic:** lets talk about the CI pipeline and hooks

**pipeline:** CI Pipeline Hooks — Analysis`;
    const result = buildQueryVariations("what should we do next?", conversationContext);
    // Should have at least the original + conversation query
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it("skips conversation query when no context", () => {
    const result = buildQueryVariations("short task");
    // Short prompts with few keywords may only produce 1 query
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0]).toBe("short task");
  });

  it("does not generate keyword query when prompt is already concise", () => {
    const result = buildQueryVariations("recall search");
    // Very short — keyword query wouldn't differ meaningfully
    expect(result[0]).toBe("recall search");
  });
});
