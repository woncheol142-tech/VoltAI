import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, expectTypeOf, it } from "vitest";

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
const hybridRoot = join(packageRoot, "src", "searchHybrid");
const packageIndex = join(packageRoot, "src", "index.ts");
const legacyFiles = [
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
  });

  it("does not change legacy runtime, Task 46, dependencies, or SQLite contracts", () => {
    expect(() =>
      execFileSync(
        "git",
        [
          "diff",
          "--exit-code",
          "HEAD",
          "--",
          ...legacyFiles,
          join(packageRoot, "package.json"),
          join(workspaceRoot, "package.json"),
          join(workspaceRoot, "pnpm-lock.yaml"),
        ],
        { cwd: workspaceRoot, stdio: "pipe" },
      ),
    ).not.toThrow();
  });

  it("keeps the legacy search API and MCP schema unchanged", () => {
    expectTypeOf<SearchKecInput>().toEqualTypeOf<{
      question?: string;
      query?: string;
      topK?: number;
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
  });

  it("does not introduce a separate request DTO", () => {
    const sources = sourceFiles(hybridRoot).map((path) =>
      readFileSync(path, "utf8"),
    );

    expect(sources.join("\n")).not.toContain("KecHybridSearchRequest");
  });
});
