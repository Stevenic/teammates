/**
 * MutableOutput — a Writable stream wrapper around stdout that can be muted.
 *
 * Readline requires an output stream for echoing characters. By wrapping
 * stdout in a mutable stream, we can suppress echo during paste detection
 * or any other time we need to control what appears on screen.
 *
 * Also proxies TTY methods (cursorTo, clearLine, etc.) so readline works
 * correctly on both Windows and macOS.
 */

import { Writable } from "node:stream";

export class MutableOutput extends Writable {
  private _muted = false;

  constructor() {
    super();

    // Proxy TTY properties from real stdout
    const self = this as any;
    const out = process.stdout as any;

    self.columns = out.columns;
    self.rows = out.rows;
    self.isTTY = out.isTTY;

    // Proxy methods readline needs
    self.cursorTo = out.cursorTo?.bind(out);
    self.clearLine = out.clearLine?.bind(out);
    self.moveCursor = out.moveCursor?.bind(out);
    self.getWindowSize = () => [out.columns || 80, out.rows || 24];

    // Forward resize events
    process.stdout.on("resize", () => {
      self.columns = out.columns;
      self.rows = out.rows;
      this.emit("resize");
    });
  }

  get muted(): boolean {
    return this._muted;
  }

  /** Mute all output — nothing written to stdout. */
  mute(): void {
    this._muted = true;
  }

  /** Unmute — resume writing to stdout. */
  unmute(): void {
    this._muted = false;
  }

  _write(chunk: Buffer | string, _encoding: string, callback: () => void): void {
    if (!this._muted) {
      process.stdout.write(chunk);
    }
    callback();
  }
}
