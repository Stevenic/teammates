/**
 * App — the top-level shell that owns the entire terminal lifecycle.
 *
 * Creates and wires together all subsystems (PixelBuffer, AnsiOutput,
 * RenderTarget, DrawingContext, InputProcessor) and drives the
 * measure → arrange → render loop in response to input and resize events.
 */

import type { Writable } from "node:stream";
import type { InputEvent } from "./input/events.js";
import type { Constraint, Rect } from "./layout/types.js";
import { Control } from "./layout/control.js";
import { PixelBuffer } from "./pixel/buffer.js";
import { AnsiOutput } from "./ansi/output.js";
import { DirtyRegions } from "./render/regions.js";
import { RenderTarget } from "./render/render-target.js";
import { DrawingContext } from "./drawing/context.js";
import { createInputProcessor } from "./input/processor.js";
import { enableRawMode, disableRawMode } from "./input/raw-mode.js";
import * as esc from "./ansi/esc.js";

// ── Options ──────────────────────────────────────────────────────────

export interface AppOptions {
  /** Root control to render. */
  root: Control;
  /** Use alternate screen buffer (default: true). */
  alternateScreen?: boolean;
  /** Enable mouse tracking (default: false). */
  mouse?: boolean;
  /** Terminal title (optional). */
  title?: string;
}

// ── App ──────────────────────────────────────────────────────────────

export class App {
  readonly root: Control;

  private readonly _alternateScreen: boolean;
  private readonly _mouse: boolean;
  private readonly _title: string | undefined;

  // Subsystems — created during run()
  private _output!: AnsiOutput;
  private _buffer!: PixelBuffer;
  private _dirtyRegions!: DirtyRegions;
  private _renderTarget!: RenderTarget;
  private _drawingContext!: DrawingContext;
  private _processor!: ReturnType<typeof createInputProcessor>["processor"];
  private _events!: ReturnType<typeof createInputProcessor>["events"];

  // Lifecycle bookkeeping
  private _running = false;
  private _resolve: (() => void) | null = null;
  private _stdinListener: ((data: string) => void) | null = null;
  private _resizeListener: (() => void) | null = null;
  private _sigintListener: (() => void) | null = null;
  private _renderScheduled = false;

  constructor(options: AppOptions) {
    this.root = options.root;
    this._alternateScreen = options.alternateScreen ?? true;
    this._mouse = options.mouse ?? false;
    this._title = options.title;
  }

  // ── Public API ───────────────────────────────────────────────────

  /**
   * Start the app — enters raw mode, sets up terminal, runs the event
   * loop. Returns a promise that resolves when the app stops.
   */
  run(): Promise<void> {
    if (this._running) {
      return Promise.reject(new Error("App is already running"));
    }
    this._running = true;

    return new Promise<void>((resolve) => {
      this._resolve = resolve;

      try {
        this._setup();
        this._initialRender();
      } catch (err) {
        this._teardown();
        throw err;
      }
    });
  }

  /** Stop the app — restores terminal and exits the event loop. */
  stop(): void {
    if (!this._running) return;
    this._teardown();
  }

  /** Force a full re-render. */
  refresh(): void {
    if (!this._running) return;
    this._fullRender();
  }

  // ── Setup ────────────────────────────────────────────────────────

  private _setup(): void {
    const stdout = process.stdout as Writable & {
      columns: number;
      rows: number;
    };

    // 1. Enable raw mode
    enableRawMode();

    // 2. Create ANSI output
    this._output = new AnsiOutput(stdout);

    // 3. Prepare terminal (custom sequence instead of prepareTerminal()
    //    so we can conditionally enable mouse tracking)
    this._prepareTerminal();

    // 4. Set terminal title
    if (this._title) {
      stdout.write(esc.setTitle(this._title));
    }

    // 5. Create pixel buffer at terminal dimensions
    const cols = stdout.columns || 80;
    const rows = stdout.rows || 24;
    this._createRenderPipeline(cols, rows);

    // 6. Wire up input
    this._setupInput();

    // 7. Wire up resize
    this._resizeListener = () => this._handleResize();
    stdout.on("resize", this._resizeListener);

    // 8. SIGINT fallback
    this._sigintListener = () => this.stop();
    process.on("SIGINT", this._sigintListener);
  }

  private _prepareTerminal(): void {
    const stream = process.stdout as Writable;
    let seq = "";
    if (this._alternateScreen) {
      seq += esc.alternateScreenOn;
    }
    seq += esc.hideCursor;
    seq += esc.bracketedPasteOn;
    if (this._mouse) {
      seq += esc.mouseTrackingOn;
    }
    seq += esc.clearScreen;
    stream.write(seq);
  }

  private _restoreTerminal(): void {
    const stream = process.stdout as Writable;
    let seq = esc.reset;
    if (this._mouse) {
      seq += esc.mouseTrackingOff;
    }
    seq += esc.bracketedPasteOff;
    seq += esc.showCursor;
    if (this._alternateScreen) {
      seq += esc.alternateScreenOff;
    }
    stream.write(seq);
  }

  private _createRenderPipeline(cols: number, rows: number): void {
    this._buffer = new PixelBuffer(cols, rows);
    this._dirtyRegions = new DirtyRegions();
    this._renderTarget = new RenderTarget(this._buffer, this._output);
    this._drawingContext = new DrawingContext(this._buffer);
  }

  private _setupInput(): void {
    const { processor, events } = createInputProcessor();
    this._processor = processor;
    this._events = events;

    // Listen for parsed input events
    this._events.on("input", (event: InputEvent) => {
      this._handleInput(event);
    });

    // Feed raw stdin data to the processor
    this._stdinListener = (data: string) => {
      this._processor.feed(data);
    };
    process.stdin.on("data", this._stdinListener);
  }

  // ── Input handling ───────────────────────────────────────────────

  private _handleInput(event: InputEvent): void {
    // Intercept Ctrl+C
    if (
      event.type === "key" &&
      event.event.key === "c" &&
      event.event.ctrl &&
      !event.event.alt &&
      !event.event.shift
    ) {
      this.stop();
      return;
    }

    // Dispatch to root control
    this.root.handleInput(event);

    // Schedule a render if the tree is dirty
    this._scheduleRender();
  }

  // ── Resize handling ──────────────────────────────────────────────

  private _handleResize(): void {
    const stdout = process.stdout as Writable & {
      columns: number;
      rows: number;
    };
    const cols = stdout.columns || 80;
    const rows = stdout.rows || 24;

    // Recreate render pipeline at new size
    this._buffer = new PixelBuffer(cols, rows);
    this._dirtyRegions = new DirtyRegions();
    this._renderTarget = new RenderTarget(this._buffer, this._output);
    this._drawingContext = new DrawingContext(this._buffer);

    // Mark root as dirty and do a full render
    this.root.invalidate();
    this._fullRender();
  }

  // ── Render loop ──────────────────────────────────────────────────

  /**
   * Schedule a render pass using setImmediate so multiple rapid events
   * within the same tick coalesce into a single render.
   */
  private _scheduleRender(): void {
    if (this._renderScheduled || !this._running) return;
    this._renderScheduled = true;

    setImmediate(() => {
      this._renderScheduled = false;
      if (!this._running) return;
      if (this.root.dirty) {
        this._renderFrame();
      }
    });
  }

  /** Perform a full measure → arrange → render cycle (used on init and resize). */
  private _fullRender(): void {
    if (!this._running) return;

    const cols = this._buffer.width;
    const rows = this._buffer.height;

    // Clear buffer
    this._buffer.clear();

    // Measure
    const constraint: Constraint = {
      minWidth: 0,
      maxWidth: cols,
      minHeight: 0,
      maxHeight: rows,
    };
    this.root.measure(constraint);

    // Arrange
    const arrangeRect: Rect = { x: 0, y: 0, width: cols, height: rows };
    this.root.arrange(arrangeRect);

    // Render control tree into buffer
    this.root.render(this._drawingContext);
    this.root.dirty = false;

    // Mark entire screen dirty and flush to terminal
    this._dirtyRegions.addRect({
      x: 0,
      y: 0,
      width: cols,
      height: rows,
    });
    this._renderTarget.render(this._dirtyRegions);
  }

  /** Perform an incremental render for dirty regions. */
  private _renderFrame(): void {
    const cols = this._buffer.width;
    const rows = this._buffer.height;

    // Clear buffer
    this._buffer.clear();

    // Measure
    const constraint: Constraint = {
      minWidth: 0,
      maxWidth: cols,
      minHeight: 0,
      maxHeight: rows,
    };
    this.root.measure(constraint);

    // Arrange
    const arrangeRect: Rect = { x: 0, y: 0, width: cols, height: rows };
    this.root.arrange(arrangeRect);

    // Mark the full area as dirty (controls re-render their full bounds)
    this._dirtyRegions.addRect({
      x: 0,
      y: 0,
      width: cols,
      height: rows,
    });

    // Render control tree into buffer
    this.root.render(this._drawingContext);
    this.root.dirty = false;

    // Diff and flush to terminal
    this._renderTarget.render(this._dirtyRegions);
  }

  /** Run the initial render after setup. */
  private _initialRender(): void {
    this._fullRender();
  }

  // ── Teardown ─────────────────────────────────────────────────────

  private _teardown(): void {
    if (!this._running) return;
    this._running = false;

    // Remove stdin listener
    if (this._stdinListener) {
      process.stdin.removeListener("data", this._stdinListener);
      this._stdinListener = null;
    }

    // Remove resize listener
    if (this._resizeListener) {
      process.stdout.removeListener("resize", this._resizeListener);
      this._resizeListener = null;
    }

    // Remove SIGINT listener
    if (this._sigintListener) {
      process.removeListener("SIGINT", this._sigintListener);
      this._sigintListener = null;
    }

    // Destroy input processor (clears timers)
    if (this._processor) {
      this._processor.destroy();
    }

    // Restore terminal
    this._restoreTerminal();

    // Disable raw mode
    disableRawMode();

    // Resolve the run() promise
    if (this._resolve) {
      const resolve = this._resolve;
      this._resolve = null;
      resolve();
    }
  }
}
