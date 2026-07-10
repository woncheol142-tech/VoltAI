import { describe, expect, it } from "vitest";

import {
  kecChunkToKnowledgeChunk,
  kecEmbeddedChunkToKnowledgeEmbeddedChunk,
  kecIndexMetadataToKnowledgeIndexMetadata,
  kecSearchResultToKnowledgeSearchResult,
  knowledgeChunkToKecChunk,
  knowledgeEmbeddedChunkToKecEmbeddedChunk,
  knowledgeIndexMetadataToKecIndexMetadata,
  knowledgeSearchResultToKecSearchResult,
} from "../src/knowledge/kecKnowledgeAdapter.js";
import type {
  EmbeddedKecChunk,
  KecChunk,
  KecIndexMetadata,
  KecSearchResult,
} from "../src/knowledge/vectorStore.js";

describe("KEC generic knowledge compatibility adapter", () => {
  it("round-trips KecChunk without changing its shape or values", () => {
    const chunk: KecChunk = {
      id: "knowledge/kec.pdf#page=3#chunk=0",
      sourcePath: "knowledge/kec.pdf",
      page: 3,
      chunkIndex: 0,
      clause: "KEC 232.5",
      text: "Cable sizing requirement.",
    };
    const generic = kecChunkToKnowledgeChunk(chunk);

    expect(generic).toEqual({
      chunkId: chunk.id,
      documentId: "kec:knowledge/kec.pdf",
      sourcePath: chunk.sourcePath,
      chunkIndex: chunk.chunkIndex,
      locator: { kind: "page", page: chunk.page },
      metadata: { clause: chunk.clause },
      text: chunk.text,
    });
    expect(knowledgeChunkToKecChunk(generic)).toEqual(chunk);
  });

  it("round-trips EmbeddedKecChunk including its embedding", () => {
    const chunk: EmbeddedKecChunk = {
      id: "knowledge/kec.pdf#page=3#chunk=0",
      sourcePath: "knowledge/kec.pdf",
      page: 3,
      chunkIndex: 0,
      clause: "KEC 232.5",
      text: "Cable sizing requirement.",
      embedding: [1, 0, 0],
    };

    expect(
      knowledgeEmbeddedChunkToKecEmbeddedChunk(
        kecEmbeddedChunkToKnowledgeEmbeddedChunk(chunk),
      ),
    ).toEqual(chunk);
  });

  it("round-trips KecSearchResult with byte-identical search_kec JSON", () => {
    const result: KecSearchResult = {
      clause: "KEC 232.5",
      page: 3,
      text: "Cable sizing requirement.",
      similarity: 0.92,
      sourcePath: "knowledge/kec.pdf",
    };
    const before = JSON.stringify({ results: [result] });
    const generic = kecSearchResultToKnowledgeSearchResult(result);
    const roundTrip = knowledgeSearchResultToKecSearchResult(generic);

    expect(generic).toEqual({
      chunkId: expect.stringMatching(/^kec:knowledge\/kec\.pdf:p3:KEC 232\.5:/),
      documentId: "kec:knowledge/kec.pdf",
      sourcePath: result.sourcePath,
      locator: { kind: "page", page: result.page },
      metadata: { clause: result.clause },
      text: result.text,
      similarity: result.similarity,
    });
    expect(roundTrip).toEqual(result);
    expect(JSON.stringify({ results: [roundTrip] })).toBe(before);
    expect(
      kecSearchResultToKnowledgeSearchResult({
        ...result,
        text: "A different cable sizing requirement.",
      }).chunkId,
    ).not.toBe(generic.chunkId);
  });

  it("round-trips KnowledgeIndexMetadata without changing the KEC metadata contract", () => {
    const metadata: KecIndexMetadata = {
      embeddingProvider: "ollama",
      embeddingModel: "nomic-embed-text",
      dimensions: 768,
      indexedAt: "2026-07-11T00:00:00.000Z",
    };

    expect(
      knowledgeIndexMetadataToKecIndexMetadata(
        kecIndexMetadataToKnowledgeIndexMetadata(metadata),
      ),
    ).toEqual(metadata);
  });

  it("does not mutate KEC inputs", () => {
    const chunk: KecChunk = {
      id: "knowledge/kec.pdf#page=3#chunk=0",
      sourcePath: "knowledge/kec.pdf",
      page: 3,
      chunkIndex: 0,
      clause: "KEC 232.5",
      text: "Cable sizing requirement.",
    };
    const result: KecSearchResult = {
      clause: "KEC 232.5",
      page: 3,
      text: "Cable sizing requirement.",
      similarity: 0.92,
      sourcePath: "knowledge/kec.pdf",
    };
    const chunkSnapshot = structuredClone(chunk);
    const resultSnapshot = structuredClone(result);
    const genericChunk = kecChunkToKnowledgeChunk(chunk);
    const genericResult = kecSearchResultToKnowledgeSearchResult(result);

    expect(chunk).toEqual(chunkSnapshot);
    expect(result).toEqual(resultSnapshot);
    expect(genericChunk).not.toBe(chunk);
    expect(genericResult).not.toBe(result);
  });
});
