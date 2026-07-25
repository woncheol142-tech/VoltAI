import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  KecSemanticSearcher,
  KecSearchRequest,
} from "../src/searchFoundation/index.js";
import type { EmbeddingProvider } from "../src/knowledge/embedding.js";
import type {
  EmbeddedKecChunk,
  KecChunk,
  KecIndexMetadata,
  KecSearchResult,
  KnowledgeCollection,
  VectorStore,
} from "../src/knowledge/vectorStore.js";
import {
  createSearchKecTool,
  searchKec,
  type SearchKecDependencies,
  type SearchKecInput,
} from "../src/tools/searchKec.js";

const testFile = fileURLToPath(import.meta.url);
const packageRoot = join(dirname(testFile), "..");
const workspaceRoot = join(packageRoot, "..", "..");
const foundationIndex = join(
  packageRoot,
  "src",
  "searchFoundation",
  "index.ts",
);
const typescriptCli = join(
  workspaceRoot,
  "node_modules",
  "typescript",
  "bin",
  "tsc",
);

type ExpectedEmbeddingProvider = {
  embed: (text: string) => Promise<number[]>;
  getMetadata: () => {
    provider: string;
    model: string;
  };
};

type ExpectedVectorStore = {
  upsert: (
    collection: KnowledgeCollection,
    chunks: EmbeddedKecChunk[],
  ) => Promise<void>;
  replaceSource: (
    collection: KnowledgeCollection,
    sourcePath: string,
    chunks: EmbeddedKecChunk[],
    metadata: KecIndexMetadata,
  ) => Promise<void>;
  deleteBySourcePath: (
    collection: KnowledgeCollection,
    sourcePath: string,
  ) => Promise<void>;
  search: (
    collection: KnowledgeCollection,
    embedding: number[],
    topK: number,
  ) => Promise<KecSearchResult[]>;
  listChunks: (collection: KnowledgeCollection) => Promise<KecChunk[]>;
  saveIndexMetadata: (
    collection: KnowledgeCollection,
    metadata: KecIndexMetadata,
  ) => Promise<void>;
  getIndexMetadata: (
    collection: KnowledgeCollection,
  ) => Promise<KecIndexMetadata | null>;
  close: () => Promise<void> | void;
};

describe("KEC search foundation legacy compatibility", () => {
  it("compiles without changing the existing or future search contracts", () => {
    expect(existsSync(foundationIndex)).toBe(true);

    expect(() =>
      execFileSync(
        process.execPath,
        [
          typescriptCli,
          "--noEmit",
          "--strict",
          "--target",
          "ES2022",
          "--module",
          "NodeNext",
          "--moduleResolution",
          "NodeNext",
          "--skipLibCheck",
          testFile,
        ],
        { cwd: workspaceRoot, stdio: "pipe" },
      ),
    ).not.toThrow();
  });

  it("keeps searchKec and its input contract unchanged", () => {
    expectTypeOf<SearchKecInput>().toEqualTypeOf<{
      question?: string;
      query?: string;
      topK?: number;
    }>();
    expectTypeOf<typeof searchKec>().toEqualTypeOf<
      (
        input: unknown,
        deps: SearchKecDependencies,
      ) => Promise<KecSearchResult[]>
    >();
    expectTypeOf<KecSemanticSearcher["search"]>()
      .parameter(0)
      .toEqualTypeOf<KecSearchRequest>();
  });

  it("keeps EmbeddingProvider and VectorStore unchanged", () => {
    expectTypeOf<EmbeddingProvider>().toEqualTypeOf<ExpectedEmbeddingProvider>();
    expectTypeOf<VectorStore>().toEqualTypeOf<ExpectedVectorStore>();
  });

  it("preserves existing semantic vector search inputs and output identity", async () => {
    const calls: unknown[] = [];
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
        embed: async (text) => {
          calls.push(["embed", text]);
          return [1, 0, 0];
        },
        getMetadata: () => ({ provider: "test", model: "fixed" }),
      },
      vectorStore: {
        upsert: async () => {},
        replaceSource: async () => {},
        deleteBySourcePath: async () => {},
        search: async (collection, embedding, topK) => {
          calls.push(["search", collection, embedding, topK]);
          return expectedResults;
        },
        listChunks: async () => [],
        saveIndexMetadata: async () => {},
        getIndexMetadata: async () => ({
          embeddingProvider: "test",
          embeddingModel: "fixed",
          dimensions: 3,
          indexedAt: "2026-07-23T00:00:00.000Z",
        }),
        close: async () => {},
      },
    };

    const results = await searchKec({ query: "cable", topK: 3 }, dependencies);

    expect(results).toBe(expectedResults);
    expect(calls).toEqual([
      ["embed", "cable"],
      ["search", "kec", [1, 0, 0], 3],
    ]);
  });

  it("keeps the search_kec MCP name and schema unchanged", () => {
    const tool = createSearchKecTool();

    expect(tool.name).toBe("search_kec");
    expect(Object.keys(tool.inputSchema)).toEqual(["query", "topK"]);
  });
});
