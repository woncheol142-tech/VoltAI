import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(testDirectory, "..");
const workspaceRoot = join(packageRoot, "..", "..");
const rankingRoot = join(packageRoot, "src", "searchRanking");
const packageIndex = join(packageRoot, "src", "index.ts");
const protectedFiles = [
  packageIndex,
  join(packageRoot, "src", "tools", "searchKec.ts"),
  join(packageRoot, "src", "knowledge", "embedding.ts"),
  join(packageRoot, "src", "knowledge", "vectorStore.ts"),
  join(packageRoot, "src", "knowledge", "sqliteVectorStore.ts"),
  join(packageRoot, "src", "searchFoundation", "types.ts"),
  join(packageRoot, "src", "searchFoundation", "semanticSearcher.ts"),
  join(packageRoot, "src", "searchFoundation", "lexicalSearcher.ts"),
  join(packageRoot, "src", "searchFoundation", "rankingStrategy.ts"),
  join(packageRoot, "src", "searchFoundation", "index.ts"),
  join(packageRoot, "src", "searchHybrid", "types.ts"),
  join(packageRoot, "src", "searchHybrid", "mergeCandidates.ts"),
  join(packageRoot, "src", "searchHybrid", "hybridSearch.ts"),
  join(packageRoot, "src", "searchHybrid", "index.ts"),
];

function sourceFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return sourceFiles(path);
    }

    return extname(entry.name) === ".ts" ? [path] : [];
  });
}

describe("KEC weighted ranking compatibility and dependency boundaries", () => {
  it("reserves exactly the four approved production modules", () => {
    expect(existsSync(rankingRoot)).toBe(true);
    expect(
      sourceFiles(rankingRoot)
        .map((path) => path.slice(rankingRoot.length + 1))
        .sort(),
    ).toEqual([
      "index.ts",
      "types.ts",
      "validateWeightedRanking.ts",
      "weightedRanking.ts",
    ]);
  });

  it("allows only Task 46 type imports and internal ranking modules", () => {
    const sources = sourceFiles(rankingRoot);

    expect(sources).toHaveLength(4);
    for (const path of sources) {
      const source = readFileSync(path, "utf8");
      const specifiers = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map(
        (match) => match[1]!,
      );

      for (const specifier of specifiers) {
        if (specifier.startsWith("./")) {
          continue;
        }

        expect(specifier).toBe("../searchFoundation/index.js");
        expect(source).toMatch(/import\s+type/);
      }
    }
  });

  it("keeps ranking free of providers, orchestration, infrastructure, and side effects", () => {
    const sources = sourceFiles(rankingRoot);
    const forbiddenPatterns = [
      /\bsearchKec\b/,
      /\bsearchHybrid\b/,
      /\bEmbeddingProvider\b/,
      /\bVectorStore\b/,
      /\bSqlite\b/i,
      /\bOpenAI\b/,
      /\bfetch\s*\(/,
      /https?:\/\//,
      /from\s+["']node:(?:fs|path|crypto|http|https)/,
      /@modelcontextprotocol/,
      /\bWeakMap\b/,
      /\bcache\b/i,
      /\bretry\b/i,
      /\bset(?:Timeout|Interval)\b/,
      /\bRRF\b/i,
      /\bReciprocalRankFusion\b/i,
      /\brerank/i,
      /\bRankingPolicy\b/,
      /\.trim\s*\(/,
      /\.normalize\s*\(/,
      /\blocaleCompare\b/,
      /console\./,
    ];

    expect(sources).toHaveLength(4);
    for (const path of sources) {
      const source = readFileSync(path, "utf8");

      for (const pattern of forbiddenPatterns) {
        expect(source).not.toMatch(pattern);
      }
    }
  });

  it("does not expose weightedScore or add a package-root export", () => {
    expect(readFileSync(packageIndex, "utf8")).not.toContain("searchRanking");

    const publicSources = [
      join(rankingRoot, "types.ts"),
      join(rankingRoot, "index.ts"),
    ]
      .filter((path) => existsSync(path))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    expect(publicSources).not.toContain("weightedScore");
    expect(publicSources).not.toContain("KecWeightedRankCandidate");
    expect(publicSources).not.toContain("KecWeightedRankingRequest");
  });

  it("does not change Task 46, Task 47, legacy runtime, or repository dependencies", () => {
    expect(() =>
      execFileSync(
        "git",
        [
          "diff",
          "--exit-code",
          "HEAD",
          "--",
          ...protectedFiles,
          join(packageRoot, "package.json"),
          join(workspaceRoot, "package.json"),
          join(workspaceRoot, "pnpm-lock.yaml"),
        ],
        { cwd: workspaceRoot, stdio: "pipe" },
      ),
    ).not.toThrow();
  });
});
