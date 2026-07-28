import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(testDirectory, "..");
const coreRoot = join(packageRoot, "src", "searchSemantic");
const packageIndex = join(packageRoot, "src", "index.ts");

function sourceFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? sourceFiles(path)
      : extname(entry.name) === ".ts"
        ? [path]
        : [];
  });
}

describe("KEC shared semantic search core boundaries", () => {
  it("contains only the approved shared-core modules", () => {
    expect(
      sourceFiles(coreRoot)
        .map((path) => path.slice(coreRoot.length + 1))
        .sort(),
    ).toEqual(["semanticSearchCore.ts", "types.ts"]);
  });

  it("contains no projection, adapter, orchestration, cache, or side effects", () => {
    const sources = sourceFiles(coreRoot);
    const forbiddenPatterns = [
      /\bKecSemanticHit\b/,
      /\bKecSearchResult\b/,
      /\bchunkId\b/,
      /\bsemanticScore\b/,
      /\bprojection\b/i,
      /\badapter\b/i,
      /\branking\b/i,
      /\bhybrid\b/i,
      /\bcache\b/i,
      /\bretry\b/i,
      /\btimeout\b/i,
      /\bconsole\./,
      /\bfetch\s*\(/,
      /\bWeakMap\b/,
      /\bset(?:Timeout|Interval)\b/,
      /@modelcontextprotocol/,
      /from\s+["']node:(?:fs|path|http|https|child_process)/,
      /\beval\s*\(/,
      /\bnew Function\b/,
    ];

    expect(sources).toHaveLength(2);
    for (const path of sources) {
      const source = readFileSync(path, "utf8");
      for (const pattern of forbiddenPatterns) {
        expect(source).not.toMatch(pattern);
      }
    }
  });

  it("does not add a package-root export", () => {
    expect(readFileSync(packageIndex, "utf8")).not.toContain(
      "./searchSemantic",
    );
  });

  it("does not import Task 46, Task 47, or Task 48 runtime modules", () => {
    const sources = sourceFiles(coreRoot)
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    expect(sources).not.toMatch(/searchFoundation|searchHybrid|searchRanking/);
  });
});
