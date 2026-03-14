/**
 * Unit tests for the ChatView widget.
 */

import { describe, it, expect, vi } from "vitest";
import { ChatView } from "../widgets/chat-view.js";
import { PixelBuffer } from "../pixel/buffer.js";
import { DrawingContext } from "../drawing/context.js";
import { keyEvent, mouseEvent } from "../input/events.js";
import type { Constraint } from "../layout/types.js";

// ── Helpers ──────────────────────────────────────────────────────────

function createRenderTarget(width = 60, height = 20) {
  const buffer = new PixelBuffer(width, height);
  const ctx = new DrawingContext(buffer);
  return { buffer, ctx };
}

function rowText(buffer: PixelBuffer, y: number, x0 = 0, x1?: number): string {
  const end = x1 ?? buffer.width;
  let s = "";
  for (let x = x0; x < end; x++) {
    s += buffer.get(x, y).foreground.symbol.text;
  }
  return s;
}

/** Full layout + render a ChatView at the given dimensions. */
function layoutAndRender(chat: ChatView, width = 60, height = 20) {
  const { buffer, ctx } = createRenderTarget(width, height);
  const constraint: Constraint = {
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
function charKey(ch: string) {
  return keyEvent(ch, ch);
}

/** Create a key event for a special key (non-printable). */
function specialKey(key: string) {
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

    it("renders the input line at the bottom", () => {
      const chat = new ChatView({ prompt: "> " });
      chat.inputValue = "test";
      const { buffer } = layoutAndRender(chat, 40, 10);

      // Input should be on the last row (row 9)
      const inputRow = rowText(buffer, 9, 0, 6);
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
      expect(item!.label).toBe("/help");
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

      // Find dropdown text
      let found = false;
      for (let y = 0; y < 12; y++) {
        const row = rowText(buffer, y, 0, 30);
        if (row.includes("/help")) {
          found = true;
          break;
        }
      }
      expect(found).toBe(true);
    });
  });

  describe("mouse scrolling", () => {
    it("scrolls feed on wheel up", () => {
      const chat = new ChatView();
      for (let i = 0; i < 30; i++) chat.appendToFeed(`line ${i}`);
      const result = chat.handleInput(mouseEvent(0, 0, "none", "wheelup"));
      expect(result).toBe(true);
    });

    it("scrolls feed on wheel down", () => {
      const chat = new ChatView();
      for (let i = 0; i < 30; i++) chat.appendToFeed(`line ${i}`);
      const result = chat.handleInput(mouseEvent(0, 0, "none", "wheeldown"));
      expect(result).toBe(true);
    });
  });

  describe("page scrolling", () => {
    it("scrolls feed on pageup", () => {
      const chat = new ChatView();
      for (let i = 0; i < 30; i++) chat.appendToFeed(`line ${i}`);
      const result = chat.handleInput(specialKey("pageup"));
      expect(result).toBe(true);
    });

    it("scrolls feed on pagedown", () => {
      const chat = new ChatView();
      for (let i = 0; i < 30; i++) chat.appendToFeed(`line ${i}`);
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

      // Last row should be the input with "> "
      const lastRow = rowText(buffer, 7, 0, 2);
      expect(lastRow).toBe("> ");
    });
  });
});
