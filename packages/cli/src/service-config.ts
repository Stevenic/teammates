/**
 * Service detection and /configure command logic.
 */

import { execSync } from "node:child_process";
import { type ChatView, concat, type StyledSpan } from "@teammates/consolonia";
import type { AnimatedBanner, ServiceInfo, ServiceStatus } from "./banner.js";
import { tp } from "./theme.js";

export interface ServiceView {
  chatView: ChatView;
  feedLine(text?: string | StyledSpan): void;
  feedCommand(command: string): void;
  refreshView(): void;
  askInline(prompt: string): Promise<string>;
  banner: AnimatedBanner | null;
}

export const CONFIGURABLE_SERVICES = ["github"];

export function detectGitHub(): ServiceStatus {
  try {
    execSync("gh --version", { stdio: "pipe" });
  } catch {
    return "missing";
  }
  try {
    execSync("gh auth status", { stdio: "pipe" });
    return "configured";
  } catch {
    return "not-configured";
  }
}

export function detectServices(): ServiceInfo[] {
  return [
    { name: "recall", status: "bundled" },
    { name: "GitHub", status: detectGitHub() },
  ];
}

export function updateServiceStatus(
  serviceStatuses: ServiceInfo[],
  name: string,
  status: ServiceStatus,
  view: ServiceView,
): void {
  const svc = serviceStatuses.find((s) => s.name === name);
  if (svc) {
    svc.status = status;
    if (view.banner) {
      view.banner.updateServices(serviceStatuses);
      view.refreshView();
    }
  }
}

export async function cmdConfigure(
  argsStr: string,
  serviceStatuses: ServiceInfo[],
  view: ServiceView,
): Promise<void> {
  const serviceName = argsStr.trim().toLowerCase();

  if (!serviceName) {
    view.feedLine();
    view.feedLine(tp.bold("  Services:"));
    for (const svc of serviceStatuses) {
      const ok = svc.status === "bundled" || svc.status === "configured";
      const icon = ok ? "● " : svc.status === "not-configured" ? "◐ " : "○ ";
      const color = ok ? tp.success : tp.warning;
      const label =
        svc.status === "bundled"
          ? "bundled"
          : svc.status === "configured"
            ? "configured"
            : svc.status === "not-configured"
              ? "not configured"
              : "missing";
      view.feedLine(
        concat(
          tp.text("    "),
          color(icon),
          color(svc.name.padEnd(12)),
          tp.muted(label),
        ),
      );
    }
    view.feedLine();
    view.feedLine(tp.muted("  Use /configure [service] to set up a service"));
    view.feedLine();
    view.refreshView();
    return;
  }

  if (serviceName === "github") {
    await configureGitHub(serviceStatuses, view);
  } else {
    view.feedLine(tp.warning(`  Unknown service: ${serviceName}`));
    view.feedLine(tp.muted(`  Available: ${CONFIGURABLE_SERVICES.join(", ")}`));
    view.refreshView();
  }
}

async function configureGitHub(
  serviceStatuses: ServiceInfo[],
  view: ServiceView,
): Promise<void> {
  let ghInstalled = false;
  try {
    execSync("gh --version", { stdio: "pipe" });
    ghInstalled = true;
  } catch {
    // not installed
  }

  if (!ghInstalled) {
    view.feedLine();
    view.feedLine(tp.warning("  GitHub CLI is not installed."));
    view.feedLine();

    const plat = process.platform;
    view.feedLine(tp.text("  Run this in another terminal:"));
    if (plat === "win32") {
      view.feedCommand("winget install --id GitHub.cli");
    } else if (plat === "darwin") {
      view.feedCommand("brew install gh");
    } else {
      view.feedCommand("sudo apt install gh");
      view.feedLine(tp.muted("    (or see https://cli.github.com)"));
    }

    view.feedLine();
    const answer = await view.askInline("Press Enter when done (or n to skip)");
    if (answer.toLowerCase() === "n") {
      view.feedLine(tp.muted("  Skipped. Run /configure github when ready."));
      view.refreshView();
      return;
    }

    try {
      execSync("gh --version", { stdio: "pipe" });
      ghInstalled = true;
      view.feedLine(tp.success("  ✓ GitHub CLI installed"));
    } catch {
      view.feedLine(
        tp.error(
          "  GitHub CLI still not found. You may need to restart your terminal.",
        ),
      );
      view.refreshView();
      return;
    }
  } else {
    view.feedLine();
    view.feedLine(tp.success("  ✓ GitHub CLI installed"));
  }

  let authed = false;
  try {
    execSync("gh auth status", { stdio: "pipe" });
    authed = true;
  } catch {
    // not authenticated
  }

  if (!authed) {
    view.feedLine();
    view.feedLine(tp.text("  Run this in another terminal to authenticate:"));
    view.feedCommand("gh auth login --web --git-protocol https");
    view.feedLine();
    view.feedLine(tp.muted("  This will open your browser for GitHub OAuth."));
    view.feedLine();

    const answer = await view.askInline("Press Enter when done (or n to skip)");
    if (answer.toLowerCase() === "n") {
      view.feedLine(tp.muted("  Skipped. Run /configure github when ready."));
      view.refreshView();
      updateServiceStatus(serviceStatuses, "GitHub", "not-configured", view);
      return;
    }

    try {
      execSync("gh auth status", { stdio: "pipe" });
      authed = true;
    } catch {
      view.feedLine(
        tp.error(
          "  Authentication could not be verified. Try again with /configure github",
        ),
      );
      view.refreshView();
      updateServiceStatus(serviceStatuses, "GitHub", "not-configured", view);
      return;
    }
  }

  let username = "";
  try {
    username = execSync("gh api user --jq .login", {
      stdio: "pipe",
      encoding: "utf-8",
    }).trim();
  } catch {
    // non-critical
  }

  view.feedLine(
    tp.success(
      `  ✓ GitHub configured${username ? ` — authenticated as @${username}` : ""}`,
    ),
  );
  view.feedLine();
  view.refreshView();
  updateServiceStatus(serviceStatuses, "GitHub", "configured", view);
}
