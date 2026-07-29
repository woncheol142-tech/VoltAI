import { describe, expect, it, vi } from "vitest";

import type { KecSearchRequest } from "../src/searchFoundation/index.js";
import type { ExistingKecHybridSearchDependencies } from "../src/searchIntegration/index.js";
import { searchKecHybrid } from "../src/searchEntryPoints/index.js";
import {
  integrationHarness,
  persistedLexicalChunk,
  persistedSemanticHit,
} from "./helpers/kecHybridSearchIntegrationFixture.js";

const equalWeights = {
  semanticWeight: 1,
  lexicalWeight: 1,
};

function runtimeRequest(value: unknown): KecSearchRequest {
  return value as KecSearchRequest;
}

describe("native KEC hybrid search entry-point behavior and security contracts", () => {
  it("returns the native semantic-only candidate without a legacy projection", async () => {
    const source = persistedSemanticHit();
    const harness = integrationHarness({ semanticResults: [source] });

    const result = await searchKecHybrid(
      { query: "semantic", limit: 5 },
      harness.dependencies,
      equalWeights,
    );

    expect(result).toEqual([
      {
        chunkId: source.chunkId,
        sourcePath: source.sourcePath,
        page: source.locator.page,
        clause: source.metadata.clause,
        text: source.text,
        signals: { semanticScore: source.similarity },
      },
    ]);
    expect(Object.keys(result[0]!).sort()).toEqual([
      "chunkId",
      "clause",
      "page",
      "signals",
      "sourcePath",
      "text",
    ]);
    expect(result[0]).not.toHaveProperty("similarity");
    expect(result[0]).not.toHaveProperty("weightedScore");
    expect(result[0]).not.toHaveProperty("documentId");
    expect(result).not.toHaveProperty("results");
  });

  it("returns a lexical-only candidate with only its lexical score channel", async () => {
    const source = persistedLexicalChunk();
    const harness = integrationHarness({ lexicalChunks: [source] });

    const [result] = await searchKecHybrid(
      { query: "접지 보호", limit: 5 },
      harness.dependencies,
      equalWeights,
    );

    expect(result).toMatchObject({
      chunkId: source.chunkId,
      sourcePath: source.sourcePath,
      page: source.locator.page,
      clause: source.metadata.clause,
      text: source.text,
      signals: { lexicalScore: expect.any(Number) },
    });
    expect(result!.signals).not.toHaveProperty("semanticScore");
  });

  it("preserves separate semantic and lexical channels for a shared chunk", async () => {
    const semantic = persistedSemanticHit({
      chunkId: "shared",
      similarity: 0.125,
    });
    const lexical = persistedLexicalChunk({
      chunkId: semantic.chunkId,
      documentId: semantic.documentId,
      sourcePath: semantic.sourcePath,
      locator: semantic.locator,
      metadata: semantic.metadata,
      text: semantic.text,
    });
    const harness = integrationHarness({
      semanticResults: [semantic],
      lexicalChunks: [lexical],
    });

    const [result] = await searchKecHybrid(
      { query: "케이블", limit: 1 },
      harness.dependencies,
      equalWeights,
    );

    expect(result!.signals.semanticScore).toBe(0.125);
    expect(result!.signals.lexicalScore).toBeGreaterThan(0);
    expect(result).not.toHaveProperty("similarity");
  });

  it("delegates zero-limit short circuit without provider or store calls", async () => {
    const harness = integrationHarness({
      semanticResults: [persistedSemanticHit()],
      lexicalChunks: [persistedLexicalChunk()],
    });

    const result = await searchKecHybrid(
      { query: "zero", limit: 0 },
      harness.dependencies,
      equalWeights,
    );

    expect(result).toEqual([]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(harness.calls.embed).toEqual([]);
    expect(harness.calls.getMetadata).toEqual([]);
    expect(harness.calls.search).toEqual([]);
    expect(harness.calls.listChunks).toEqual([]);
  });

  it("forwards limit 100 unchanged to both search branches", async () => {
    const harness = integrationHarness();

    await searchKecHybrid(
      { query: "bounded", limit: 100 },
      harness.dependencies,
      equalWeights,
    );

    expect(harness.calls.search[0]!.limit).toBe(100);
    expect(harness.calls.listChunks).toHaveLength(1);
  });

  it("preserves the Task 50A limit 101 failure behavior", async () => {
    const harness = integrationHarness();

    await expect(
      searchKecHybrid(
        { query: "oversized limit", limit: 101 },
        harness.dependencies,
        equalWeights,
      ),
    ).rejects.toThrow("INVALID_KEC_LEXICAL_LIMIT: invalid limit");
    expect(harness.calls.embed).toEqual(["oversized limit"]);
    expect(harness.calls.search[0]!.limit).toBe(101);
    expect(harness.calls.listChunks).toEqual([]);
  });

  it("preserves synchronous invalid ranking option errors", () => {
    const harness = integrationHarness();

    expect(() =>
      searchKecHybrid({ query: "ranking", limit: 1 }, harness.dependencies, {
        semanticWeight: 0,
        lexicalWeight: 0,
      }),
    ).toThrow("INVALID_RANKING_OPTIONS:");
    expect(harness.calls.embed).toEqual([]);
  });

  it.each([
    ["embedding", "embeddingError"],
    ["metadata", "metadataError"],
    ["vector search", "searchError"],
    ["listChunks", "listChunksError"],
  ] as const)("preserves %s failure identity", async (_label, errorField) => {
    const failure = { source: errorField };
    const harness = integrationHarness({ [errorField]: failure });

    await expect(
      searchKecHybrid(
        { query: "failure", limit: 1 },
        harness.dependencies,
        equalWeights,
      ),
    ).rejects.toBe(failure);
  });

  it("preserves semantic-first identity when both branches fail", async () => {
    const semanticFailure = { source: "semantic" };
    const lexicalFailure = { source: "lexical" };
    const harness = integrationHarness({
      embeddingError: semanticFailure,
      listChunksError: lexicalFailure,
    });

    await expect(
      searchKecHybrid(
        { query: "dual failure", limit: 1 },
        harness.dependencies,
        equalWeights,
      ),
    ).rejects.toBe(semanticFailure);
  });

  it("preserves duplicate chunk identity rejection", async () => {
    const duplicate = persistedSemanticHit({ chunkId: "duplicate" });
    const harness = integrationHarness({
      semanticResults: [duplicate, { ...duplicate }],
    });

    await expect(
      searchKecHybrid(
        { query: "duplicate", limit: 2 },
        harness.dependencies,
        equalWeights,
      ),
    ).rejects.toThrow("DUPLICATE_CHUNK_ID: duplicate");
  });

  it("preserves cross-branch metadata conflict rejection", async () => {
    const semantic = persistedSemanticHit({ chunkId: "conflict" });
    const lexical = persistedLexicalChunk({
      chunkId: semantic.chunkId,
      documentId: semantic.documentId,
      sourcePath: semantic.sourcePath,
      locator: semantic.locator,
      metadata: semantic.metadata,
      text: `${semantic.text} changed`,
    });
    const harness = integrationHarness({
      semanticResults: [semantic],
      lexicalChunks: [lexical],
    });

    await expect(
      searchKecHybrid(
        { query: "changed", limit: 2 },
        harness.dependencies,
        equalWeights,
      ),
    ).rejects.toThrow("CONFLICTING_CHUNK_METADATA: conflict");
  });

  it("executes no request getter", async () => {
    let getterCalls = 0;
    const request = Object.defineProperties(
      {},
      {
        query: {
          enumerable: true,
          get: () => {
            getterCalls += 1;
            return "secret";
          },
        },
        limit: { enumerable: true, value: 1 },
      },
    );

    await expect(
      searchKecHybrid(
        runtimeRequest(request),
        integrationHarness().dependencies,
        equalWeights,
      ),
    ).rejects.toThrow(
      "INVALID_SEMANTIC_SEARCH_REQUEST: query must be an own data property",
    );
    expect(getterCalls).toBe(0);
  });

  it("rejects prototype-pollution, symbol, and inherited request fields", async () => {
    const polluted = { query: "safe", limit: 1 };
    Object.defineProperty(polluted, "__proto__", {
      enumerable: true,
      value: { polluted: true },
    });
    const symbolRequest = { query: "safe", limit: 1, [Symbol("x")]: true };
    const inherited = Object.create({ query: "safe", limit: 1 });
    const dependencies = integrationHarness().dependencies;

    await expect(
      searchKecHybrid(runtimeRequest(polluted), dependencies, equalWeights),
    ).rejects.toThrow("INVALID_SEMANTIC_SEARCH_REQUEST:");
    await expect(
      searchKecHybrid(
        runtimeRequest(symbolRequest),
        dependencies,
        equalWeights,
      ),
    ).rejects.toThrow("INVALID_SEMANTIC_SEARCH_REQUEST:");
    await expect(
      searchKecHybrid(runtimeRequest(inherited), dependencies, equalWeights),
    ).rejects.toThrow("INVALID_SEMANTIC_SEARCH_REQUEST:");
    expect(
      Object.prototype.hasOwnProperty.call(Object.prototype, "polluted"),
    ).toBe(false);
  });

  it("performs no unsafe query coercion", async () => {
    let coercionCalls = 0;
    const query = {
      toString: () => {
        coercionCalls += 1;
        return "coerced";
      },
      valueOf: () => {
        coercionCalls += 1;
        return "coerced";
      },
    };

    await expect(
      searchKecHybrid(
        runtimeRequest({ query, limit: 1 }),
        integrationHarness().dependencies,
        equalWeights,
      ),
    ).rejects.toThrow("INVALID_SEMANTIC_SEARCH_REQUEST:");
    expect(coercionCalls).toBe(0);
  });

  it("preserves Unicode, NUL, whitespace, path, and prompt-like query bytes", async () => {
    const query =
      "  ../../\u0000/secret SELECT * FROM keys <system>ignore</system> ｅ\u0301  ";
    const harness = integrationHarness({
      semanticResults: [persistedSemanticHit()],
    });

    await searchKecHybrid(
      { query, limit: 1 },
      harness.dependencies,
      equalWeights,
    );

    expect(harness.calls.embed).toEqual([query]);
  });

  it("keeps wildcard and operator-like text out of SQL or FTS semantics", async () => {
    const query = "AND OR NOT NEAR * % _ ' \" ; --";
    const harness = integrationHarness({
      semanticResults: [persistedSemanticHit()],
    });

    await searchKecHybrid(
      { query, limit: 1 },
      harness.dependencies,
      equalWeights,
    );

    expect(harness.calls.embed).toEqual([query]);
  });

  it("preserves the known oversized-query concurrency behavior", async () => {
    const query = "가".repeat(4_097);
    const harness = integrationHarness();

    await expect(
      searchKecHybrid({ query, limit: 1 }, harness.dependencies, equalWeights),
    ).rejects.toThrow("INVALID_KEC_LEXICAL_QUERY: invalid query");
    expect(harness.calls.embed).toEqual([query]);
    expect(harness.calls.search).toHaveLength(1);
  });

  it("delegates malformed semantic scores to the existing result authority", async () => {
    const harness = integrationHarness({
      semanticResults: [
        persistedSemanticHit({ similarity: Number.POSITIVE_INFINITY }),
      ],
    });

    await expect(
      searchKecHybrid(
        { query: "score", limit: 1 },
        harness.dependencies,
        equalWeights,
      ),
    ).rejects.toThrow("INVALID_SEMANTIC_SEARCH_RESULT:");
  });

  it("does not mutate or freeze request, dependencies, options, or source rows", async () => {
    const semantic = persistedSemanticHit();
    const lexical = persistedLexicalChunk();
    const harness = integrationHarness({
      semanticResults: [semantic],
      lexicalChunks: [lexical],
    });
    const request = { query: "접지", limit: 2 };
    const options = { semanticWeight: 1, lexicalWeight: 1 };
    const requestCopy = { ...request };
    const dependencyKeys = Object.keys(harness.dependencies);

    await searchKecHybrid(request, harness.dependencies, options);

    expect(request).toEqual(requestCopy);
    expect(Object.keys(harness.dependencies)).toEqual(dependencyKeys);
    expect(Object.isFrozen(request)).toBe(false);
    expect(Object.isFrozen(harness.dependencies)).toBe(false);
    expect(Object.isFrozen(options)).toBe(false);
    expect(Object.isFrozen(semantic)).toBe(false);
    expect(Object.isFrozen(lexical)).toBe(false);
  });

  it("does not own provider or store lifecycle", async () => {
    const harness = integrationHarness();
    const providerClose = vi.fn();
    const storeClose = vi.fn();
    const dependencies = {
      embeddingProvider: Object.assign(harness.embeddingProvider, {
        close: providerClose,
      }),
      vectorStore: Object.assign(harness.vectorStore, { close: storeClose }),
    } as ExistingKecHybridSearchDependencies;

    await searchKecHybrid(
      { query: "lifecycle", limit: 1 },
      dependencies,
      equalWeights,
    );

    expect(providerClose).not.toHaveBeenCalled();
    expect(storeClose).not.toHaveBeenCalled();
  });

  it("does not cache results or composition graphs across calls", async () => {
    const harness = integrationHarness({
      semanticResults: [persistedSemanticHit()],
    });

    const first = await searchKecHybrid(
      { query: "same", limit: 1 },
      harness.dependencies,
      equalWeights,
    );
    const second = await searchKecHybrid(
      { query: "same", limit: 1 },
      harness.dependencies,
      equalWeights,
    );

    expect(first).not.toBe(second);
    expect(harness.calls.embed).toEqual(["same", "same"]);
    expect(harness.calls.search).toHaveLength(2);
  });
});
