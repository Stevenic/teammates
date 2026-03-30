/**
 * Wordwheel/autocomplete system — handles command, @mention, and #thread completion.
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";
import {
  type ChatView,
  type DropdownItem,
  stripAnsi,
} from "@teammates/consolonia";
import chalk from "chalk";
import { findAtMention } from "./cli-utils.js";
import type { PromptInput } from "./console/prompt-input.js";
import type { SlashCommand, TaskThread } from "./types.js";

export interface WordwheelView {
  chatView: ChatView;
  input: PromptInput;
  commands: Map<string, SlashCommand>;
  listTeammates(): string[];
  getTeammateRole(name: string): string;
  selfName: string;
  adapterName: string;
  userAlias: string | null;
  teammatesDir: string;
  threads: Map<number, TaskThread>;
  refreshView(): void;
}

/**
 * Which argument positions are teammate-name completable per command.
 * Key = command name, value = set of 0-based arg positions that take a teammate.
 */
const TEAMMATE_ARG_POSITIONS: Record<string, Set<number>> = {
  assign: new Set([0]),
  handoff: new Set([0, 1]),
  compact: new Set([0]),
  debug: new Set([0]),
  retro: new Set([0]),
  cancel: new Set([1]),
  interrupt: new Set([1]),
  int: new Set([1]),
};

const CONFIGURABLE_SERVICES = ["github"];

export class Wordwheel {
  items: DropdownItem[] = [];
  index = -1; // -1 = no selection, 0+ = highlighted row

  private view: WordwheelView;

  constructor(view: WordwheelView) {
    this.view = view;
  }

  /** Get unique commands (de-duplicated from alias map). */
  private getUniqueCommands(): SlashCommand[] {
    const seen = new Set<string>();
    const result: SlashCommand[] = [];
    for (const [, cmd] of this.view.commands) {
      if (seen.has(cmd.name)) continue;
      seen.add(cmd.name);
      result.push(cmd);
    }
    return result;
  }

  /** Clear the wordwheel display. */
  clear(): void {
    if (this.view.chatView) {
      this.view.chatView.hideDropdown();
    } else {
      this.view.input.clearDropdown();
    }
  }

  /** Write static hint lines to the wordwheel. */
  private writeLines(lines: string[]): void {
    if (this.view.chatView) {
      this.view.chatView.showDropdown(
        lines.map((l) => ({
          label: stripAnsi(l).trim(),
          description: "",
          completion: "",
        })),
      );
      this.view.refreshView();
    } else {
      this.view.input.setDropdown(lines);
    }
  }

  /** Build param-completion items for the current line, if any. */
  private getParamItems(
    cmdName: string,
    argsBefore: string,
    partial: string,
  ): DropdownItem[] {
    // Script subcommand + name completion for /script
    if (cmdName === "script") {
      const completedArgs = argsBefore.trim()
        ? argsBefore.trim().split(/\s+/).length
        : 0;
      const lower = partial.toLowerCase();

      if (completedArgs === 0) {
        const subs = [
          { name: "list", desc: "List saved scripts" },
          { name: "run", desc: "Run an existing script" },
        ];
        return subs
          .filter((s) => s.name.startsWith(lower))
          .map((s) => ({
            label: s.name,
            description: s.desc,
            completion: `/script ${s.name} `,
          }));
      }

      if (completedArgs === 1 && argsBefore.trim() === "run") {
        const scriptsDir = join(
          this.view.teammatesDir,
          this.view.selfName,
          "scripts",
        );
        let files: string[] = [];
        try {
          files = readdirSync(scriptsDir).filter((f) => !f.startsWith("."));
        } catch {
          // directory doesn't exist yet
        }
        return files
          .filter((f) => f.toLowerCase().startsWith(lower))
          .map((f) => ({
            label: f,
            description: "saved script",
            completion: `/script run ${f}`,
          }));
      }

      return [];
    }

    // Service name completion for /configure
    if (cmdName === "configure" || cmdName === "config") {
      const completedArgs = argsBefore.trim()
        ? argsBefore.trim().split(/\s+/).length
        : 0;
      if (completedArgs > 0) return [];
      const lower = partial.toLowerCase();
      return CONFIGURABLE_SERVICES.filter((s) => s.startsWith(lower)).map(
        (s) => ({
          label: s,
          description: `configure ${s}`,
          completion: `/${cmdName} ${s} `,
        }),
      );
    }

    const positions = TEAMMATE_ARG_POSITIONS[cmdName];
    if (!positions) return [];

    const completedArgs = argsBefore.trim()
      ? argsBefore.trim().split(/\s+/).length
      : 0;
    if (!positions.has(completedArgs)) return [];

    const teammates = this.view.listTeammates();
    const lower = partial.toLowerCase();
    const items: DropdownItem[] = [];

    if (completedArgs === 0 && "everyone".startsWith(lower)) {
      const linePrefix = `/${cmdName} ${argsBefore ? argsBefore : ""}`;
      items.push({
        label: "everyone",
        description: "all teammates",
        completion: `${linePrefix}everyone `,
      });
    }

    for (const name of teammates) {
      if (!name.toLowerCase().startsWith(lower)) continue;
      const linePrefix = `/${cmdName} ${argsBefore ? argsBefore : ""}`;
      items.push({
        label: name,
        description: this.view.getTeammateRole(name),
        completion: `${linePrefix + name} `,
      });
    }
    return items;
  }

  /**
   * Return dim placeholder hint text for the current input value.
   */
  getCommandHint(value: string): string | null {
    const trimmed = value.trimStart();
    if (!trimmed.startsWith("/")) return null;

    const spaceIdx = trimmed.indexOf(" ");
    const cmdName =
      spaceIdx < 0 ? trimmed.slice(1) : trimmed.slice(1, spaceIdx);
    const cmd = this.view.commands.get(cmdName);
    if (!cmd) return null;

    const usageParts = cmd.usage.split(/\s+/).slice(1);
    if (usageParts.length === 0) return null;

    const afterCmd = spaceIdx < 0 ? "" : trimmed.slice(spaceIdx + 1);
    const typedArgs = afterCmd
      .trim()
      .split(/\s+/)
      .filter((s) => s.length > 0);

    const remaining = usageParts.slice(typedArgs.length);
    if (remaining.length === 0) return null;

    const pad = value.endsWith(" ") ? "" : " ";
    return pad + remaining.join(" ");
  }

  /** Build @mention teammate completion items. */
  private getAtMentionItems(
    line: string,
    before: string,
    partial: string,
    atPos: number,
  ): DropdownItem[] {
    const teammates = this.view.listTeammates();
    const lower = partial.toLowerCase();
    const after = line.slice(atPos + 1 + partial.length);
    const items: DropdownItem[] = [];

    if ("everyone".startsWith(lower)) {
      items.push({
        label: "@everyone",
        description: "Send to all teammates",
        completion: `${before}@everyone ${after.replace(/^\s+/, "")}`,
      });
    }

    for (const name of teammates) {
      const display =
        name === this.view.userAlias ? this.view.adapterName : name;
      if (display.toLowerCase().startsWith(lower)) {
        items.push({
          label: `@${display}`,
          description: this.view.getTeammateRole(name),
          completion: `${before}@${display} ${after.replace(/^\s+/, "")}`,
        });
      }
    }
    return items;
  }

  /** Recompute matches and draw the wordwheel. */
  update(): void {
    this.clear();
    const line: string = this.view.chatView
      ? this.view.chatView.inputValue
      : this.view.input.line;
    const cursor: number = this.view.chatView
      ? this.view.chatView.inputValue.length
      : this.view.input.cursor;

    // @mention anywhere in the line
    const mention = findAtMention(line, cursor);
    if (mention) {
      this.items = this.getAtMentionItems(
        line,
        mention.before,
        mention.partial,
        mention.atPos,
      );
      if (this.items.length > 0) {
        if (this.index >= this.items.length) {
          this.index = this.items.length - 1;
        }
        this.render();
        return;
      }
    }

    // #thread completion
    const hashMatch = line.match(/^#(\d*)$/);
    if (hashMatch && this.view.threads.size > 0) {
      const partial = hashMatch[1];
      const threadItems: DropdownItem[] = [];
      for (const [id, thread] of this.view.threads) {
        const idStr = String(id);
        if (partial && !idStr.startsWith(partial)) continue;
        const origin =
          thread.originMessage.length > 50
            ? `${thread.originMessage.slice(0, 47)}…`
            : thread.originMessage;
        threadItems.push({
          label: `#${id}`,
          description: origin,
          completion: `#${id} `,
        });
      }
      if (threadItems.length > 0) {
        this.items = threadItems;
        if (this.index >= threadItems.length) {
          this.index = threadItems.length - 1;
        }
        this.render();
        return;
      }
    }

    // /command completion
    if (!line.startsWith("/") || line.length < 2) {
      this.items = [];
      this.index = -1;
      return;
    }

    const spaceIdx = line.indexOf(" ");

    if (spaceIdx > 0) {
      const cmdName = line.slice(1, spaceIdx);
      const cmd = this.view.commands.get(cmdName);
      if (!cmd) {
        this.items = [];
        this.index = -1;
        return;
      }

      const afterCmd = line.slice(spaceIdx + 1);
      const lastSpace = afterCmd.lastIndexOf(" ");
      const argsBefore = lastSpace >= 0 ? afterCmd.slice(0, lastSpace + 1) : "";
      const partial = lastSpace >= 0 ? afterCmd.slice(lastSpace + 1) : afterCmd;

      this.items = this.getParamItems(cmdName, argsBefore, partial);

      if (this.items.length > 0) {
        if (this.index >= this.items.length) {
          this.index = this.items.length - 1;
        }
        this.render();
      } else {
        this.items = [];
        this.index = -1;
      }
      return;
    }

    // Partial command — find matching commands
    const partial = line.slice(1).toLowerCase();
    this.items = this.getUniqueCommands()
      .filter(
        (c) =>
          c.name.startsWith(partial) ||
          c.aliases.some((a) => a.startsWith(partial)),
      )
      .map((c) => {
        const hasParams = /^\/\S+\s+.+$/.test(c.usage);
        return {
          label: `/${c.name}`,
          description: c.description,
          completion: hasParams ? `/${c.name} ` : `/${c.name}`,
        };
      });

    if (this.items.length === 0) {
      this.index = -1;
      return;
    }

    if (this.index >= this.items.length) {
      this.index = this.items.length - 1;
    }

    this.render();
  }

  /** Render the current items list with selection highlight. */
  render(): void {
    if (this.view.chatView) {
      this.view.chatView.showDropdown(this.items);
      if (this.index >= 0) {
        while (this.view.chatView.dropdownIndex < this.index)
          this.view.chatView.dropdownDown();
        while (this.view.chatView.dropdownIndex > this.index)
          this.view.chatView.dropdownUp();
      }
      this.view.refreshView();
    } else {
      this.writeLines(
        this.items.map((item, i) => {
          const prefix = i === this.index ? chalk.cyan("▸ ") : "  ";
          const label = item.label.padEnd(14);
          if (i === this.index) {
            return (
              prefix +
              chalk.cyanBright.bold(label) +
              " " +
              chalk.white(item.description)
            );
          }
          return `${prefix + chalk.cyan(label)} ${chalk.gray(item.description)}`;
        }),
      );
    }
  }

  /** Accept the currently highlighted item into the input line. */
  acceptSelection(): void {
    const item = this.items[this.index];
    if (!item) return;
    this.clear();
    if (this.view.chatView) {
      this.view.chatView.inputValue = item.completion;
    } else {
      this.view.input.setLine(item.completion);
    }
    this.items = [];
    this.index = -1;
    // Re-render for next param or usage hint
    this.update();
  }

  /** Reset all state. */
  reset(): void {
    this.items = [];
    this.index = -1;
  }
}
