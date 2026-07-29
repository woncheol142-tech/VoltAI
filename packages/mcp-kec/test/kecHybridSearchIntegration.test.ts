import { describe, expect, it } from "vitest";

import { kecKnowledgeCodecs } from "../src/knowledge/kecKnowledgeAdapter.js";
import { createExistingKecHybridSearch } from "../src/searchIntegration/index.js";
import {
  expectKecCodecIdentity,
  integrationHarness,
  persistedLexicalChunk,
  persistedSemanticHit,
} from "./helpers/kecHybridSearchIntegrationFixture.js";

const equalWeights = Object.freeze({
  semanticWeight: 1,
  lexicalWeight: 1,
});

function resultIds(
  result: Awaited<
    ReturnType<ReturnType<typeof createExistingKecHybridSearch>["search"]>
  >,
): string[] {
  return result.map((candidate) => candidate.chunkId);
}

describe("KEC hybrid search integration composition contracts", () => {
  it("returns a usable existing hybrid orchestrator", async () => {
    const harness = integrationHarness();
    const search = createExistingKecHybridSearch(
      harness.dependencies,
      equalWeights,
    );

    await expect(
      search.search({ query: "KEC cable", limit: 5 }),
    ).resolves.toEqual([]);
  });

  it("projects a semantic-only persisted hit through the existing adapter", async () => {
    const source = persistedSemanticHit();
    const harness = integrationHarness({ semanticResults: [source] });
    const search = createExistingKecHybridSearch(
      harness.dependencies,
      equalWeights,
    );

    const result = await search.search({ query: "semantic only", limit: 5 });

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
  });

  it("projects a lexical-only persisted chunk through Task 50A and Task 50", async () => {
    const source = persistedLexicalChunk();
    const harness = integrationHarness({ lexicalChunks: [source] });
    const search = createExistingKecHybridSearch(
      harness.dependencies,
      equalWeights,
    );

    const [result] = await search.search({ query: "접지 보호", limit: 5 });

    expect(result).toMatchObject({
      chunkId: source.chunkId,
      sourcePath: source.sourcePath,
      page: source.locator.page,
      clause: source.metadata.clause,
      text: source.text,
      signals: { lexicalScore: expect.any(Number) },
    });
    expect(result!.signals.lexicalScore).toBeGreaterThan(0);
  });

  it("merges matching semantic and lexical identities with both signals", async () => {
    const semantic = persistedSemanticHit({
      chunkId: "chunk-shared",
      similarity: 0.75,
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
    const search = createExistingKecHybridSearch(
      harness.dependencies,
      equalWeights,
    );

    const [result] = await search.search({ query: "케이블", limit: 5 });

    expect(result).toMatchObject({
      chunkId: "chunk-shared",
      signals: {
        semanticScore: 0.75,
        lexicalScore: expect.any(Number),
      },
    });
  });

  it("binds both branches to the exact KEC collection and codec authority", async () => {
    const harness = integrationHarness({
      semanticResults: [persistedSemanticHit()],
      lexicalChunks: [persistedLexicalChunk()],
    });
    const search = createExistingKecHybridSearch(
      harness.dependencies,
      equalWeights,
    );

    await search.search({ query: "접지", limit: 5 });

    expect(harness.calls.getMetadata).toEqual([{ collection: "kec" }]);
    expect(harness.calls.search).toHaveLength(1);
    expect(harness.calls.search[0]).toMatchObject({
      collection: "kec",
      embedding: harness.embedding,
      limit: 5,
    });
    expect(harness.calls.search[0]!.codecs).toBe(kecKnowledgeCodecs);
    expect(expectKecCodecIdentity(harness.calls.search[0]!)).toBe(true);
    expect(harness.calls.listChunks).toHaveLength(1);
    expect(harness.calls.listChunks[0]).toEqual({
      collection: "kec",
      codecs: kecKnowledgeCodecs,
    });
  });

  it("adds no duplicate provider or store calls for a successful request", async () => {
    const harness = integrationHarness({
      semanticResults: [persistedSemanticHit()],
      lexicalChunks: [persistedLexicalChunk()],
    });
    const search = createExistingKecHybridSearch(
      harness.dependencies,
      equalWeights,
    );

    await search.search({ query: "접지", limit: 5 });

    expect(harness.calls.embed).toEqual(["접지"]);
    expect(harness.calls.getMetadata).toHaveLength(1);
    expect(harness.calls.search).toHaveLength(1);
    expect(harness.calls.listChunks).toHaveLength(1);
  });

  it("forwards Unicode, NUL, and whitespace query bytes to the embedding provider", async () => {
    const query = "  접지\u0000ｅ\u0301  ";
    const harness = integrationHarness({
      semanticResults: [persistedSemanticHit()],
    });
    const search = createExistingKecHybridSearch(
      harness.dependencies,
      equalWeights,
    );

    await search.search({ query, limit: 3 });

    expect(harness.calls.embed).toEqual([query]);
    expect(harness.calls.search[0]!.limit).toBe(3);
  });

  it("lets semantic weights dominate without swapping the options", async () => {
    const harness = integrationHarness({
      semanticResults: [
        persistedSemanticHit({ chunkId: "semantic", similarity: 0.9 }),
      ],
      lexicalChunks: [
        persistedLexicalChunk({ chunkId: "lexical", text: "접지" }),
      ],
    });
    const search = createExistingKecHybridSearch(harness.dependencies, {
      semanticWeight: 10,
      lexicalWeight: 0,
    });

    expect(resultIds(await search.search({ query: "접지", limit: 2 }))).toEqual(
      ["semantic", "lexical"],
    );
  });

  it("lets lexical weights dominate without defaulting or normalizing options", async () => {
    const harness = integrationHarness({
      semanticResults: [
        persistedSemanticHit({ chunkId: "semantic", similarity: 0.99 }),
      ],
      lexicalChunks: [
        persistedLexicalChunk({ chunkId: "lexical", text: "접지" }),
      ],
    });
    const search = createExistingKecHybridSearch(harness.dependencies, {
      semanticWeight: 0,
      lexicalWeight: 7,
    });

    expect(resultIds(await search.search({ query: "접지", limit: 2 }))).toEqual(
      ["lexical", "semantic"],
    );
  });

  it("delegates deterministic tie breaking to Task 48", async () => {
    const harness = integrationHarness({
      semanticResults: [
        persistedSemanticHit({ chunkId: "z", similarity: 0.5 }),
        persistedSemanticHit({ chunkId: "a", similarity: 0.5 }),
      ],
    });
    const search = createExistingKecHybridSearch(
      harness.dependencies,
      equalWeights,
    );

    expect(resultIds(await search.search({ query: "tie", limit: 2 }))).toEqual([
      "a",
      "z",
    ]);
  });

  it("delegates final result limiting to Task 48", async () => {
    const harness = integrationHarness({
      semanticResults: [
        persistedSemanticHit({ chunkId: "a", similarity: 0.9 }),
        persistedSemanticHit({ chunkId: "b", similarity: 0.8 }),
      ],
    });
    const search = createExistingKecHybridSearch(
      harness.dependencies,
      equalWeights,
    );

    expect(
      resultIds(await search.search({ query: "limit", limit: 1 })),
    ).toEqual(["a"]);
    expect(harness.calls.search[0]!.limit).toBe(1);
  });

  it("adds no integration short circuit for zero limit", async () => {
    const harness = integrationHarness({
      semanticResults: [persistedSemanticHit()],
      lexicalChunks: [persistedLexicalChunk()],
    });
    const search = createExistingKecHybridSearch(
      harness.dependencies,
      equalWeights,
    );

    const first = await search.search({ query: "zero", limit: 0 });
    const second = await search.search({ query: "", limit: 0 });

    expect(first).toEqual([]);
    expect(second).toEqual([]);
    expect(first).not.toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(second)).toBe(true);
    expect(harness.calls.embed).toEqual([]);
    expect(harness.calls.getMetadata).toEqual([]);
    expect(harness.calls.search).toEqual([]);
    expect(harness.calls.listChunks).toEqual([]);
  });

  it("delegates an empty positive query to existing branch authorities", async () => {
    const source = persistedSemanticHit();
    const harness = integrationHarness({ semanticResults: [source] });
    const search = createExistingKecHybridSearch(
      harness.dependencies,
      equalWeights,
    );

    const result = await search.search({ query: "", limit: 2 });

    expect(resultIds(result)).toEqual([source.chunkId]);
    expect(harness.calls.embed).toEqual([""]);
    expect(harness.calls.search).toHaveLength(1);
    expect(harness.calls.listChunks).toHaveLength(0);
  });

  it("forwards limit 101 unchanged and preserves the lexical authority error", async () => {
    const harness = integrationHarness();
    const search = createExistingKecHybridSearch(
      harness.dependencies,
      equalWeights,
    );

    await expect(search.search({ query: "limit", limit: 101 })).rejects.toThrow(
      "INVALID_KEC_LEXICAL_LIMIT: invalid limit",
    );
    expect(harness.calls.search[0]!.limit).toBe(101);
    expect(harness.calls.listChunks).toHaveLength(0);
  });

  it("retains persisted identity and shared metadata without documentId leakage", async () => {
    const source = persistedSemanticHit({
      chunkId: "persisted-id",
      documentId: "private-document-id",
      sourcePath: "../../../../opaque/\u0000/source.pdf",
      locator: { kind: "page", page: 77 },
      metadata: { clause: null },
      text: "opaque persisted text",
    });
    const harness = integrationHarness({ semanticResults: [source] });
    const search = createExistingKecHybridSearch(
      harness.dependencies,
      equalWeights,
    );

    const [result] = await search.search({ query: "opaque", limit: 1 });

    expect(result).toEqual({
      chunkId: "persisted-id",
      sourcePath: source.sourcePath,
      page: 77,
      clause: null,
      text: source.text,
      signals: { semanticScore: source.similarity },
    });
    expect(result).not.toHaveProperty("documentId");
  });

  it("rejects cross-provider metadata conflicts through Task 47", async () => {
    const semantic = persistedSemanticHit({ chunkId: "conflict" });
    const lexical = persistedLexicalChunk({
      chunkId: semantic.chunkId,
      sourcePath: semantic.sourcePath,
      locator: semantic.locator,
      metadata: semantic.metadata,
      text: `${semantic.text} changed`,
    });
    const harness = integrationHarness({
      semanticResults: [semantic],
      lexicalChunks: [lexical],
    });
    const search = createExistingKecHybridSearch(
      harness.dependencies,
      equalWeights,
    );

    await expect(search.search({ query: "케이블", limit: 2 })).rejects.toThrow(
      "CONFLICTING_CHUNK_METADATA: conflict",
    );
  });

  it("delegates duplicate semantic chunk IDs to Task 47", async () => {
    const harness = integrationHarness({
      semanticResults: [
        persistedSemanticHit({ chunkId: "duplicate" }),
        persistedSemanticHit({ chunkId: "duplicate" }),
      ],
    });
    const search = createExistingKecHybridSearch(
      harness.dependencies,
      equalWeights,
    );

    await expect(
      search.search({ query: "duplicate", limit: 2 }),
    ).rejects.toThrow("DUPLICATE_CHUNK_ID: duplicate");
  });

  it("delegates duplicate lexical source IDs to Task 50A", async () => {
    const harness = integrationHarness({
      lexicalChunks: [
        persistedLexicalChunk({ chunkId: "duplicate" }),
        persistedLexicalChunk({ chunkId: "duplicate" }),
      ],
    });
    const search = createExistingKecHybridSearch(
      harness.dependencies,
      equalWeights,
    );

    await expect(search.search({ query: "접지", limit: 2 })).rejects.toThrow(
      "INVALID_KEC_LEXICAL_SOURCE_RESULT: invalid source result",
    );
  });

  it("preserves semantic and lexical scores in their named signals", async () => {
    const semantic = persistedSemanticHit({
      chunkId: "signals",
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
    const search = createExistingKecHybridSearch(
      harness.dependencies,
      equalWeights,
    );

    const [result] = await search.search({ query: "케이블", limit: 1 });

    expect(result!.signals.semanticScore).toBe(0.125);
    expect(result!.signals.lexicalScore).toBeGreaterThan(0);
    expect(result!.signals.semanticScore).not.toBe(
      result!.signals.lexicalScore,
    );
  });

  it("creates independent orchestrator graphs without taking dependency lifecycle ownership", async () => {
    const harness = integrationHarness();
    const first = createExistingKecHybridSearch(
      harness.dependencies,
      equalWeights,
    );
    const second = createExistingKecHybridSearch(
      harness.dependencies,
      equalWeights,
    );

    expect(first).not.toBe(second);
    expect(first).not.toHaveProperty("close");
    expect(second).not.toHaveProperty("dispose");
    await first.search({ query: "first", limit: 1 });
    await second.search({ query: "second", limit: 1 });
    expect(harness.calls.embed).toEqual(["first", "second"]);
  });
});
