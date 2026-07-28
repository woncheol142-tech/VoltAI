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
  createKecHybridSearchOrchestrator,
  type KecHybridSearchDependencies,
  type KecHybridSearchOrchestrator,
  type KecHybridSearchResult,
} from "../src/searchHybrid/index.js";
import type {
  KecLexicalSearcher,
  KecRankCandidate,
  KecRankingStrategy,
  KecSearchRequest,
  KecSemanticSearcher,
} from "../src/searchFoundation/index.js";
import {
  createSearchKecTool,
  searchKec,
  type SearchKecDependencies,
  type SearchKecInput,
} from "../src/tools/searchKec.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(testDirectory, "..");
const workspaceRoot = join(packageRoot, "..", "..");
const hybridRoot = join(packageRoot, "src", "searchHybrid");
const semanticRoot = join(packageRoot, "src", "searchSemantic");
const packageIndex = join(packageRoot, "src", "index.ts");
const searchKecFile = join(packageRoot, "src", "tools", "searchKec.ts");
const legacyFiles = [
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
];
const headStableLegacyFiles = legacyFiles.filter(
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

describe("KEC hybrid search compatibility and dependency boundaries", () => {
  it("reserves exactly the four approved production modules", () => {
    expect(existsSync(hybridRoot)).toBe(true);
    expect(
      sourceFiles(hybridRoot)
        .map((path) => path.slice(hybridRoot.length + 1))
        .sort(),
    ).toEqual([
      "hybridSearch.ts",
      "index.ts",
      "mergeCandidates.ts",
      "types.ts",
    ]);
  });

  it("keeps orchestration free of legacy, network, storage, cache, and timer dependencies", () => {
    const sources = sourceFiles(hybridRoot);
    const forbiddenPatterns = [
      /\bEmbeddingProvider\b/,
      /\bVectorStore\b/,
      /\bsearchKec\b/,
      /\bsearchSemantic\b/,
      /\bSqlite\b/i,
      /\bOpenAI\b/,
      /\bfetch\s*\(/,
      /https?:\/\//,
      /from\s+["']node:(?:fs|path|crypto|http|https)/,
      /\bWeakMap\b/,
      /\bcache\b/i,
      /\bretry\b/i,
      /\bset(?:Timeout|Interval)\b/,
      /\.trim\s*\(/,
      /\.normalize\s*\(/,
      /\blocaleCompare\b/,
      /@modelcontextprotocol/,
    ];

    expect(sources).toHaveLength(4);
    for (const path of sources) {
      const source = readFileSync(path, "utf8");

      for (const pattern of forbiddenPatterns) {
        expect(source).not.toMatch(pattern);
      }
    }
  });

  it("does not add a package-root export or connect existing runtime modules", () => {
    expect(readFileSync(packageIndex, "utf8")).not.toContain("searchHybrid");

    for (const path of legacyFiles) {
      expect(readFileSync(path, "utf8")).not.toContain("searchHybrid");
    }

    for (const path of sourceFiles(semanticRoot)) {
      expect(readFileSync(path, "utf8")).not.toContain("searchHybrid");
    }
  });

  it("keeps Task 46, Task 47, dependencies, and SQLite contracts head-stable", () => {
    expect(() =>
      execFileSync(
        "git",
        [
          "diff",
          "--exit-code",
          "HEAD",
          "--",
          ...headStableLegacyFiles,
          ...sourceFiles(hybridRoot),
          join(packageRoot, "package.json"),
          join(workspaceRoot, "package.json"),
          join(workspaceRoot, "pnpm-lock.yaml"),
        ],
        { cwd: workspaceRoot, stdio: "pipe" },
      ),
    ).not.toThrow();
  });

  it("keeps the legacy search API and MCP schema unchanged", () => {
    expectTypeOf<KecHybridSearchResult>().toEqualTypeOf<
      readonly KecRankCandidate[]
    >();
    expectTypeOf<KecHybridSearchDependencies>().toEqualTypeOf<{
      readonly semanticSearcher: KecSemanticSearcher;
      readonly lexicalSearcher: KecLexicalSearcher;
      readonly rankingStrategy: KecRankingStrategy;
    }>();
    expectTypeOf<KecHybridSearchOrchestrator>().toEqualTypeOf<{
      search(request: KecSearchRequest): Promise<readonly KecRankCandidate[]>;
    }>();
    expectTypeOf<typeof createKecHybridSearchOrchestrator>().toEqualTypeOf<
      (dependencies: KecHybridSearchDependencies) => KecHybridSearchOrchestrator
    >();
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
  });

  it("preserves legacy semantic search output identity", async () => {
    const expected: KecSearchResult[] = [
      {
        clause: "KEC 232.5",
        page: 3,
        text: "Cable sizing requirement.",
        similarity: 0.92,
        sourcePath: "knowledge/kec.pdf",
      },
    ];
    const vectorStore: VectorStore = {
      upsert: async () => {},
      replaceSource: async () => {},
      deleteBySourcePath: async () => {},
      search: async () => expected,
      listChunks: async () => [],
      saveIndexMetadata: async () => {},
      getIndexMetadata: async () => ({
        embeddingProvider: "test",
        embeddingModel: "fixed",
        dimensions: 3,
        indexedAt: "2026-07-25T00:00:00.000Z",
      }),
      close: async () => {},
    };

    const result = await searchKec(
      { query: "cable", topK: 3 },
      {
        embeddingProvider: {
          embed: async () => [1, 0, 0],
          getMetadata: () => ({ provider: "test", model: "fixed" }),
        },
        vectorStore,
      },
    );

    expect(result).toBe(expected);
    expect(result[0]).toBe(expected[0]);

    await expect(
      searchKec(
        { query: "cable", topK: 3 },
        {
          embeddingProvider: {
            embed: async () => [1, 0, 0],
            getMetadata: () => ({ provider: "test", model: "fixed" }),
          },
          vectorStore: {
            ...vectorStore,
            getIndexMetadata: async () => null,
          },
        },
      ),
    ).rejects.toThrow(
      "KEC index embedding metadata mismatch. Please re-run index_kec.",
    );
  });

  it("does not introduce a separate request DTO", () => {
    const sources = sourceFiles(hybridRoot).map((path) =>
      readFileSync(path, "utf8"),
    );

    expect(sources.join("\n")).not.toContain("KecHybridSearchRequest");
  });
});
