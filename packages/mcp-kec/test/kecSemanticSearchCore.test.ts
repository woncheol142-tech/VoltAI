import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  executeKecSemanticSearch,
  type KecSemanticSearchCoreDependencies,
} from "../src/searchSemantic/semanticSearchCore.js";

type TestResult = {
  readonly persistedId: string;
  readonly payload: unknown;
};

const matchingMetadata = {
  embeddingProvider: "test-provider",
  embeddingModel: "test-model",
  dimensions: 3,
  indexedAt: "2026-07-28T00:00:00.000Z",
};

function createDependencies(
  overrides: Partial<KecSemanticSearchCoreDependencies<TestResult>> = {},
): KecSemanticSearchCoreDependencies<TestResult> {
  return {
    embeddingProvider: {
      embed: async () => [1, 0, 0],
      getMetadata: () => ({
        provider: "test-provider",
        model: "test-model",
      }),
    },
    getIndexMetadata: async () => matchingMetadata,
    search: async () => [],
    ...overrides,
  };
}

describe("KEC shared semantic search core", () => {
  it("has the approved generic function contract", () => {
    expectTypeOf(executeKecSemanticSearch<TestResult>).toBeFunction();
    expectTypeOf(
      executeKecSemanticSearch<TestResult>,
    ).returns.resolves.toEqualTypeOf<TestResult[]>();
  });

  it("executes embedding, metadata validation, and delegated search in order", async () => {
    const calls: unknown[] = [];
    const embedding = [0.2, 0.4, 0.6];
    const expected: TestResult[] = [
      { persistedId: "chunk-2", payload: { rank: 2 } },
      { persistedId: "chunk-1", payload: { rank: 1 } },
    ];
    const dependencies = createDependencies({
      embeddingProvider: {
        embed: async (query) => {
          calls.push(["embed", query]);
          return embedding;
        },
        getMetadata: () => {
          calls.push(["provider-metadata"]);
          return { provider: "test-provider", model: "test-model" };
        },
      },
      getIndexMetadata: async () => {
        calls.push(["index-metadata"]);
        return matchingMetadata;
      },
      search: async (receivedEmbedding, topK) => {
        calls.push(["search", receivedEmbedding, topK]);
        return expected;
      },
    });

    const result = await executeKecSemanticSearch("KEC cable", 7, dependencies);

    expect(result).toBe(expected);
    expect(calls).toEqual([
      ["embed", "KEC cable"],
      ["provider-metadata"],
      ["index-metadata"],
      ["search", embedding, 7],
    ]);
  });

  it("preserves query bytes, result ordering, objects, and array identity", async () => {
    const query = "  KEC \u212b e\u0301 \ud55c\uae00  ";
    const expected: TestResult[] = [
      { persistedId: "z", payload: Symbol("opaque") },
      { persistedId: "a", payload: new Map([["key", "value"]]) },
    ];
    let receivedQuery: string | undefined;
    const dependencies = createDependencies({
      embeddingProvider: {
        embed: async (value) => {
          receivedQuery = value;
          return [1, 0, 0];
        },
        getMetadata: () => ({
          provider: "test-provider",
          model: "test-model",
        }),
      },
      search: async () => expected,
    });

    const result = await executeKecSemanticSearch(query, 2, dependencies);

    expect(receivedQuery).toBe(query);
    expect(result).toBe(expected);
    expect(result[0]).toBe(expected[0]);
    expect(result[1]).toBe(expected[1]);
  });

  it("passes the embedding array to search without cloning or mutation", async () => {
    const embedding = [1, -0, 0.5];
    const snapshot = [...embedding];
    let receivedEmbedding: number[] | undefined;
    const dependencies = createDependencies({
      embeddingProvider: {
        embed: async () => embedding,
        getMetadata: () => ({
          provider: "test-provider",
          model: "test-model",
        }),
      },
      search: async (value) => {
        receivedEmbedding = value;
        return [];
      },
    });

    await executeKecSemanticSearch("query", 3, dependencies);

    expect(receivedEmbedding).toBe(embedding);
    expect(embedding).toEqual(snapshot);
    expect(Object.is(embedding[1], -0)).toBe(true);
  });

  it.each([
    {
      name: "missing index metadata",
      metadata: null,
    },
    {
      name: "provider mismatch",
      metadata: { ...matchingMetadata, embeddingProvider: "other" },
    },
    {
      name: "model mismatch",
      metadata: { ...matchingMetadata, embeddingModel: "other" },
    },
    {
      name: "dimension mismatch",
      metadata: { ...matchingMetadata, dimensions: 4 },
    },
  ])("rejects a $name before delegated search", async ({ metadata }) => {
    const search = vi.fn(async () => [] as TestResult[]);
    const dependencies = createDependencies({
      getIndexMetadata: async () => metadata,
      search,
    });

    await expect(
      executeKecSemanticSearch("query", 3, dependencies),
    ).rejects.toThrow(
      "KEC index embedding metadata mismatch. Please re-run index_kec.",
    );
    expect(search).not.toHaveBeenCalled();
  });

  it("ignores non-authoritative metadata fields during compatibility checks", async () => {
    const expected: TestResult[] = [
      { persistedId: "chunk", payload: "result" },
    ];
    const dependencies = createDependencies({
      getIndexMetadata: async () => ({
        ...matchingMetadata,
        indexedAt: "1900-01-01T00:00:00.000Z",
      }),
      search: async () => expected,
    });

    await expect(
      executeKecSemanticSearch("query", 1, dependencies),
    ).resolves.toBe(expected);
  });

  it.each(["embed", "provider metadata", "index metadata", "delegated search"])(
    "preserves $name error identity",
    async (failurePoint) => {
      const failure = { failurePoint };
      const dependencies = createDependencies({
        embeddingProvider: {
          embed: async () => {
            if (failurePoint === "embed") throw failure;
            return [1, 0, 0];
          },
          getMetadata: () => {
            if (failurePoint === "provider metadata") throw failure;
            return { provider: "test-provider", model: "test-model" };
          },
        },
        getIndexMetadata: async () => {
          if (failurePoint === "index metadata") throw failure;
          return matchingMetadata;
        },
        search: async () => {
          if (failurePoint === "delegated search") throw failure;
          return [];
        },
      });

      await expect(
        executeKecSemanticSearch("query", 3, dependencies),
      ).rejects.toBe(failure);
    },
  );

  it("does not retry or cache repeated executions", async () => {
    const embed = vi.fn(async () => [1, 0, 0]);
    const getProviderMetadata = vi.fn(() => ({
      provider: "test-provider",
      model: "test-model",
    }));
    const getIndexMetadata = vi.fn(async () => matchingMetadata);
    const search = vi.fn(async () => [] as TestResult[]);
    const dependencies = createDependencies({
      embeddingProvider: {
        embed,
        getMetadata: getProviderMetadata,
      },
      getIndexMetadata,
      search,
    });

    await executeKecSemanticSearch("same query", 3, dependencies);
    await executeKecSemanticSearch("same query", 3, dependencies);

    expect(embed).toHaveBeenCalledTimes(2);
    expect(getProviderMetadata).toHaveBeenCalledTimes(2);
    expect(getIndexMetadata).toHaveBeenCalledTimes(2);
    expect(search).toHaveBeenCalledTimes(2);
  });
});
