import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, expectTypeOf, it } from "vitest";

import type { EmbeddingProvider } from "../src/knowledge/embedding.js";
import type {
  KecSearchResult,
  VectorStore,
} from "../src/knowledge/vectorStore.js";
import {
  createSearchKecTool,
  searchKec,
  type SearchKecDependencies,
  type SearchKecInput,
} from "../src/tools/searchKec.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(testDirectory, "..");
const workspaceRoot = join(packageRoot, "..", "..");
const rankingRoot = join(packageRoot, "src", "searchRanking");
const packageIndex = join(packageRoot, "src", "index.ts");
const searchKecFile = join(packageRoot, "src", "tools", "searchKec.ts");
const legacyRuntimeFiles = [
  packageIndex,
  searchKecFile,
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
const headStableFiles = legacyRuntimeFiles.filter(
  (path) => path !== searchKecFile,
);

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

    for (const path of legacyRuntimeFiles) {
      expect(readFileSync(path, "utf8")).not.toContain("searchRanking");
    }

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

  it("preserves legacy contracts without coupling Task 48 to its runtime", async () => {
    expectTypeOf<SearchKecInput>().toEqualTypeOf<{
      question?: string;
      query?: string;
      topK?: number;
    }>();
    expectTypeOf<SearchKecDependencies>().toEqualTypeOf<{
      embeddingProvider: EmbeddingProvider;
      vectorStore: VectorStore;
    }>();
    expectTypeOf<KecSearchResult>().toEqualTypeOf<{
      clause: string | null;
      page: number;
      text: string;
      similarity: number;
      sourcePath: string;
    }>();
    expectTypeOf<typeof searchKec>().toEqualTypeOf<
      (
        input: unknown,
        dependencies: SearchKecDependencies,
      ) => Promise<KecSearchResult[]>
    >();

    const tool = createSearchKecTool();
    expect(tool.name).toBe("search_kec");
    expect(Object.keys(tool.inputSchema)).toEqual(["query", "topK"]);
    expect(tool.inputSchema.query.safeParse("cable").success).toBe(true);
    expect(tool.inputSchema.query.safeParse("").success).toBe(false);
    expect(tool.inputSchema.topK.safeParse(undefined).success).toBe(true);
    expect(tool.inputSchema.topK.safeParse(1).success).toBe(true);
    expect(tool.inputSchema.topK.safeParse(0).success).toBe(false);
    expect(tool.inputSchema.topK.safeParse(1.5).success).toBe(false);

    expect(() =>
      execFileSync(
        "git",
        [
          "diff",
          "--exit-code",
          "HEAD",
          "--",
          ...headStableFiles,
          join(packageRoot, "package.json"),
          join(workspaceRoot, "package.json"),
          join(workspaceRoot, "pnpm-lock.yaml"),
        ],
        { cwd: workspaceRoot, stdio: "pipe" },
      ),
    ).not.toThrow();

    const expectedResults: KecSearchResult[] = [
      {
        clause: "KEC 232.5",
        page: 3,
        text: "Cable sizing requirement.",
        similarity: 0.92,
        sourcePath: "knowledge/kec.pdf",
      },
    ];
    const dependencies: SearchKecDependencies = {
      embeddingProvider: {
        embed: async () => [1, 0, 0],
        getMetadata: () => ({ provider: "test", model: "fixed" }),
      },
      vectorStore: {
        upsert: async () => {},
        replaceSource: async () => {},
        deleteBySourcePath: async () => {},
        search: async () => expectedResults,
        listChunks: async () => [],
        saveIndexMetadata: async () => {},
        getIndexMetadata: async () => ({
          embeddingProvider: "test",
          embeddingModel: "fixed",
          dimensions: 3,
          indexedAt: "2026-07-28T00:00:00.000Z",
        }),
        close: async () => {},
      },
    };

    const results = await searchKec({ query: "cable", topK: 3 }, dependencies);
    expect(results).toBe(expectedResults);
    expect(results[0]).toBe(expectedResults[0]);

    await expect(
      searchKec(
        { query: "cable", topK: 3 },
        {
          ...dependencies,
          vectorStore: {
            ...dependencies.vectorStore,
            getIndexMetadata: async () => null,
          },
        },
      ),
    ).rejects.toThrow(
      "KEC index embedding metadata mismatch. Please re-run index_kec.",
    );
  });
});
