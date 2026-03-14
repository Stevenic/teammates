/**
 * Unit tests for the ChatView widget.
 */
import { describe, it, expect, vi } from "vitest";
import { ChatView } from "../widgets/chat-view.js";
import { PixelBuffer } from "../pixel/buffer.js";
import { DrawingContext } from "../drawing/context.js";
import { keyEvent, mouseEvent } from "../input/events.js";
// ── Helpers ──────────────────────────────────────────────────────────
function createRenderTarget(width = 60, height = 20) {
    const buffer = new PixelBuffer(width, height);
    const ctx = new DrawingContext(buffer);
    return { buffer, ctx };
}
function rowText(buffer, y, x0 = 0, x1) {
    const end = x1 ?? buffer.width;
    let s = "";
    for (let x = x0; x < end; x++) {
        s += buffer.get(x, y).foreground.symbol.text;
    }
    return s;
}
/** Full layout + render a ChatView at the given dimensions. */
function layoutAndRender(chat, width = 60, height = 20) {
    const { buffer, ctx } = createRenderTarget(width, height);
    const constraint = {
        minWidth: 0,
        minHeight: 0,
        maxWidth: width,
        maxHeight: height,
    };
    chat.measure(constraint);
    chat.arrange({ x: 0, y: 0, width, height });
    chat.render(ctx);
    return { buffer, ctx };
}
/** Create a key event for a printable character. */
function charKey(ch) {
    return keyEvent(ch, ch);
}
/** Create a key event for a special key (non-printable). */
function specialKey(key) {
    return keyEvent(key);
}
// ── Tests ────────────────────────────────────────────────────────────
describe("ChatView", () => {
    describe("construction", () => {
        it("creates with default options", () => {
            const chat = new ChatView();
            expect(chat).toBeDefined();
            expect(chat.inputValue).toBe("");
            expect(chat.feedLineCount).toBe(0);
            expect(chat.banner).toBe("");
        });
        it("creates with custom options", () => {
            const chat = new ChatView({
                banner: "Welcome!",
                prompt: "> ",
                placeholder: "Type here...",
            });
            expect(chat.banner).toBe("Welcome!");
            expect(chat.prompt).toBe("> ");
        });
    });
    describe("banner", () => {
        it("renders banner text at top", () => {
            const chat = new ChatView({ banner: "Hello" });
            const { buffer } = layoutAndRender(chat, 40, 10);
            const row0 = rowText(buffer, 0, 0, 5);
            expect(row0).toBe("Hello");
        });
        it("hides banner when empty", () => {
            const chat = new ChatView({ banner: "" });
            layoutAndRender(chat, 40, 10);
            expect(chat.banner).toBe("");
        });
        it("can update banner text", () => {
            const chat = new ChatView({ banner: "Old" });
            chat.banner = "New Title";
            expect(chat.banner).toBe("New Title");
        });
    });
    describe("feed", () => {
        it("starts empty", () => {
            const chat = new ChatView();
            expect(chat.feedLineCount).toBe(0);
        });
        it("appends lines", () => {
            const chat = new ChatView();
            chat.appendToFeed("line 1");
            chat.appendToFeed("line 2");
            expect(chat.feedLineCount).toBe(2);
        });
        it("appends multiple lines at once", () => {
            const chat = new ChatView();
            chat.appendLines(["a", "b", "c"]);
            expect(chat.feedLineCount).toBe(3);
        });
        it("renders feed lines in the feed area", () => {
            const chat = new ChatView({ banner: "B" });
            chat.appendToFeed("Hello feed");
            const { buffer } = layoutAndRender(chat, 40, 10);
            // Row 0: banner "B"
            // Row 1: separator
            // Row 2+: feed area — should contain "Hello feed"
            const feedRow = rowText(buffer, 2, 0, 10);
            expect(feedRow).toBe("Hello feed");
        });
        it("clears feed lines", () => {
            const chat = new ChatView();
            chat.appendToFeed("msg1");
            chat.appendToFeed("msg2");
            expect(chat.feedLineCount).toBe(2);
            chat.clear();
            expect(chat.feedLineCount).toBe(0);
        });
        it("scrolling adjusts feed offset", () => {
            const chat = new ChatView();
            for (let i = 0; i < 30; i++) {
                chat.appendToFeed(`line ${i}`);
            }
            chat.scrollFeed(-5);
            // Should not crash
            layoutAndRender(chat, 40, 10);
        });
    });
    describe("input", () => {
        it("handles key input", () => {
            const chat = new ChatView();
            const submitted = vi.fn();
            chat.on("submit", submitted);
            // Type "hello"
            for (const ch of "hello") {
                chat.handleInput(charKey(ch));
            }
            expect(chat.inputValue).toBe("hello");
            // Press enter
            chat.handleInput(specialKey("enter"));
            expect(submitted).toHaveBeenCalledWith("hello");
        });
        it("emits change on input", () => {
            const chat = new ChatView();
            const changed = vi.fn();
            chat.on("change", changed);
            chat.handleInput(charKey("a"));
            expect(changed).toHaveBeenCalled();
        });
        it("can set input value programmatically", () => {
            const chat = new ChatView();
            chat.inputValue = "/help";
            expect(chat.inputValue).toBe("/help");
        });
        it("renders the input line above separator and footer", () => {
            const chat = new ChatView({ prompt: "> " });
            chat.inputValue = "test";
            const { buffer } = layoutAndRender(chat, 40, 10);
            // Input at row 7, separator at row 8, footer at row 9
            const inputRow = rowText(buffer, 7, 0, 6);
            expect(inputRow).toBe("> test");
        });
    });
    describe("progress", () => {
        it("shows progress message above input", () => {
            const chat = new ChatView();
            chat.setProgress("Loading...");
            const { buffer } = layoutAndRender(chat, 40, 10);
            // Find "Loading..." somewhere in the buffer
            let found = false;
            for (let y = 0; y < 10; y++) {
                const row = rowText(buffer, y, 0, 10);
                if (row.startsWith("Loading...")) {
                    found = true;
                    break;
                }
            }
            expect(found).toBe(true);
        });
        it("hides progress when set to null", () => {
            const chat = new ChatView();
            chat.setProgress("Loading...");
            chat.setProgress(null);
            // Should not crash during render
            layoutAndRender(chat, 40, 10);
        });
    });
    describe("dropdown", () => {
        it("starts with no dropdown", () => {
            const chat = new ChatView();
            expect(chat.dropdownItems).toHaveLength(0);
            expect(chat.dropdownIndex).toBe(-1);
        });
        it("shows dropdown items", () => {
            const chat = new ChatView();
            chat.showDropdown([
                { label: "/help", description: "Show help", completion: "/help " },
                { label: "/status", description: "Show status", completion: "/status " },
            ]);
            expect(chat.dropdownItems).toHaveLength(2);
            expect(chat.dropdownIndex).toBe(0);
        });
        it("navigates dropdown with up/down", () => {
            const chat = new ChatView();
            chat.showDropdown([
                { label: "/help", description: "desc", completion: "/help " },
                { label: "/status", description: "desc", completion: "/status " },
                { label: "/quit", description: "desc", completion: "/quit " },
            ]);
            expect(chat.dropdownIndex).toBe(0);
            chat.dropdownDown();
            expect(chat.dropdownIndex).toBe(1);
            chat.dropdownDown();
            expect(chat.dropdownIndex).toBe(2);
            chat.dropdownDown(); // at end, stays
            expect(chat.dropdownIndex).toBe(2);
            chat.dropdownUp();
            expect(chat.dropdownIndex).toBe(1);
            chat.dropdownUp();
            expect(chat.dropdownIndex).toBe(0);
            chat.dropdownUp(); // at top, stays
            expect(chat.dropdownIndex).toBe(0);
        });
        it("accepts dropdown item", () => {
            const chat = new ChatView();
            chat.showDropdown([
                { label: "/help", description: "desc", completion: "/help " },
            ]);
            const item = chat.acceptDropdownItem();
            expect(item).not.toBeNull();
            expect(item.label).toBe("/help");
            expect(chat.inputValue).toBe("/help ");
            expect(chat.dropdownItems).toHaveLength(0);
        });
        it("hides dropdown on escape", () => {
            const chat = new ChatView();
            chat.showDropdown([
                { label: "/help", description: "desc", completion: "/help " },
            ]);
            chat.handleInput(specialKey("escape"));
            expect(chat.dropdownItems).toHaveLength(0);
        });
        it("accepts dropdown on enter when item selected", () => {
            const chat = new ChatView();
            chat.showDropdown([
                { label: "/help", description: "desc", completion: "/help " },
            ]);
            chat.handleInput(specialKey("enter"));
            expect(chat.inputValue).toBe("/help ");
        });
        it("navigates dropdown via keyboard events", () => {
            const chat = new ChatView();
            chat.showDropdown([
                { label: "/a", description: "", completion: "/a " },
                { label: "/b", description: "", completion: "/b " },
            ]);
            chat.handleInput(specialKey("down"));
            expect(chat.dropdownIndex).toBe(1);
            chat.handleInput(specialKey("up"));
            expect(chat.dropdownIndex).toBe(0);
        });
        it("renders dropdown items below input", () => {
            const chat = new ChatView();
            chat.showDropdown([
                { label: "/help", description: "Show help", completion: "/help " },
            ]);
            const { buffer } = layoutAndRender(chat, 40, 12);
            // Find dropdown text — check the last row (should be right after input)
            let foundRow = -1;
            for (let y = 0; y < 12; y++) {
                const row = rowText(buffer, y, 0, 30);
                if (row.includes("/help")) {
                    foundRow = y;
                    break;
                }
            }
            expect(foundRow).toBeGreaterThanOrEqual(0);
        });
        it("renders dropdown items at correct position with banner", () => {
            const chat = new ChatView({ banner: "Banner\nLine 2" });
            chat.appendToFeed("msg1");
            chat.showDropdown([
                { label: "/help", description: "Show help", completion: "/help " },
                { label: "/status", description: "Status", completion: "/status " },
            ]);
            const H = 15;
            const { buffer } = layoutAndRender(chat, 50, H);
            // Dump all rows for debugging
            const rows = [];
            for (let y = 0; y < H; y++) {
                rows.push(rowText(buffer, y, 0, 50).replace(/ +$/, ""));
            }
            // Input should be at H - 3 (2 dropdown rows below)
            // Dropdown should be at H - 2 and H - 1
            const helpRow = rows.findIndex((r) => r.includes("/help"));
            const statusRow = rows.findIndex((r) => r.includes("/status"));
            expect(helpRow).toBeGreaterThanOrEqual(0);
            expect(statusRow).toBeGreaterThanOrEqual(0);
            // Dropdown should be after input (last 2 rows)
            expect(helpRow).toBeGreaterThan(rows.findIndex((r) => r.includes("❯") || r.includes("> ")));
        });
    });
    describe("mouse scrolling", () => {
        it("scrolls feed on wheel up", () => {
            const chat = new ChatView();
            for (let i = 0; i < 30; i++)
                chat.appendToFeed(`line ${i}`);
            const result = chat.handleInput(mouseEvent(0, 0, "none", "wheelup"));
            expect(result).toBe(true);
        });
        it("scrolls feed on wheel down", () => {
            const chat = new ChatView();
            for (let i = 0; i < 30; i++)
                chat.appendToFeed(`line ${i}`);
            const result = chat.handleInput(mouseEvent(0, 0, "none", "wheeldown"));
            expect(result).toBe(true);
        });
    });
    describe("page scrolling", () => {
        it("scrolls feed on pageup", () => {
            const chat = new ChatView();
            for (let i = 0; i < 30; i++)
                chat.appendToFeed(`line ${i}`);
            const result = chat.handleInput(specialKey("pageup"));
            expect(result).toBe(true);
        });
        it("scrolls feed on pagedown", () => {
            const chat = new ChatView();
            for (let i = 0; i < 30; i++)
                chat.appendToFeed(`line ${i}`);
            const result = chat.handleInput(specialKey("pagedown"));
            expect(result).toBe(true);
        });
    });
    describe("resize / double buffer", () => {
        it("renders cleanly at different sizes", () => {
            const chat = new ChatView({ banner: "Banner" });
            chat.appendToFeed("message 1");
            chat.appendToFeed("message 2");
            // Render at one size
            layoutAndRender(chat, 60, 20);
            // Re-render at a different size (simulates resize)
            const { buffer } = layoutAndRender(chat, 40, 15);
            // Should still render banner
            const row0 = rowText(buffer, 0, 0, 6);
            expect(row0).toBe("Banner");
        });
        it("renders at minimum viable size", () => {
            const chat = new ChatView();
            // Even at 10x3, should not crash
            layoutAndRender(chat, 10, 3);
        });
        it("handles very small terminal gracefully", () => {
            const chat = new ChatView();
            const { ctx } = createRenderTarget(2, 2);
            chat.measure({ minWidth: 0, minHeight: 0, maxWidth: 2, maxHeight: 2 });
            chat.arrange({ x: 0, y: 0, width: 2, height: 2 });
            // Should not throw
            chat.render(ctx);
        });
    });
    describe("dropdown after external showDropdown + re-render", () => {
        it("dropdown persists across multiple render passes", () => {
            const chat = new ChatView({ banner: "B", prompt: "> " });
            const W = 50, H = 15;
            // First render — no dropdown
            let { buffer, ctx } = layoutAndRender(chat, W, H);
            // Simulate: user types, CLI shows dropdown, then forces refresh
            chat.showDropdown([
                { label: "/help", description: "Show help", completion: "/help " },
                { label: "/quit", description: "Quit", completion: "/quit " },
            ]);
            // Second render (simulates app.refresh())
            ({ buffer, ctx } = layoutAndRender(chat, W, H));
            // Dropdown should be in the last 2 rows
            const helpRow = rowText(buffer, H - 2, 0, 30);
            const quitRow = rowText(buffer, H - 1, 0, 30);
            expect(helpRow).toContain("/help");
            expect(quitRow).toContain("/quit");
        });
        it("dropdown appears when set during change event handler", () => {
            const chat = new ChatView({ banner: "B", prompt: "> " });
            const W = 50, H = 15;
            // Wire up a change handler that shows dropdown (like the CLI does)
            chat.on("change", (text) => {
                if (text.startsWith("/") && text.length >= 2) {
                    chat.showDropdown([
                        { label: "/help", description: "Show help", completion: "/help " },
                    ]);
                }
                else {
                    chat.hideDropdown();
                }
            });
            // Do initial render
            let { buffer, ctx } = layoutAndRender(chat, W, H);
            // Simulate typing "/" then "h" — exactly as App would
            chat.handleInput(charKey("/"));
            // After "/", no dropdown (length < 2)
            ({ buffer } = layoutAndRender(chat, W, H));
            let hasDropdown = false;
            for (let y = 0; y < H; y++) {
                if (rowText(buffer, y, 0, 30).includes("/help")) {
                    hasDropdown = true;
                    break;
                }
            }
            expect(hasDropdown).toBe(false);
            // Type "h" — should trigger dropdown
            chat.handleInput(charKey("h"));
            // Re-render (simulates App's scheduled render after input)
            ({ buffer } = layoutAndRender(chat, W, H));
            hasDropdown = false;
            let dropdownRow = -1;
            for (let y = 0; y < H; y++) {
                const row = rowText(buffer, y, 0, 40);
                if (row.includes("/help")) {
                    hasDropdown = true;
                    dropdownRow = y;
                    break;
                }
            }
            expect(hasDropdown).toBe(true);
            // Dropdown should be after the input line (near bottom)
            expect(dropdownRow).toBeGreaterThanOrEqual(H - 3);
        });
        it("dropdown survives re-render after invalidation", () => {
            const chat = new ChatView({ prompt: "> " });
            const W = 40, H = 10;
            // Show dropdown
            chat.showDropdown([
                { label: "/test", description: "Test cmd", completion: "/test " },
            ]);
            // Render once
            layoutAndRender(chat, W, H);
            // Simulate TextInput invalidation (what happens after insert)
            chat.input.setValue("x");
            // Re-render (like App._renderFrame after setImmediate)
            const { buffer } = layoutAndRender(chat, W, H);
            // Dropdown should still be there
            let found = false;
            for (let y = 0; y < H; y++) {
                if (rowText(buffer, y, 0, 30).includes("/test")) {
                    found = true;
                    break;
                }
            }
            expect(found).toBe(true);
        });
    });
    describe("full render cycle", () => {
        it("renders banner + separator + feed + separator + input", () => {
            const chat = new ChatView({
                banner: "Test Chat",
                prompt: "> ",
            });
            chat.appendToFeed("Hello world");
            const { buffer } = layoutAndRender(chat, 40, 8);
            // Row 0: "Test Chat"
            expect(rowText(buffer, 0, 0, 9)).toBe("Test Chat");
            // Row 1: separator (repeated char)
            const sep = rowText(buffer, 1, 0, 3);
            expect(sep).toBe("───");
            // Feed should contain "Hello world" somewhere in rows 2-5
            let feedFound = false;
            for (let y = 2; y < 6; y++) {
                if (rowText(buffer, y, 0, 11) === "Hello world") {
                    feedFound = true;
                    break;
                }
            }
            expect(feedFound).toBe(true);
            // Input at row 5, separator at row 6, footer at row 7
            const inputRow = rowText(buffer, 5, 0, 2);
            expect(inputRow).toBe("> ");
        });
    });
});
