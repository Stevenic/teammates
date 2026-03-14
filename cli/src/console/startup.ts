/**
 * Animated startup sequence for the teammates CLI.
 *
 * Renders a large "teammates" title using Unicode block characters,
 * revealed letter by letter, then rolls out the info panel.
 */

import chalk from "chalk";

// ── Timing helpers ────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function write(text: string): void {
  process.stdout.write(text);
}

// ── Block font glyphs (2 rows tall) ─────────────────────────────
//
// Each glyph is [topLine, bottomLine]. Uses Unicode half-blocks
// (▀ ▄ █ ▐ ▌) for a clean, compact large-text look.

const GLYPHS: Record<string, [string, string]> = {
  t: ["▀█▀", " █ "],
  e: ["█▀▀", "██▄"],
  a: ["▄▀█", "█▀█"],
  m: ["█▀▄▀█", "█ ▀ █"],
  s: ["█▀", "▄█"],
};

/** Build the two-line title from a word using the block font. */
export function buildTitle(word: string): [string, string] {
  const top: string[] = [];
  const bot: string[] = [];
  for (const ch of word) {
    const g = GLYPHS[ch.toLowerCase()];
    if (g) {
      top.push(g[0]);
      bot.push(g[1]);
    }
  }
  return [top.join(" "), bot.join(" ")];
}

/** Get the glyph column ranges for each letter (start col, width). */
function getLetterPositions(word: string): { start: number; width: number }[] {
  const positions: { start: number; width: number }[] = [];
  let col = 0;
  for (const ch of word) {
    const g = GLYPHS[ch.toLowerCase()];
    if (g) {
      const w = g[0].length;
      positions.push({ start: col, width: w });
      col += w + 1; // +1 for the space between letters
    }
  }
  return positions;
}

// ── Main animation ───────────────────────────────────────────────

export interface StartupInfo {
  version: string;
  adapterName: string;
  teammateCount: number;
  cwd: string;
  recallInstalled: boolean;
  teammates: { name: string; role: string }[];
}

export async function playStartup(info: StartupInfo): Promise<void> {
  const termWidth = process.stdout.columns || 100;
  const word = "teammates";
  const [topFull, botFull] = buildTitle(word);
  const positions = getLetterPositions(word);
  const titleWidth = topFull.length;

  // Center the title
  const pad = Math.max(0, Math.floor((termWidth - titleWidth) / 2));
  const indent = " ".repeat(pad);

  console.log();

  // Phase 1: reveal title letter by letter
  // Draw two empty lines for the title area
  write(indent);
  const topLine = pad; // track where we are
  write("\n" + indent + "\n");

  // Move back up to the first title line
  write("\x1b[2A");

  let builtTop = "";
  let builtBot = "";

  for (let i = 0; i < positions.length; i++) {
    const ch = word[i];
    const g = GLYPHS[ch.toLowerCase()];
    if (!g) continue;

    if (i > 0) {
      builtTop += " ";
      builtBot += " ";
    }
    builtTop += g[0];
    builtBot += g[1];

    // Draw top line — flash bright then settle
    write("\r" + indent + chalk.whiteBright(builtTop));
    // Move down, draw bottom line
    write("\n\r" + indent + chalk.whiteBright(builtBot));
    // Move back up
    write("\x1b[1A");

    await sleep(35);

    // Re-draw in resting color (cyan)
    write("\r" + indent + chalk.cyan(builtTop));
    write("\n\r" + indent + chalk.cyan(builtBot));
    write("\x1b[1A");

    await sleep(15);
  }

  // Move past the title
  write("\n\n");

  await sleep(100);

  // Phase 2: version tag centered under the title
  const versionTag = `v${info.version}`;
  const tagPad = Math.max(0, Math.floor((termWidth - versionTag.length) / 2));
  console.log(" ".repeat(tagPad) + chalk.gray(versionTag));

  await sleep(80);

  // Phase 3: info panel
  console.log();

  const infoLines = [
    chalk.white("  " + info.adapterName) +
      chalk.gray(` · ${info.teammateCount} teammate${info.teammateCount === 1 ? "" : "s"}`),
    chalk.gray("  " + info.cwd),
    info.recallInstalled
      ? "  " + chalk.green("● recall") + chalk.gray(" installed")
      : "  " + chalk.yellow("○ recall") + chalk.gray(" not installed"),
  ];

  for (const line of infoLines) {
    console.log(line);
    await sleep(25);
  }

  await sleep(60);

  // Phase 4: roster
  if (info.teammates.length > 0) {
    console.log();
    for (const t of info.teammates) {
      const line =
        chalk.gray("  ") +
        chalk.cyan("●") +
        chalk.cyan(` @${t.name}`.padEnd(14)) +
        chalk.gray(t.role);
      console.log(line);
      await sleep(25);
    }
  }

  await sleep(60);

  // Phase 5: quick reference
  console.log();
  console.log(chalk.gray("─".repeat(termWidth)));

  const col1 = [
    ["@mention", "assign to teammate"],
    ["text", "auto-route task"],
    ["/queue", "queue tasks"],
  ];
  const col2 = [
    ["/status", "session overview"],
    ["/debug", "raw agent output"],
    ["/log", "last task output"],
  ];
  const col3 = [
    ["/install", "add a service"],
    ["/help", "all commands"],
    ["/exit", "exit session"],
  ];

  for (let i = 0; i < col1.length; i++) {
    const c1 = chalk.cyan(col1[i][0].padEnd(12)) + chalk.gray(col1[i][1].padEnd(22));
    const c2 = chalk.cyan(col2[i][0].padEnd(12)) + chalk.gray(col2[i][1].padEnd(22));
    const c3 = chalk.cyan(col3[i][0].padEnd(12)) + chalk.gray(col3[i][1]);
    console.log(`  ${c1}${c2}${c3}`);
    await sleep(20);
  }

  console.log();
}
