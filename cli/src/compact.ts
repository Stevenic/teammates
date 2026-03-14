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

import { readdir, readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { join, basename } from "node:path";

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
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
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
function groupDailiesByWeek<T extends { date: string }>(dailies: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const daily of dailies) {
    const d = new Date(daily.date + "T00:00:00Z");
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
function groupWeekliesByMonth<T extends { week: string }>(weeklies: T[]): Map<string, T[]> {
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
 */
function buildWeeklySummary(weekKey: string, dailies: { date: string; content: string }[]): string {
  // Sort chronologically
  const sorted = [...dailies].sort((a, b) => a.date.localeCompare(b.date));
  const firstDate = sorted[0].date;
  const lastDate = sorted[sorted.length - 1].date;

  const lines: string[] = [];
  lines.push("---");
  lines.push(`type: weekly`);
  lines.push(`week: ${weekKey}`);
  lines.push(`period: ${firstDate} to ${lastDate}`);
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
function buildMonthlySummary(monthKey: string, weeklies: { week: string; content: string }[]): string {
  const sorted = [...weeklies].sort((a, b) => a.week.localeCompare(b.week));
  const firstWeek = sorted[0].week;
  const lastWeek = sorted[sorted.length - 1].week;

  const lines: string[] = [];
  lines.push("---");
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

  // Check which weekly summaries already exist
  const existingWeeklies = new Set<string>();
  try {
    const wEntries = await readdir(weeklyDir);
    for (const e of wEntries) {
      if (e.endsWith(".md")) existingWeeklies.add(basename(e, ".md"));
    }
  } catch {
    // No weekly dir yet
  }

  const created: string[] = [];
  const removed: string[] = [];

  for (const [weekKey, weekDailies] of groups) {
    // Skip current week
    if (weekKey === currentWeek) continue;
    // Skip if weekly summary already exists
    if (existingWeeklies.has(weekKey)) continue;

    // Create weekly dir if needed
    await mkdir(weeklyDir, { recursive: true });

    // Build and write weekly summary
    const summary = buildWeeklySummary(weekKey, weekDailies);
    const weeklyFile = join(weeklyDir, `${weekKey}.md`);
    await writeFile(weeklyFile, summary, "utf-8");
    created.push(`${weekKey}.md`);

    // Delete the daily logs that were compacted
    for (const daily of weekDailies) {
      await unlink(join(memoryDir, daily.file)).catch(() => {});
      removed.push(daily.file);
    }
  }

  return { created, removed };
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
export async function compactEpisodic(teammateDir: string, teammateName: string): Promise<CompactionResult> {
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
