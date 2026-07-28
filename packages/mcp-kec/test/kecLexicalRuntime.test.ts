import { describe, expect, it } from "vitest";

import {
  searchKecLexically,
  type KecLexicalSearchDependencies,
  type KecLexicalSearchResult,
} from "../src/searchLexical/index.js";
import { tokenizeKecLexicalText } from "../src/searchLexical/tokenizeKecLexicalText.js";
import {
  createKecLexicalSourceHarness,
  kecLexicalSourceChunk,
} from "./helpers/kecLexicalRuntimeFixture.js";

function runtimeSearch(
  query: unknown,
  limit: unknown,
  dependencies: KecLexicalSearchDependencies,
): Promise<readonly KecLexicalSearchResult[]> {
  return searchKecLexically(query as string, limit as number, dependencies);
}

function hangulTokens(count: number): string {
  return Array.from({ length: count }, (_, index) =>
    String.fromCodePoint(0xac00 + index),
  ).join(" ");
}

describe("KEC lexical runtime validation and short circuits", () => {
  it.each([null, 1, true, Symbol("query"), { toString: () => "접지" }])(
    "rejects a non-string query without coercion",
    async (query) => {
      const harness = createKecLexicalSourceHarness();

      await expect(
        runtimeSearch(query, 1, harness.dependencies),
      ).rejects.toThrow(/^INVALID_KEC_LEXICAL_QUERY:/);
      expect(harness.callCount()).toBe(0);
    },
  );

  it("accepts exactly 4,096 UTF-16 code units and rejects 4,097", async () => {
    const accepted = createKecLexicalSourceHarness();
    const rejected = createKecLexicalSourceHarness();

    await expect(
      searchKecLexically("가".repeat(4_096), 1, accepted.dependencies),
    ).resolves.toEqual([]);
    await expect(
      searchKecLexically("가".repeat(4_097), 1, rejected.dependencies),
    ).rejects.toThrow(/^INVALID_KEC_LEXICAL_QUERY:/);
    expect(accepted.callCount()).toBe(1);
    expect(rejected.callCount()).toBe(0);
  });

  it.each([
    "1",
    1n,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    1.5,
    -1,
    101,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects an invalid limit without source access", async (limit) => {
    const harness = createKecLexicalSourceHarness();

    await expect(
      runtimeSearch("접지", limit, harness.dependencies),
    ).rejects.toThrow(/^INVALID_KEC_LEXICAL_LIMIT:/);
    expect(harness.callCount()).toBe(0);
  });

  it("checks query type and length before limit validation", async () => {
    const harness = createKecLexicalSourceHarness();

    await expect(
      runtimeSearch({ toString: () => "접지" }, 101, harness.dependencies),
    ).rejects.toThrow(/^INVALID_KEC_LEXICAL_QUERY:/);
    await expect(
      runtimeSearch("가".repeat(4_097), 101, harness.dependencies),
    ).rejects.toThrow(/^INVALID_KEC_LEXICAL_QUERY:/);
    expect(harness.callCount()).toBe(0);
  });

  it("checks limit before normalization and raw-token count", async () => {
    const harness = createKecLexicalSourceHarness();

    await expect(
      runtimeSearch("접지 ".repeat(65), 101, harness.dependencies),
    ).rejects.toThrow(/^INVALID_KEC_LEXICAL_LIMIT:/);
    expect(harness.callCount()).toBe(0);
  });

  it("accepts 64 raw tokens and rejects 65 before source access", async () => {
    const accepted = createKecLexicalSourceHarness([
      kecLexicalSourceChunk({ text: "접지" }),
    ]);
    const rejected = createKecLexicalSourceHarness();

    await expect(
      searchKecLexically("접지 ".repeat(64), 1, accepted.dependencies),
    ).resolves.toHaveLength(1);
    await expect(
      searchKecLexically("접지 ".repeat(65), 1, rejected.dependencies),
    ).rejects.toThrow(/^INVALID_KEC_LEXICAL_QUERY:/);
    expect(accepted.callCount()).toBe(1);
    expect(rejected.callCount()).toBe(0);
  });

  it("also permits 64 unique tokens after raw-token validation", async () => {
    const harness = createKecLexicalSourceHarness();

    await expect(
      searchKecLexically(hangulTokens(64), 1, harness.dependencies),
    ).resolves.toEqual([]);
    expect(harness.callCount()).toBe(1);
  });

  it.each(["", " \t\r\n ", "* + - \" ' : ( )", "＊＋－："])(
    "returns a fresh frozen empty result for a valid empty search",
    async (query) => {
      const harness = createKecLexicalSourceHarness([kecLexicalSourceChunk()]);

      const first = await searchKecLexically(query, 1, harness.dependencies);
      const second = await searchKecLexically(query, 1, harness.dependencies);

      expect(first).toEqual([]);
      expect(Object.isFrozen(first)).toBe(true);
      expect(second).not.toBe(first);
      expect(harness.callCount()).toBe(0);
    },
  );

  it("returns a fresh frozen empty result for limit zero", async () => {
    const harness = createKecLexicalSourceHarness([kecLexicalSourceChunk()]);

    const first = await searchKecLexically("접지", 0, harness.dependencies);
    const second = await searchKecLexically("접지", 0, harness.dependencies);

    expect(first).toEqual([]);
    expect(Object.isFrozen(first)).toBe(true);
    expect(second).not.toBe(first);
    expect(harness.callCount()).toBe(0);
  });

  it("does not let zero-limit bypass invalid query, limit, or token count", async () => {
    const harness = createKecLexicalSourceHarness();

    await expect(runtimeSearch(1, 0, harness.dependencies)).rejects.toThrow(
      /^INVALID_KEC_LEXICAL_QUERY:/,
    );
    await expect(
      runtimeSearch("접지", -1, harness.dependencies),
    ).rejects.toThrow(/^INVALID_KEC_LEXICAL_LIMIT:/);
    await expect(
      searchKecLexically("접지 ".repeat(65), 0, harness.dependencies),
    ).rejects.toThrow(/^INVALID_KEC_LEXICAL_QUERY:/);
    expect(harness.callCount()).toBe(0);
  });
});

describe("KEC lexical tokenizer and Korean search behavior", () => {
  it.each([
    ["22.9kV", ["22.9", "kv"]],
    ["제1종", ["제", "1", "종"]],
    ["과전류 보호", ["과전류", "보호"]],
    ["3상 4선식", ["3", "상", "4", "선식"]],
    ["ＫＥＣ ２３２．５", ["kec", "232.5"]],
    ["접지, 피뢰 (전선관)", ["접지", "피뢰", "전선관"]],
  ])("normalizes and tokenizes %j deterministically", (value, expected) => {
    expect(tokenizeKecLexicalText(value as string)).toEqual(expected);
  });

  it("treats query operators as separators rather than executable syntax", () => {
    expect(
      tokenizeKecLexicalText("접지 * + - \" ' : ( ) NEAR AND OR NOT 피뢰"),
    ).toEqual(["접지", "피뢰"]);
  });

  it.each([
    "접지",
    "피뢰",
    "전선관",
    "과전류 보호",
    "22.9kV",
    "저압 전로",
    "제1종 접지",
    "감전 보호",
    "누전차단기",
    "3상 4선식",
  ])("finds the approved Korean or mixed query %j", async (query) => {
    const harness = createKecLexicalSourceHarness([
      kecLexicalSourceChunk({
        metadata: { clause: null },
        text: query,
      }),
    ]);

    await expect(
      searchKecLexically(query, 1, harness.dependencies),
    ).resolves.toHaveLength(1);
  });

  it("does not silently repair Korean spacing variants", async () => {
    const harness = createKecLexicalSourceHarness([
      kecLexicalSourceChunk({
        metadata: { clause: null },
        text: "과전류보호 기준",
      }),
    ]);

    await expect(
      searchKecLexically("과전류 보호", 1, harness.dependencies),
    ).resolves.toEqual([]);
  });
});

describe("KEC lexical score authority", () => {
  it.each([
    {
      name: "full contiguous phrase",
      query: "접지 보호",
      text: "접지 보호 기준",
      clause: null,
      expected: 0.833333,
    },
    {
      name: "partial token match",
      query: "접지 보호",
      text: "접지 설비",
      clause: null,
      expected: 0.291667,
    },
    {
      name: "text frequency capped at three",
      query: "접지",
      text: "접지 접지 접지 접지 접지",
      clause: null,
      expected: 0.9,
    },
    {
      name: "duplicate query tokens use the unique denominator",
      query: "접지 접지 보호",
      text: "접지 보호",
      clause: null,
      expected: 0.833333,
    },
    {
      name: "exact clause token sequence",
      query: "KEC 232.5",
      text: "관련 기준",
      clause: "KEC 232.5",
      expected: 0.9,
    },
    {
      name: "same tokens in the wrong order",
      query: "접지 보호",
      text: "보호 접지",
      clause: null,
      expected: 0.583333,
    },
  ])("calculates the exact $name score", async (vector) => {
    const harness = createKecLexicalSourceHarness([
      kecLexicalSourceChunk({
        metadata: { clause: vector.clause },
        text: vector.text,
      }),
    ]);

    const [result] = await searchKecLexically(
      vector.query,
      1,
      harness.dependencies,
    );

    expect(result.lexicalScore).toBe(vector.expected);
  });

  it("omits a row whose token coverage is zero", async () => {
    const harness = createKecLexicalSourceHarness([
      kecLexicalSourceChunk({
        metadata: { clause: null },
        text: "피뢰 설비",
      }),
    ]);

    await expect(
      searchKecLexically("접지 보호", 10, harness.dependencies),
    ).resolves.toEqual([]);
  });

  it("generates only finite, positive scores no greater than one and never -0", async () => {
    const harness = createKecLexicalSourceHarness([
      kecLexicalSourceChunk({
        text: "접지 접지 접지 접지",
        metadata: { clause: "접지" },
      }),
      kecLexicalSourceChunk({
        chunkId: "partial",
        text: "접지",
        metadata: { clause: null },
      }),
    ]);

    const results = await searchKecLexically(
      "접지 보호",
      10,
      harness.dependencies,
    );

    for (const result of results) {
      expect(Number.isFinite(result.lexicalScore)).toBe(true);
      expect(result.lexicalScore).toBeGreaterThan(0);
      expect(result.lexicalScore).toBeLessThanOrEqual(1);
      expect(Object.is(result.lexicalScore, -0)).toBe(false);
    }
  });
});

describe("KEC lexical result, ordering, and limit contracts", () => {
  it("preserves persisted fields and exposes exactly one generated field", async () => {
    const source = kecLexicalSourceChunk({
      chunkId: "persisted-authority",
      documentId: "kec:document-authority",
      sourcePath: "../opaque/not-opened.pdf",
      chunkIndex: 17,
      locator: { kind: "page", page: 9 },
      metadata: { clause: "KEC 232.5" },
      text: "접지 보호",
    });
    const harness = createKecLexicalSourceHarness([source]);

    const [result] = await searchKecLexically("접지", 1, harness.dependencies);

    expect(Object.keys(result)).toEqual([
      "chunkId",
      "documentId",
      "sourcePath",
      "locator",
      "metadata",
      "text",
      "lexicalScore",
    ]);
    expect(result).toMatchObject({
      chunkId: source.chunkId,
      documentId: source.documentId,
      sourcePath: source.sourcePath,
      locator: source.locator,
      metadata: source.metadata,
      text: source.text,
    });
    expect(result).not.toHaveProperty("chunkIndex");
  });

  it("orders by score descending before the deterministic ID tie-break", async () => {
    const harness = createKecLexicalSourceHarness([
      kecLexicalSourceChunk({
        chunkId: "lower-score",
        text: "접지",
        metadata: { clause: null },
      }),
      kecLexicalSourceChunk({
        chunkId: "higher-score",
        text: "접지 접지 접지",
        metadata: { clause: "접지" },
      }),
    ]);

    const results = await searchKecLexically("접지", 10, harness.dependencies);

    expect(results.map((result) => result.chunkId)).toEqual([
      "higher-score",
      "lower-score",
    ]);
  });

  it("uses UTF-16 code-unit ascending order and ignores source order", async () => {
    const astral = `id-${String.fromCodePoint(0x10000)}`;
    const privateUse = "id-\ue000";
    const rows = [
      kecLexicalSourceChunk({ chunkId: privateUse, text: "접지" }),
      kecLexicalSourceChunk({ chunkId: astral, text: "접지" }),
    ];
    const forward = createKecLexicalSourceHarness(rows);
    const reverse = createKecLexicalSourceHarness([...rows].reverse());

    const first = await searchKecLexically("접지", 10, forward.dependencies);
    const second = await searchKecLexically("접지", 10, reverse.dependencies);

    expect(first.map((result) => result.chunkId)).toEqual([astral, privateUse]);
    expect(second).toEqual(first);
  });

  it("applies the validated limit only after deterministic ordering", async () => {
    const rows = Array.from({ length: 101 }, (_, index) =>
      kecLexicalSourceChunk({
        chunkId: `chunk-${String(100 - index).padStart(3, "0")}`,
        chunkIndex: index,
        text: "접지",
      }),
    );
    const harness = createKecLexicalSourceHarness(rows);

    const one = await searchKecLexically("접지", 1, harness.dependencies);
    const hundred = await searchKecLexically("접지", 100, harness.dependencies);

    expect(one.map((result) => result.chunkId)).toEqual(["chunk-000"]);
    expect(hundred).toHaveLength(100);
    expect(hundred.at(-1)?.chunkId).toBe("chunk-099");
  });

  it("returns new schema-local frozen objects without source aliases", async () => {
    const source = kecLexicalSourceChunk({ text: "접지" });
    const sourceArray = [source];
    const harness = createKecLexicalSourceHarness(sourceArray);

    const result = await searchKecLexically("접지", 1, harness.dependencies);

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result[0])).toBe(true);
    expect(Object.isFrozen(result[0].locator)).toBe(true);
    expect(Object.isFrozen(result[0].metadata)).toBe(true);
    expect(result).not.toBe(sourceArray);
    expect(result[0]).not.toBe(source);
    expect(result[0].locator).not.toBe(source.locator);
    expect(result[0].metadata).not.toBe(source.metadata);
    expect(Object.isFrozen(sourceArray)).toBe(false);
    expect(Object.isFrozen(source)).toBe(false);
    expect(Object.isFrozen(source.locator)).toBe(false);
    expect(Object.isFrozen(source.metadata)).toBe(false);
  });
});
