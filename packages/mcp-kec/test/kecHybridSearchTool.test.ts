import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { KnowledgeVectorStore } from "@voltai/knowledge-core";
import type { VoltAiTool } from "@voltai/mcp-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { EmbeddingProvider } from "../src/knowledge/embedding.js";
import type { KecHybridSearchResult } from "../src/searchHybrid/index.js";
import type { ExistingKecHybridSearchDependencies } from "../src/searchIntegration/index.js";
import type { KecWeightedRankingOptions } from "../src/searchRanking/index.js";
import {
  hybridToolHarness,
  nativeHybridResult,
  rankingOptions,
} from "./helpers/kecHybridSearchToolFixture.js";

const searchKecHybridMock = vi.hoisted(() => vi.fn());
const createEmbeddingProviderFromEnvMock = vi.hoisted(() => vi.fn());
const sqliteKnowledgeStoreConstructor = vi.hoisted(() => vi.fn());
const testDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(testDirectory, "..");
const workspaceRoot = join(packageRoot, "..", "..");
const originalProjectRoot = process.env.PROJECT_ROOT;

vi.mock("../src/searchEntryPoints/index.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/searchEntryPoints/index.js")>();
  return { ...actual, searchKecHybrid: searchKecHybridMock };
});

vi.mock("../src/knowledge/embedding.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/knowledge/embedding.js")>();
  return {
    ...actual,
    createEmbeddingProviderFromEnv: createEmbeddingProviderFromEnvMock,
  };
});

vi.mock("@voltai/knowledge-sqlite", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@voltai/knowledge-sqlite")>();
  return {
    ...actual,
    SqliteKnowledgeStore: function SqliteKnowledgeStore(dbPath: string) {
      return sqliteKnowledgeStoreConstructor(dbPath);
    },
  };
});

type SearchKecHybridToolDependencies = Readonly<{
  rankingOptions: KecWeightedRankingOptions;
  embeddingProvider?: EmbeddingProvider;
  vectorStore?: Pick<
    KnowledgeVectorStore,
    "getIndexMetadata" | "search" | "listChunks"
  >;
}>;

type SearchKecHybridToolResult = Readonly<{
  results: KecHybridSearchResult;
}>;

type ToolModule = {
  createSearchKecHybridTool(
    dependencies: SearchKecHybridToolDependencies,
  ): VoltAiTool<SearchKecHybridToolResult>;
};

async function importToolModule(): Promise<ToolModule> {
  const moduleUrl = new URL("../src/tools/searchKecHybrid.ts", import.meta.url);
  return import(
    /* @vite-ignore */ fileURLToPath(moduleUrl)
  ) as Promise<ToolModule>;
}

async function createTool(
  dependencies: SearchKecHybridToolDependencies,
): Promise<VoltAiTool<SearchKecHybridToolResult>> {
  const module = await importToolModule();
  return module.createSearchKecHybridTool(dependencies);
}

async function captureError(operation: () => unknown): Promise<unknown> {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  throw new Error("Expected operation to fail");
}

describe("native KEC hybrid MCP thin tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PROJECT_ROOT = workspaceRoot;
  });

  afterEach(() => {
    if (originalProjectRoot === undefined) {
      delete process.env.PROJECT_ROOT;
    } else {
      process.env.PROJECT_ROOT = originalProjectRoot;
    }
  });

  it("declares the exact tool name, description, and input schema", async () => {
    const tool = await createTool({ rankingOptions: rankingOptions() });
    const schema = z.object(tool.inputSchema);

    expect(tool.name).toBe("search_kec_hybrid");
    expect(tool.description).toEqual(expect.any(String));
    expect(tool.description.length).toBeGreaterThan(0);
    expect(Object.keys(tool.inputSchema).sort()).toEqual(["limit", "query"]);
    expect(schema.safeParse({ query: "cable", limit: 5 }).success).toBe(true);
  });

  it.each([" ", "   ", "\u0000", "a\u0000b"])(
    "accepts the query bytes %j without normalization",
    async (query) => {
      const result = nativeHybridResult();
      const ranking = rankingOptions();
      const harness = hybridToolHarness();
      searchKecHybridMock.mockResolvedValueOnce(result);
      const tool = await createTool({
        rankingOptions: ranking,
        embeddingProvider: harness.embeddingProvider,
        vectorStore: harness.closableStore,
      });
      const request = { query, limit: 5 };

      await expect(tool.handler(request)).resolves.toEqual({ results: result });
      expect(searchKecHybridMock).toHaveBeenCalledWith(
        request,
        {
          embeddingProvider: harness.embeddingProvider,
          vectorStore: harness.closableStore,
        },
        ranking,
      );
    },
  );

  it.each([
    { query: "a", limit: 0 },
    { query: "a".repeat(4096), limit: 100 },
  ])("accepts approved transport boundary %#", async (request) => {
    const result = nativeHybridResult([]);
    const harness = hybridToolHarness();
    searchKecHybridMock.mockResolvedValueOnce(result);
    const tool = await createTool({
      rankingOptions: rankingOptions(),
      embeddingProvider: harness.embeddingProvider,
      vectorStore: harness.closableStore,
    });

    await expect(tool.handler(request)).resolves.toEqual({ results: result });
    expect(searchKecHybridMock).toHaveBeenCalledTimes(1);
    expect(searchKecHybridMock.mock.calls[0]?.[0]).toBe(request);
  });

  it.each([
    { query: "", limit: 1 },
    { query: "a".repeat(4097), limit: 1 },
    { query: new String("cable"), limit: 1 },
    { query: 42, limit: 1 },
    { query: null, limit: 1 },
    { limit: 1 },
    { query: "cable", limit: -1 },
    { query: "cable", limit: 1.5 },
    { query: "cable", limit: 101 },
    { query: "cable", limit: Number.NaN },
    { query: "cable", limit: Number.POSITIVE_INFINITY },
    { query: "cable", limit: "5" },
    { query: "cable", limit: 5n },
    { query: "cable" },
  ])("exposes a transport schema that rejects %#", async (request) => {
    const tool = await createTool({ rankingOptions: rankingOptions() });
    const schema = z.object(tool.inputSchema);

    expect(schema.safeParse(request).success).toBe(false);
  });

  it("counts astral characters by UTF-16 code units", async () => {
    const tool = await createTool({ rankingOptions: rankingOptions() });
    const schema = z.object(tool.inputSchema);

    expect(
      schema.safeParse({ query: "😀".repeat(2048), limit: 1 }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ query: `${"😀".repeat(2048)}a`, limit: 1 }).success,
    ).toBe(false);
  });

  it("delegates exactly once with exact request and caller-owned references", async () => {
    const result = nativeHybridResult();
    const harness = hybridToolHarness();
    const ranking = rankingOptions();
    const dependencies = {
      rankingOptions: ranking,
      embeddingProvider: harness.embeddingProvider,
      vectorStore: harness.closableStore,
    };
    const request = Object.freeze({ query: "  Cable\u0000", limit: 7 });
    searchKecHybridMock.mockResolvedValueOnce(result);
    const tool = await createTool(dependencies);

    const output = await tool.handler(request);

    expect(searchKecHybridMock).toHaveBeenCalledTimes(1);
    expect(searchKecHybridMock.mock.calls[0]?.[0]).toBe(request);
    expect(searchKecHybridMock.mock.calls[0]?.[1]).toEqual({
      embeddingProvider: harness.embeddingProvider,
      vectorStore: harness.closableStore,
    });
    expect(
      (
        searchKecHybridMock.mock
          .calls[0]?.[1] as ExistingKecHybridSearchDependencies
      ).embeddingProvider,
    ).toBe(harness.embeddingProvider);
    expect(
      (
        searchKecHybridMock.mock
          .calls[0]?.[1] as ExistingKecHybridSearchDependencies
      ).vectorStore,
    ).toBe(harness.closableStore);
    expect(searchKecHybridMock.mock.calls[0]?.[2]).toBe(ranking);
    expect(output).toEqual({ results: result });
    expect(output.results).toBe(result);
  });

  it("preserves result, candidate, signal, and ordering identity", async () => {
    const result = nativeHybridResult();
    const harness = hybridToolHarness();
    searchKecHybridMock.mockResolvedValueOnce(result);
    const tool = await createTool({
      rankingOptions: rankingOptions(),
      embeddingProvider: harness.embeddingProvider,
      vectorStore: harness.closableStore,
    });

    const output = await tool.handler({ query: "identity", limit: 3 });

    expect(output).not.toBe(result);
    expect(output.results).toBe(result);
    expect(output.results.map(({ chunkId }) => chunkId)).toEqual(
      result.map(({ chunkId }) => chunkId),
    );
    expect(output.results[0]).toBe(result[0]);
    expect(output.results[0]?.signals).toBe(result[0]?.signals);
  });

  it("does not short-circuit a zero limit before Task 52", async () => {
    const empty = nativeHybridResult([]);
    const harness = hybridToolHarness();
    searchKecHybridMock.mockResolvedValueOnce(empty);
    const tool = await createTool({
      rankingOptions: rankingOptions(),
      embeddingProvider: harness.embeddingProvider,
      vectorStore: harness.closableStore,
    });
    const request = { query: "zero", limit: 0 };

    const output = await tool.handler(request);

    expect(searchKecHybridMock).toHaveBeenCalledTimes(1);
    expect(searchKecHybridMock.mock.calls[0]?.[0]).toBe(request);
    expect(output.results).toBe(empty);
  });

  it("uses an injected provider/store without default factories or disposal", async () => {
    const result = nativeHybridResult();
    const harness = hybridToolHarness();
    searchKecHybridMock.mockResolvedValueOnce(result);
    const tool = await createTool({
      rankingOptions: rankingOptions(),
      embeddingProvider: harness.embeddingProvider,
      vectorStore: harness.closableStore,
    });

    await tool.handler({ query: "injected", limit: 2 });

    expect(createEmbeddingProviderFromEnvMock).not.toHaveBeenCalled();
    expect(sqliteKnowledgeStoreConstructor).not.toHaveBeenCalled();
    expect(harness.close).not.toHaveBeenCalled();
  });

  it("creates fresh default provider/store dependencies for every call", async () => {
    const first = hybridToolHarness();
    const second = hybridToolHarness();
    createEmbeddingProviderFromEnvMock
      .mockReturnValueOnce(first.embeddingProvider)
      .mockReturnValueOnce(second.embeddingProvider);
    sqliteKnowledgeStoreConstructor
      .mockReturnValueOnce(first.closableStore)
      .mockReturnValueOnce(second.closableStore);
    searchKecHybridMock.mockResolvedValue(nativeHybridResult([]));
    const tool = await createTool({ rankingOptions: rankingOptions() });

    await tool.handler({ query: "first", limit: 1 });
    await tool.handler({ query: "second", limit: 1 });

    expect(createEmbeddingProviderFromEnvMock).toHaveBeenCalledTimes(2);
    expect(sqliteKnowledgeStoreConstructor).toHaveBeenCalledTimes(2);
    expect(searchKecHybridMock.mock.calls[0]?.[1]).toEqual({
      embeddingProvider: first.embeddingProvider,
      vectorStore: first.closableStore,
    });
    expect(searchKecHybridMock.mock.calls[1]?.[1]).toEqual({
      embeddingProvider: second.embeddingProvider,
      vectorStore: second.closableStore,
    });
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(second.close).toHaveBeenCalledTimes(1);
  });

  it("uses KEC_DB_PATH and the existing project-root fallback", async () => {
    const originalDbPath = process.env.KEC_DB_PATH;
    const originalProjectRoot = process.env.PROJECT_ROOT;
    const first = hybridToolHarness();
    const second = hybridToolHarness();
    createEmbeddingProviderFromEnvMock.mockReturnValue(first.embeddingProvider);
    sqliteKnowledgeStoreConstructor
      .mockReturnValueOnce(first.closableStore)
      .mockReturnValueOnce(second.closableStore);
    searchKecHybridMock.mockResolvedValue(nativeHybridResult([]));
    const tool = await createTool({ rankingOptions: rankingOptions() });

    try {
      process.env.PROJECT_ROOT = workspaceRoot;
      process.env.KEC_DB_PATH = "/tmp/task53-approved.sqlite";
      await tool.handler({ query: "env", limit: 1 });
      delete process.env.KEC_DB_PATH;
      await tool.handler({ query: "fallback", limit: 1 });

      expect(sqliteKnowledgeStoreConstructor.mock.calls[0]?.[0]).toBe(
        "/tmp/task53-approved.sqlite",
      );
      expect(sqliteKnowledgeStoreConstructor.mock.calls[1]?.[0]).toBe(
        fileURLToPath(new URL("../../../.voltai/kec.sqlite", import.meta.url)),
      );
    } finally {
      if (originalDbPath === undefined) delete process.env.KEC_DB_PATH;
      else process.env.KEC_DB_PATH = originalDbPath;
      if (originalProjectRoot === undefined) delete process.env.PROJECT_ROOT;
      else process.env.PROJECT_ROOT = originalProjectRoot;
    }
  });

  it("propagates Task 52 error identity without wrapping", async () => {
    const primary = new Error("task52-primary");
    const harness = hybridToolHarness();
    searchKecHybridMock.mockRejectedValueOnce(primary);
    const tool = await createTool({
      rankingOptions: rankingOptions(),
      embeddingProvider: harness.embeddingProvider,
      vectorStore: harness.closableStore,
    });

    expect(
      await captureError(() => tool.handler({ query: "error", limit: 1 })),
    ).toBe(primary);
  });
});
