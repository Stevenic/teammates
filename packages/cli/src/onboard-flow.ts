/**
 * Onboarding flow — user profile setup, team onboarding, persona picker, import, adaptation.
 * Extracted from cli.ts to reduce file size.
 */

import { execSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

import type { StyledSpan } from "@teammates/consolonia";
import { concat } from "@teammates/consolonia";
import chalk from "chalk";
import ora from "ora";
import type { AgentAdapter } from "./adapter.js";
import { buildTitle } from "./console/startup.js";
import {
  buildImportAdaptationPrompt,
  copyTemplateFiles,
  getOnboardingPrompt,
  importTeammates,
} from "./onboard.js";
import { loadPersonas, scaffoldFromPersona } from "./personas.js";
import { tp } from "./theme.js";

// ── View interface ──────────────────────────────────────────────────

export interface OnboardView {
  feedLine(text?: string | StyledSpan): void;
  feedMarkdown(source: string): void;
  refreshView(): void;
  askInline(prompt: string): Promise<string>;
  get adapterName(): string;
}

// ── Onboarding class ────────────────────────────────────────────────

export class OnboardFlow {
  private view: OnboardView;

  constructor(view: OnboardView) {
    this.view = view;
  }

  // ── Pre-TUI helpers (console-based, before ChatView exists) ─────

  /** Simple blocking prompt — reads one line from stdin and validates. */
  askChoice(prompt: string, valid: string[]): Promise<string> {
    return new Promise((resolve) => {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      const ask = () => {
        rl.question(chalk.cyan("  ") + prompt, (answer) => {
          const trimmed = answer.trim();
          if (valid.includes(trimmed)) {
            rl.close();
            resolve(trimmed);
          } else {
            ask();
          }
        });
      };
      ask();
    });
  }

  askInput(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      rl.question(chalk.cyan("  ") + prompt, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });
  }

  // ── User profile ─────────────────────────────────────────────────

  /**
   * Check whether USER.md needs to be created or is still template placeholders.
   */
  needsUserSetup(teammatesDir: string): boolean {
    const userMdPath = join(teammatesDir, "USER.md");
    try {
      const content = readFileSync(userMdPath, "utf-8");
      return !content.trim() || content.toLowerCase().includes("<your name>");
    } catch {
      return true;
    }
  }

  /**
   * Pre-TUI user profile setup. Runs in the console before the ChatView is created.
   * Offers GitHub-based or manual profile creation.
   */
  async runUserSetup(teammatesDir: string): Promise<void> {
    const termWidth = process.stdout.columns || 100;

    console.log();
    console.log(chalk.gray("─".repeat(termWidth)));
    console.log();
    console.log(chalk.white("  Set up your profile\n"));
    console.log(
      chalk.cyan("  1") +
        chalk.gray(") ") +
        chalk.white("Use GitHub account") +
        chalk.gray(" — import your name and username from GitHub"),
    );
    console.log(
      chalk.cyan("  2") +
        chalk.gray(") ") +
        chalk.white("Manual setup") +
        chalk.gray(" — enter your details manually"),
    );
    console.log(
      chalk.cyan("  3") +
        chalk.gray(") ") +
        chalk.white("Skip") +
        chalk.gray(" — set up later with /user"),
    );
    console.log();

    const choice = await this.askChoice("Pick an option (1/2/3): ", [
      "1",
      "2",
      "3",
    ]);

    if (choice === "3") {
      console.log(
        chalk.gray("  Skipped — run /user to set up your profile later."),
      );
      console.log();
      return;
    }

    if (choice === "1") {
      await this.setupGitHubProfile(teammatesDir);
    } else {
      await this.setupManualProfile(teammatesDir);
    }
  }

  /**
   * GitHub-based profile setup. Ensures gh is installed and authenticated,
   * then fetches user info from the GitHub API to create the profile.
   */
  private async setupGitHubProfile(teammatesDir: string): Promise<void> {
    console.log();

    // Step 1: Check if gh is installed
    let ghInstalled = false;
    try {
      execSync("gh --version", { stdio: "pipe" });
      ghInstalled = true;
    } catch {
      // not installed
    }

    if (!ghInstalled) {
      console.log(chalk.yellow("  GitHub CLI is not installed.\n"));

      const plat = process.platform;
      console.log(chalk.white("  Run this in another terminal:"));
      if (plat === "win32") {
        console.log(chalk.cyan("    winget install --id GitHub.cli"));
      } else if (plat === "darwin") {
        console.log(chalk.cyan("    brew install gh"));
      } else {
        console.log(chalk.cyan("    sudo apt install gh"));
        console.log(chalk.gray("    (or see https://cli.github.com)"));
      }
      console.log();

      const answer = await this.askChoice(
        "Press Enter when done, or s to skip: ",
        ["", "s", "S"],
      );
      if (answer.toLowerCase() === "s") {
        console.log(chalk.gray("  Falling back to manual setup.\n"));
        return this.setupManualProfile(teammatesDir);
      }

      // Re-check
      try {
        execSync("gh --version", { stdio: "pipe" });
        ghInstalled = true;
        console.log(chalk.green("  ✔  GitHub CLI installed"));
      } catch {
        console.log(
          chalk.yellow(
            "  GitHub CLI still not found. You may need to restart your terminal.",
          ),
        );
        console.log(chalk.gray("  Falling back to manual setup.\n"));
        return this.setupManualProfile(teammatesDir);
      }
    } else {
      console.log(chalk.green("  ✔  GitHub CLI installed"));
    }

    // Step 2: Check auth
    let authed = false;
    try {
      execSync("gh auth status", { stdio: "pipe" });
      authed = true;
    } catch {
      // not authenticated
    }

    if (!authed) {
      console.log();
      console.log(chalk.gray("  Authenticating with GitHub...\n"));

      const result = spawnSync(
        "gh",
        ["auth", "login", "--web", "--git-protocol", "https"],
        {
          stdio: "inherit",
          shell: true,
        },
      );

      if (result.status !== 0) {
        console.log(chalk.yellow("  Authentication failed or was cancelled."));
        console.log(chalk.gray("  Falling back to manual setup.\n"));
        return this.setupManualProfile(teammatesDir);
      }

      // Verify
      try {
        execSync("gh auth status", { stdio: "pipe" });
        authed = true;
      } catch {
        console.log(chalk.yellow("  Authentication could not be verified."));
        console.log(chalk.gray("  Falling back to manual setup.\n"));
        return this.setupManualProfile(teammatesDir);
      }
    }

    console.log(chalk.green("  ✔  GitHub authenticated"));

    // Step 3: Fetch user info from GitHub API
    let login = "";
    let name = "";
    try {
      const json = execSync("gh api user", {
        stdio: "pipe",
        encoding: "utf-8",
      });
      const user = JSON.parse(json);
      login = (user.login || "").toLowerCase().replace(/[^a-z0-9_-]/g, "");
      name = user.name || user.login || "";
    } catch {
      console.log(chalk.yellow("  Could not fetch GitHub user info."));
      console.log(chalk.gray("  Falling back to manual setup.\n"));
      return this.setupManualProfile(teammatesDir);
    }

    if (!login) {
      console.log(chalk.yellow("  No GitHub username found."));
      console.log(chalk.gray("  Falling back to manual setup.\n"));
      return this.setupManualProfile(teammatesDir);
    }

    console.log(
      chalk.green("  ✔  Authenticated as ") +
        chalk.cyan(`@${login}`) +
        (name && name !== login ? chalk.gray(` (${name})`) : ""),
    );
    console.log();

    // Ask for remaining fields since GitHub doesn't provide them
    const role = await this.askInput(
      "Your role (optional, press Enter to skip): ",
    );
    const experience = await this.askInput(
      "Relevant experience (e.g., 10 years Go, new to React): ",
    );
    const preferences = await this.askInput(
      "How you like to work (e.g., terse responses): ",
    );
    // Auto-detect timezone
    const detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const timezone = await this.askInput(
      `Primary timezone${detectedTz ? ` [${detectedTz}]` : ""}: `,
    );

    const answers: Record<string, string> = {
      alias: login,
      name: name || login,
      role: role || "",
      experience: experience || "",
      preferences: preferences || "",
      timezone: timezone || detectedTz || "",
    };

    this.writeUserProfile(teammatesDir, login, answers);
    this.createUserAvatar(teammatesDir, login, answers);

    console.log(
      chalk.green("  ✔  ") + chalk.gray(`Profile created — avatar @${login}`),
    );
    console.log();
  }

  /**
   * Manual (console-based) profile setup. Collects fields via askInput().
   */
  private async setupManualProfile(teammatesDir: string): Promise<void> {
    console.log();
    console.log(
      chalk.gray("  (alias is required, press Enter to skip others)\n"),
    );

    const aliasRaw = await this.askInput("Your alias (e.g., alex): ");
    const alias = aliasRaw
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "")
      .trim();
    if (!alias) {
      console.log(
        chalk.yellow("  Alias is required. Run /user to try again.\n"),
      );
      return;
    }

    const name = await this.askInput("Your name: ");
    const role = await this.askInput(
      "Your role (e.g., senior backend engineer): ",
    );
    const experience = await this.askInput(
      "Relevant experience (e.g., 10 years Go, new to React): ",
    );
    const preferences = await this.askInput(
      "How you like to work (e.g., terse responses): ",
    );
    // Auto-detect timezone
    const detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const timezone = await this.askInput(
      `Primary timezone${detectedTz ? ` [${detectedTz}]` : ""}: `,
    );

    const answers: Record<string, string> = {
      alias,
      name,
      role,
      experience,
      preferences,
      timezone: timezone || detectedTz || "",
    };

    this.writeUserProfile(teammatesDir, alias, answers);
    this.createUserAvatar(teammatesDir, alias, answers);

    console.log();
    console.log(
      chalk.green("  ✔  ") + chalk.gray(`Profile created — avatar @${alias}`),
    );
    console.log(chalk.gray("  Update anytime with /user"));
    console.log();
  }

  /**
   * Write USER.md from collected answers.
   */
  writeUserProfile(
    teammatesDir: string,
    alias: string,
    answers: Record<string, string>,
  ): void {
    const userMdPath = join(teammatesDir, "USER.md");
    const lines = ["# User\n"];
    lines.push(`- **Alias:** ${alias}`);
    lines.push(`- **Name:** ${answers.name || "_not provided_"}`);
    lines.push(`- **Role:** ${answers.role || "_not provided_"}`);
    lines.push(`- **Experience:** ${answers.experience || "_not provided_"}`);
    lines.push(`- **Preferences:** ${answers.preferences || "_not provided_"}`);
    lines.push(
      `- **Primary Timezone:** ${answers.timezone || "_not provided_"}`,
    );
    writeFileSync(userMdPath, `${lines.join("\n")}\n`, "utf-8");
  }

  /**
   * Create the user's avatar folder with SOUL.md and WISDOM.md.
   * The avatar is a teammate folder with type: human.
   */
  createUserAvatar(
    teammatesDir: string,
    alias: string,
    answers: Record<string, string>,
  ): void {
    const avatarDir = join(teammatesDir, alias);
    const memoryDir = join(avatarDir, "memory");
    mkdirSync(avatarDir, { recursive: true });
    mkdirSync(memoryDir, { recursive: true });

    const name = answers.name || alias;
    const role = answers.role || "I'm a human working on this project";
    const experience = answers.experience || "";
    const preferences = answers.preferences || "";
    const timezone = answers.timezone || "";

    // Write SOUL.md
    const soulLines = [
      `# ${name}`,
      "",
      "## Identity",
      "",
      "**Type:** human",
      `**Alias:** ${alias}`,
      `**Role:** ${role}`,
    ];
    if (experience) soulLines.push(`**Experience:** ${experience}`);
    if (preferences) soulLines.push(`**Preferences:** ${preferences}`);
    if (timezone) soulLines.push(`**Primary Timezone:** ${timezone}`);
    soulLines.push("");

    const soulPath = join(avatarDir, "SOUL.md");
    writeFileSync(soulPath, soulLines.join("\n"), "utf-8");

    // Write empty WISDOM.md
    const wisdomPath = join(avatarDir, "WISDOM.md");
    writeFileSync(
      wisdomPath,
      `# ${name} — Wisdom\n\nDistilled from work history. Updated during compaction.\n`,
      "utf-8",
    );
  }

  /**
   * Read USER.md and extract the alias field.
   * Returns null if USER.md doesn't exist or has no alias.
   */
  readUserAlias(teammatesDir: string): string | null {
    try {
      const content = readFileSync(join(teammatesDir, "USER.md"), "utf-8");
      const match = content.match(/\*\*Alias:\*\*\s*(\S+)/);
      return match ? match[1].toLowerCase().replace(/[^a-z0-9_-]/g, "") : null;
    } catch {
      return null;
    }
  }

  /**
   * Read the isSolo flag from settings.json.
   * Returns true only if the user explicitly chose solo mode.
   */
  readSoloSetting(teammatesDir: string): boolean {
    try {
      const settings = JSON.parse(
        readFileSync(join(teammatesDir, "settings.json"), "utf-8"),
      );
      return settings.isSolo === true;
    } catch {
      return false;
    }
  }

  /**
   * Persist the isSolo flag to settings.json.
   */
  writeSoloSetting(teammatesDir: string, value: boolean): void {
    const settingsPath = join(teammatesDir, "settings.json");
    let settings: Record<string, unknown> = {};
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    } catch {
      /* create fresh */
    }
    settings.isSolo = value;
    try {
      writeFileSync(
        settingsPath,
        `${JSON.stringify(settings, null, 2)}\n`,
        "utf-8",
      );
    } catch {
      /* write failed — non-fatal */
    }
  }

  // ── Team onboarding ──────────────────────────────────────────────

  /**
   * Check whether any agentic teammates are configured.
   * Scans .teammates/ for subdirectories with SOUL.md that aren't human-type.
   */
  async hasAgenticTeammates(teammatesDir: string): Promise<boolean> {
    let entries: { isDirectory(): boolean; name: string }[];
    try {
      entries = await readdir(teammatesDir, { withFileTypes: true });
    } catch {
      return false;
    }
    const userAlias = this.readUserAlias(teammatesDir);

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".") || entry.name.startsWith("_")) continue;
      if (entry.name === "example") continue;
      if (entry.name === userAlias) continue;

      try {
        const soul = readFileSync(
          join(teammatesDir, entry.name, "SOUL.md"),
          "utf-8",
        );
        if (soul.includes("**Type:** human")) continue;
        return true;
      } catch {}
    }

    return false;
  }

  /**
   * Interactive prompt for team onboarding after user profile is set up.
   * .teammates/ already exists at this point. Returns false if user chose to exit.
   */
  async promptTeamOnboarding(
    adapter: AgentAdapter,
    teammatesDir: string,
    printAgentOutput: (raw: string | undefined) => void,
  ): Promise<boolean> {
    const cwd = process.cwd();
    const termWidth = process.stdout.columns || 100;

    console.log();
    console.log(chalk.gray("─".repeat(termWidth)));
    console.log();
    console.log(chalk.white("  Set up teammates for this project?\n"));
    console.log(
      chalk.cyan("  1") +
        chalk.gray(") ") +
        chalk.white("Pick teammates") +
        chalk.gray(" — choose from persona templates"),
    );
    console.log(
      chalk.cyan("  2") +
        chalk.gray(") ") +
        chalk.white("Auto-generate") +
        chalk.gray(
          " — let your agent analyze the codebase and create teammates",
        ),
    );
    console.log(
      chalk.cyan("  3") +
        chalk.gray(") ") +
        chalk.white("Import team") +
        chalk.gray(" — copy teammates from another project"),
    );
    console.log(
      chalk.cyan("  4") +
        chalk.gray(") ") +
        chalk.white("Solo mode") +
        chalk.gray(" — use your agent without teammates"),
    );
    console.log(chalk.cyan("  5") + chalk.gray(") ") + chalk.white("Exit"));
    console.log();

    const choice = await this.askChoice("Pick an option (1/2/3/4/5): ", [
      "1",
      "2",
      "3",
      "4",
      "5",
    ]);

    if (choice === "5") {
      console.log(chalk.gray("  Goodbye."));
      return false;
    }

    if (choice === "4") {
      console.log(
        chalk.gray("  Running in solo mode — all tasks go to your agent."),
      );
      console.log(chalk.gray("  Run /add later to add teammates."));
      console.log();
      // Persist the solo choice so we don't re-prompt on next startup
      this.writeSoloSetting(teammatesDir, true);
      return true;
    }

    if (choice === "3") {
      await this.runImport(cwd, adapter, printAgentOutput);
      return true;
    }

    if (choice === "2") {
      await this.runOnboardingAgent(
        adapter,
        cwd,
        this.view.adapterName,
        printAgentOutput,
      );
      return true;
    }

    // choice === "1": Pick from persona templates
    await this.runPersonaOnboarding(teammatesDir);
    return true;
  }

  /**
   * Persona-based onboarding: show a list of bundled personas, let the user
   * pick which ones to create, optionally rename them, and scaffold the folders.
   */
  async runPersonaOnboarding(teammatesDir: string): Promise<void> {
    const personas = await loadPersonas();
    if (personas.length === 0) {
      console.log(chalk.yellow("  No persona templates found."));
      return;
    }

    console.log();
    console.log(chalk.white("  Available personas:\n"));

    // Display personas grouped by tier
    let currentTier = 0;
    for (let i = 0; i < personas.length; i++) {
      const p = personas[i];
      if (p.tier !== currentTier) {
        currentTier = p.tier;
        const label = currentTier === 1 ? "Core" : "Specialized";
        console.log(chalk.gray(`  ── ${label} ──`));
      }
      const num = String(i + 1).padStart(2, " ");
      console.log(
        chalk.cyan(`  ${num}`) +
          chalk.gray(") ") +
          chalk.white(`@${p.alias}`) +
          chalk.gray(` - ${p.persona}`) +
          chalk.gray(` - ${p.description}`),
      );
    }

    console.log();
    console.log(chalk.gray("  Enter numbers separated by commas, e.g. 1,3,5"));
    console.log();

    const input = await this.askInput("Personas: ");
    if (!input) {
      console.log(chalk.gray("  No personas selected."));
      return;
    }

    // Parse comma-separated numbers
    const indices = input
      .split(",")
      .map((s) => parseInt(s.trim(), 10) - 1)
      .filter((i) => i >= 0 && i < personas.length);

    const unique = [...new Set(indices)];
    if (unique.length === 0) {
      console.log(chalk.yellow("  No valid selections."));
      return;
    }

    console.log();

    // Copy framework files first
    await copyTemplateFiles(teammatesDir);

    const created: string[] = [];
    for (const idx of unique) {
      const p = personas[idx];
      const nameInput = await this.askInput(
        `Alias for @${p.alias} [${p.alias}]: `,
      );
      const name = nameInput || p.alias;
      const folderName = name.toLowerCase().replace(/[^a-z0-9_-]/g, "");

      await scaffoldFromPersona(teammatesDir, folderName, p);
      created.push(folderName);
      console.log(
        chalk.green("  ✔  ") +
          chalk.white(`@${folderName}`) +
          chalk.gray(` - ${p.persona}`),
      );
    }

    console.log();
    console.log(
      chalk.green(
        `  ✔  Created ${created.length} teammate${created.length > 1 ? "s" : ""}: `,
      ) + chalk.white(created.map((n) => `@${n}`).join(", ")),
    );
    console.log(
      chalk.gray(
        "  Tip: Your agent will adapt ownership and capabilities to this codebase on first task.",
      ),
    );
    console.log();
  }

  /**
   * In-TUI persona picker for /add. Uses feedLine + askInline instead
   * of console.log + askInput.
   */
  async runPersonaOnboardingInline(teammatesDir: string): Promise<void> {
    const personas = await loadPersonas();
    if (personas.length === 0) {
      this.view.feedLine(tp.warning("  No persona templates found."));
      this.view.refreshView();
      return;
    }

    // Display personas in the feed
    this.view.feedLine(tp.text("  Available personas:\n"));

    let currentTier = 0;
    for (let i = 0; i < personas.length; i++) {
      const p = personas[i];
      if (p.tier !== currentTier) {
        currentTier = p.tier;
        const label = currentTier === 1 ? "Core" : "Specialized";
        this.view.feedLine(tp.muted(`  ── ${label} ──`));
      }
      const num = String(i + 1).padStart(2, " ");
      this.view.feedLine(
        concat(
          tp.text(`  ${num}) @${p.alias} `),
          tp.muted(`- ${p.persona} - ${p.description}`),
        ),
      );
    }

    this.view.feedLine(
      tp.muted("\n  Enter numbers separated by commas, e.g. 1,3,5"),
    );
    this.view.refreshView();

    const input = await this.view.askInline("Personas: ");
    if (!input) {
      this.view.feedLine(tp.muted("  No personas selected."));
      this.view.refreshView();
      return;
    }

    const indices = input
      .split(",")
      .map((s) => parseInt(s.trim(), 10) - 1)
      .filter((i) => i >= 0 && i < personas.length);

    const unique = [...new Set(indices)];
    if (unique.length === 0) {
      this.view.feedLine(tp.warning("  No valid selections."));
      this.view.refreshView();
      return;
    }

    await copyTemplateFiles(teammatesDir);

    const created: string[] = [];
    for (const idx of unique) {
      const p = personas[idx];
      const nameInput = await this.view.askInline(
        `Alias for @${p.alias} [${p.alias}]: `,
      );
      const name = nameInput || p.alias;
      const folderName = name.toLowerCase().replace(/[^a-z0-9_-]/g, "");

      await scaffoldFromPersona(teammatesDir, folderName, p);
      created.push(folderName);
      this.view.feedLine(
        concat(tp.success(`  ✔  @${folderName}`), tp.muted(` — ${p.persona}`)),
      );
    }

    this.view.feedLine(
      concat(
        tp.success(
          `\n  ✔  Created ${created.length} teammate${created.length > 1 ? "s" : ""}: `,
        ),
        tp.text(created.map((n) => `@${n}`).join(", ")),
      ),
    );
    this.view.refreshView();
  }

  /**
   * Run the onboarding agent to analyze the codebase and create teammates.
   * Used by both promptOnboarding (pre-orchestrator) and cmdInit (post-orchestrator).
   */
  async runOnboardingAgent(
    adapter: AgentAdapter,
    projectDir: string,
    adapterName: string,
    printAgentOutput: (raw: string | undefined) => void,
  ): Promise<void> {
    console.log();
    console.log(
      chalk.blue("  Starting onboarding...") +
        chalk.gray(
          " Your agent will analyze your codebase and create .teammates/",
        ),
    );
    console.log();

    // Copy framework files from bundled template
    const teammatesDir = join(projectDir, ".teammates");
    const copied = await copyTemplateFiles(teammatesDir);
    if (copied.length > 0) {
      console.log(
        chalk.green("  ✔ ") +
          chalk.gray(` Copied template files: ${copied.join(", ")}`),
      );
      console.log();
    }

    const onboardingPrompt = await getOnboardingPrompt(projectDir);
    const tempConfig = {
      name: adapterName,
      type: "ai" as const,
      role: "Onboarding agent",
      soul: "",
      goals: "",
      wisdom: "",
      dailyLogs: [] as { date: string; content: string }[],
      weeklyLogs: [] as { week: string; content: string }[],
      ownership: { primary: [] as string[], secondary: [] as string[] },
      routingKeywords: [] as string[],
      cwd: projectDir,
    };

    const sessionId = await adapter.startSession(tempConfig);
    const spinner = ora({
      text: chalk.gray("Analyzing your codebase..."),
      spinner: "dots",
    }).start();

    try {
      const result = await adapter.executeTask(
        sessionId,
        tempConfig,
        onboardingPrompt,
      );
      spinner.stop();
      printAgentOutput(result.rawOutput);

      if (result.success) {
        console.log(chalk.green("  ✔  Onboarding complete!"));
      } else {
        console.log(
          chalk.yellow(
            `  ⚠ Onboarding finished with issues: ${result.summary}`,
          ),
        );
      }
    } catch (err: any) {
      spinner.fail(chalk.red(`Onboarding failed: ${err.message}`));
    }

    if (adapter.destroySession) {
      await adapter.destroySession(sessionId);
    }

    // Verify .teammates/ now has content
    try {
      const entries = await readdir(teammatesDir);
      if (!entries.some((e) => !e.startsWith("."))) {
        console.log(
          chalk.yellow("  ⚠ .teammates/ was created but appears empty."),
        );
        console.log(
          chalk.gray(
            "  You may need to run the onboarding agent again or set up manually.",
          ),
        );
      }
    } catch {
      /* dir might not exist if onboarding failed badly */
    }
    console.log();
  }

  /**
   * Import teammates from another project's .teammates/ directory.
   * Prompts for a path, copies teammate folders + framework files,
   * then optionally runs the agent to adapt ownership for this codebase.
   */
  async runImport(
    projectDir: string,
    adapter: AgentAdapter,
    printAgentOutput: (raw: string | undefined) => void,
  ): Promise<void> {
    console.log();
    console.log(
      chalk.white("  Enter the path to another project") +
        chalk.gray(" (the project root or its .teammates/ directory):"),
    );
    console.log();

    const rawPath = await this.askInput("Path: ");
    if (!rawPath) {
      console.log(chalk.yellow("  No path provided. Aborting import."));
      return;
    }

    // Resolve the source — accept either project root or .teammates/ directly
    const resolved = resolve(rawPath);
    let sourceDir: string;
    try {
      const s = await stat(join(resolved, ".teammates"));
      if (s.isDirectory()) {
        sourceDir = join(resolved, ".teammates");
      } else {
        sourceDir = resolved;
      }
    } catch {
      sourceDir = resolved;
    }

    const teammatesDir = join(projectDir, ".teammates");
    console.log();

    try {
      const { teammates, skipped, files } = await importTeammates(
        sourceDir,
        teammatesDir,
      );

      const allTeammates = [...teammates, ...skipped];

      if (allTeammates.length === 0) {
        console.log(
          chalk.yellow("  No teammates found at ") + chalk.white(sourceDir),
        );
        console.log(
          chalk.gray(
            "  The directory should contain teammate folders (each with a SOUL.md).",
          ),
        );
        return;
      }

      if (teammates.length > 0) {
        console.log(
          chalk.green("  ✔ ") +
            chalk.white(
              ` Imported ${teammates.length} teammate${teammates.length > 1 ? "s" : ""}: `,
            ) +
            chalk.cyan(teammates.join(", ")),
        );
        console.log(chalk.gray(`    (${files.length} files copied)`));
      }
      if (skipped.length > 0) {
        console.log(
          chalk.gray(
            `  ${skipped.length} already present: ${skipped.join(", ")} (will re-adapt)`,
          ),
        );
      }
      console.log();

      // Copy framework files so the agent has TEMPLATE.md etc. available
      await copyTemplateFiles(teammatesDir);

      // Ask if user wants the agent to adapt teammates to this codebase
      console.log(chalk.white("  Adapt teammates to this codebase?"));
      console.log(
        chalk.gray(
          "  The agent will scan this project, evaluate which teammates are needed,",
        ),
      );
      console.log(
        chalk.gray(
          "  adapt their files, and create any new teammates the project needs.",
        ),
      );
      console.log(chalk.gray("  You can also do this later with /add."));
      console.log();

      const adapt = await this.askChoice("Adapt now? (y/n): ", ["y", "n"]);

      if (adapt === "y") {
        await this.runAdaptationAgent(
          adapter,
          projectDir,
          allTeammates,
          sourceDir,
          printAgentOutput,
        );
      } else {
        console.log(
          chalk.gray("  Skipped adaptation. Run /add to adapt later."),
        );
      }
    } catch (err: any) {
      console.log(chalk.red(`  Import failed: ${err.message}`));
    }
    console.log();
  }

  /**
   * Run the agent to adapt imported teammates to the current codebase.
   */
  private async runAdaptationAgent(
    adapter: AgentAdapter,
    projectDir: string,
    teammateNames: string[],
    sourceProjectPath: string,
    printAgentOutput: (raw: string | undefined) => void,
  ): Promise<void> {
    const teammatesDir = join(projectDir, ".teammates");
    console.log();
    console.log(
      chalk.blue("  Starting adaptation...") +
        chalk.gray(" Your agent will scan this project and adapt the team"),
    );
    console.log();

    const prompt = await buildImportAdaptationPrompt(
      teammatesDir,
      teammateNames,
      sourceProjectPath,
    );
    const tempConfig = {
      name: this.view.adapterName,
      type: "ai" as const,
      role: "Adaptation agent",
      soul: "",
      goals: "",
      wisdom: "",
      dailyLogs: [] as { date: string; content: string }[],
      weeklyLogs: [] as { week: string; content: string }[],
      ownership: { primary: [] as string[], secondary: [] as string[] },
      routingKeywords: [] as string[],
      cwd: projectDir,
    };

    const sessionId = await adapter.startSession(tempConfig);
    const spinner = ora({
      text: chalk.gray("Scanning the project and adapting teammates..."),
      spinner: "dots",
    }).start();

    try {
      const result = await adapter.executeTask(sessionId, tempConfig, prompt);
      spinner.stop();
      printAgentOutput(result.rawOutput);

      if (result.success) {
        console.log(chalk.green("  ✔  Team adaptation complete!"));
      } else {
        console.log(
          chalk.yellow(
            `  ⚠ Adaptation finished with issues: ${result.summary}`,
          ),
        );
      }
    } catch (err: any) {
      spinner.fail(chalk.red(`Adaptation failed: ${err.message}`));
    }

    if (adapter.destroySession) {
      await adapter.destroySession(sessionId);
    }

    console.log();
  }

  /**
   * Register the user's avatar as a teammate in the orchestrator.
   * Sets presence to "online" since the local user is always online.
   */
  registerUserAvatar(
    teammatesDir: string,
    alias: string,
    orchestrator: {
      getRegistry(): {
        register(config: any): void;
        get(name: string): any;
      };
      getAllStatuses(): Map<string, { state: string; presence: string }>;
    },
  ): void {
    const registry = orchestrator.getRegistry();
    const avatarDir = join(teammatesDir, alias);

    // Read the avatar's SOUL.md if it exists
    let soul = "";
    let role = "I'm a human working on this project";
    try {
      soul = readFileSync(join(avatarDir, "SOUL.md"), "utf-8");
      const roleMatch = soul.match(/\*\*Role:\*\*\s*(.+)/);
      if (roleMatch) role = roleMatch[1].trim();
    } catch {
      /* avatar folder may not exist yet */
    }

    let wisdom = "";
    try {
      wisdom = readFileSync(join(avatarDir, "WISDOM.md"), "utf-8");
    } catch {
      /* ok */
    }

    let goals = "";
    try {
      goals = readFileSync(join(avatarDir, "GOALS.md"), "utf-8");
    } catch {
      /* ok */
    }

    registry.register({
      name: alias,
      type: "human",
      role,
      soul,
      goals,
      wisdom,
      dailyLogs: [],
      weeklyLogs: [],
      ownership: { primary: [], secondary: [] },
      routingKeywords: [],
    });

    // Set presence to online (local user is always online)
    orchestrator
      .getAllStatuses()
      .set(alias, { state: "idle", presence: "online" });
  }

  // ── Display helpers ──────────────────────────────────────────────

  /**
   * Render the box logo with up to 4 info lines on the right side.
   */
  printLogo(infoLines: string[]): void {
    const [top, bot] = buildTitle("teammates");
    console.log(`  ${chalk.cyan(top)}`);
    console.log(`  ${chalk.cyan(bot)}`);
    if (infoLines.length > 0) {
      console.log();
      for (const line of infoLines) {
        console.log(`  ${line}`);
      }
    }
  }

  /**
   * Print agent raw output, stripping the trailing JSON protocol block.
   */
  printAgentOutput(rawOutput: string | undefined): void {
    const raw = rawOutput ?? "";
    if (!raw) return;
    const cleaned = raw
      .replace(/```json\s*\n\s*\{[\s\S]*?\}\s*\n\s*```\s*$/, "")
      .trim();
    if (cleaned) {
      this.view.feedMarkdown(cleaned);
    }
    this.view.feedLine();
  }
}
