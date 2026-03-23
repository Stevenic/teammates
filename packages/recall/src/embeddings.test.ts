import { describe, expect, it, vi } from "vitest";
import { LocalEmbeddings } from "./embeddings.js";

// Mock @huggingface/transformers to avoid loading the real model
vi.mock("@huggingface/transformers", () => ({
  pipeline: vi.fn(async () => {
    // Return a fake extractor function
    return async (texts: string[], _opts: any) => ({
      tolist: () => texts.map(() => new Array(384).fill(0.1)),
    });
  }),
}));

describe("LocalEmbeddings", () => {
  it("has maxTokens set to 256", () => {
    const emb = new LocalEmbeddings();
    expect(emb.maxTokens).toBe(256);
  });

  describe("createEmbeddings", () => {
    it("returns embeddings for a single string input", async () => {
      const emb = new LocalEmbeddings();
      const result = await emb.createEmbeddings("hello world");

      expect(result.status).toBe("success");
      expect(result.output).toHaveLength(1);
      expect(result.output![0]).toHaveLength(384);
    });

    it("returns embeddings for an array of strings", async () => {
      const emb = new LocalEmbeddings();
      const result = await emb.createEmbeddings(["hello", "world"]);

      expect(result.status).toBe("success");
      expect(result.output).toHaveLength(2);
      expect(result.output![0]).toHaveLength(384);
      expect(result.output![1]).toHaveLength(384);
    });

    it("returns empty output for empty string input", async () => {
      const emb = new LocalEmbeddings();
      const result = await emb.createEmbeddings("");

      expect(result.status).toBe("success");
      expect(result.output).toHaveLength(0);
    });

    it("returns empty output for whitespace-only input", async () => {
      const emb = new LocalEmbeddings();
      const result = await emb.createEmbeddings("   ");

      expect(result.status).toBe("success");
      expect(result.output).toHaveLength(0);
    });

    it("filters out empty strings from array input", async () => {
      const emb = new LocalEmbeddings();
      const result = await emb.createEmbeddings(["hello", "", "  ", "world"]);

      expect(result.status).toBe("success");
      expect(result.output).toHaveLength(2);
    });

    it("returns error status when extractor throws", async () => {
      const { pipeline } = await import("@huggingface/transformers");
      // Override mock to throw
      (pipeline as any).mockImplementationOnce(async () => {
        return async () => {
          throw new Error("Model load failed");
        };
      });

      const emb = new LocalEmbeddings("bad-model");
      const result = await emb.createEmbeddings("test");

      expect(result.status).toBe("error");
      expect(result.message).toBe("Model load failed");
    });

    it("reuses the extractor on subsequent calls (lazy init)", async () => {
      const { pipeline } = await import("@huggingface/transformers");
      (pipeline as any).mockClear();

      const emb = new LocalEmbeddings();
      await emb.createEmbeddings("first");
      await emb.createEmbeddings("second");

      // pipeline() should only be called once (lazy singleton)
      expect(pipeline).toHaveBeenCalledTimes(1);
    });

    it("accepts a custom model name", async () => {
      const { pipeline } = await import("@huggingface/transformers");
      (pipeline as any).mockClear();

      const emb = new LocalEmbeddings("custom/model-name");
      await emb.createEmbeddings("test");

      expect(pipeline).toHaveBeenCalledWith(
        "feature-extraction",
        "custom/model-name",
        expect.objectContaining({ dtype: "fp32" }),
      );
    });
  });
});
