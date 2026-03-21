/**
 * Lightweight query expansion for Pass 1 recall queries.
 *
 * No LLM needed — uses stopword removal and basic text analysis
 * to generate multiple query variations from a task prompt.
 */

/** Common English stopwords to filter from queries. */
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
  "being", "have", "has", "had", "do", "does", "did", "will", "would",
  "could", "should", "may", "might", "shall", "can", "need", "must",
  "it", "its", "this", "that", "these", "those", "i", "you", "he", "she",
  "we", "they", "me", "him", "her", "us", "them", "my", "your", "his",
  "our", "their", "what", "which", "who", "whom", "where", "when", "how",
  "why", "if", "then", "so", "not", "no", "just", "also", "very", "too",
  "some", "any", "all", "each", "every", "both", "few", "more", "most",
  "other", "into", "over", "after", "before", "between", "through",
  "about", "up", "out", "off", "down", "here", "there", "again", "once",
  "let", "lets", "let's", "get", "got", "go", "going", "make", "made",
  "take", "took", "come", "came", "see", "saw", "know", "knew", "think",
  "thought", "say", "said", "tell", "told", "ask", "asked", "want",
  "wanted", "like", "look", "use", "used", "find", "give", "work",
]);

/**
 * Extract meaningful keywords from text by removing stopwords and short tokens.
 * Returns lowercase keywords in order of appearance.
 */
export function extractKeywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^\w\s@/-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));

  // Deduplicate while preserving order
  const seen = new Set<string>();
  const result: string[] = [];
  for (const w of words) {
    if (!seen.has(w)) {
      seen.add(w);
      result.push(w);
    }
  }
  return result;
}

/**
 * Build multiple query variations from a task prompt and optional conversation context.
 *
 * Returns 1-3 queries:
 * 1. The original task prompt (always)
 * 2. A focused keyword query (if keywords differ meaningfully from the original)
 * 3. A conversation-derived query (if recent conversation context is provided)
 */
export function buildQueryVariations(
  taskPrompt: string,
  conversationContext?: string,
): string[] {
  const queries: string[] = [taskPrompt];

  // Query 2: Focused keywords from the task prompt
  const keywords = extractKeywords(taskPrompt);
  if (keywords.length >= 2 && keywords.length <= 20) {
    const keywordQuery = keywords.slice(0, 8).join(" ");
    // Only add if meaningfully different from original
    if (keywordQuery.length < taskPrompt.length * 0.7) {
      queries.push(keywordQuery);
    }
  }

  // Query 3: Recent conversation topic
  if (conversationContext) {
    const recentTopic = extractRecentTopic(conversationContext);
    if (recentTopic) {
      queries.push(recentTopic);
    }
  }

  return queries;
}

/**
 * Extract the most recent topic/theme from conversation context.
 * Takes the last 1-2 meaningful entries and extracts keywords.
 */
function extractRecentTopic(conversationContext: string): string | null {
  // Split on common conversation entry patterns
  const entries = conversationContext
    .split(/\n\*\*\w+:\*\*\s*/g)
    .filter((e) => e.trim().length > 10);

  if (entries.length === 0) return null;

  // Take the last 1-2 entries (most recent conversation)
  const recent = entries.slice(-2).join(" ");
  const keywords = extractKeywords(recent);

  if (keywords.length < 2) return null;

  // Build a focused query from the recent conversation keywords
  return keywords.slice(0, 6).join(" ");
}
