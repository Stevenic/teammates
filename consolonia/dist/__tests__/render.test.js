import { describe, it, expect, beforeEach } from "vitest";
import { Writable } from "node:stream";
import { DirtyRegions, DirtySnapshot } from "../render/regions.js";
import { RenderTarget } from "../render/render-target.js";
import { PixelBuffer } from "../pixel/buffer.js";
import { AnsiOutput } from "../ansi/output.js";
// ── Helpers ────────────────────────────────────────────────────────
function mockStream() {
    const stream = new Writable({
        write(chunk, _encoding, callback) {
            stream.output += chunk.toString();
            callback();
        },
    });
    stream.output = "";
    return stream;
}
function makePixel(char, fg = { r: 255, g: 255, b: 255, a: 255 }, bg = { r: 0, g: 0, b: 0, a: 255 }) {
    return {
        foreground: {
            symbol: { text: char, width: 1, pattern: 0 },
            color: fg,
            bold: false,
            italic: false,
            underline: false,
            strikethrough: false,
        },
        background: { color: bg },
    };
}
// ═══════════════════════════════════════════════════════════════════
// regions.ts
// ═══════════════════════════════════════════════════════════════════
describe("DirtyRegions", () => {
    let regions;
    beforeEach(() => {
        regions = new DirtyRegions();
    });
    describe("addRect and contains", () => {
        it("contains returns false when no rects added", () => {
            expect(regions.contains(0, 0)).toBe(false);
        });
        it("contains returns true for point inside added rect", () => {
            regions.addRect({ x: 0, y: 0, width: 10, height: 5 });
            expect(regions.contains(0, 0)).toBe(true);
            expect(regions.contains(9, 4)).toBe(true);
            expect(regions.contains(5, 2)).toBe(true);
        });
        it("contains uses exclusive upper bounds", () => {
            regions.addRect({ x: 0, y: 0, width: 10, height: 5 });
            // (10, 4) is outside because width is exclusive
            expect(regions.contains(10, 4)).toBe(false);
            // (9, 5) is outside because height is exclusive
            expect(regions.contains(9, 5)).toBe(false);
        });
        it("handles multiple non-overlapping rects", () => {
            regions.addRect({ x: 0, y: 0, width: 5, height: 5 });
            regions.addRect({ x: 10, y: 10, width: 5, height: 5 });
            expect(regions.contains(2, 2)).toBe(true);
            expect(regions.contains(12, 12)).toBe(true);
            expect(regions.contains(7, 7)).toBe(false);
        });
        it("ignores empty rects (width 0)", () => {
            regions.addRect({ x: 0, y: 0, width: 0, height: 5 });
            expect(regions.contains(0, 0)).toBe(false);
        });
        it("ignores empty rects (height 0)", () => {
            regions.addRect({ x: 0, y: 0, width: 5, height: 0 });
            expect(regions.contains(0, 0)).toBe(false);
        });
        it("ignores negative dimensions", () => {
            regions.addRect({ x: 0, y: 0, width: -1, height: 5 });
            expect(regions.contains(0, 0)).toBe(false);
            regions.addRect({ x: 0, y: 0, width: 5, height: -1 });
            expect(regions.contains(0, 0)).toBe(false);
        });
    });
    describe("containment optimization", () => {
        it("skips rect that is fully contained by an existing rect", () => {
            regions.addRect({ x: 0, y: 0, width: 20, height: 20 });
            regions.addRect({ x: 5, y: 5, width: 5, height: 5 }); // contained, should be skipped
            // The big rect still contains everything
            expect(regions.contains(0, 0)).toBe(true);
            expect(regions.contains(19, 19)).toBe(true);
            // Taking a snapshot: should have only 1 rect
            const snapshot = regions.getSnapshotAndClear();
            // We can verify indirectly: if we had 2 rects, the snapshot would still work
            // But we test the optimization by checking snapshot contains the large area
            expect(snapshot.contains(0, 0)).toBe(true);
            expect(snapshot.contains(19, 19)).toBe(true);
        });
        it("replaces existing rect when new rect fully contains it", () => {
            regions.addRect({ x: 5, y: 5, width: 5, height: 5 }); // small
            regions.addRect({ x: 0, y: 0, width: 20, height: 20 }); // big, should replace small
            expect(regions.contains(0, 0)).toBe(true);
            expect(regions.contains(19, 19)).toBe(true);
        });
        it("replaces multiple existing rects when new rect contains all of them", () => {
            regions.addRect({ x: 0, y: 0, width: 3, height: 3 });
            regions.addRect({ x: 5, y: 5, width: 3, height: 3 });
            regions.addRect({ x: 8, y: 8, width: 2, height: 2 });
            // Add a big rect that contains all three
            regions.addRect({ x: 0, y: 0, width: 20, height: 20 });
            const snapshot = regions.getSnapshotAndClear();
            expect(snapshot.contains(0, 0)).toBe(true);
            expect(snapshot.contains(19, 19)).toBe(true);
        });
        it("keeps non-overlapping rects when new rect does not contain them", () => {
            regions.addRect({ x: 0, y: 0, width: 5, height: 5 });
            regions.addRect({ x: 10, y: 10, width: 5, height: 5 });
            // Neither contains the other, both should remain
            expect(regions.contains(2, 2)).toBe(true);
            expect(regions.contains(12, 12)).toBe(true);
        });
        it("exact duplicate rect is treated as contained", () => {
            regions.addRect({ x: 3, y: 3, width: 10, height: 10 });
            regions.addRect({ x: 3, y: 3, width: 10, height: 10 }); // exact duplicate
            // Should still work
            expect(regions.contains(3, 3)).toBe(true);
            expect(regions.contains(12, 12)).toBe(true);
        });
    });
    describe("clear", () => {
        it("removes all tracked regions", () => {
            regions.addRect({ x: 0, y: 0, width: 10, height: 10 });
            expect(regions.contains(5, 5)).toBe(true);
            regions.clear();
            expect(regions.contains(5, 5)).toBe(false);
        });
    });
    describe("getSnapshotAndClear", () => {
        it("returns a snapshot containing the dirty rects", () => {
            regions.addRect({ x: 0, y: 0, width: 10, height: 10 });
            const snapshot = regions.getSnapshotAndClear();
            expect(snapshot.contains(5, 5)).toBe(true);
            expect(snapshot.contains(10, 10)).toBe(false);
        });
        it("clears regions after snapshot", () => {
            regions.addRect({ x: 0, y: 0, width: 10, height: 10 });
            regions.getSnapshotAndClear();
            // Regions should be empty now
            expect(regions.contains(5, 5)).toBe(false);
        });
        it("snapshot is independent from subsequent mutations", () => {
            regions.addRect({ x: 0, y: 0, width: 10, height: 10 });
            const snapshot = regions.getSnapshotAndClear();
            // Add new rect after snapshot
            regions.addRect({ x: 20, y: 20, width: 5, height: 5 });
            // Snapshot should not contain the new rect
            expect(snapshot.contains(22, 22)).toBe(false);
            // But the original rect is still in the snapshot
            expect(snapshot.contains(5, 5)).toBe(true);
        });
        it("empty snapshot contains nothing", () => {
            const snapshot = regions.getSnapshotAndClear();
            expect(snapshot.contains(0, 0)).toBe(false);
        });
    });
});
describe("DirtySnapshot", () => {
    it("contains checks against all rects in the snapshot", () => {
        const snapshot = new DirtySnapshot([
            { x: 0, y: 0, width: 5, height: 5 },
            { x: 10, y: 10, width: 5, height: 5 },
        ]);
        expect(snapshot.contains(2, 2)).toBe(true);
        expect(snapshot.contains(12, 12)).toBe(true);
        expect(snapshot.contains(7, 7)).toBe(false);
    });
    it("returns false for empty snapshot", () => {
        const snapshot = new DirtySnapshot([]);
        expect(snapshot.contains(0, 0)).toBe(false);
    });
});
// ═══════════════════════════════════════════════════════════════════
// render-target.ts
// ═══════════════════════════════════════════════════════════════════
describe("RenderTarget", () => {
    let stream;
    let ansiOutput;
    let buffer;
    beforeEach(() => {
        stream = mockStream();
        ansiOutput = new AnsiOutput(stream);
        buffer = new PixelBuffer(10, 5);
    });
    describe("render with dirty regions", () => {
        it("only writes pixels inside dirty regions", () => {
            const target = new RenderTarget(buffer, ansiOutput);
            const regions = new DirtyRegions();
            // Set specific pixels in the buffer
            buffer.set(0, 0, makePixel("A"));
            buffer.set(5, 2, makePixel("B"));
            // Only mark (0,0) area as dirty
            regions.addRect({ x: 0, y: 0, width: 1, height: 1 });
            target.render(regions);
            // "A" should be in output but "B" should not (not in dirty region)
            expect(stream.output).toContain("A");
            expect(stream.output).not.toContain("B");
        });
        it("writes pixel when dirty region covers it", () => {
            const target = new RenderTarget(buffer, ansiOutput);
            const regions = new DirtyRegions();
            buffer.set(3, 2, makePixel("X"));
            regions.addRect({ x: 0, y: 0, width: 10, height: 5 }); // entire buffer
            target.render(regions);
            expect(stream.output).toContain("X");
        });
        it("does not write anything when no dirty regions", () => {
            const target = new RenderTarget(buffer, ansiOutput);
            const regions = new DirtyRegions();
            buffer.set(0, 0, makePixel("A"));
            target.render(regions); // empty dirty regions
            // Should only contain hide/show cursor, no pixel data
            expect(stream.output).not.toContain("A");
        });
    });
    describe("cache behavior", () => {
        it("skips pixels that match the cache on second render", () => {
            const target = new RenderTarget(buffer, ansiOutput);
            // First render: everything is new
            buffer.set(0, 0, makePixel("A"));
            const regions1 = new DirtyRegions();
            regions1.addRect({ x: 0, y: 0, width: 1, height: 1 });
            target.render(regions1);
            // Clear stream output
            stream.output = "";
            // Second render with same pixel, same dirty region
            const regions2 = new DirtyRegions();
            regions2.addRect({ x: 0, y: 0, width: 1, height: 1 });
            target.render(regions2);
            // "A" should NOT appear again because the cache matches
            expect(stream.output).not.toContain("A");
        });
        it("writes pixel when it changes between renders", () => {
            const target = new RenderTarget(buffer, ansiOutput);
            // First render
            buffer.set(0, 0, makePixel("A"));
            const regions1 = new DirtyRegions();
            regions1.addRect({ x: 0, y: 0, width: 1, height: 1 });
            target.render(regions1);
            stream.output = "";
            // Change pixel
            buffer.set(0, 0, makePixel("B"));
            const regions2 = new DirtyRegions();
            regions2.addRect({ x: 0, y: 0, width: 1, height: 1 });
            target.render(regions2);
            expect(stream.output).toContain("B");
        });
        it("updates cache after writing a pixel", () => {
            const target = new RenderTarget(buffer, ansiOutput);
            const px = makePixel("Z");
            buffer.set(2, 3, px);
            const regions = new DirtyRegions();
            regions.addRect({ x: 2, y: 3, width: 1, height: 1 });
            target.render(regions);
            // Cache should now have the pixel
            const cached = target.getCachePixel(2, 3);
            expect(cached).not.toBeNull();
            expect(cached.foreground.symbol.text).toBe("Z");
        });
        it("getCachePixel returns null for never-rendered cells", () => {
            const target = new RenderTarget(buffer, ansiOutput);
            expect(target.getCachePixel(0, 0)).toBeNull();
        });
        it("getCachePixel returns null for out-of-bounds", () => {
            const target = new RenderTarget(buffer, ansiOutput);
            expect(target.getCachePixel(-1, 0)).toBeNull();
            expect(target.getCachePixel(0, -1)).toBeNull();
            expect(target.getCachePixel(100, 0)).toBeNull();
            expect(target.getCachePixel(0, 100)).toBeNull();
        });
    });
    describe("fullRender", () => {
        it("renders all cells in the buffer", () => {
            const target = new RenderTarget(buffer, ansiOutput);
            // Set a few pixels
            buffer.set(0, 0, makePixel("A"));
            buffer.set(9, 4, makePixel("Z"));
            target.fullRender();
            expect(stream.output).toContain("A");
            expect(stream.output).toContain("Z");
        });
        it("renders cells even without prior dirty region calls", () => {
            const target = new RenderTarget(buffer, ansiOutput);
            buffer.set(5, 2, makePixel("M"));
            target.fullRender();
            expect(stream.output).toContain("M");
        });
        it("emits hideCursor before and showCursor after pixel data", () => {
            const target = new RenderTarget(buffer, ansiOutput);
            target.fullRender();
            const hideCursorIdx = stream.output.indexOf("\x1b[?25l");
            const showCursorIdx = stream.output.indexOf("\x1b[?25h");
            expect(hideCursorIdx).toBeGreaterThanOrEqual(0);
            expect(showCursorIdx).toBeGreaterThan(hideCursorIdx);
        });
    });
    describe("resize", () => {
        it("resets cache so next render writes all pixels", () => {
            const target = new RenderTarget(buffer, ansiOutput);
            // First render to populate cache
            buffer.set(0, 0, makePixel("A"));
            const regions1 = new DirtyRegions();
            regions1.addRect({ x: 0, y: 0, width: 1, height: 1 });
            target.render(regions1);
            stream.output = "";
            // Resize (same dimensions for simplicity)
            target.resize(10, 5);
            // Now render again with same pixel — should re-emit because cache was cleared
            const regions2 = new DirtyRegions();
            regions2.addRect({ x: 0, y: 0, width: 1, height: 1 });
            target.render(regions2);
            expect(stream.output).toContain("A");
        });
        it("handles different dimensions", () => {
            const target = new RenderTarget(buffer, ansiOutput);
            // Resize to larger
            target.resize(20, 10);
            // getCachePixel should return null for all positions in new grid
            expect(target.getCachePixel(15, 8)).toBeNull();
        });
        it("resize to smaller dimensions works", () => {
            const target = new RenderTarget(buffer, ansiOutput);
            target.resize(3, 2);
            // Old positions beyond new bounds should return null
            expect(target.getCachePixel(5, 3)).toBeNull();
            // New valid positions also null (fresh cache)
            expect(target.getCachePixel(0, 0)).toBeNull();
        });
    });
    describe("render emits correct ANSI structure", () => {
        it("flushes after rendering", () => {
            const target = new RenderTarget(buffer, ansiOutput);
            buffer.set(0, 0, makePixel("Q"));
            const regions = new DirtyRegions();
            regions.addRect({ x: 0, y: 0, width: 1, height: 1 });
            target.render(regions);
            // Output should not be empty (flush was called)
            expect(stream.output.length).toBeGreaterThan(0);
        });
        it("multiple renders accumulate output", () => {
            const target = new RenderTarget(buffer, ansiOutput);
            buffer.set(0, 0, makePixel("A"));
            const r1 = new DirtyRegions();
            r1.addRect({ x: 0, y: 0, width: 1, height: 1 });
            target.render(r1);
            buffer.set(0, 0, makePixel("B"));
            const r2 = new DirtyRegions();
            r2.addRect({ x: 0, y: 0, width: 1, height: 1 });
            target.render(r2);
            expect(stream.output).toContain("A");
            expect(stream.output).toContain("B");
        });
    });
    describe("interaction between dirty regions and cache", () => {
        it("pixel changed but not in dirty region is not written", () => {
            const target = new RenderTarget(buffer, ansiOutput);
            // Render pixel at (0,0)
            buffer.set(0, 0, makePixel("A"));
            const r1 = new DirtyRegions();
            r1.addRect({ x: 0, y: 0, width: 1, height: 1 });
            target.render(r1);
            stream.output = "";
            // Change pixel at (0,0) but mark a different region as dirty
            buffer.set(0, 0, makePixel("B"));
            const r2 = new DirtyRegions();
            r2.addRect({ x: 5, y: 5, width: 1, height: 1 }); // different area
            target.render(r2);
            // "B" should not be written because (0,0) is not in dirty region
            expect(stream.output).not.toContain("B");
        });
        it("pixel unchanged but in dirty region is skipped via cache", () => {
            const target = new RenderTarget(buffer, ansiOutput);
            // Render pixel
            buffer.set(2, 2, makePixel("X"));
            const r1 = new DirtyRegions();
            r1.addRect({ x: 2, y: 2, width: 1, height: 1 });
            target.render(r1);
            stream.output = "";
            // Mark same region dirty again, pixel unchanged
            const r2 = new DirtyRegions();
            r2.addRect({ x: 2, y: 2, width: 1, height: 1 });
            target.render(r2);
            // "X" should not be re-emitted
            expect(stream.output).not.toContain("X");
        });
    });
});
