import { describe, expect, it } from "vitest";

import { createKecHybridSearchOrchestrator } from "../src/searchHybrid/index.js";
import type {
  KecRankCandidate,
  KecSearchRequest,
} from "../src/searchFoundation/index.js";
import {
  deferred,
  hybridSearchRequest,
  lexicalHit,
  semanticHit,
} from "./helpers/kecHybridSearchFixture.js";

describe("KEC hybrid search execution and failure contracts", () => {
  it("starts both providers once with the same request before awaiting either", async () => {
    const semantic = deferred<readonly ReturnType<typeof semanticHit>[]>();
    const lexical = deferred<readonly ReturnType<typeof lexicalHit>[]>();
    const calls: Array<{ readonly provider: string; readonly input: unknown }> =
      [];
    const orchestrator = createKecHybridSearchOrchestrator({
      semanticSearcher: {
        search: (request) => {
          calls.push({ provider: "semantic", input: request });
          return semantic.promise;
        },
      },
      lexicalSearcher: {
        search: (request) => {
          calls.push({ provider: "lexical", input: request });
          return lexical.promise;
        },
      },
      rankingStrategy: { rank: (candidates) => candidates },
    });
    const request: KecSearchRequest = { query: "parallel", limit: 4 };

    const resultPromise = orchestrator.search(request);

    expect(calls).toEqual([
      { provider: "semantic", input: request },
      { provider: "lexical", input: request },
    ]);
    expect(calls[0]!.input).toBe(request);
    expect(calls[1]!.input).toBe(request);

    semantic.resolve([]);
    lexical.resolve([]);
    await resultPromise;
  });

  it("propagates a semantic-only rejection object without partial ranking", async () => {
    const failure = { provider: "semantic", reason: "offline" };
    let rankCalls = 0;
    const orchestrator = createKecHybridSearchOrchestrator({
      semanticSearcher: { search: async () => Promise.reject(failure) },
      lexicalSearcher: { search: async () => [lexicalHit()] },
      rankingStrategy: {
        rank: (candidates) => {
          rankCalls += 1;
          return candidates;
        },
      },
    });

    await expect(orchestrator.search(hybridSearchRequest)).rejects.toBe(
      failure,
    );
    expect(rankCalls).toBe(0);
  });

  it("propagates a lexical-only rejection object without partial ranking", async () => {
    const failure = { provider: "lexical", reason: "offline" };
    let rankCalls = 0;
    const orchestrator = createKecHybridSearchOrchestrator({
      semanticSearcher: { search: async () => [semanticHit()] },
      lexicalSearcher: { search: async () => Promise.reject(failure) },
      rankingStrategy: {
        rank: (candidates) => {
          rankCalls += 1;
          return candidates;
        },
      },
    });

    await expect(orchestrator.search(hybridSearchRequest)).rejects.toBe(
      failure,
    );
    expect(rankCalls).toBe(0);
  });

  it("gives semantic rejection identity deterministic priority on dual failure", async () => {
    const semanticFailure = { provider: "semantic" };
    const lexicalFailure = { provider: "lexical" };
    const orchestrator = createKecHybridSearchOrchestrator({
      semanticSearcher: {
        search: async () => Promise.reject(semanticFailure),
      },
      lexicalSearcher: {
        search: async () => Promise.reject(lexicalFailure),
      },
      rankingStrategy: { rank: (candidates) => candidates },
    });

    await expect(orchestrator.search(hybridSearchRequest)).rejects.toBe(
      semanticFailure,
    );
  });

  it("invokes lexical once after a semantic synchronous throw", async () => {
    const failure = { provider: "semantic-sync" };
    const calls: Array<{
      readonly provider: "semantic" | "lexical";
      readonly request: KecSearchRequest;
    }> = [];
    let rankCalls = 0;
    const request: KecSearchRequest = { query: "semantic sync", limit: 2 };
    const orchestrator = createKecHybridSearchOrchestrator({
      semanticSearcher: {
        search: (received) => {
          calls.push({ provider: "semantic", request: received });
          throw failure;
        },
      },
      lexicalSearcher: {
        search: async (received) => {
          calls.push({ provider: "lexical", request: received });
          return [];
        },
      },
      rankingStrategy: {
        rank: (candidates) => {
          rankCalls += 1;
          return candidates;
        },
      },
    });

    await expect(orchestrator.search(request)).rejects.toBe(failure);
    expect(calls).toEqual([
      { provider: "semantic", request },
      { provider: "lexical", request },
    ]);
    expect(calls.every((call) => call.request === request)).toBe(true);
    expect(rankCalls).toBe(0);
  });

  it("observes a lexical synchronous throw after semantic invocation", async () => {
    const failure = { provider: "lexical-sync" };
    const calls: Array<{
      readonly provider: "semantic" | "lexical";
      readonly request: KecSearchRequest;
    }> = [];
    let rankCalls = 0;
    const request: KecSearchRequest = { query: "lexical sync", limit: 2 };
    const orchestrator = createKecHybridSearchOrchestrator({
      semanticSearcher: {
        search: async (received) => {
          calls.push({ provider: "semantic", request: received });
          return [];
        },
      },
      lexicalSearcher: {
        search: (received) => {
          calls.push({ provider: "lexical", request: received });
          throw failure;
        },
      },
      rankingStrategy: {
        rank: (candidates) => {
          rankCalls += 1;
          return candidates;
        },
      },
    });

    await expect(orchestrator.search(request)).rejects.toBe(failure);
    expect(calls).toEqual([
      { provider: "semantic", request },
      { provider: "lexical", request },
    ]);
    expect(calls.every((call) => call.request === request)).toBe(true);
    expect(rankCalls).toBe(0);
  });

  it("selects semantic error identity when both providers throw synchronously", async () => {
    const semanticFailure = { provider: "semantic-sync" };
    const lexicalFailure = { provider: "lexical-sync" };
    const calls: Array<{
      readonly provider: "semantic" | "lexical";
      readonly request: KecSearchRequest;
    }> = [];
    let rankCalls = 0;
    const request: KecSearchRequest = { query: "dual sync", limit: 2 };
    const orchestrator = createKecHybridSearchOrchestrator({
      semanticSearcher: {
        search: (received) => {
          calls.push({ provider: "semantic", request: received });
          throw semanticFailure;
        },
      },
      lexicalSearcher: {
        search: (received) => {
          calls.push({ provider: "lexical", request: received });
          throw lexicalFailure;
        },
      },
      rankingStrategy: {
        rank: (candidates) => {
          rankCalls += 1;
          return candidates;
        },
      },
    });

    await expect(orchestrator.search(request)).rejects.toBe(semanticFailure);
    expect(calls).toEqual([
      { provider: "semantic", request },
      { provider: "lexical", request },
    ]);
    expect(calls.every((call) => call.request === request)).toBe(true);
    expect(rankCalls).toBe(0);
  });

  it("selects semantic rejected identity over a lexical synchronous throw", async () => {
    const semanticFailure = { provider: "semantic-async" };
    const lexicalFailure = { provider: "lexical-sync" };
    const calls: Array<{
      readonly provider: "semantic" | "lexical";
      readonly request: KecSearchRequest;
    }> = [];
    let rankCalls = 0;
    const request: KecSearchRequest = { query: "semantic async", limit: 2 };
    const orchestrator = createKecHybridSearchOrchestrator({
      semanticSearcher: {
        search: (received) => {
          calls.push({ provider: "semantic", request: received });
          const rejection = Promise.reject(semanticFailure);
          rejection.catch(() => {});
          return rejection;
        },
      },
      lexicalSearcher: {
        search: (received) => {
          calls.push({ provider: "lexical", request: received });
          throw lexicalFailure;
        },
      },
      rankingStrategy: {
        rank: (candidates) => {
          rankCalls += 1;
          return candidates;
        },
      },
    });

    await expect(orchestrator.search(request)).rejects.toBe(semanticFailure);
    expect(calls).toEqual([
      { provider: "semantic", request },
      { provider: "lexical", request },
    ]);
    expect(calls.every((call) => call.request === request)).toBe(true);
    expect(rankCalls).toBe(0);
  });

  it("selects semantic synchronous identity over a lexical rejection", async () => {
    const semanticFailure = { provider: "semantic-sync" };
    const lexicalFailure = { provider: "lexical-async" };
    const calls: Array<{
      readonly provider: "semantic" | "lexical";
      readonly request: KecSearchRequest;
    }> = [];
    let rankCalls = 0;
    const request: KecSearchRequest = {
      query: "semantic sync first",
      limit: 2,
    };
    const orchestrator = createKecHybridSearchOrchestrator({
      semanticSearcher: {
        search: (received) => {
          calls.push({ provider: "semantic", request: received });
          throw semanticFailure;
        },
      },
      lexicalSearcher: {
        search: async (received) => {
          calls.push({ provider: "lexical", request: received });
          throw lexicalFailure;
        },
      },
      rankingStrategy: {
        rank: (candidates) => {
          rankCalls += 1;
          return candidates;
        },
      },
    });

    await expect(orchestrator.search(request)).rejects.toBe(semanticFailure);
    expect(calls).toEqual([
      { provider: "semantic", request },
      { provider: "lexical", request },
    ]);
    expect(calls.every((call) => call.request === request)).toBe(true);
    expect(rankCalls).toBe(0);
  });

  it("propagates the original ranking throw without wrapping it", async () => {
    const failure = { provider: "ranking" };
    const orchestrator = createKecHybridSearchOrchestrator({
      semanticSearcher: { search: async () => [] },
      lexicalSearcher: { search: async () => [] },
      rankingStrategy: {
        rank: () => {
          throw failure;
        },
      },
    });

    await expect(orchestrator.search(hybridSearchRequest)).rejects.toBe(
      failure,
    );
  });

  it("calls ranking exactly once for empty providers and passes through its result", async () => {
    const ranked: KecRankCandidate[] = [];
    const rankCalls: Array<{
      readonly candidates: readonly KecRankCandidate[];
      readonly limit: number;
    }> = [];
    const orchestrator = createKecHybridSearchOrchestrator({
      semanticSearcher: { search: async () => [] },
      lexicalSearcher: { search: async () => [] },
      rankingStrategy: {
        rank: (candidates, limit) => {
          rankCalls.push({ candidates, limit });
          return ranked;
        },
      },
    });

    const result = await orchestrator.search(hybridSearchRequest);

    expect(rankCalls).toHaveLength(1);
    expect(rankCalls[0]).toEqual({
      candidates: [],
      limit: hybridSearchRequest.limit,
    });
    expect(result).toBe(ranked);
  });

  it("does not reorder, re-limit, clone, or freeze ranking output", async () => {
    const ranked: KecRankCandidate[] = [
      {
        chunkId: "ranker-z",
        sourcePath: "ranker",
        page: 9,
        clause: null,
        text: "Ranker-owned result",
        signals: {},
      },
      {
        chunkId: "ranker-a",
        sourcePath: "ranker",
        page: 8,
        clause: null,
        text: "Second ranker result",
        signals: {},
      },
    ];
    const orchestrator = createKecHybridSearchOrchestrator({
      semanticSearcher: { search: async () => [semanticHit()] },
      lexicalSearcher: { search: async () => [] },
      rankingStrategy: { rank: () => ranked },
    });

    const result = await orchestrator.search({ query: "rank", limit: 1 });

    expect(result).toBe(ranked);
    expect(result).toHaveLength(2);
    expect(result.map((candidate) => candidate.chunkId)).toEqual([
      "ranker-z",
      "ranker-a",
    ]);
    expect(Object.isFrozen(result)).toBe(false);
  });

  it("does not mutate frozen requests, provider arrays, or provider hits", async () => {
    const request = Object.freeze<KecSearchRequest>({
      query: "immutable",
      limit: 2,
    });
    const semantic = Object.freeze(semanticHit());
    const lexical = Object.freeze(lexicalHit());
    const semanticResults = Object.freeze([semantic]);
    const lexicalResults = Object.freeze([lexical]);
    let rankedCandidates: readonly KecRankCandidate[] | undefined;
    const orchestrator = createKecHybridSearchOrchestrator({
      semanticSearcher: { search: async () => semanticResults },
      lexicalSearcher: { search: async () => lexicalResults },
      rankingStrategy: {
        rank: (candidates) => {
          rankedCandidates = candidates;
          return candidates;
        },
      },
    });

    const result = await orchestrator.search(request);

    expect(request).toEqual({ query: "immutable", limit: 2 });
    expect(semanticResults).toEqual([semantic]);
    expect(lexicalResults).toEqual([lexical]);
    expect(semantic).toEqual(semanticHit());
    expect(lexical).toEqual(lexicalHit());
    expect(rankedCandidates).toBe(result);
    expect(result[0]).not.toBe(semantic);
    expect(result[0]).not.toBe(lexical);
    expect(result[0]!.signals).toEqual({
      semanticScore: semantic.semanticScore,
      lexicalScore: lexical.lexicalScore,
    });
  });

  it("does not retry either provider after a rejection", async () => {
    const failure = new Error("provider failure");
    let semanticCalls = 0;
    let lexicalCalls = 0;
    const orchestrator = createKecHybridSearchOrchestrator({
      semanticSearcher: {
        search: async () => {
          semanticCalls += 1;
          throw failure;
        },
      },
      lexicalSearcher: {
        search: async () => {
          lexicalCalls += 1;
          return [];
        },
      },
      rankingStrategy: { rank: (candidates) => candidates },
    });

    await expect(orchestrator.search(hybridSearchRequest)).rejects.toBe(
      failure,
    );
    expect(semanticCalls).toBe(1);
    expect(lexicalCalls).toBe(1);
  });
});
