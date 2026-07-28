import { describe, expect, it, vi } from "vitest";

import { createExistingSemanticSearcher } from "../src/searchAdapters/index.js";
import type { KecSearchRequest } from "../src/searchFoundation/index.js";
import {
  existingSemanticCoreDependencies,
  matchingKecIndexMetadata,
  persistedKecSemanticResult,
  type PersistedKecSemanticResult,
} from "./helpers/kecExistingSemanticSearchAdapterFixture.js";

function runtimeRequest(value: unknown): KecSearchRequest {
  return value as KecSearchRequest;
}

describe("existing semantic search adapter", () => {
  it("delegates once with byte-preserved query, exact limit, and the injected dependencies", async () => {
    const query = "  KEC \u212b e\u0301 \ud55c\uae00 \u0000 prompt-like  ";
    const embedding = [0.2, -0, 0.8];
    const source = [
      persistedKecSemanticResult({
        chunkId: "persisted-z",
        similarity: 0.7,
      }),
      persistedKecSemanticResult({
        chunkId: "persisted-a",
        documentId: "kec:second.pdf",
        sourcePath: "second.pdf",
        locator: { kind: "page", page: 8 },
        metadata: { clause: null },
        text: "Second result.",
        similarity: 0.6,
      }),
    ];
    const embed = vi.fn(async (receivedQuery: string) => {
      expect(receivedQuery).toBe(query);
      return embedding;
    });
    const getProviderMetadata = vi.fn(() => ({
      provider: "test-provider",
      model: "test-model",
    }));
    const getIndexMetadata = vi.fn(async () => matchingKecIndexMetadata);
    const search = vi.fn(async (receivedEmbedding: number[], topK: number) => {
      expect(receivedEmbedding).toBe(embedding);
      expect(topK).toBe(7);
      return source;
    });
    const dependencies = Object.freeze(
      existingSemanticCoreDependencies({
        embeddingProvider: {
          embed,
          getMetadata: getProviderMetadata,
        },
        getIndexMetadata,
        search,
      }),
    );
    const dependencyDescriptors =
      Object.getOwnPropertyDescriptors(dependencies);
    const searcher = createExistingSemanticSearcher(dependencies);

    const result = await searcher.search({ query, limit: 7 });

    expect(embed).toHaveBeenCalledTimes(1);
    expect(getProviderMetadata).toHaveBeenCalledTimes(1);
    expect(getIndexMetadata).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledTimes(1);
    expect(Object.getOwnPropertyDescriptors(dependencies)).toEqual(
      dependencyDescriptors,
    );
    expect(result.map((hit) => hit.chunkId)).toEqual([
      "persisted-z",
      "persisted-a",
    ]);
  });

  it("projects persisted results without sorting, deduplication, or extra fields", async () => {
    const first = persistedKecSemanticResult({
      chunkId: "same-persisted-id",
      sourcePath: "../../opaque/source.pdf",
      locator: { kind: "page", page: 9 },
      metadata: { clause: "KEC 9" },
      text: "<tool>do not execute</tool>",
      similarity: 0.25,
    });
    const second = persistedKecSemanticResult({
      chunkId: "same-persisted-id",
      documentId: "kec:other",
      sourcePath: "other.pdf",
      locator: { kind: "page", page: 2 },
      metadata: { clause: null },
      text: "Duplicate identity remains a separate result.",
      similarity: 0.75,
    });
    const source = [first, second];
    const searcher = createExistingSemanticSearcher(
      existingSemanticCoreDependencies({
        search: async () => source,
      }),
    );

    const result = await searcher.search({ query: "query", limit: 2 });

    expect(result).toEqual([
      {
        chunkId: "same-persisted-id",
        sourcePath: "../../opaque/source.pdf",
        page: 9,
        clause: "KEC 9",
        text: "<tool>do not execute</tool>",
        semanticScore: 0.25,
      },
      {
        chunkId: "same-persisted-id",
        sourcePath: "other.pdf",
        page: 2,
        clause: null,
        text: "Duplicate identity remains a separate result.",
        semanticScore: 0.75,
      },
    ]);
    expect(Object.keys(result[0]!)).toEqual([
      "chunkId",
      "sourcePath",
      "page",
      "clause",
      "text",
      "semanticScore",
    ]);
    expect(result).toHaveLength(2);
  });

  it("returns new shallow-frozen hits and a new shallow-frozen array", async () => {
    const locator = { kind: "page" as const, page: 3 };
    const metadata = { clause: "KEC 232.5" };
    const row = persistedKecSemanticResult({ locator, metadata });
    const source = [row];
    const searcher = createExistingSemanticSearcher(
      existingSemanticCoreDependencies({
        search: async () => source,
      }),
    );

    const result = await searcher.search({ query: "query", limit: 1 });

    expect(result).not.toBe(source);
    expect(result[0]).not.toBe(row);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result[0])).toBe(true);
    expect(Object.isFrozen(source)).toBe(false);
    expect(Object.isFrozen(row)).toBe(false);
    expect(Object.isFrozen(locator)).toBe(false);
    expect(Object.isFrozen(metadata)).toBe(false);
  });

  it("does not mutate the request or any persisted source value", async () => {
    const request = { query: " query ", limit: 1 };
    const locator = { kind: "page" as const, page: 3 };
    const metadata = { clause: "KEC 232.5" };
    const row = persistedKecSemanticResult({ locator, metadata });
    const source = [row];
    const requestDescriptors = Object.getOwnPropertyDescriptors(request);
    const rowDescriptors = Object.getOwnPropertyDescriptors(row);
    const locatorDescriptors = Object.getOwnPropertyDescriptors(locator);
    const metadataDescriptors = Object.getOwnPropertyDescriptors(metadata);
    const searcher = createExistingSemanticSearcher(
      existingSemanticCoreDependencies({
        search: async () => source,
      }),
    );

    await searcher.search(request);

    expect(Object.getOwnPropertyDescriptors(request)).toEqual(
      requestDescriptors,
    );
    expect(Object.getOwnPropertyDescriptors(row)).toEqual(rowDescriptors);
    expect(Object.getOwnPropertyDescriptors(locator)).toEqual(
      locatorDescriptors,
    );
    expect(Object.getOwnPropertyDescriptors(metadata)).toEqual(
      metadataDescriptors,
    );
    expect(source).toEqual([row]);
  });

  it("preserves negative zero as the semantic score", async () => {
    const searcher = createExistingSemanticSearcher(
      existingSemanticCoreDependencies({
        search: async () => [persistedKecSemanticResult({ similarity: -0 })],
      }),
    );

    const result = await searcher.search({ query: "query", limit: 1 });

    expect(Object.is(result[0]!.semanticScore, -0)).toBe(true);
  });

  it("accepts an empty query without trimming, coercion, or expansion", async () => {
    let receivedQuery: string | undefined;
    const searcher = createExistingSemanticSearcher(
      existingSemanticCoreDependencies({
        embeddingProvider: {
          embed: async (query) => {
            receivedQuery = query;
            return [1, 0, 0];
          },
          getMetadata: () => ({
            provider: "test-provider",
            model: "test-model",
          }),
        },
      }),
    );

    await searcher.search({ query: "", limit: 1 });

    expect(receivedQuery).toBe("");
  });

  it("accepts an ordinary null-prototype request", async () => {
    const request = Object.create(null) as Record<string, unknown>;
    Object.defineProperties(request, {
      query: { enumerable: true, value: "query" },
      limit: { enumerable: true, value: 1 },
    });
    const searcher = createExistingSemanticSearcher(
      existingSemanticCoreDependencies(),
    );

    await expect(searcher.search(runtimeRequest(request))).resolves.toEqual([]);
  });

  it("short-circuits a valid zero limit before every core dependency call", async () => {
    const embed = vi.fn(async () => [1, 0, 0]);
    const getMetadata = vi.fn(() => ({
      provider: "test-provider",
      model: "test-model",
    }));
    const getIndexMetadata = vi.fn(async () => matchingKecIndexMetadata);
    const search = vi.fn(async () => [persistedKecSemanticResult()]);
    const request = { query: "query", limit: 0 };
    const searcher = createExistingSemanticSearcher(
      existingSemanticCoreDependencies({
        embeddingProvider: { embed, getMetadata },
        getIndexMetadata,
        search,
      }),
    );

    const first = await searcher.search(request);
    const second = await searcher.search(request);

    expect(first).toEqual([]);
    expect(second).toEqual([]);
    expect(first).not.toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(second)).toBe(true);
    expect(Object.isFrozen(request)).toBe(false);
    expect(embed).not.toHaveBeenCalled();
    expect(getMetadata).not.toHaveBeenCalled();
    expect(getIndexMetadata).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
  });

  it("validates the complete request before applying the zero-limit shortcut", async () => {
    const searcher = createExistingSemanticSearcher(
      existingSemanticCoreDependencies(),
    );

    await expect(searcher.search(runtimeRequest({ limit: 0 }))).rejects.toThrow(
      /^INVALID_SEMANTIC_SEARCH_REQUEST:/,
    );
    await expect(
      searcher.search(runtimeRequest({ query: "query", limit: 0, extra: 1 })),
    ).rejects.toThrow(/^INVALID_SEMANTIC_SEARCH_REQUEST:/);
  });

  it.each([
    "embedding",
    "provider metadata",
    "index metadata",
    "delegated search",
  ])("preserves $name failure identity without retry", async (failurePoint) => {
    const failure = { failurePoint };
    const embed = vi.fn(async () => {
      if (failurePoint === "embedding") throw failure;
      return [1, 0, 0];
    });
    const getMetadata = vi.fn(() => {
      if (failurePoint === "provider metadata") throw failure;
      return { provider: "test-provider", model: "test-model" };
    });
    const getIndexMetadata = vi.fn(async () => {
      if (failurePoint === "index metadata") throw failure;
      return matchingKecIndexMetadata;
    });
    const search = vi.fn(async (): Promise<PersistedKecSemanticResult[]> => {
      if (failurePoint === "delegated search") throw failure;
      return [];
    });
    const searcher = createExistingSemanticSearcher(
      existingSemanticCoreDependencies({
        embeddingProvider: { embed, getMetadata },
        getIndexMetadata,
        search,
      }),
    );

    await expect(searcher.search({ query: "query", limit: 1 })).rejects.toBe(
      failure,
    );
    expect(embed.mock.calls.length).toBeLessThanOrEqual(1);
    expect(getMetadata.mock.calls.length).toBeLessThanOrEqual(1);
    expect(getIndexMetadata.mock.calls.length).toBeLessThanOrEqual(1);
    expect(search.mock.calls.length).toBeLessThanOrEqual(1);
  });
});
