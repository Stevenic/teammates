/**
 * Episodic memory compaction.
 *
 * Compresses daily logs into weekly summaries, and old weekly summaries
 * into monthly summaries. During weekly compaction, durable knowledge
 * is extracted into typed memory files.
 *
 * Compaction pipeline:
 *   daily logs (7 days) → weekly summary (kept 52 weeks)
 *   weekly summaries (>52 weeks) → monthly summary (kept permanently)
 */

import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { PKG_VERSION } from "./cli-args.js";

/** How long daily logs are kept on disk before purging (30 days). */
export const DAILY_LOG_RETENTION_DAYS = 30;

export interface CompactionResult {
  teammate: string;
  weekliesCreated: string[];
  monthliesCreated: string[];
  dailiesRemoved: string[];
  weekliesRemoved: string[];
}

/**
 * Get ISO week number and year for a date.
 * Returns { year, week } where week is 1-53.
 */
function getISOWeek(date: Date): { year: number; week: number } {
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  );
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
  return { year: d.getUTCFullYear(), week };
}

/**
 * Format a week number as YYYY-Wnn.
 */
function formatWeek(year: number, week: number): string {
  return `${year}-W${week.toString().padStart(2, "0")}`;
}

/**
 * Group daily logs by ISO week.
 */
function groupDailiesByWeek<T extends { date: string }>(
  dailies: T[],
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const daily of dailies) {
    const d = new Date(`${daily.date}T00:00:00`);
    const { year, week } = getISOWeek(d);
    const key = formatWeek(year, week);
    const group = groups.get(key) ?? ([] as T[]);
    group.push(daily);
    groups.set(key, group);
  }
  return groups;
}

/**
 * Group weekly summaries by month (YYYY-MM).
 */
function groupWeekliesByMonth<T extends { week: string }>(
  weeklies: T[],
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const weekly of weeklies) {
    // Parse YYYY-Wnn to get approximate month from the Thursday of that week
    const match = weekly.week.match(/^(\d{4})-W(\d{2})$/);
    if (!match) continue;
    const year = parseInt(match[1], 10);
    const weekNum = parseInt(match[2], 10);
    // ISO week date: Jan 4 is always in week 1
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const dayOfWeek = jan4.getUTCDay() || 7;
    const monday = new Date(jan4);
    monday.setUTCDate(jan4.getUTCDate() - dayOfWeek + 1 + (weekNum - 1) * 7);
    const thursday = new Date(monday);
    thursday.setUTCDate(monday.getUTCDate() + 3);
    const month = `${thursday.getUTCFullYear()}-${(thursday.getUTCMonth() + 1).toString().padStart(2, "0")}`;
    const group = groups.get(month) ?? ([] as T[]);
    group.push(weekly);
    groups.set(month, group);
  }
  return groups;
}

/**
 * Build a weekly summary from daily logs.
 * This is a structural concatenation — the agent can refine it afterward.
 * When `partial` is true, adds `partial: true` to frontmatter to indicate
 * the week is incomplete and may be merged with later dailies.
 */
function buildWeeklySummary(
  weekKey: string,
  dailies: { date: string; content: string }[],
  partial = false,
): string {
  // Sort chronologically
  const sorted = [...dailies].sort((a, b) => a.date.localeCompare(b.date));
  const firstDate = sorted[0].date;
  const lastDate = sorted[sorted.length - 1].date;

  const lines: string[] = [];
  lines.push("---");
  lines.push(`version: ${PKG_VERSION}`);
  lines.push(`type: weekly`);
  lines.push(`week: ${weekKey}`);
  lines.push(`period: ${firstDate} to ${lastDate}`);
  if (partial) lines.push("partial: true");
  lines.push("---");
  lines.push("");
  lines.push(`# Week ${weekKey}`);
  lines.push("");

  for (const daily of sorted) {
    lines.push(`## ${daily.date}`);
    lines.push("");
    lines.push(daily.content.trim());
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Build a monthly summary from weekly summaries.
 */
function buildMonthlySummary(
  monthKey: string,
  weeklies: { week: string; content: string }[],
): string {
  const sorted = [...weeklies].sort((a, b) => a.week.localeCompare(b.week));
  const firstWeek = sorted[0].week;
  const lastWeek = sorted[sorted.length - 1].week;

  const lines: string[] = [];
  lines.push("---");
  lines.push(`version: ${PKG_VERSION}`);
  lines.push(`type: monthly`);
  lines.push(`month: ${monthKey}`);
  lines.push(`period: ${firstWeek} to ${lastWeek}`);
  lines.push("---");
  lines.push("");
  lines.push(`# Month ${monthKey}`);
  lines.push("");

  for (const weekly of sorted) {
    // Strip frontmatter from weekly content before including
    const content = weekly.content.replace(/^---[\s\S]*?---\s*\n/, "").trim();
    lines.push(content);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Compact daily logs into weekly summaries for a single teammate.
 * Only compacts complete weeks (not the current week).
 * If a partial weekly exists for a week, merges new dailies into it.
 */
export async function compactDailies(teammateDir: string): Promise<{
  created: string[];
  removed: string[];
}> {
  const memoryDir = join(teammateDir, "memory");
  const weeklyDir = join(memoryDir, "weekly");

  // Read all daily logs
  const entries = await readdir(memoryDir).catch(() => [] as string[]);
  const dailies: { date: string; content: string; file: string }[] = [];

  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const stem = basename(entry, ".md");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(stem)) continue;
    const content = await readFile(join(memoryDir, entry), "utf-8");
    dailies.push({ date: stem, content, file: entry });
  }

  if (dailies.length === 0) return { created: [], removed: [] };

  // Group by ISO week
  const groups = groupDailiesByWeek(dailies);

  // Determine current week — don't compact it
  const now = new Date();
  const { year: curYear, week: curWeek } = getISOWeek(now);
  const currentWeek = formatWeek(curYear, curWeek);

  // Check which weekly summaries already exist and which are partial
  const existingWeeklies = new Set<string>();
  const partialWeeklies = new Set<string>();
  try {
    const wEntries = await readdir(weeklyDir);
    for (const e of wEntries) {
      if (!e.endsWith(".md")) continue;
      const stem = basename(e, ".md");
      existingWeeklies.add(stem);
      // Check if this weekly is partial
      const content = await readFile(join(weeklyDir, e), "utf-8");
      if (/^partial:\s*true/m.test(content)) {
        partialWeeklies.add(stem);
      }
    }
  } catch {
    // No weekly dir yet
  }

  const created: string[] = [];
  const removed: string[] = [];

  for (const [weekKey, weekDailies] of groups) {
    // Skip current week
    if (weekKey === currentWeek) continue;

    // If a partial weekly exists for this week, merge new dailies into it
    if (partialWeeklies.has(weekKey)) {
      const existingDailies = await extractDailiesFromWeekly(
        join(weeklyDir, `${weekKey}.md`),
      );
      // Merge: combine existing + new, dedup by date
      const dateSet = new Set(existingDailies.map((d) => d.date));
      const merged = [...existingDailies];
      for (const d of weekDailies) {
        if (!dateSet.has(d.date)) {
          merged.push({ date: d.date, content: d.content });
          dateSet.add(d.date);
        }
      }
      // Rewrite as non-partial (complete week now, since current week is excluded)
      const summary = buildWeeklySummary(weekKey, merged, false);
      await writeFile(join(weeklyDir, `${weekKey}.md`), summary, "utf-8");
      created.push(`${weekKey}.md (merged)`);
      continue;
    }

    // Skip if weekly summary already exists (non-partial)
    if (existingWeeklies.has(weekKey)) continue;

    // Create weekly dir if needed
    await mkdir(weeklyDir, { recursive: true });

    // Build and write weekly summary
    const summary = buildWeeklySummary(weekKey, weekDailies);
    const weeklyFile = join(weeklyDir, `${weekKey}.md`);
    await writeFile(weeklyFile, summary, "utf-8");
    created.push(`${weekKey}.md`);

    // Daily logs are kept on disk for DAILY_LOG_RETENTION_DAYS (purged separately)
  }

  return { created, removed };
}

/**
 * Extract daily log entries from a weekly summary file.
 * Parses `## YYYY-MM-DD` sections back into individual entries.
 */
async function extractDailiesFromWeekly(
  weeklyPath: string,
): Promise<{ date: string; content: string }[]> {
  let raw: string;
  try {
    raw = await readFile(weeklyPath, "utf-8");
  } catch {
    return [];
  }
  // Strip frontmatter
  raw = raw.replace(/^---[\s\S]*?---\s*\n/, "");
  // Split on ## YYYY-MM-DD headers
  const entries: { date: string; content: string }[] = [];
  const parts = raw.split(/^## (\d{4}-\d{2}-\d{2})\s*$/m);
  // parts[0] = preamble (# Week header), then alternating: date, content, date, content...
  for (let i = 1; i < parts.length; i += 2) {
    const date = parts[i];
    const content = (parts[i + 1] ?? "").trim();
    if (date && content) {
      entries.push({ date, content });
    }
  }
  return entries;
}

/** Approximate chars per token for budget estimation. */
const CHARS_PER_TOKEN = 4;

/** Estimate tokens from character count. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Auto-compact oldest daily logs into weekly summaries when the total
 * daily log token count exceeds the budget. Unlike `compactDailies()`,
 * this WILL compact the current week if needed, marking the result as
 * `partial: true` in frontmatter. Partial weeklies are later merged
 * by `compactDailies()` when more dailies arrive.
 *
 * @param teammateDir - Path to the teammate directory
 * @param budgetTokens - Maximum token budget for daily logs
 * @returns What was compacted, or null if budget was not exceeded
 */
export async function autoCompactForBudget(
  teammateDir: string,
  budgetTokens: number,
): Promise<{ created: string[]; compactedDates: string[] } | null> {
  const memoryDir = join(teammateDir, "memory");
  const weeklyDir = join(memoryDir, "weekly");

  // Read all daily logs
  const entries = await readdir(memoryDir).catch(() => [] as string[]);
  const dailies: { date: string; content: string; file: string }[] = [];

  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const stem = basename(entry, ".md");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(stem)) continue;
    const content = await readFile(join(memoryDir, entry), "utf-8");
    dailies.push({ date: stem, content, file: entry });
  }

  if (dailies.length === 0) return null;

  // Sort chronologically (oldest first)
  dailies.sort((a, b) => a.date.localeCompare(b.date));

  // Estimate total token cost (excluding today — today is always in prompt)
  const today = new Date().toISOString().slice(0, 10);
  const pastDailies = dailies.filter((d) => d.date !== today);
  const totalTokens = pastDailies.reduce(
    (sum, d) => sum + estimateTokens(`### ${d.date}\n${d.content}`),
    0,
  );

  // If under budget, nothing to do
  if (totalTokens <= budgetTokens) return null;

  // Group by ISO week
  const groups = groupDailiesByWeek(pastDailies);

  // Sort week keys chronologically (oldest first)
  const sortedWeeks = [...groups.keys()].sort();

  // Determine current week
  const now = new Date();
  const { year: curYear, week: curWeek } = getISOWeek(now);
  const currentWeek = formatWeek(curYear, curWeek);

  // Check existing weeklies
  const existingWeeklies = new Set<string>();
  try {
    const wEntries = await readdir(weeklyDir);
    for (const e of wEntries) {
      if (e.endsWith(".md")) existingWeeklies.add(basename(e, ".md"));
    }
  } catch {
    // No weekly dir yet
  }

  // Compact oldest weeks first until remaining dailies fit in budget
  let remainingTokens = totalTokens;
  const created: string[] = [];
  const compactedDates: string[] = [];

  for (const weekKey of sortedWeeks) {
    if (remainingTokens <= budgetTokens) break;

    // Skip weeks that already have a (non-partial) weekly summary
    if (existingWeeklies.has(weekKey)) continue;

    const weekDailies = groups.get(weekKey)!;
    const weekTokens = weekDailies.reduce(
      (sum, d) => sum + estimateTokens(`### ${d.date}\n${d.content}`),
      0,
    );

    // Mark as partial if this is the current week
    const isPartial = weekKey === currentWeek;

    await mkdir(weeklyDir, { recursive: true });
    const summary = buildWeeklySummary(weekKey, weekDailies, isPartial);
    await writeFile(join(weeklyDir, `${weekKey}.md`), summary, "utf-8");
    created.push(`${weekKey}.md${isPartial ? " (partial)" : ""}`);

    for (const d of weekDailies) {
      compactedDates.push(d.date);
    }

    remainingTokens -= weekTokens;
  }

  if (created.length === 0) return null;

  return { created, compactedDates };
}

/**
 * Compact weekly summaries older than 52 weeks into monthly summaries.
 */
export async function compactWeeklies(teammateDir: string): Promise<{
  created: string[];
  removed: string[];
}> {
  const memoryDir = join(teammateDir, "memory");
  const weeklyDir = join(memoryDir, "weekly");
  const monthlyDir = join(memoryDir, "monthly");

  // Read all weekly summaries
  let entries: string[];
  try {
    entries = await readdir(weeklyDir);
  } catch {
    return { created: [], removed: [] };
  }

  const weeklies: { week: string; content: string; file: string }[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const stem = basename(entry, ".md");
    if (!/^\d{4}-W\d{2}$/.test(stem)) continue;
    const content = await readFile(join(weeklyDir, entry), "utf-8");
    weeklies.push({ week: stem, content, file: entry });
  }

  if (weeklies.length === 0) return { created: [], removed: [] };

  // Determine cutoff: 52 weeks ago
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 52 * 7);
  const { year: cutYear, week: cutWeek } = getISOWeek(cutoff);
  const cutoffWeek = formatWeek(cutYear, cutWeek);

  // Filter to old weeklies only
  const oldWeeklies = weeklies.filter((w) => w.week < cutoffWeek);
  if (oldWeeklies.length === 0) return { created: [], removed: [] };

  // Group by month
  const groups = groupWeekliesByMonth(oldWeeklies);

  // Check existing monthlies
  const existingMonthlies = new Set<string>();
  try {
    const mEntries = await readdir(monthlyDir);
    for (const e of mEntries) {
      if (e.endsWith(".md")) existingMonthlies.add(basename(e, ".md"));
    }
  } catch {
    // No monthly dir yet
  }

  const created: string[] = [];
  const removed: string[] = [];

  for (const [monthKey, monthWeeklies] of groups) {
    if (existingMonthlies.has(monthKey)) continue;

    await mkdir(monthlyDir, { recursive: true });

    const summary = buildMonthlySummary(monthKey, monthWeeklies);
    const monthlyFile = join(monthlyDir, `${monthKey}.md`);
    await writeFile(monthlyFile, summary, "utf-8");
    created.push(`${monthKey}.md`);

    // Delete the old weekly files
    for (const weekly of monthWeeklies) {
      await unlink(join(weeklyDir, weekly.file)).catch(() => {});
      removed.push(weekly.file);
    }
  }

  return { created, removed };
}

/**
 * Run full episodic compaction for a teammate:
 * 1. Compact completed weeks' dailies → weekly summaries
 * 2. Compact weeklies older than 52 weeks → monthly summaries
 */
export async function compactEpisodic(
  teammateDir: string,
  teammateName: string,
): Promise<CompactionResult> {
  const dailyResult = await compactDailies(teammateDir);
  const weeklyResult = await compactWeeklies(teammateDir);

  return {
    teammate: teammateName,
    weekliesCreated: dailyResult.created,
    monthliesCreated: weeklyResult.created,
    dailiesRemoved: dailyResult.removed,
    weekliesRemoved: weeklyResult.removed,
  };
}

/**
 * Build a prompt that tells a teammate to distill their WISDOM.md
 * from typed memories, daily logs, and weekly summaries.
 *
 * Returns null if there are no typed memories to distill from.
 */
export async function buildWisdomPrompt(
  teammateDir: string,
  teammateName: string,
): Promise<string | null> {
  const memoryDir = join(teammateDir, "memory");
  const wisdomPath = join(teammateDir, "WISDOM.md");

  // Read current WISDOM.md
  let currentWisdom = "";
  try {
    currentWisdom = await readFile(wisdomPath, "utf-8");
  } catch {
    // No WISDOM.md yet — that's fine, we'll create one
  }

  // Read typed memory files (anything in memory/ that isn't a daily log)
  const typedMemories: { file: string; content: string }[] = [];
  try {
    const entries = await readdir(memoryDir);
    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;
      // Skip daily logs (YYYY-MM-DD.md)
      if (/^\d{4}-\d{2}-\d{2}\.md$/.test(entry)) continue;
      // Skip subdirectories (weekly/, monthly/) — readdir only returns files here
      const content = await readFile(join(memoryDir, entry), "utf-8");
      typedMemories.push({ file: entry, content });
    }
  } catch {
    // No memory dir
  }

  // Read recent daily logs (current week)
  const recentDailies: { date: string; content: string }[] = [];
  try {
    const entries = await readdir(memoryDir);
    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;
      const stem = basename(entry, ".md");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(stem)) continue;
      const content = await readFile(join(memoryDir, entry), "utf-8");
      recentDailies.push({ date: stem, content });
    }
    recentDailies.sort((a, b) => b.date.localeCompare(a.date));
  } catch {
    // No memory dir
  }

  // If there's nothing to distill from, skip
  if (typedMemories.length === 0 && recentDailies.length === 0) {
    return null;
  }

  const today = new Date().toISOString().slice(0, 10);

  // Skip if already distilled today
  const compactedMatch = currentWisdom.match(
    /Last compacted:\s*(\d{4}-\d{2}-\d{2})/,
  );
  if (compactedMatch && compactedMatch[1] === today) {
    return null;
  }

  const parts: string[] = [];
  parts.push("# Wisdom Distillation Task\n");
  parts.push(
    "Update your WISDOM.md by distilling durable knowledge from your typed memories, recent daily logs, and weekly summaries.\n",
  );

  parts.push("## Rules\n");
  parts.push(
    "- WISDOM.md contains **distilled principles and patterns** — not a changelog or task list",
  );
  parts.push(
    "- Each entry should be a reusable insight: a convention, decision, pattern, gotcha, or codebase fact",
  );
  parts.push("- Keep entries concise (2-4 lines each) with a bold title");
  parts.push("- Remove entries that are outdated or no longer accurate");
  parts.push(
    "- Update entries whose details have changed (e.g., line counts, file counts)",
  );
  parts.push("- Add new entries for durable knowledge not yet captured");
  parts.push(`- Set \`Last compacted: ${today}\` at the top`);
  parts.push(
    "- Do NOT include task-specific details, conversation history, or ephemeral state",
  );
  parts.push(
    "- Do NOT include anything already in your SOUL.md (ownership, routing, technologies, etc.)\n",
  );

  if (currentWisdom) {
    parts.push("## Current WISDOM.md\n");
    parts.push("```markdown");
    parts.push(currentWisdom.trim());
    parts.push("```\n");
  }

  if (typedMemories.length > 0) {
    parts.push("## Typed Memories\n");
    for (const mem of typedMemories) {
      parts.push(`### ${mem.file}\n`);
      parts.push(mem.content.trim());
      parts.push("");
    }
  }

  if (recentDailies.length > 0) {
    parts.push("## Recent Daily Logs\n");
    for (const daily of recentDailies.slice(0, 7)) {
      parts.push(`### ${daily.date}\n`);
      parts.push(daily.content.trim());
      parts.push("");
    }
  }

  parts.push("\n## Instructions\n");
  parts.push(
    `Read your current WISDOM.md at \`.teammates/${teammateName}/WISDOM.md\` and rewrite it with updated, distilled entries. Write the file directly — this is the one time you are allowed to edit WISDOM.md.`,
  );

  return parts.join("\n");
}

/**
 * Purge daily logs older than DAILY_LOG_RETENTION_DAYS from disk.
 * Returns the list of deleted filenames.
 */
export async function purgeStaleDailies(
  teammateDir: string,
): Promise<string[]> {
  const memoryDir = join(teammateDir, "memory");
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - DAILY_LOG_RETENTION_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const entries = await readdir(memoryDir).catch(() => [] as string[]);
  const purged: string[] = [];

  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const stem = basename(entry, ".md");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(stem)) continue;
    if (stem < cutoffStr) {
      await unlink(join(memoryDir, entry)).catch(() => {});
      purged.push(entry);
    }
  }

  return purged;
}

/**
 * Find all daily logs that are not yet compressed (no `compressed: true`
 * frontmatter). Returns an array of { date, file } for each uncompressed log.
 */
export async function findUncompressedDailies(
  teammateDir: string,
): Promise<{ date: string; file: string }[]> {
  const memoryDir = join(teammateDir, "memory");
  const entries = await readdir(memoryDir).catch(() => [] as string[]);
  const results: { date: string; file: string }[] = [];

  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const stem = basename(entry, ".md");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(stem)) continue;
    const content = await readFile(join(memoryDir, entry), "utf-8");
    if (content.startsWith("---") && /compressed:\s*true/.test(content)) {
      continue; // Already compressed
    }
    results.push({ date: stem, file: entry });
  }

  return results.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Build a prompt for an agent to compress multiple daily logs in bulk.
 * Used during version migrations to compress all historical daily logs.
 * Returns null if there are no uncompressed dailies.
 */
export async function buildMigrationCompressionPrompt(
  _teammateDir: string,
  teammateName: string,
  dailies: { date: string; file: string }[],
): Promise<string | null> {
  if (dailies.length === 0) return null;

  const filePaths = dailies
    .map((d) => `.teammates/${teammateName}/memory/${d.file}`)
    .join("\n- ");

  return `You are compressing daily work logs to save context window space. There are ${dailies.length} uncompressed daily logs that need compression.

## Rules

For EACH file listed below:
1. Read the file
2. Rewrite it into a shorter version that preserves:
   - Task names and one-line summaries of what was done
   - Key decisions and their rationale
   - Files changed (as a flat list per task, not grouped subsections)
   - Important context for future tasks
3. Remove:
   - Detailed "What was done" step-by-step breakdowns
   - Build/test status lines (unless something failed)
   - Redundant section headers
4. Keep the same markdown structure (# date header, ## Task headers) but make each task entry 3-5 lines max
5. Remove any entries that are about compaction, compression, wisdom distillation, or other system maintenance tasks — these are noise and should not be in daily logs
6. Start the file with this frontmatter:
\`\`\`
---
version: ${PKG_VERSION}
type: daily
compressed: true
---
\`\`\`

## Files to Compress

- ${filePaths}

Process each file one at a time. Read it, compress it, write it back. Do NOT skip any files.`;
}

/**
 * Check if the previous day's log needs compression and return a prompt
 * to compress it. Returns null if no compression is needed.
 *
 * A daily log is eligible for compression when:
 * - Today's log does not yet exist (new day boundary)
 * - Yesterday's log exists and is not already compressed (no `compressed: true` frontmatter)
 */
export async function buildDailyCompressionPrompt(
  teammateDir: string,
): Promise<{ date: string; prompt: string } | null> {
  const memoryDir = join(teammateDir, "memory");

  const today = new Date().toISOString().slice(0, 10);

  // Find yesterday's date
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  // Check if yesterday's log exists
  const yesterdayFile = join(memoryDir, `${yesterdayStr}.md`);
  let content: string;
  try {
    content = await readFile(yesterdayFile, "utf-8");
  } catch {
    return null; // No yesterday log
  }

  // Skip if already compressed
  if (content.startsWith("---") && /compressed:\s*true/.test(content)) {
    return null;
  }

  // Skip if today's log already exists (we already passed the day boundary)
  const todayFile = join(memoryDir, `${today}.md`);
  try {
    await readFile(todayFile, "utf-8");
    // Today's log exists — this isn't a fresh day boundary, skip
    return null;
  } catch {
    // Today's log doesn't exist — this is a new day, compress yesterday
  }

  const prompt = `You are compressing a daily work log to save context window space. Rewrite the log below into a shorter version that preserves:
- Task names and one-line summaries of what was done
- Key decisions and their rationale
- Files changed (as a flat list per task, not grouped subsections)
- Important context for future tasks

Remove:
- Detailed "What was done" step-by-step breakdowns
- Build/test status lines (unless something failed)
- Redundant section headers
- Any entries about compaction, compression, wisdom distillation, or other system maintenance tasks — these are noise

Keep the same markdown structure (# date header, ## Task headers) but make each task entry 3-5 lines max.

Write the compressed version to \`.teammates/${basename(teammateDir)}/memory/${yesterdayStr}.md\`. Start the file with this frontmatter:
\`\`\`
---
version: ${PKG_VERSION}
type: daily
compressed: true
---
\`\`\`

## Original Log

${content}`;

  return { date: yesterdayStr, prompt };
}
