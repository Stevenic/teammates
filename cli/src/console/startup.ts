/**
 * Animated startup sequence for the teammates CLI.
 *
 * Phase 1: Reveals "teammates" letter by letter in block font, left-aligned.
 * Phase 2: Replaces with compact "TM" block logo + stats panel to the right.
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
  const indent = "  ";

  // Hide cursor during animation
  write("\x1b[?25l");

  console.log();

  // Phase 1: reveal full "teammates" title letter by letter, left-aligned
  // Reserve two lines for the title area
  write(`${indent}\n${indent}\n`);
  write("\x1b[2A"); // move back up

  let builtTop = "";
  let builtBot = "";

  for (const ch of word) {
    const g = GLYPHS[ch.toLowerCase()];
    if (!g) continue;

    if (builtTop.length > 0) {
      builtTop += " ";
      builtBot += " ";
    }
    builtTop += g[0];
    builtBot += g[1];

    write(`\r${indent}${chalk.cyan(builtTop)}`);
    write(`\n\r${indent}${chalk.cyan(builtBot)}`);
    write("\x1b[1A");

    await sleep(60);
  }

  // Pause on the full title
  await sleep(1000);

  // Roll out version to the right of the logo on the bottom row
  const versionTag = chalk.gray(` v${info.version}`);
  write(`\n\r${indent}${chalk.cyan(builtBot)}${versionTag}`);
  write("\x1b[1A"); // back to top line

  await sleep(2000);

  // Phase 2: Replace title with compact TM + stats
  // Erase the two title lines and rewrite
  write("\r\x1b[K"); // erase top line
  write("\n\r\x1b[K"); // erase bottom line
  write("\x1b[1A"); // back to top

  const [tmTop, tmBot] = buildTitle("tm");
  const tmWidth = tmTop.length; // "▀█▀ █▀▄▀█" = 9 chars
  const gap = "   ";

  // Build info lines to sit to the right of TM
  const rightLine1 =
    chalk.white(info.adapterName) +
    chalk.gray(
      ` · ${info.teammateCount} teammate${info.teammateCount === 1 ? "" : "s"}`,
    ) +
    chalk.gray(` · v${info.version}`);
  const rightLine2 = chalk.gray(info.cwd);
  const rightLine3 = info.recallInstalled
    ? chalk.green("● recall") + chalk.gray(" installed")
    : chalk.yellow("○ recall") + chalk.gray(" not installed");

  // TM row 1 + first stat
  write(`${indent + chalk.cyan(tmTop) + gap + rightLine1}\n`);
  await sleep(40);
  // TM row 2 + second stat
  write(`${indent + chalk.cyan(tmBot) + gap + rightLine2}\n`);
  await sleep(40);
  // Blank TM area + third stat
  write(`${indent + " ".repeat(tmWidth) + gap + rightLine3}\n`);

  await sleep(80);

  // Phase 3: roster
  if (info.teammates.length > 0) {
    console.log();
    for (const t of info.teammates) {
      const line =
        chalk.gray("  ") +
        chalk.cyan("●") +
        chalk.cyan(` @${t.name}`.padEnd(14)) +
        chalk.gray(t.role);
      console.log(line);
      await sleep(40);
    }
  }

  await sleep(80);

  // Phase 4: quick reference
  console.log();
  console.log(chalk.gray("─".repeat(termWidth)));

  const col1 = [
    ["@mention", "assign to teammate"],
    ["text", "auto-route task"],
    ["/queue", "view task queue"],
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
    const c1 =
      chalk.cyan(col1[i][0].padEnd(12)) + chalk.gray(col1[i][1].padEnd(22));
    const c2 =
      chalk.cyan(col2[i][0].padEnd(12)) + chalk.gray(col2[i][1].padEnd(22));
    const c3 = chalk.cyan(col3[i][0].padEnd(12)) + chalk.gray(col3[i][1]);
    console.log(`  ${c1}${c2}${c3}`);
    await sleep(30);
  }

  console.log();
}
