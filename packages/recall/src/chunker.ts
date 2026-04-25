/**
 * Memory file chunker — splits markdown files into ~2k token chunks
 * for more granular semantic search results.
 *
 * Splitting strategy:
 * 1. Split on markdown headings (## or ###)
 * 2. If a section exceeds the token budget, split on paragraph boundaries (\n\n)
 * 3. Small consecutive sections are merged into a single chunk
 */

/** Approximate characters per token. */
const CHARS_PER_TOKEN = 4;

/** Default chunk budget in tokens. */
export const DEFAULT_CHUNK_TOKENS = 2_000;

/** A chunk of a memory file. */
export interface MemoryChunk {
  /** Chunk index (0-based). */
  index: number;
  /** The text content of this chunk. */
  text: string;
  /** Whether this is a partial chunk (file was split into multiple). */
  partial: boolean;
  /** Estimated token count. */
  estimatedTokens: number;
}

/**
 * Split a markdown text into chunks of approximately `maxTokens` each.
 *
 * Returns at least one chunk even for empty/small documents.
 * Preserves YAML frontmatter in the first chunk.
 */
export function chunkMarkdown(
  text: string,
  maxTokens: number = DEFAULT_CHUNK_TOKENS,
): MemoryChunk[] {
  const maxChars = maxTokens * CHARS_PER_TOKEN;

  // If the whole document fits, return a single chunk
  if (text.length <= maxChars) {
    return [
      {
        index: 0,
        text,
        partial: false,
        estimatedTokens: Math.ceil(text.length / CHARS_PER_TOKEN),
      },
    ];
  }

  // Split on markdown headings (## or ###)
  const sections = splitOnHeadings(text);

  // Merge small sections and split large ones to hit the target chunk size
  const chunks: MemoryChunk[] = [];
  let currentParts: string[] = [];
  let currentChars = 0;

  for (const section of sections) {
    if (section.length > maxChars) {
      // Flush current buffer first
      if (currentParts.length > 0) {
        const chunkText = currentParts.join("");
        chunks.push({
          index: chunks.length,
          text: chunkText,
          partial: true,
          estimatedTokens: Math.ceil(chunkText.length / CHARS_PER_TOKEN),
        });
        currentParts = [];
        currentChars = 0;
      }

      // Split large section on paragraph boundaries
      const paragraphs = splitOnParagraphs(section);
      for (const para of paragraphs) {
        if (currentChars + para.length > maxChars && currentParts.length > 0) {
          const chunkText = currentParts.join("");
          chunks.push({
            index: chunks.length,
            text: chunkText,
            partial: true,
            estimatedTokens: Math.ceil(chunkText.length / CHARS_PER_TOKEN),
          });
          currentParts = [];
          currentChars = 0;
        }
        currentParts.push(para);
        currentChars += para.length;
      }
    } else if (currentChars + section.length > maxChars) {
      // Current buffer would overflow — flush it
      const chunkText = currentParts.join("");
      chunks.push({
        index: chunks.length,
        text: chunkText,
        partial: true,
        estimatedTokens: Math.ceil(chunkText.length / CHARS_PER_TOKEN),
      });
      currentParts = [section];
      currentChars = section.length;
    } else {
      currentParts.push(section);
      currentChars += section.length;
    }
  }

  // Flush remaining
  if (currentParts.length > 0) {
    const chunkText = currentParts.join("");
    chunks.push({
      index: chunks.length,
      text: chunkText,
      partial: chunks.length > 0,
      estimatedTokens: Math.ceil(chunkText.length / CHARS_PER_TOKEN),
    });
  }

  // Mark all chunks as partial if there's more than one
  if (chunks.length > 1) {
    for (const chunk of chunks) {
      chunk.partial = true;
    }
  }

  return chunks;
}

/**
 * Split text on markdown headings (## or ###).
 * Each resulting section includes its heading line.
 * YAML frontmatter is preserved as the first section.
 */
function splitOnHeadings(text: string): string[] {
  const sections: string[] = [];
  const lines = text.split("\n");
  let current: string[] = [];

  for (const line of lines) {
    // Heading boundary: ## or ### (not # which is the title)
    if (/^#{2,3}\s/.test(line) && current.length > 0) {
      sections.push(current.join("\n"));
      current = [];
    }
    current.push(line);
  }

  if (current.length > 0) {
    sections.push(current.join("\n"));
  }

  return sections;
}

/**
 * Split text on paragraph boundaries (\n\n).
 */
function splitOnParagraphs(text: string): string[] {
  // Split on double newlines, keeping the delimiter with the next paragraph
  const parts = text.split(/(?=\n\n)/);
  return parts.filter((p) => p.length > 0);
}

/**
 * Build a chunk-aware URI.
 * Single-chunk files keep the original URI.
 * Multi-chunk files get `#<index>` appended.
 */
export function chunkUri(baseUri: string, chunk: MemoryChunk): string {
  if (!chunk.partial) return baseUri;
  return `${baseUri}#${chunk.index}`;
}
