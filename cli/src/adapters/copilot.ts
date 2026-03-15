/**
 * GitHub Copilot SDK adapter — uses the @github/copilot-sdk to run tasks
 * through GitHub Copilot's agentic coding engine.
 *
 * Unlike the CLI proxy adapter (which spawns subprocesses), this adapter
 * communicates with Copilot via the SDK's JSON-RPC protocol, giving us:
 *   - Structured event streaming (no stdout scraping)
 *   - Session persistence via Copilot's infinite sessions
 *   - Direct tool/permission control
 *   - Access to Copilot's built-in coding tools (file ops, git, bash, etc.)
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CopilotClient,
  type CopilotSession,
  approveAll,
  type SessionEvent,
} from "@github/copilot-sdk";
import type {
  AgentAdapter,
  InstalledService,
  RosterEntry,
} from "../adapter.js";
import { buildTeammatePrompt } from "../adapter.js";
import type { TaskResult, TeammateConfig } from "../types.js";
import { parseResult } from "./cli-proxy.js";

// ─── Options ─────────────────────────────────────────────────────────

export interface CopilotAdapterOptions {
  /** Model override (e.g. "gpt-4o", "claude-sonnet-4-5") */
  model?: string;
  /** Timeout in ms for sendAndWait (default: 600_000 = 10 min) */
  timeout?: number;
  /** GitHub token for authentication (falls back to env/logged-in user) */
  githubToken?: string;
  /** Custom provider config for BYOK mode */
  provider?: {
    type?: "openai" | "azure" | "anthropic";
    baseUrl: string;
    apiKey?: string;
  };
}

// ─── Adapter ─────────────────────────────────────────────────────────

let nextId = 1;

export class CopilotAdapter implements AgentAdapter {
  readonly name = "copilot";

  /** Team roster — set by the orchestrator so prompts include teammate info. */
  public roster: RosterEntry[] = [];
  /** Installed services — set by the CLI so prompts include service info. */
  public services: InstalledService[] = [];

  private options: CopilotAdapterOptions;
  private client: CopilotClient | null = null;
  private sessions: Map<string, CopilotSession> = new Map();
  /** Session files per teammate — persists state across task invocations. */
  private sessionFiles: Map<string, string> = new Map();
  /** Base directory for session files. */
  private sessionsDir = "";

  constructor(options: CopilotAdapterOptions = {}) {
    this.options = options;
  }

  async startSession(teammate: TeammateConfig): Promise<string> {
    const id = `copilot-${teammate.name}-${nextId++}`;

    // Ensure the client is running
    await this.ensureClient(teammate.cwd);

    // Create session file inside .teammates/.tmp so the agent can access it
    if (!this.sessionsDir) {
      const tmpBase = join(
        teammate.cwd ?? process.cwd(),
        ".teammates",
        ".tmp",
      );
      this.sessionsDir = join(tmpBase, "sessions");
      await mkdir(this.sessionsDir, { recursive: true });
      const gitignorePath = join(tmpBase, "..", ".gitignore");
      const existing = await readFile(gitignorePath, "utf-8").catch(() => "");
      if (!existing.includes(".tmp/")) {
        await writeFile(
          gitignorePath,
          existing +
            (existing.endsWith("\n") || !existing ? "" : "\n") +
            ".tmp/\n",
        ).catch(() => {});
      }
    }
    const sessionFile = join(this.sessionsDir, `${teammate.name}.md`);
    await writeFile(sessionFile, `# Session — ${teammate.name}\n\n`, "utf-8");
    this.sessionFiles.set(teammate.name, sessionFile);

    return id;
  }

  async executeTask(
    _sessionId: string,
    teammate: TeammateConfig,
    prompt: string,
  ): Promise<TaskResult> {
    await this.ensureClient(teammate.cwd);

    const sessionFile = this.sessionFiles.get(teammate.name);

    // Build the full teammate prompt (identity + memory + task)
    let fullPrompt: string;
    if (teammate.soul) {
      fullPrompt = buildTeammatePrompt(teammate, prompt, {
        roster: this.roster,
        services: this.services,
        sessionFile,
      });
    } else {
      // Raw agent mode — minimal wrapping
      const parts = [prompt];
      const others = this.roster.filter((r) => r.name !== teammate.name);
      if (others.length > 0) {
        parts.push("\n\n---\n");
        parts.push(
          "If part of this task belongs to a specialist, you can hand it off.",
        );
        parts.push("Your teammates:");
        for (const t of others) {
          const owns =
            t.ownership.primary.length > 0
              ? ` — owns: ${t.ownership.primary.join(", ")}`
              : "";
          parts.push(`- @${t.name}: ${t.role}${owns}`);
        }
        parts.push(
          "\nTo hand off, include a fenced handoff block in your response:",
        );
        parts.push("```handoff\n@<teammate>\n<task details>\n```");
      }
      fullPrompt = parts.join("\n");
    }

    // Create a Copilot session with the teammate prompt as the system message
    const session = await this.client!.createSession({
      model: this.options.model,
      systemMessage: {
        mode: "replace",
        content: fullPrompt,
      },
      onPermissionRequest: approveAll,
      provider: this.options.provider
        ? {
            type: this.options.provider.type ?? "openai",
            baseUrl: this.options.provider.baseUrl,
            apiKey: this.options.provider.apiKey,
          }
        : undefined,
      workingDirectory: teammate.cwd ?? process.cwd(),
    });

    // Collect the assistant's response silently — the CLI handles rendering.
    // We do NOT write to stdout here; that would corrupt the consolonia UI.
    const outputParts: string[] = [];

    session.on("assistant.message_delta" as SessionEvent["type"], (event) => {
      const delta = (event as { data: { deltaContent?: string } }).data
        ?.deltaContent;
      if (delta) {
        outputParts.push(delta);
      }
    });

    try {
      const timeout = this.options.timeout ?? 600_000;
      const reply = await session.sendAndWait({ prompt }, timeout);

      // Use the final assistant message content, fall back to collected deltas
      const output =
        (reply?.data as { content?: string })?.content ??
        outputParts.join("");

      const teammateNames = this.roster.map((r) => r.name);
      return parseResult(teammate.name, output, teammateNames, prompt);
    } finally {
      // Disconnect the session (preserves data for potential resume)
      await session.disconnect().catch(() => {});
    }
  }

  async routeTask(
    task: string,
    roster: RosterEntry[],
  ): Promise<string | null> {
    await this.ensureClient();

    const lines = [
      "You are a task router. Given a task and a list of teammates, reply with ONLY the name of the teammate who should handle it. No explanation, no punctuation — just the name.",
      "",
      "Teammates:",
    ];
    for (const t of roster) {
      const owns =
        t.ownership.primary.length > 0
          ? ` — owns: ${t.ownership.primary.join(", ")}`
          : "";
      lines.push(`- ${t.name}: ${t.role}${owns}`);
    }
    lines.push("", `Task: ${task}`);

    const session = await this.client!.createSession({
      model: this.options.model,
      onPermissionRequest: approveAll,
      systemMessage: {
        mode: "replace",
        content: lines.join("\n"),
      },
    });

    try {
      const reply = await session.sendAndWait(
        { prompt: task },
        30_000,
      );

      const output =
        (reply?.data as { content?: string })?.content?.trim().toLowerCase() ??
        "";

      // Match against roster names
      const rosterNames = roster.map((r) => r.name);
      for (const name of rosterNames) {
        if (output === name.toLowerCase() || output.endsWith(name.toLowerCase())) {
          return name;
        }
      }
      for (const name of rosterNames) {
        if (output.includes(name.toLowerCase())) {
          return name;
        }
      }
      return null;
    } catch {
      return null;
    } finally {
      await session.disconnect().catch(() => {});
    }
  }

  async destroySession(_sessionId: string): Promise<void> {
    // Disconnect all sessions
    for (const [, session] of this.sessions) {
      await session.disconnect().catch(() => {});
    }
    this.sessions.clear();

    // Stop the client
    if (this.client) {
      await this.client.stop().catch(() => {});
      this.client = null;
    }
  }

  /**
   * Ensure the CopilotClient is started.
   */
  private async ensureClient(cwd?: string): Promise<void> {
    if (this.client) return;

    // Suppress Node.js ExperimentalWarning (e.g. SQLite) in the SDK's
    // CLI subprocess so it doesn't leak into the terminal UI.
    const env = { ...process.env };
    const existing = env.NODE_OPTIONS ?? "";
    if (!existing.includes("--disable-warning=ExperimentalWarning")) {
      env.NODE_OPTIONS = existing
        ? `${existing} --disable-warning=ExperimentalWarning`
        : "--disable-warning=ExperimentalWarning";
    }

    this.client = new CopilotClient({
      cwd: cwd ?? process.cwd(),
      githubToken: this.options.githubToken,
      env,
    });

    await this.client.start();
  }
}
