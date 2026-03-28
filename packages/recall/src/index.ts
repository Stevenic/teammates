export { LocalEmbeddings } from "./embeddings.js";
export { Indexer, type IndexerConfig } from "./indexer.js";
export { matchMemoryCatalog, scanMemoryCatalog } from "./memory-index.js";
export { buildQueryVariations, extractKeywords } from "./query-expansion.js";
export {
  type MultiSearchOptions,
  multiSearch,
  type SearchOptions,
  type SearchResult,
  search,
} from "./search.js";
