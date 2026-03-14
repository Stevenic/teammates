/**
 * App — the top-level shell that owns the entire terminal lifecycle.
 *
 * Creates and wires together all subsystems (PixelBuffer, AnsiOutput,
 * RenderTarget, DrawingContext, InputProcessor) and drives the
 * measure → arrange → render loop in response to input and resize events.
 */
import { Control } from "./layout/control.js";
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
export declare class App {
    readonly root: Control;
    private readonly _alternateScreen;
    private readonly _mouse;
    private readonly _title;
    private _output;
    private _buffer;
    private _dirtyRegions;
    private _renderTarget;
    private _drawingContext;
    private _processor;
    private _events;
    private _running;
    private _resolve;
    private _stdinListener;
    private _resizeListener;
    private _sigintListener;
    private _renderScheduled;
    constructor(options: AppOptions);
    /**
     * Start the app — enters raw mode, sets up terminal, runs the event
     * loop. Returns a promise that resolves when the app stops.
     */
    run(): Promise<void>;
    /** Stop the app — restores terminal and exits the event loop. */
    stop(): void;
    /** Force a full re-render. */
    refresh(): void;
    private _setup;
    private _prepareTerminal;
    private _restoreTerminal;
    private _createRenderPipeline;
    private _setupInput;
    private _handleInput;
    private _handleResize;
    /**
     * Schedule a render pass using setImmediate so multiple rapid events
     * within the same tick coalesce into a single render.
     */
    private _scheduleRender;
    /** Perform a full measure → arrange → render cycle (used on init and resize). */
    private _fullRender;
    /** Perform an incremental render for dirty regions. */
    private _renderFrame;
    /** Run the initial render after setup. */
    private _initialRender;
    private _teardown;
}
