import { describe, expect, it } from "vitest";

import { createKecWeightedRankingStrategy } from "../src/searchRanking/index.js";
import type {
  KecRankCandidate,
  KecRankingStrategy,
} from "../src/searchFoundation/index.js";
import { rankCandidate } from "./helpers/kecWeightedRankingFixture.js";

function rankedIds(
  strategy: KecRankingStrategy,
  candidates: readonly KecRankCandidate[],
  limit = candidates.length,
): string[] {
  return strategy.rank(candidates, limit).map((candidate) => candidate.chunkId);
}

describe("KEC weighted ranking ordering contracts", () => {
  it("orders semantic-only candidates by weighted score", () => {
    const strategy = createKecWeightedRankingStrategy({
      semanticWeight: 2,
      lexicalWeight: 1,
    });
    const candidates = [
      rankCandidate({
        chunkId: "semantic-low",
        signals: { semanticScore: 2 },
      }),
      rankCandidate({
        chunkId: "semantic-high",
        signals: { semanticScore: 5 },
      }),
    ];

    expect(rankedIds(strategy, candidates)).toEqual([
      "semantic-high",
      "semantic-low",
    ]);
  });

  it("orders lexical-only candidates by weighted score", () => {
    const strategy = createKecWeightedRankingStrategy({
      semanticWeight: 1,
      lexicalWeight: 3,
    });
    const candidates = [
      rankCandidate({
        chunkId: "lexical-low",
        signals: { lexicalScore: 1 },
      }),
      rankCandidate({
        chunkId: "lexical-high",
        signals: { lexicalScore: 4 },
      }),
    ];

    expect(rankedIds(strategy, candidates)).toEqual([
      "lexical-high",
      "lexical-low",
    ]);
  });

  it("orders semantic, lexical, and both-signal candidates with explicit unequal weights", () => {
    const strategy = createKecWeightedRankingStrategy({
      semanticWeight: 2,
      lexicalWeight: 1,
    });
    const candidates = [
      rankCandidate({
        chunkId: "lexical-only",
        signals: { lexicalScore: 15 },
      }),
      rankCandidate({
        chunkId: "both",
        signals: { semanticScore: 5, lexicalScore: 7 },
      }),
      rankCandidate({
        chunkId: "semantic-only",
        signals: { semanticScore: 9 },
      }),
    ];

    expect(rankedIds(strategy, candidates)).toEqual([
      "semantic-only",
      "both",
      "lexical-only",
    ]);
  });

  it("allows either weight to be zero without dropping the present signal", () => {
    const lexicalStrategy = createKecWeightedRankingStrategy({
      semanticWeight: 0,
      lexicalWeight: 1,
    });
    const semanticStrategy = createKecWeightedRankingStrategy({
      semanticWeight: 1,
      lexicalWeight: 0,
    });
    const candidates = [
      rankCandidate({
        chunkId: "semantic",
        signals: { semanticScore: 100, lexicalScore: 2 },
      }),
      rankCandidate({
        chunkId: "lexical",
        signals: { semanticScore: 1, lexicalScore: 8 },
      }),
    ];

    expect(rankedIds(lexicalStrategy, candidates)).toEqual([
      "lexical",
      "semantic",
    ]);
    expect(rankedIds(semanticStrategy, candidates)).toEqual([
      "semantic",
      "lexical",
    ]);
  });

  it("allows weights greater than one without normalizing them", () => {
    const strategy = createKecWeightedRankingStrategy({
      semanticWeight: 4,
      lexicalWeight: 3,
    });
    const candidates = [
      rankCandidate({
        chunkId: "semantic",
        signals: { semanticScore: 3 },
      }),
      rankCandidate({
        chunkId: "lexical",
        signals: { lexicalScore: 5 },
      }),
    ];

    expect(rankedIds(strategy, candidates)).toEqual(["lexical", "semantic"]);
  });

  it("treats each missing signal as a zero contribution", () => {
    const strategy = createKecWeightedRankingStrategy({
      semanticWeight: 2,
      lexicalWeight: 3,
    });
    const candidates = [
      rankCandidate({
        chunkId: "semantic-only",
        signals: { semanticScore: 4 },
      }),
      rankCandidate({
        chunkId: "both",
        signals: { semanticScore: 1, lexicalScore: 3 },
      }),
    ];

    expect(rankedIds(strategy, candidates)).toEqual(["both", "semantic-only"]);
  });

  it("uses semantic signal presence after a weighted score tie", () => {
    const strategy = createKecWeightedRankingStrategy({
      semanticWeight: 1,
      lexicalWeight: 1,
    });
    const candidates = [
      rankCandidate({
        chunkId: "lexical",
        signals: { lexicalScore: 10 },
      }),
      rankCandidate({
        chunkId: "semantic",
        signals: { semanticScore: 10 },
      }),
    ];

    expect(rankedIds(strategy, candidates)).toEqual(["semantic", "lexical"]);
  });

  it("uses semantic score descending after semantic presence", () => {
    const strategy = createKecWeightedRankingStrategy({
      semanticWeight: 1,
      lexicalWeight: 1,
    });
    const candidates = [
      rankCandidate({
        chunkId: "lower-semantic",
        signals: { semanticScore: 6, lexicalScore: 4 },
      }),
      rankCandidate({
        chunkId: "higher-semantic",
        signals: { semanticScore: 8, lexicalScore: 2 },
      }),
    ];

    expect(rankedIds(strategy, candidates)).toEqual([
      "higher-semantic",
      "lower-semantic",
    ]);
  });

  it("uses lexical signal presence after equal semantic signals", () => {
    const strategy = createKecWeightedRankingStrategy({
      semanticWeight: 1,
      lexicalWeight: 1,
    });
    const candidates = [
      rankCandidate({
        chunkId: "semantic-only",
        signals: { semanticScore: 10 },
      }),
      rankCandidate({
        chunkId: "lexical-present",
        signals: { semanticScore: 10, lexicalScore: 0 },
      }),
    ];

    expect(rankedIds(strategy, candidates)).toEqual([
      "lexical-present",
      "semantic-only",
    ]);
  });

  it("uses lexical score descending when its weight is zero", () => {
    const strategy = createKecWeightedRankingStrategy({
      semanticWeight: 1,
      lexicalWeight: 0,
    });
    const candidates = [
      rankCandidate({
        chunkId: "lower-lexical",
        signals: { semanticScore: 10, lexicalScore: 2 },
      }),
      rankCandidate({
        chunkId: "higher-lexical",
        signals: { semanticScore: 10, lexicalScore: 8 },
      }),
    ];

    expect(rankedIds(strategy, candidates)).toEqual([
      "higher-lexical",
      "lower-lexical",
    ]);
  });

  it("uses JavaScript string ordering as the final tie-break", () => {
    const strategy = createKecWeightedRankingStrategy({
      semanticWeight: 1,
      lexicalWeight: 1,
    });
    const chunkIds = ["10", "2", "a", "A", "\ud55c", "\u00e9", "e\u0301"];
    const expected = [...chunkIds].sort((left, right) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    const candidates = chunkIds
      .toReversed()
      .map((chunkId) =>
        rankCandidate({ chunkId, signals: { semanticScore: 1 } }),
      );

    expect(rankedIds(strategy, candidates)).toEqual(expected);
  });

  it.each([
    { limit: 0, expected: [] },
    { limit: 1, expected: ["high"] },
    { limit: 2, expected: ["high", "low"] },
    { limit: 5, expected: ["high", "low"] },
  ])(
    "applies a valid limit only after ranking: $limit",
    ({ limit, expected }) => {
      const strategy = createKecWeightedRankingStrategy({
        semanticWeight: 1,
        lexicalWeight: 0,
      });
      const candidates = [
        rankCandidate({ chunkId: "low", signals: { semanticScore: 1 } }),
        rankCandidate({ chunkId: "high", signals: { semanticScore: 2 } }),
      ];

      expect(rankedIds(strategy, candidates, limit)).toEqual(expected);
    },
  );

  it("returns a new shallow-frozen array while preserving candidate references", () => {
    const options = { semanticWeight: 1, lexicalWeight: 1 };
    const strategy = createKecWeightedRankingStrategy(options);
    const low = rankCandidate({
      chunkId: "low",
      signals: { semanticScore: 1 },
    });
    const high = rankCandidate({
      chunkId: "high",
      signals: { semanticScore: 2 },
    });
    const candidates = [low, high];
    const inputSnapshot = [...candidates];
    const optionsSnapshot = { ...options };

    const result = strategy.rank(candidates, candidates.length);

    expect(result).not.toBe(candidates);
    expect(result).toEqual([high, low]);
    expect(result[0]).toBe(high);
    expect(result[1]).toBe(low);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(high)).toBe(false);
    expect(Object.isFrozen(high.signals)).toBe(false);
    expect(candidates).toEqual(inputSnapshot);
    expect(options).toEqual(optionsSnapshot);
    expect(Object.hasOwn(result[0]!, "weightedScore")).toBe(false);
  });

  it("supports frozen options, candidates, and signals without mutation", () => {
    const options = Object.freeze({ semanticWeight: 1, lexicalWeight: 1 });
    const low = Object.freeze(
      rankCandidate({
        chunkId: "low",
        signals: Object.freeze({ semanticScore: 1 }),
      }),
    );
    const high = Object.freeze(
      rankCandidate({
        chunkId: "high",
        signals: Object.freeze({ semanticScore: 2 }),
      }),
    );
    const candidates = Object.freeze([low, high]);
    const strategy = createKecWeightedRankingStrategy(options);

    const result = strategy.rank(candidates, 2);

    expect(result).toEqual([high, low]);
    expect(candidates).toEqual([low, high]);
  });

  it("is deterministic across repeated and reversed input order", () => {
    const strategy = createKecWeightedRankingStrategy({
      semanticWeight: 2,
      lexicalWeight: 1,
    });
    const candidates = [
      rankCandidate({
        chunkId: "c",
        signals: { semanticScore: 4, lexicalScore: 1 },
      }),
      rankCandidate({
        chunkId: "a",
        signals: { semanticScore: 2, lexicalScore: 5 },
      }),
      rankCandidate({
        chunkId: "b",
        signals: { semanticScore: 3, lexicalScore: 3 },
      }),
    ];
    const expected = rankedIds(strategy, candidates);

    for (let iteration = 0; iteration < 100; iteration += 1) {
      expect(rankedIds(strategy, candidates)).toEqual(expected);
      expect(rankedIds(strategy, candidates.toReversed())).toEqual(expected);
    }
  });
});
