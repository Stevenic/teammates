/**
 * DrawingContext: the main drawing API for rendering to a PixelBuffer.
 *
 * Port of Consolonia's DrawingContextImpl.cs + DrawingContextImpl.Boxes.cs,
 * simplified for the Node.js/TypeScript environment.
 */
import type { Color } from "../pixel/color.js";
import type { Rect } from "../layout/types.js";
import type { Pixel } from "../pixel/pixel.js";
import { type PixelBuffer } from "../pixel/buffer.js";
export interface TextStyle {
    fg?: Color;
    bg?: Color;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strikethrough?: boolean;
}
export interface BoxStyle {
    fg?: Color;
    bg?: Color;
    bold?: boolean;
}
export declare class DrawingContext {
    private readonly buffer;
    private readonly clipStack;
    private translateStack;
    private offsetX;
    private offsetY;
    constructor(buffer: PixelBuffer);
    /** Push a clip rectangle. All drawing is clipped to this region. */
    pushClip(rect: Rect): void;
    /** Pop the last clip rectangle. */
    popClip(): void;
    /** Push a coordinate translation. All drawing coordinates are offset. */
    pushTranslate(dx: number, dy: number): void;
    /** Pop the last coordinate translation. */
    popTranslate(): void;
    /** Translate a point by the current offset. */
    private tx;
    private ty;
    /** Check if a local-coord point is visible after translate. */
    private isVisible;
    /** Get a pixel at local coordinates (translated to buffer coords). */
    private bufGet;
    /** Set a pixel at local coordinates (translated to buffer coords). */
    private bufSet;
    /** Fill a rectangle with a solid color. */
    fillRect(rect: Rect, color: Color): void;
    /** Draw a single character at (x, y) with styling. */
    drawChar(x: number, y: number, char: string, style?: TextStyle): void;
    /** Draw a text string at (x, y). Handles wide characters and tabs. */
    drawText(x: number, y: number, text: string, style?: TextStyle): void;
    /**
     * Draw an array of styled segments at (x, y).
     * Each segment carries its own TextStyle; segments are drawn sequentially.
     */
    drawStyledText(x: number, y: number, segments: {
        text: string;
        style: TextStyle;
    }[]): void;
    /** Draw a box-drawing rectangle (border) with smart corner merging. */
    drawBox(rect: Rect, style?: BoxStyle): void;
    /**
     * Draw a single box-drawing character at (x, y), merging with any existing
     * box pattern at that position.
     */
    private drawBoxChar;
    /** Draw a horizontal line using box-drawing characters. */
    drawHLine(x: number, y: number, width: number, style?: TextStyle): void;
    /** Draw a vertical line using box-drawing characters. */
    drawVLine(x: number, y: number, height: number, style?: TextStyle): void;
    /** Set a pixel directly. Respects clip. */
    setPixel(x: number, y: number, pixel: Pixel): void;
    /** Blend a pixel at (x, y) with what's already there. Respects clip. */
    blendPixel(x: number, y: number, pixel: Pixel): void;
}
