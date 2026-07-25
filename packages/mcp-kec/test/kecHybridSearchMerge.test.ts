import { describe, expect, it } from "vitest";

import {
  createKecHybridSearchOrchestrator,
  type KecHybridSearchOrchestrator,
} from "../src/searchHybrid/index.js";
import type {
  KecLexicalHit,
  KecRankCandidate,
  KecRankingStrategy,
  KecSearchRequest,
  KecSemanticHit,
} from "../src/searchFoundation/index.js";
import {
  hybridSearchRequest,
  lexicalHit,
  semanticHit,
} from "./helpers/kecHybridSearchFixture.js";

type RankCall = {
  readonly candidates: readonly KecRankCandidate[];
  readonly limit: number;
};

type Harness = {
  readonly orchestrator: KecHybridSearchOrchestrator;
  readonly rankCalls: RankCall[];
};

function createHarness(
  semanticHits: readonly KecSemanticHit[],
  lexicalHits: readonly KecLexicalHit[],
  rank: KecRankingStrategy["rank"] = (candidates) => candidates,
): Harness {
  const rankCalls: RankCall[] = [];
  const orchestrator = createKecHybridSearchOrchestrator({
    semanticSearcher: {
      search: async () => semanticHits,
    },
    lexicalSearcher: {
      search: async () => lexicalHits,
    },
    rankingStrategy: {
      rank: (candidates, limit) => {
        rankCalls.push({ candidates, limit });
        return rank(candidates, limit);
      },
    },
  });

  return { orchestrator, rankCalls };
}

describe("KEC hybrid search merge contracts", () => {
  it("creates a semantic-only candidate without a lexical signal property", async () => {
    const hit = semanticHit();
    const harness = createHarness([hit], []);

    const result = await harness.orchestrator.search(hybridSearchRequest);

    expect(result).toEqual([
      {
        chunkId: hit.chunkId,
        sourcePath: hit.sourcePath,
        page: hit.page,
        clause: hit.clause,
        text: hit.text,
        signals: { semanticScore: hit.semanticScore },
      },
    ]);
    expect(Object.hasOwn(result[0]!.signals, "lexicalScore")).toBe(false);
    expect(result[0]).not.toBe(hit);
  });

  it("creates a lexical-only candidate without a semantic signal property", async () => {
    const hit = lexicalHit();
    const harness = createHarness([], [hit]);

    const result = await harness.orchestrator.search(hybridSearchRequest);

    expect(result).toEqual([
      {
        chunkId: hit.chunkId,
        sourcePath: hit.sourcePath,
        page: hit.page,
        clause: hit.clause,
        text: hit.text,
        signals: { lexicalScore: hit.lexicalScore },
      },
    ]);
    expect(Object.hasOwn(result[0]!.signals, "semanticScore")).toBe(false);
    expect(result[0]).not.toBe(hit);
  });

  it("combines exact matching hits without calculating either score", async () => {
    const semantic = semanticHit({ semanticScore: 0.123456789 });
    const lexical = lexicalHit({ lexicalScore: 987.654321 });
    const harness = createHarness([semantic], [lexical]);

    const result = await harness.orchestrator.search(hybridSearchRequest);

    expect(result[0]!.signals).toEqual({
      semanticScore: 0.123456789,
      lexicalScore: 987.654321,
    });
    expect(result[0]).not.toBe(semantic);
    expect(result[0]).not.toBe(lexical);
  });

  it("merges semantic-only, lexical-only, and shared chunks", async () => {
    const harness = createHarness(
      [
        semanticHit({ chunkId: "chunk-c" }),
        semanticHit({ chunkId: "chunk-a" }),
      ],
      [lexicalHit({ chunkId: "chunk-b" }), lexicalHit({ chunkId: "chunk-a" })],
    );

    const result = await harness.orchestrator.search(hybridSearchRequest);

    expect(result.map((candidate) => candidate.chunkId)).toEqual([
      "chunk-a",
      "chunk-b",
      "chunk-c",
    ]);
    expect(result.map((candidate) => candidate.signals)).toEqual([
      { semanticScore: 0.91, lexicalScore: 12.5 },
      { lexicalScore: 12.5 },
      { semanticScore: 0.91 },
    ]);
  });

  it("rejects duplicate semantic chunk IDs with the fixed prefix", async () => {
    const harness = createHarness(
      [semanticHit(), semanticHit({ semanticScore: 0.5 })],
      [],
    );

    await expect(
      harness.orchestrator.search(hybridSearchRequest),
    ).rejects.toThrow(/^DUPLICATE_CHUNK_ID:/);
    expect(harness.rankCalls).toHaveLength(0);
  });

  it("rejects duplicate lexical chunk IDs with the fixed prefix", async () => {
    const harness = createHarness(
      [],
      [lexicalHit(), lexicalHit({ lexicalScore: 2 })],
    );

    await expect(
      harness.orchestrator.search(hybridSearchRequest),
    ).rejects.toThrow(/^DUPLICATE_CHUNK_ID:/);
    expect(harness.rankCalls).toHaveLength(0);
  });

  it.each<[string, Partial<KecLexicalHit>]>([
    ["sourcePath", { sourcePath: "knowledge/other.pdf" }],
    ["page", { page: 2 }],
    ["clause", { clause: null }],
    ["text", { text: "Different text." }],
  ])(
    "rejects an exact shared metadata conflict in %s",
    async (_field, overrides) => {
      const harness = createHarness([semanticHit()], [lexicalHit(overrides)]);

      await expect(
        harness.orchestrator.search(hybridSearchRequest),
      ).rejects.toThrow(/^CONFLICTING_CHUNK_METADATA:/);
      expect(harness.rankCalls).toHaveLength(0);
    },
  );

  it("uses deterministic JavaScript string ordering before ranking", async () => {
    const chunkIds = ["😀", "é", "a2", "A", "2", "10"];
    const harness = createHarness(
      chunkIds.map((chunkId) => semanticHit({ chunkId })),
      [],
    );

    await harness.orchestrator.search(hybridSearchRequest);

    expect(
      harness.rankCalls[0]!.candidates.map((candidate) => candidate.chunkId),
    ).toEqual(["10", "2", "A", "a2", "é", "😀"]);
  });

  it("is independent of both provider result orders", async () => {
    const semantic = [
      semanticHit({ chunkId: "c" }),
      semanticHit({ chunkId: "a" }),
    ];
    const lexical = [
      lexicalHit({ chunkId: "b" }),
      lexicalHit({ chunkId: "a" }),
    ];
    const forward = createHarness(semantic, lexical);
    const reversed = createHarness(
      [...semantic].reverse(),
      [...lexical].reverse(),
    );

    const forwardResult =
      await forward.orchestrator.search(hybridSearchRequest);
    const reversedResult =
      await reversed.orchestrator.search(hybridSearchRequest);

    expect(reversedResult).toEqual(forwardResult);
  });

  it("does not normalize canonically equivalent chunk ID strings", async () => {
    const request: KecSearchRequest = { query: "unicode", limit: 2 };
    const harness = createHarness(
      [semanticHit({ chunkId: "é" }), semanticHit({ chunkId: "e\u0301" })],
      [],
    );

    const result = await harness.orchestrator.search(request);

    expect(result.map((candidate) => candidate.chunkId)).toEqual([
      "e\u0301",
      "é",
    ]);
  });
});
