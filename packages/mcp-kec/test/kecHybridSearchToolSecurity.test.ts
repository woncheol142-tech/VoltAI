import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { KnowledgeVectorStore } from "@voltai/knowledge-core";
import type { VoltAiTool } from "@voltai/mcp-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EmbeddingProvider } from "../src/knowledge/embedding.js";
import type { KecHybridSearchResult } from "../src/searchHybrid/index.js";
import type { KecWeightedRankingOptions } from "../src/searchRanking/index.js";
import {
  hybridToolHarness,
  rankingOptions,
} from "./helpers/kecHybridSearchToolFixture.js";

const createEmbeddingProviderFromEnvMock = vi.hoisted(() => vi.fn());
const sqliteKnowledgeStoreConstructor = vi.hoisted(() => vi.fn());
const testDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(testDirectory, "..");
const workspaceRoot = join(packageRoot, "..", "..");
const originalProjectRoot = process.env.PROJECT_ROOT;

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

type ToolDependencies = Readonly<{
  rankingOptions: KecWeightedRankingOptions;
  embeddingProvider?: EmbeddingProvider;
  vectorStore?: Pick<
    KnowledgeVectorStore,
    "getIndexMetadata" | "search" | "listChunks"
  >;
}>;

type ToolModule = {
  createSearchKecHybridTool(
    dependencies: ToolDependencies,
  ): VoltAiTool<Readonly<{ results: KecHybridSearchResult }>>;
};

async function createTool(
  dependencies: ToolDependencies,
): Promise<VoltAiTool<Readonly<{ results: KecHybridSearchResult }>>> {
  const moduleUrl = new URL("../src/tools/searchKecHybrid.ts", import.meta.url);
  const module = (await import(
    /* @vite-ignore */ fileURLToPath(moduleUrl)
  )) as ToolModule;
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

describe("native KEC hybrid MCP security and lifecycle", () => {
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

  it("passes a direct request downstream without executing accessors", async () => {
    const harness = hybridToolHarness();
    const tool = await createTool({
      rankingOptions: rankingOptions(),
      embeddingProvider: harness.embeddingProvider,
      vectorStore: harness.closableStore,
    });
    let getterCalls = 0;
    const request = Object.defineProperty({ limit: 1 }, "query", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "secret-query";
      },
    });

    await expect(tool.handler(request)).rejects.toThrow(
      /^INVALID_SEMANTIC_SEARCH_REQUEST:/,
    );
    expect(getterCalls).toBe(0);
  });

  it.each([
    Object.assign(Object.create({ query: "inherited" }), { limit: 1 }),
    Object.assign({ query: "symbol", limit: 1 }, { [Symbol("x")]: true }),
    Object.assign({ query: "extra", limit: 1 }, { topK: 1 }),
    Object.assign({ query: "unsafe", limit: 1 }, { constructor: "x" }),
  ])("leaves hostile direct request rejection to Task 52", async (request) => {
    const harness = hybridToolHarness();
    const tool = await createTool({
      rankingOptions: rankingOptions(),
      embeddingProvider: harness.embeddingProvider,
      vectorStore: harness.closableStore,
    });

    await expect(tool.handler(request)).rejects.toThrow(
      /^INVALID_SEMANTIC_SEARCH_REQUEST:/,
    );
    expect(harness.calls.embed).toEqual([]);
    expect(harness.calls.search).toEqual([]);
  });

  it("does not mutate, clone, freeze, or coerce a direct request", async () => {
    const harness = hybridToolHarness();
    const request = { query: "cable", limit: 1 };
    const before = Reflect.ownKeys(request);
    const tool = await createTool({
      rankingOptions: rankingOptions(),
      embeddingProvider: harness.embeddingProvider,
      vectorStore: harness.closableStore,
    });

    await tool.handler(request);

    expect(Reflect.ownKeys(request)).toEqual(before);
    expect(request).toEqual({ query: "cable", limit: 1 });
    expect(Object.isFrozen(request)).toBe(false);
  });

  it("closes a default store exactly once on success", async () => {
    const harness = hybridToolHarness();
    createEmbeddingProviderFromEnvMock.mockReturnValue(
      harness.embeddingProvider,
    );
    sqliteKnowledgeStoreConstructor.mockReturnValue(harness.closableStore);
    const tool = await createTool({ rankingOptions: rankingOptions() });

    await expect(tool.handler({ query: "success", limit: 1 })).resolves.toEqual(
      {
        results: expect.any(Array),
      },
    );
    expect(harness.close).toHaveBeenCalledTimes(1);
  });

  it("closes a default store exactly once on asynchronous search failure", async () => {
    const primary = new Error("async-search-failure");
    const harness = hybridToolHarness({ embeddingError: primary });
    createEmbeddingProviderFromEnvMock.mockReturnValue(
      harness.embeddingProvider,
    );
    sqliteKnowledgeStoreConstructor.mockReturnValue(harness.closableStore);
    const tool = await createTool({ rankingOptions: rankingOptions() });

    expect(
      await captureError(() => tool.handler({ query: "failure", limit: 1 })),
    ).toBe(primary);
    expect(harness.close).toHaveBeenCalledTimes(1);
  });

  it("closes a default store on synchronous ranking failure", async () => {
    const harness = hybridToolHarness();
    createEmbeddingProviderFromEnvMock.mockReturnValue(
      harness.embeddingProvider,
    );
    sqliteKnowledgeStoreConstructor.mockReturnValue(harness.closableStore);
    const tool = await createTool({
      rankingOptions: { semanticWeight: 0, lexicalWeight: 0 },
    });

    await expect(tool.handler({ query: "sync", limit: 1 })).rejects.toThrow(
      /^INVALID_RANKING_OPTIONS:/,
    );
    expect(harness.close).toHaveBeenCalledTimes(1);
  });

  it("propagates a close error after successful search", async () => {
    const closeError = new Error("close-after-success");
    const harness = hybridToolHarness({ closeError });
    createEmbeddingProviderFromEnvMock.mockReturnValue(
      harness.embeddingProvider,
    );
    sqliteKnowledgeStoreConstructor.mockReturnValue(harness.closableStore);
    const tool = await createTool({ rankingOptions: rankingOptions() });

    expect(
      await captureError(() => tool.handler({ query: "close", limit: 1 })),
    ).toBe(closeError);
    expect(harness.close).toHaveBeenCalledTimes(1);
  });

  it("preserves async primary error over cleanup error", async () => {
    const primary = new Error("primary-search");
    const cleanup = new Error("cleanup-close");
    const harness = hybridToolHarness({
      embeddingError: primary,
      closeError: cleanup,
    });
    createEmbeddingProviderFromEnvMock.mockReturnValue(
      harness.embeddingProvider,
    );
    sqliteKnowledgeStoreConstructor.mockReturnValue(harness.closableStore);
    const tool = await createTool({ rankingOptions: rankingOptions() });

    expect(
      await captureError(() => tool.handler({ query: "dual", limit: 1 })),
    ).toBe(primary);
    expect(harness.close).toHaveBeenCalledTimes(1);
  });

  it("preserves synchronous ranking error over cleanup error", async () => {
    const cleanup = new Error("cleanup-close");
    const harness = hybridToolHarness({ closeError: cleanup });
    createEmbeddingProviderFromEnvMock.mockReturnValue(
      harness.embeddingProvider,
    );
    sqliteKnowledgeStoreConstructor.mockReturnValue(harness.closableStore);
    const tool = await createTool({
      rankingOptions: { semanticWeight: 0, lexicalWeight: 0 },
    });

    const error = await captureError(() =>
      tool.handler({ query: "sync-dual", limit: 1 }),
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/^INVALID_RANKING_OPTIONS:/);
    expect(error).not.toBe(cleanup);
    expect(harness.close).toHaveBeenCalledTimes(1);
  });

  it.each([
    { failure: false, ranking: rankingOptions() },
    {
      failure: true,
      ranking: { semanticWeight: 0, lexicalWeight: 0 },
    },
  ])("never closes an injected store on path %#", async ({ ranking }) => {
    const harness = hybridToolHarness();
    const tool = await createTool({
      rankingOptions: ranking,
      embeddingProvider: harness.embeddingProvider,
      vectorStore: harness.closableStore,
    });

    await captureErrorOrSuccess(() =>
      tool.handler({ query: "injected", limit: 1 }),
    );
    expect(harness.close).not.toHaveBeenCalled();
  });

  it("never closes an injected store on asynchronous failure or repeated calls", async () => {
    const primary = new Error("injected-async-failure");
    const failing = hybridToolHarness({ embeddingError: primary });
    const failingTool = await createTool({
      rankingOptions: rankingOptions(),
      embeddingProvider: failing.embeddingProvider,
      vectorStore: failing.closableStore,
    });

    expect(
      await captureError(() =>
        failingTool.handler({ query: "failure", limit: 1 }),
      ),
    ).toBe(primary);
    expect(failing.close).not.toHaveBeenCalled();

    const successful = hybridToolHarness();
    const successfulTool = await createTool({
      rankingOptions: rankingOptions(),
      embeddingProvider: successful.embeddingProvider,
      vectorStore: successful.closableStore,
    });
    await successfulTool.handler({ query: "first", limit: 1 });
    await successfulTool.handler({ query: "second", limit: 1 });
    expect(successful.close).not.toHaveBeenCalled();
  });

  it("preserves a synchronous composition error identity over close failure", async () => {
    const primary = new Error("synchronous-composition-primary");
    const cleanup = new Error("synchronous-composition-cleanup");
    const harness = hybridToolHarness({ closeError: cleanup });
    const hostileRanking = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw primary;
        },
      },
    ) as KecWeightedRankingOptions;
    createEmbeddingProviderFromEnvMock.mockReturnValue(
      harness.embeddingProvider,
    );
    sqliteKnowledgeStoreConstructor.mockReturnValue(harness.closableStore);
    const tool = await createTool({ rankingOptions: hostileRanking });

    expect(
      await captureError(() =>
        tool.handler({ query: "sync-composition", limit: 1 }),
      ),
    ).toBe(primary);
    expect(harness.close).toHaveBeenCalledTimes(1);
  });

  it("never closes or disposes the default provider", async () => {
    const harness = hybridToolHarness();
    const close = vi.fn();
    const dispose = vi.fn();
    const provider = Object.assign(harness.embeddingProvider, {
      close,
      dispose,
    });
    createEmbeddingProviderFromEnvMock.mockReturnValue(provider);
    sqliteKnowledgeStoreConstructor.mockReturnValue(harness.closableStore);
    const tool = await createTool({ rankingOptions: rankingOptions() });

    await tool.handler({ query: "provider-ownership", limit: 1 });

    expect(close).not.toHaveBeenCalled();
    expect(dispose).not.toHaveBeenCalled();
  });

  it("still owns and closes the default store for limit zero", async () => {
    const harness = hybridToolHarness();
    createEmbeddingProviderFromEnvMock.mockReturnValue(
      harness.embeddingProvider,
    );
    sqliteKnowledgeStoreConstructor.mockReturnValue(harness.closableStore);
    const tool = await createTool({ rankingOptions: rankingOptions() });

    const output = await tool.handler({ query: "zero", limit: 0 });

    expect(output.results).toEqual([]);
    expect(Object.isFrozen(output.results)).toBe(true);
    expect(harness.close).toHaveBeenCalledTimes(1);
  });
});

async function captureErrorOrSuccess(operation: () => unknown): Promise<void> {
  try {
    await operation();
  } catch {
    // Both success and the deliberate synchronous ranking failure are valid.
  }
}
