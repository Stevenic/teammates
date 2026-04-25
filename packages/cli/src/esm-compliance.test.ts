/**
 * ESM compliance tests — verify that all source files in the monorepo
 * avoid CJS-only patterns that break under "type": "module".
 *
 * Catches bugs like the require() call in onboard-flow.ts that caused
 * "require is not defined" at runtime.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..", "..");

const PACKAGES = [
  join(ROOT, "packages", "cli", "src"),
  join(ROOT, "packages", "recall", "src"),
  join(ROOT, "packages", "consolonia", "src"),
];

/** Recursively collect all .ts files (excluding .test.ts and .d.ts). */
function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(full));
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".d.ts")
    ) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Match bare require() calls that are NOT inside comments or strings that
 * look like documentation. We look for `require(` preceded by a non-word
 * boundary or start-of-line (catches `= require(`, `const x = require(`).
 * We exclude lines that are clearly single-line comments.
 */
function findRequireCalls(content: string): { line: number; text: string }[] {
  const hits: { line: number; text: string }[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // Skip single-line comments and lines inside JSDoc/block comments
    if (line.startsWith("//") || line.startsWith("*") || line.startsWith("/*"))
      continue;
    // Match require("...") or require('...') — actual CJS calls
    if (/\brequire\s*\(/.test(line)) {
      hits.push({ line: i + 1, text: line });
    }
  }
  return hits;
}

/**
 * Match __dirname or __filename usage outside of comments, UNLESS the file
 * contains the standard ESM polyfill (`fileURLToPath(import.meta.url)`).
 * Files that define their own __dirname from import.meta.url are safe.
 */
function findCjsGlobals(
  content: string,
): { line: number; text: string; global: string }[] {
  // If the file uses the standard ESM polyfill, all __dirname/__filename
  // references are safe (they're locally scoped const variables).
  if (content.includes("fileURLToPath(import.meta.url)")) return [];

  const hits: { line: number; text: string; global: string }[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("//") || line.startsWith("*") || line.startsWith("/*"))
      continue;
    for (const g of ["__dirname", "__filename"]) {
      if (new RegExp(`\\b${g}\\b`).test(line)) {
        hits.push({ line: i + 1, text: line, global: g });
      }
    }
  }
  return hits;
}

describe("ESM compliance", () => {
  const allFiles = PACKAGES.flatMap(collectSourceFiles);

  it("finds source files to scan", () => {
    // Sanity check — make sure the scan is actually running
    expect(allFiles.length).toBeGreaterThan(10);
  });

  it("no source files use require() — use import instead", () => {
    const violations: string[] = [];
    for (const file of allFiles) {
      const content = readFileSync(file, "utf-8");
      const hits = findRequireCalls(content);
      for (const hit of hits) {
        violations.push(`${relative(ROOT, file)}:${hit.line} → ${hit.text}`);
      }
    }
    expect(
      violations,
      `Found require() calls in ESM source files:\n${violations.join("\n")}`,
    ).toEqual([]);
  });

  it("no source files use __dirname or __filename — use import.meta.url instead", () => {
    const violations: string[] = [];
    for (const file of allFiles) {
      const content = readFileSync(file, "utf-8");
      const hits = findCjsGlobals(content);
      for (const hit of hits) {
        violations.push(
          `${relative(ROOT, file)}:${hit.line} → ${hit.global}: ${hit.text}`,
        );
      }
    }
    expect(
      violations,
      `Found CJS globals in ESM source files:\n${violations.join("\n")}`,
    ).toEqual([]);
  });

  it("all packages declare type: module", () => {
    const pkgDirs = [
      join(ROOT, "packages", "cli"),
      join(ROOT, "packages", "recall"),
      join(ROOT, "packages", "consolonia"),
    ];
    for (const dir of pkgDirs) {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
      expect(
        pkg.type,
        `${relative(ROOT, dir)}/package.json should have "type": "module"`,
      ).toBe("module");
    }
  });
});
