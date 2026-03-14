/**
 * FileDropHandler — detects dragged/dropped files in terminal input.
 *
 * When a file is dragged into a terminal, the OS pastes the file path as text.
 * This handler detects path-like input and converts it to file attachment tags.
 *
 * Supports images (png, jpg, gif, webp, svg) and general files.
 * Works on both Windows (C:\...) and macOS/Linux (/...) terminals.
 */

import { existsSync, statSync } from "node:fs";
import { basename, extname, resolve } from "node:path";

const IMAGE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico", ".tiff", ".tif",
]);

const KNOWN_EXTENSIONS = new Set([
  ...IMAGE_EXTENSIONS,
  ".pdf", ".txt", ".md", ".json", ".csv", ".xml", ".yaml", ".yml",
  ".ts", ".js", ".py", ".go", ".rs", ".java", ".c", ".cpp", ".h",
  ".html", ".css", ".sql", ".sh", ".bat", ".ps1",
  ".log", ".env", ".toml", ".ini", ".cfg",
]);

export interface FileAttachment {
  /** Unique ID for this attachment. */
  id: number;
  /** Absolute path to the file. */
  path: string;
  /** File basename. */
  name: string;
  /** Whether this is an image file. */
  isImage: boolean;
  /** File size in bytes. */
  size: number;
}

export class FileDropHandler {
  private nextId = 1;
  private attachments = new Map<number, FileAttachment>();

  /** All current attachments. */
  getAll(): FileAttachment[] {
    return [...this.attachments.values()];
  }

  /** Get a specific attachment by ID. */
  get(id: number): FileAttachment | undefined {
    return this.attachments.get(id);
  }

  /** Remove an attachment by ID. */
  remove(id: number): boolean {
    return this.attachments.delete(id);
  }

  /** Clear all attachments. */
  clear(): void {
    this.attachments.clear();
  }

  /**
   * Check if a string looks like a file path that was drag-and-dropped.
   * Returns the cleaned path if it's a valid file, null otherwise.
   */
  detectFilePath(input: string): string | null {
    let candidate = input.trim();

    // Strip surrounding quotes (Windows often wraps paths in quotes)
    if (
      (candidate.startsWith('"') && candidate.endsWith('"')) ||
      (candidate.startsWith("'") && candidate.endsWith("'"))
    ) {
      candidate = candidate.slice(1, -1);
    }

    // Must look like an absolute path
    const isAbsoluteWindows = /^[A-Za-z]:\\/.test(candidate);
    const isAbsoluteUnix = candidate.startsWith("/");
    if (!isAbsoluteWindows && !isAbsoluteUnix) return null;

    // Should not contain newlines or control characters
    if (/[\n\r\t]/.test(candidate)) return null;

    // Resolve and check existence
    const resolved = resolve(candidate);
    try {
      const st = statSync(resolved);
      if (st.isFile()) return resolved;
    } catch {
      // File doesn't exist
    }

    return null;
  }

  /**
   * Try to convert input text into file attachments.
   * Returns the modified input (with file tags inserted) and whether any files were detected.
   */
  processInput(input: string): { text: string; filesDetected: boolean } {
    // Check if the entire input is a single file path
    const singlePath = this.detectFilePath(input);
    if (singlePath) {
      const attachment = this.addFile(singlePath);
      const tag = this.formatTag(attachment);
      return { text: tag + " ", filesDetected: true };
    }

    // Check for file paths mixed with text — look for path-like tokens
    let modified = input;
    let detected = false;

    // Match Windows paths: C:\... or "C:\..."
    // Match Unix paths: /home/... or "/home/..."
    const pathPattern = /(?:"([A-Za-z]:\\[^"]+)"|'([A-Za-z]:\\[^']+)'|([A-Za-z]:\\[^\s]+)|"(\/[^"]+)"|'(\/[^']+)'|(\/[^\s]+\.\w{1,5}))/g;

    let match;
    const replacements: { from: string; to: string }[] = [];

    while ((match = pathPattern.exec(input)) !== null) {
      const rawMatch = match[0];
      const path = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? match[6];
      const resolved = this.detectFilePath(path);
      if (resolved) {
        const attachment = this.addFile(resolved);
        replacements.push({ from: rawMatch, to: this.formatTag(attachment) });
        detected = true;
      }
    }

    for (const { from, to } of replacements) {
      modified = modified.replace(from, to);
    }

    return { text: modified, filesDetected: detected };
  }

  /**
   * Expand file tags in a string, replacing [Image #N] / [File #N] with
   * the actual file path for downstream processing.
   */
  expandTags(input: string): { text: string; attachments: FileAttachment[] } {
    const used: FileAttachment[] = [];

    const expanded = input.replace(
      /\[(Image|File) #(\d+)\]/g,
      (_match, _type, num) => {
        const id = parseInt(num, 10);
        const attachment = this.attachments.get(id);
        if (attachment) {
          used.push(attachment);
          return attachment.path;
        }
        return _match;
      }
    );

    return { text: expanded, attachments: used };
  }

  private addFile(filePath: string): FileAttachment {
    // Check if this file is already attached
    for (const existing of this.attachments.values()) {
      if (existing.path === filePath) return existing;
    }

    const ext = extname(filePath).toLowerCase();
    const st = statSync(filePath);

    const attachment: FileAttachment = {
      id: this.nextId++,
      path: filePath,
      name: basename(filePath),
      isImage: IMAGE_EXTENSIONS.has(ext),
      size: st.size,
    };

    this.attachments.set(attachment.id, attachment);
    return attachment;
  }

  /** Format an attachment as an inline tag. */
  formatTag(attachment: FileAttachment): string {
    const type = attachment.isImage ? "Image" : "File";
    return `[${type} #${attachment.id}]`;
  }

  /** Format a human-readable summary of an attachment. */
  formatSummary(attachment: FileAttachment): string {
    const type = attachment.isImage ? "Image" : "File";
    const sizeKB = (attachment.size / 1024).toFixed(1);
    return `${type} #${attachment.id}: ${attachment.name} (${sizeKB}KB)`;
  }
}
