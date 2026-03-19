/**
 * Animated startup banner for @teammates/cli.
 */

import {
  type Constraint,
  Control,
  concat,
  type DrawingContext,
  type Rect,
  type Size,
  type StyledLine,
  StyledText,
} from "@teammates/consolonia";
import { PKG_VERSION } from "./cli-args.js";
import { buildTitle } from "./console/startup.js";
import { tp } from "./theme.js";
import type { PresenceState } from "./types.js";

// ─── Types ───────────────────────────────────────────────────────────

export type ServiceStatus = "bundled" | "missing" | "not-configured" | "configured";

export interface ServiceInfo {
  name: string;
  status: ServiceStatus;
}

export interface BannerInfo {
  /** Display name shown in the banner (user alias or adapter name). */
  displayName: string;
  teammateCount: number;
  cwd: string;
  teammates: { name: string; role: string; presence: PresenceState }[];
  services: ServiceInfo[];
}

// ─── Animated banner widget ─────────────────────────────────────────

/**
 * Custom banner widget that plays a reveal animation inside the
 * consolonia rendering loop (alternate screen already active).
 *
 * Phases:
 *  1. Reveal "teammates" letter by letter in block font
 *  2. Collapse to "TM" + stats panel
 *  3. Fade in teammate roster
 *  4. Fade in command reference
 */
export class AnimatedBanner extends Control {
  private _lines: StyledLine[] = [];
  private _info: BannerInfo;
  private _phase:
    | "idle"
    | "spelling"
    | "version"
    | "pause"
    | "compact"
    | "roster"
    | "roster-held"
    | "commands"
    | "done" = "idle";
  private _inner: StyledText;
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _onDirty: (() => void) | null = null;

  // Spelling state
  private _word = "teammates";
  private _charIndex = 0;
  private _builtTop = "";
  private _builtBot = "";
  private _versionStr = ` v${PKG_VERSION}`;
  private _versionIndex = 0;

  // Roster/command reveal state
  private _revealIndex = 0;

  /** When true, the animation pauses after roster reveal (before commands). */
  private _held = false;

  // The final lines (built once, revealed progressively)
  private _finalLines: StyledLine[] = [];

  // Line index where roster starts and commands start
  private _rosterStart = 0;
  private _commandsStart = 0;

  private static GLYPHS: Record<string, [string, string]> = {
    t: ["▀█▀", " █ "],
    e: ["█▀▀", "██▄"],
    a: ["▄▀█", "█▀█"],
    m: ["█▀▄▀█", "█ ▀ █"],
    s: ["█▀", "▄█"],
  };

  constructor(info: BannerInfo) {
    super();
    this._info = info;
    this._inner = new StyledText({ lines: [], wrap: true });
    this.addChild(this._inner);
    this._buildFinalLines();
  }

  /** Set a callback that fires when the banner needs a re-render. */
  set onDirty(fn: () => void) {
    this._onDirty = fn;
  }

  /** Start the animation sequence. */
  start(): void {
    this._phase = "spelling";
    this._charIndex = 0;
    this._builtTop = "";
    this._builtBot = "";
    this._tick();
  }

  private _buildFinalLines(): void {
    const info = this._info;
    const [tmTop, tmBot] = buildTitle("tm");
    const tmPad = " ".repeat(tmTop.length);
    const gap = "   ";

    const lines: StyledLine[] = [];

    // TM logo row 1 + adapter info
    lines.push(
      concat(
        tp.accent(tmTop),
        tp.text(gap + info.displayName),
        tp.muted(
          ` · ${info.teammateCount} teammate${info.teammateCount === 1 ? "" : "s"}`,
        ),
        tp.muted(` · v${PKG_VERSION}`),
      ),
    );
    // TM logo row 2 + cwd
    lines.push(concat(tp.accent(tmBot), tp.muted(gap + info.cwd)));
    // Service status rows
    for (const svc of info.services) {
      const isBundledOrConfigured = svc.status === "bundled" || svc.status === "configured";
      const icon = isBundledOrConfigured ? "● " : svc.status === "not-configured" ? "◐ " : "○ ";
      const color = isBundledOrConfigured ? tp.success : tp.warning;
      const label = svc.status === "bundled"
        ? "bundled"
        : svc.status === "configured"
          ? "configured"
          : svc.status === "not-configured"
            ? `not configured — /configure ${svc.name.toLowerCase()}`
            : `missing — /configure ${svc.name.toLowerCase()}`;
      lines.push(concat(tp.text(tmPad + gap), color(icon), color(svc.name), tp.muted(` ${label}`)));
    }

    // blank
    lines.push("");
    this._rosterStart = lines.length;

    // Teammate roster (with presence indicators)
    for (const t of info.teammates) {
      const presenceDot =
        t.presence === "online"
          ? tp.success("  ● ")
          : t.presence === "reachable"
            ? tp.warning("  ● ")
            : tp.error("  ● ");
      lines.push(
        concat(
          presenceDot,
          tp.accent(`@${t.name}`.padEnd(14)),
          tp.muted(t.role),
        ),
      );
    }

    // blank
    lines.push("");
    this._commandsStart = lines.length;

    // Command reference (must match printBanner normal-mode layout)
    const col1 = [
      ["@mention", "assign to teammate"],
      ["text", "auto-route task"],
      ["[image]", "drag & drop images"],
    ];
    const col2 = [
      ["/status", "teammates & queue"],
      ["/compact", "compact memory"],
      ["/retro", "run retrospective"],
    ];
    const col3 = [
      ["/copy", "copy session text"],
      ["/help", "all commands"],
      ["/exit", "exit session"],
    ];
    for (let i = 0; i < col1.length; i++) {
      lines.push(
        concat(
          tp.accent(`  ${col1[i][0].padEnd(12)}`),
          tp.muted(col1[i][1].padEnd(22)),
          tp.accent(col2[i][0].padEnd(12)),
          tp.muted(col2[i][1].padEnd(22)),
          tp.accent(col3[i][0].padEnd(12)),
          tp.muted(col3[i][1]),
        ),
      );
    }

    this._finalLines = lines;
  }

  private _tick(): void {
    switch (this._phase) {
      case "spelling": {
        const ch = this._word[this._charIndex];
        const g = AnimatedBanner.GLYPHS[ch];
        if (g) {
          if (this._builtTop.length > 0) {
            this._builtTop += " ";
            this._builtBot += " ";
          }
          this._builtTop += g[0];
          this._builtBot += g[1];
        }
        this._lines = [
          concat(tp.accent(this._builtTop)),
          concat(tp.accent(this._builtBot)),
        ];
        this._apply();
        this._charIndex++;
        if (this._charIndex >= this._word.length) {
          this._phase = "version";
          this._versionIndex = 0;
          this._schedule(60);
        } else {
          this._schedule(60);
        }
        break;
      }

      case "version": {
        // Type out version string character by character on the bottom row
        this._versionIndex++;
        const partial = this._versionStr.slice(0, this._versionIndex);
        this._lines = [
          concat(tp.accent(this._builtTop)),
          concat(tp.accent(this._builtBot), tp.muted(partial)),
        ];
        this._apply();
        if (this._versionIndex >= this._versionStr.length) {
          this._phase = "pause";
          this._schedule(600);
        } else {
          this._schedule(60);
        }
        break;
      }

      case "pause": {
        // Brief pause before transitioning to compact view
        this._phase = "compact";
        this._schedule(800);
        break;
      }

      case "compact": {
        // Switch to TM + stats — show first 4 lines of final
        this._lines = this._finalLines.slice(0, 4);
        this._apply();
        this._phase = "roster";
        this._revealIndex = 0;
        this._schedule(80);
        break;
      }

      case "roster": {
        // Reveal roster lines one at a time
        const end = this._rosterStart + this._revealIndex + 1;
        this._lines = [
          ...this._finalLines.slice(0, this._rosterStart),
          ...this._finalLines.slice(this._rosterStart, end),
        ];
        this._apply();
        this._revealIndex++;
        const rosterCount = this._commandsStart - 1 - this._rosterStart; // -1 for blank line
        if (this._revealIndex >= rosterCount) {
          if (this._held) {
            // Pause here until releaseHold() is called
            this._phase = "roster-held";
          } else {
            this._phase = "commands";
            this._revealIndex = 0;
            this._schedule(80);
          }
        } else {
          this._schedule(40);
        }
        break;
      }

      case "commands": {
        // Add the blank line between roster and commands, then reveal commands
        const rosterEnd = this._commandsStart; // includes the blank line
        const cmdEnd = this._commandsStart + this._revealIndex + 1;
        this._lines = [
          ...this._finalLines.slice(0, rosterEnd),
          ...this._finalLines.slice(this._commandsStart, cmdEnd),
        ];
        this._apply();
        this._revealIndex++;
        const cmdCount = this._finalLines.length - this._commandsStart;
        if (this._revealIndex >= cmdCount) {
          this._phase = "done";
        } else {
          this._schedule(30);
        }
        break;
      }
    }
  }

  private _apply(): void {
    this._inner.lines = this._lines;
    this.invalidate();
    if (this._onDirty) this._onDirty();
  }

  private _schedule(ms: number): void {
    this._timer = setTimeout(() => {
      this._timer = null;
      this._tick();
    }, ms);
  }

  /**
   * Hold the animation — it will pause after the roster phase and
   * not reveal the command reference until releaseHold() is called.
   */
  hold(): void {
    this._held = true;
  }

  /**
   * Release the hold and continue to the commands phase.
   * If the animation already reached the hold point, it resumes immediately.
   */
  releaseHold(): void {
    this._held = false;
    // If we're waiting at the hold point, resume
    if (this._phase === "roster-held") {
      this._phase = "commands";
      this._revealIndex = 0;
      this._schedule(80);
    }
  }

  /** Update service statuses and rebuild the banner lines. */
  updateServices(services: ServiceInfo[]): void {
    this._info.services = services;
    this._buildFinalLines();
    // If animation is done, refresh immediately
    if (this._phase === "done") {
      this._lines = this._finalLines;
      this._apply();
    }
  }

  /** Cancel any pending animation timer. */
  dispose(): void {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  // ── Layout delegation ───────────────────────────────────────────

  override measure(constraint: Constraint): Size {
    const size = this._inner.measure(constraint);
    this.desiredSize = size;
    return size;
  }

  override arrange(rect: Rect): void {
    this.bounds = rect;
    this._inner.arrange(rect);
  }

  override render(ctx: DrawingContext): void {
    this._inner.render(ctx);
  }
}
