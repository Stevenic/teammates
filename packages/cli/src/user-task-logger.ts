/**
 * User task logger — logs task initiations to the user's twin daily memory.
 *
 * When the human user orchestrates work (assigns tasks to teammates),
 * we record those assignments in the user's own daily log so the
 * twin's memory reflects the orchestration activity.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Append a task entry to the user's twin daily log.
 *
 * @param teammatesDir - Path to .teammates/ directory
 * @param userAlias - The user's alias (twin name, e.g. "stevenic")
 * @param teammate - The teammate the task was assigned to
 * @param task - The task description (user's original input)
 * @param result - Optional result summary (only included when user used coding agent directly)
 */
export async function logUserTask(
  teammatesDir: string,
  userAlias: string,
  teammate: string,
  task: string,
  result?: { summary?: string; changedFiles?: string[] },
): Promise<void> {
  const memoryDir = join(teammatesDir, userAlias, "memory");
  const today = new Date().toISOString().slice(0, 10);
  const logFile = join(memoryDir, `${today}.md`);

  // Ensure memory directory exists
  await mkdir(memoryDir, { recursive: true });

  // Read existing log or create new
  let existing = "";
  try {
    existing = await readFile(logFile, "utf-8");
  } catch {
    // No log yet today — create with frontmatter and header
  }

  // Build the entry
  const time = new Date().toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const lines: string[] = [];
  lines.push(`## ${time} — Assigned @${teammate}`);
  // Truncate task to a reasonable length for the log
  const taskPreview = task.length > 300 ? `${task.slice(0, 297)}...` : task;
  lines.push(taskPreview);

  // If the user used the coding agent directly, include result details
  if (result) {
    if (result.summary) {
      lines.push("");
      lines.push(`**Result:** ${result.summary}`);
    }
    if (result.changedFiles && result.changedFiles.length > 0) {
      lines.push("");
      lines.push("**Files changed:**");
      for (const f of result.changedFiles) {
        lines.push(`- ${f}`);
      }
    }
  }

  const entry = lines.join("\n");

  if (existing) {
    // Append to existing log
    const content = `${existing.trimEnd()}\n\n${entry}\n`;
    await writeFile(logFile, content, "utf-8");
  } else {
    // Create new daily log
    const content = `---\ntype: daily\n---\n\n# ${today}\n\n${entry}\n`;
    await writeFile(logFile, content, "utf-8");
  }
}
