import { beforeEach, describe, expect, it, vi } from "vitest";

import type { KecSearchRequest } from "../src/searchFoundation/index.js";
import type {
  KecHybridSearchOrchestrator,
  KecHybridSearchResult,
} from "../src/searchHybrid/index.js";
import type { ExistingKecHybridSearchDependencies } from "../src/searchIntegration/index.js";
import type { KecWeightedRankingOptions } from "../src/searchRanking/index.js";
import { searchKecHybrid } from "../src/searchEntryPoints/index.js";
import { integrationHarness } from "./helpers/kecHybridSearchIntegrationFixture.js";

const factoryMock = vi.hoisted(() => vi.fn());

vi.mock("../src/searchIntegration/index.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/searchIntegration/index.js")>();

  return {
    ...actual,
    createExistingKecHybridSearch: factoryMock,
  };
});

const request: KecSearchRequest = { query: "KEC cable", limit: 5 };
const rankingOptions: KecWeightedRankingOptions = {
  semanticWeight: 2,
  lexicalWeight: 1,
};

function dependencies(): ExistingKecHybridSearchDependencies {
  return integrationHarness().dependencies;
}

function nativeResult(): KecHybridSearchResult {
  const signals = { semanticScore: 0.9, lexicalScore: 0.75 };
  const candidate = {
    chunkId: "chunk-native",
    sourcePath: "knowledge/kec.pdf",
    page: 12,
    clause: "KEC 232.5",
    text: "Cable sizing requirement.",
    signals,
  };

  return Object.freeze([candidate]);
}

function stubOrchestrator(promise: Promise<KecHybridSearchResult>): {
  orchestrator: KecHybridSearchOrchestrator;
  search: ReturnType<typeof vi.fn>;
} {
  const search = vi.fn((request: KecSearchRequest) => {
    void request;
    return promise;
  });

  return {
    orchestrator: { search } as KecHybridSearchOrchestrator,
    search,
  };
}

describe("native KEC hybrid search entry-point delegation contracts", () => {
  beforeEach(() => {
    factoryMock.mockReset();
  });

  it("calls the Task 51 factory exactly once", () => {
    const sourceDependencies = dependencies();
    const promise = Promise.resolve(nativeResult());
    const stub = stubOrchestrator(promise);
    factoryMock.mockReturnValue(stub.orchestrator);

    searchKecHybrid(request, sourceDependencies, rankingOptions);

    expect(factoryMock).toHaveBeenCalledTimes(1);
  });

  it("passes the exact dependency and ranking option references", () => {
    const sourceDependencies = dependencies();
    const promise = Promise.resolve(nativeResult());
    const stub = stubOrchestrator(promise);
    factoryMock.mockReturnValue(stub.orchestrator);

    searchKecHybrid(request, sourceDependencies, rankingOptions);

    expect(factoryMock).toHaveBeenCalledWith(
      sourceDependencies,
      rankingOptions,
    );
    expect(factoryMock.mock.calls[0]![0]).toBe(sourceDependencies);
    expect(factoryMock.mock.calls[0]![1]).toBe(rankingOptions);
  });

  it("calls the returned orchestrator exactly once with the request reference", () => {
    const sourceDependencies = dependencies();
    const promise = Promise.resolve(nativeResult());
    const stub = stubOrchestrator(promise);
    factoryMock.mockReturnValue(stub.orchestrator);

    searchKecHybrid(request, sourceDependencies, rankingOptions);

    expect(stub.search).toHaveBeenCalledTimes(1);
    expect(stub.search).toHaveBeenCalledWith(request);
    expect(stub.search.mock.calls[0]![0]).toBe(request);
  });

  it("returns the exact orchestrator Promise without an async wrapper", async () => {
    const sourceDependencies = dependencies();
    const result = nativeResult();
    const promise = Promise.resolve(result);
    const stub = stubOrchestrator(promise);
    factoryMock.mockReturnValue(stub.orchestrator);

    const returned = searchKecHybrid(
      request,
      sourceDependencies,
      rankingOptions,
    );

    expect(returned).toBe(promise);
    await expect(returned).resolves.toBe(result);
  });

  it("preserves result array, candidate, and signals identity", async () => {
    const sourceDependencies = dependencies();
    const result = nativeResult();
    const candidate = result[0]!;
    const signals = candidate.signals;
    const promise = Promise.resolve(result);
    const stub = stubOrchestrator(promise);
    factoryMock.mockReturnValue(stub.orchestrator);

    const resolved = await searchKecHybrid(
      request,
      sourceDependencies,
      rankingOptions,
    );

    expect(resolved).toBe(result);
    expect(resolved[0]).toBe(candidate);
    expect(resolved[0]!.signals).toBe(signals);
  });

  it.each([0, 1, 5, 100, 101, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "forwards limit %s without validation, clamping, or defaults",
    (limit) => {
      const sourceDependencies = dependencies();
      const forwarded = { query: "limit", limit } as KecSearchRequest;
      const promise = Promise.resolve(nativeResult());
      const stub = stubOrchestrator(promise);
      factoryMock.mockReturnValue(stub.orchestrator);

      searchKecHybrid(forwarded, sourceDependencies, rankingOptions);

      expect(stub.search.mock.calls[0]![0]).toBe(forwarded);
      expect(stub.search.mock.calls[0]![0].limit).toBe(limit);
    },
  );

  it("passes a hostile missing-field request to the child unchanged", () => {
    const sourceDependencies = dependencies();
    const hostile = { query: "missing limit" } as KecSearchRequest;
    const promise = Promise.resolve(nativeResult());
    const stub = stubOrchestrator(promise);
    factoryMock.mockReturnValue(stub.orchestrator);

    searchKecHybrid(hostile, sourceDependencies, rankingOptions);

    expect(stub.search.mock.calls[0]![0]).toBe(hostile);
  });

  it("preserves a rejected Promise and its error identity", async () => {
    const sourceDependencies = dependencies();
    const failure = { source: "orchestrator" };
    const promise = Promise.reject(failure);
    const stub = stubOrchestrator(promise);
    factoryMock.mockReturnValue(stub.orchestrator);

    const returned = searchKecHybrid(
      request,
      sourceDependencies,
      rankingOptions,
    );

    expect(returned).toBe(promise);
    await expect(returned).rejects.toBe(failure);
  });

  it("preserves synchronous factory errors without Promise conversion", () => {
    const sourceDependencies = dependencies();
    const failure = { source: "ranking-options" };
    factoryMock.mockImplementation(() => {
      throw failure;
    });
    let caught: unknown;

    try {
      searchKecHybrid(request, sourceDependencies, rankingOptions);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(failure);
  });

  it("does not inspect, clone, freeze, or mutate its inputs", () => {
    const sourceDependencies = dependencies();
    const sourceRequest = { query: "  접지\u0000ｅ\u0301  ", limit: 3 };
    const sourceOptions = { semanticWeight: 7, lexicalWeight: 2 };
    const requestDescriptor = Object.getOwnPropertyDescriptors(sourceRequest);
    const dependencyDescriptor =
      Object.getOwnPropertyDescriptors(sourceDependencies);
    const optionDescriptor = Object.getOwnPropertyDescriptors(sourceOptions);
    const promise = Promise.resolve(nativeResult());
    const stub = stubOrchestrator(promise);
    factoryMock.mockReturnValue(stub.orchestrator);

    searchKecHybrid(sourceRequest, sourceDependencies, sourceOptions);

    expect(Object.getOwnPropertyDescriptors(sourceRequest)).toEqual(
      requestDescriptor,
    );
    expect(Object.getOwnPropertyDescriptors(sourceDependencies)).toEqual(
      dependencyDescriptor,
    );
    expect(Object.getOwnPropertyDescriptors(sourceOptions)).toEqual(
      optionDescriptor,
    );
    expect(Object.isFrozen(sourceRequest)).toBe(false);
    expect(Object.isFrozen(sourceDependencies)).toBe(false);
    expect(Object.isFrozen(sourceOptions)).toBe(false);
  });

  it("does not call provider, store, or lifecycle methods itself", () => {
    const sourceDependencies = dependencies();
    const providerClose = vi.fn();
    const storeClose = vi.fn();
    const providerEmbed = vi.spyOn(
      sourceDependencies.embeddingProvider,
      "embed",
    );
    const storeSearch = vi.spyOn(sourceDependencies.vectorStore, "search");
    const storeList = vi.spyOn(sourceDependencies.vectorStore, "listChunks");
    Object.assign(sourceDependencies.embeddingProvider, {
      close: providerClose,
    });
    Object.assign(sourceDependencies.vectorStore, { close: storeClose });
    const promise = Promise.resolve(nativeResult());
    const stub = stubOrchestrator(promise);
    factoryMock.mockReturnValue(stub.orchestrator);

    searchKecHybrid(request, sourceDependencies, rankingOptions);

    expect(providerEmbed).not.toHaveBeenCalled();
    expect(storeSearch).not.toHaveBeenCalled();
    expect(storeList).not.toHaveBeenCalled();
    expect(providerClose).not.toHaveBeenCalled();
    expect(storeClose).not.toHaveBeenCalled();
  });

  it("creates an independent Task 51 graph for each invocation", async () => {
    const sourceDependencies = dependencies();
    const firstResult = Object.freeze([]) as KecHybridSearchResult;
    const secondResult = nativeResult();
    const firstPromise = Promise.resolve(firstResult);
    const secondPromise = Promise.resolve(secondResult);
    const first = stubOrchestrator(firstPromise);
    const second = stubOrchestrator(secondPromise);
    factoryMock
      .mockReturnValueOnce(first.orchestrator)
      .mockReturnValueOnce(second.orchestrator);

    const firstReturned = searchKecHybrid(
      request,
      sourceDependencies,
      rankingOptions,
    );
    const secondReturned = searchKecHybrid(
      request,
      sourceDependencies,
      rankingOptions,
    );

    expect(factoryMock).toHaveBeenCalledTimes(2);
    expect(firstReturned).toBe(firstPromise);
    expect(secondReturned).toBe(secondPromise);
    expect(await firstReturned).toBe(firstResult);
    expect(await secondReturned).toBe(secondResult);
  });
});
