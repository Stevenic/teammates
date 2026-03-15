import type { EmbeddingsModel, EmbeddingsResponse } from "vectra";

const DEFAULT_MODEL = "Xenova/all-MiniLM-L6-v2";
const MAX_TOKENS = 256;

/**
 * Local embeddings using transformers.js. No API keys, no network after first model download.
 */
export class LocalEmbeddings implements EmbeddingsModel {
  readonly maxTokens = MAX_TOKENS;

  private _model: string;
  private _extractor: any | null = null;

  constructor(model?: string) {
    this._model = model ?? DEFAULT_MODEL;
  }

  async createEmbeddings(
    inputs: string | string[],
  ): Promise<EmbeddingsResponse> {
    try {
      const extractor = await this._getExtractor();
      const texts = (Array.isArray(inputs) ? inputs : [inputs]).filter(
        (t) => t.trim().length > 0,
      );
      if (texts.length === 0) {
        return { status: "success", output: [] };
      }
      const output = await extractor(texts, {
        pooling: "mean",
        normalize: true,
      });
      const embeddings: number[][] = output.tolist();
      return { status: "success", output: embeddings };
    } catch (err: any) {
      return { status: "error", message: err.message };
    }
  }

  private async _getExtractor(): Promise<any> {
    if (!this._extractor) {
      const { pipeline } = await import("@huggingface/transformers");
      this._extractor = await pipeline("feature-extraction", this._model);
    }
    return this._extractor;
  }
}
