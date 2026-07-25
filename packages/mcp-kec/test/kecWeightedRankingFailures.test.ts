import { describe, expect, it } from "vitest";

import {
  createKecWeightedRankingStrategy,
  type KecWeightedRankingOptions,
} from "../src/searchRanking/index.js";
import type { KecRankCandidate } from "../src/searchFoundation/index.js";
import { rankCandidate } from "./helpers/kecWeightedRankingFixture.js";

function runtimeOptions(value: unknown): KecWeightedRankingOptions {
  return value as KecWeightedRankingOptions;
}

function runtimeCandidate(value: unknown): KecRankCandidate {
  return value as KecRankCandidate;
}

describe("KEC weighted ranking validation contracts", () => {
  it.each([
    {
      name: "negative semanticWeight",
      options: { semanticWeight: -1, lexicalWeight: 1 },
      field: "semanticWeight",
    },
    {
      name: "NaN semanticWeight",
      options: { semanticWeight: Number.NaN, lexicalWeight: 1 },
      field: "semanticWeight",
    },
    {
      name: "negative Infinity semanticWeight",
      options: { semanticWeight: Number.NEGATIVE_INFINITY, lexicalWeight: 1 },
      field: "semanticWeight",
    },
    {
      name: "negative lexicalWeight",
      options: { semanticWeight: 1, lexicalWeight: -1 },
      field: "lexicalWeight",
    },
    {
      name: "Infinity lexicalWeight",
      options: { semanticWeight: 1, lexicalWeight: Number.POSITIVE_INFINITY },
      field: "lexicalWeight",
    },
    {
      name: "string semanticWeight",
      options: { semanticWeight: "1", lexicalWeight: 1 },
      field: "semanticWeight",
    },
    {
      name: "bigint lexicalWeight",
      options: { semanticWeight: 1, lexicalWeight: 1n },
      field: "lexicalWeight",
    },
  ])("rejects $name without coercion", ({ options, field }) => {
    expect(() =>
      createKecWeightedRankingStrategy(runtimeOptions(options)),
    ).toThrow(new RegExp(`^INVALID_RANKING_OPTIONS: ${field}`));
  });

  it("rejects missing and inherited weight properties in validation order", () => {
    expect(() =>
      createKecWeightedRankingStrategy(runtimeOptions({ lexicalWeight: 1 })),
    ).toThrow(/^INVALID_RANKING_OPTIONS: semanticWeight/);

    const inheritedSemantic = Object.create({ semanticWeight: 1 }) as Record<
      string,
      unknown
    >;
    inheritedSemantic.lexicalWeight = 1;
    expect(() =>
      createKecWeightedRankingStrategy(runtimeOptions(inheritedSemantic)),
    ).toThrow(/^INVALID_RANKING_OPTIONS: semanticWeight/);

    expect(() =>
      createKecWeightedRankingStrategy(runtimeOptions({ semanticWeight: 1 })),
    ).toThrow(/^INVALID_RANKING_OPTIONS: lexicalWeight/);
  });

  it("rejects option accessors without invoking their getters", () => {
    let semanticGetterCalls = 0;
    let lexicalGetterCalls = 0;
    const semanticAccessor = { lexicalWeight: 1 };
    Object.defineProperty(semanticAccessor, "semanticWeight", {
      enumerable: true,
      get: () => {
        semanticGetterCalls += 1;
        return 1;
      },
    });
    const lexicalAccessor = { semanticWeight: 1 };
    Object.defineProperty(lexicalAccessor, "lexicalWeight", {
      enumerable: true,
      get: () => {
        lexicalGetterCalls += 1;
        return 1;
      },
    });

    expect(() =>
      createKecWeightedRankingStrategy(runtimeOptions(semanticAccessor)),
    ).toThrow(/^INVALID_RANKING_OPTIONS: semanticWeight/);
    expect(() =>
      createKecWeightedRankingStrategy(runtimeOptions(lexicalAccessor)),
    ).toThrow(/^INVALID_RANKING_OPTIONS: lexicalWeight/);
    expect(semanticGetterCalls).toBe(0);
    expect(lexicalGetterCalls).toBe(0);
  });

  it("rejects two zero weights after validating both fields", () => {
    expect(() =>
      createKecWeightedRankingStrategy({
        semanticWeight: 0,
        lexicalWeight: 0,
      }),
    ).toThrow(/^INVALID_RANKING_OPTIONS: at least one/);
  });

  it.each([
    { name: "negative", limit: -1 },
    { name: "fractional", limit: 1.5 },
    { name: "NaN", limit: Number.NaN },
    { name: "Infinity", limit: Number.POSITIVE_INFINITY },
    { name: "unsafe integer", limit: Number.MAX_SAFE_INTEGER + 1 },
    { name: "runtime string", limit: "1" },
  ])("rejects a $name limit before candidate validation", ({ limit }) => {
    const strategy = createKecWeightedRankingStrategy({
      semanticWeight: 1,
      lexicalWeight: 1,
    });
    const invalidCandidate = runtimeCandidate({ signals: {} });

    expect(() => strategy.rank([invalidCandidate], limit as number)).toThrow(
      /^INVALID_RANK_LIMIT:/,
    );
  });

  it("validates every candidate before returning for limit zero", () => {
    const strategy = createKecWeightedRankingStrategy({
      semanticWeight: 1,
      lexicalWeight: 1,
    });
    const invalidCandidate = runtimeCandidate({
      chunkId: "missing-signals",
      signals: {},
    });

    expect(() => strategy.rank([invalidCandidate], 0)).toThrow(
      /^MISSING_RANK_SIGNALS:/,
    );
  });

  it.each([
    { name: "missing chunkId", candidate: { signals: { semanticScore: 1 } } },
    {
      name: "non-string chunkId",
      candidate: { chunkId: 1, signals: { semanticScore: 1 } },
    },
    { name: "missing signals", candidate: { chunkId: "chunk" } },
    { name: "null signals", candidate: { chunkId: "chunk", signals: null } },
  ])("rejects a candidate with $name", ({ candidate }) => {
    const strategy = createKecWeightedRankingStrategy({
      semanticWeight: 1,
      lexicalWeight: 1,
    });

    expect(() => strategy.rank([runtimeCandidate(candidate)], 1)).toThrow(
      /^INVALID_RANK_CANDIDATE:/,
    );
  });

  it("rejects chunkId and signals accessors without invoking getters", () => {
    const strategy = createKecWeightedRankingStrategy({
      semanticWeight: 1,
      lexicalWeight: 1,
    });
    let chunkIdGetterCalls = 0;
    let signalsGetterCalls = 0;
    const chunkIdAccessor = { signals: { semanticScore: 1 } };
    Object.defineProperty(chunkIdAccessor, "chunkId", {
      enumerable: true,
      get: () => {
        chunkIdGetterCalls += 1;
        return "chunk";
      },
    });
    const signalsAccessor = { chunkId: "chunk" };
    Object.defineProperty(signalsAccessor, "signals", {
      enumerable: true,
      get: () => {
        signalsGetterCalls += 1;
        return { semanticScore: 1 };
      },
    });

    expect(() => strategy.rank([runtimeCandidate(chunkIdAccessor)], 1)).toThrow(
      /^INVALID_RANK_CANDIDATE: chunkId/,
    );
    expect(() => strategy.rank([runtimeCandidate(signalsAccessor)], 1)).toThrow(
      /^INVALID_RANK_CANDIDATE: signals/,
    );
    expect(chunkIdGetterCalls).toBe(0);
    expect(signalsGetterCalls).toBe(0);
  });

  it("rejects candidates with no own ranking signals", () => {
    const strategy = createKecWeightedRankingStrategy({
      semanticWeight: 1,
      lexicalWeight: 1,
    });

    expect(() =>
      strategy.rank([rankCandidate({ chunkId: "empty", signals: {} })], 1),
    ).toThrow(/^MISSING_RANK_SIGNALS:/);
  });

  it.each([
    {
      name: "undefined semantic score",
      signals: { semanticScore: undefined },
      field: "semanticScore",
    },
    {
      name: "undefined lexical score",
      signals: { lexicalScore: undefined },
      field: "lexicalScore",
    },
    {
      name: "NaN semantic score",
      signals: { semanticScore: Number.NaN },
      field: "semanticScore",
    },
    {
      name: "Infinity lexical score",
      signals: { lexicalScore: Number.POSITIVE_INFINITY },
      field: "lexicalScore",
    },
    {
      name: "negative Infinity semantic score",
      signals: { semanticScore: Number.NEGATIVE_INFINITY },
      field: "semanticScore",
    },
    {
      name: "numeric string score",
      signals: { semanticScore: "1" },
      field: "semanticScore",
    },
    {
      name: "coercible object score",
      signals: { lexicalScore: { valueOf: () => 1 } },
      field: "lexicalScore",
    },
  ])("rejects $name without coercion", ({ signals, field }) => {
    const strategy = createKecWeightedRankingStrategy({
      semanticWeight: 1,
      lexicalWeight: 1,
    });
    const candidate = runtimeCandidate({ chunkId: "chunk", signals });

    expect(() => strategy.rank([candidate], 1)).toThrow(
      new RegExp(`^INVALID_RANK_SCORE: .*${field}`),
    );
  });

  it("rejects inherited scores instead of treating them as own presence", () => {
    const strategy = createKecWeightedRankingStrategy({
      semanticWeight: 1,
      lexicalWeight: 1,
    });
    const inheritedSemantic = Object.create({ semanticScore: 1 });
    const inheritedLexical = Object.create({ lexicalScore: 1 });

    expect(() =>
      strategy.rank(
        [runtimeCandidate({ chunkId: "semantic", signals: inheritedSemantic })],
        1,
      ),
    ).toThrow(/^INVALID_RANK_SCORE: .*semanticScore/);
    expect(() =>
      strategy.rank(
        [runtimeCandidate({ chunkId: "lexical", signals: inheritedLexical })],
        1,
      ),
    ).toThrow(/^INVALID_RANK_SCORE: .*lexicalScore/);
  });

  it("rejects score accessors without invoking their getters", () => {
    const strategy = createKecWeightedRankingStrategy({
      semanticWeight: 1,
      lexicalWeight: 1,
    });
    let semanticGetterCalls = 0;
    let lexicalGetterCalls = 0;
    const semanticSignals = { lexicalScore: 1 };
    Object.defineProperty(semanticSignals, "semanticScore", {
      enumerable: true,
      get: () => {
        semanticGetterCalls += 1;
        return 1;
      },
    });
    const lexicalSignals = { semanticScore: 1 };
    Object.defineProperty(lexicalSignals, "lexicalScore", {
      enumerable: true,
      get: () => {
        lexicalGetterCalls += 1;
        return 1;
      },
    });

    expect(() =>
      strategy.rank(
        [runtimeCandidate({ chunkId: "semantic", signals: semanticSignals })],
        1,
      ),
    ).toThrow(/^INVALID_RANK_SCORE: .*semanticScore/);
    expect(() =>
      strategy.rank(
        [runtimeCandidate({ chunkId: "lexical", signals: lexicalSignals })],
        1,
      ),
    ).toThrow(/^INVALID_RANK_SCORE: .*lexicalScore/);
    expect(semanticGetterCalls).toBe(0);
    expect(lexicalGetterCalls).toBe(0);
  });

  it("validates a present score even when its weight is zero", () => {
    const strategy = createKecWeightedRankingStrategy({
      semanticWeight: 0,
      lexicalWeight: 1,
    });
    const candidate = runtimeCandidate({
      chunkId: "zero-weight",
      signals: { semanticScore: Number.NaN, lexicalScore: 1 },
    });

    expect(() => strategy.rank([candidate], 1)).toThrow(
      /^INVALID_RANK_SCORE: .*semanticScore/,
    );
  });

  it("validates candidates in input order and semantic before lexical", () => {
    const strategy = createKecWeightedRankingStrategy({
      semanticWeight: 1,
      lexicalWeight: 1,
    });
    const first = runtimeCandidate({
      chunkId: "first",
      signals: { semanticScore: 1, lexicalScore: Number.NaN },
    });
    const second = runtimeCandidate({
      chunkId: "second",
      signals: { semanticScore: Number.NaN },
    });
    const bothInvalid = runtimeCandidate({
      chunkId: "both",
      signals: {
        semanticScore: Number.NaN,
        lexicalScore: Number.NaN,
      },
    });

    expect(() => strategy.rank([first, second], 2)).toThrow(
      /^INVALID_RANK_SCORE: first.*lexicalScore/,
    );
    expect(() => strategy.rank([bothInvalid], 1)).toThrow(
      /^INVALID_RANK_SCORE: both.*semanticScore/,
    );
  });

  it("rejects semantic, lexical, and final addition overflow", () => {
    const semanticOverflow = createKecWeightedRankingStrategy({
      semanticWeight: Number.MAX_VALUE,
      lexicalWeight: 0,
    });
    const lexicalOverflow = createKecWeightedRankingStrategy({
      semanticWeight: 0,
      lexicalWeight: Number.MAX_VALUE,
    });
    const additionOverflow = createKecWeightedRankingStrategy({
      semanticWeight: 1,
      lexicalWeight: 1,
    });

    expect(() =>
      semanticOverflow.rank(
        [
          rankCandidate({
            chunkId: "semantic-overflow",
            signals: { semanticScore: 2 },
          }),
        ],
        1,
      ),
    ).toThrow(/^INVALID_RANK_SCORE:/);
    expect(() =>
      lexicalOverflow.rank(
        [
          rankCandidate({
            chunkId: "lexical-overflow",
            signals: { lexicalScore: 2 },
          }),
        ],
        1,
      ),
    ).toThrow(/^INVALID_RANK_SCORE:/);
    expect(() =>
      additionOverflow.rank(
        [
          rankCandidate({
            chunkId: "addition-overflow",
            signals: {
              semanticScore: Number.MAX_VALUE,
              lexicalScore: Number.MAX_VALUE,
            },
          }),
        ],
        1,
      ),
    ).toThrow(/^INVALID_RANK_SCORE:/);
  });
});
