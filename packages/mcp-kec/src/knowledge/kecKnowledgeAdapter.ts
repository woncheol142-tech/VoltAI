import type {
  EmbeddedKnowledgeChunk,
  KnowledgeChunk,
  KnowledgeCodecs,
  KnowledgeIndexMetadata,
  KnowledgeLocator,
  KnowledgeMetadata,
  KnowledgeSearchResult,
  PageLocator,
} from "@voltai/knowledge-core";

import type {
  EmbeddedKecChunk,
  KecChunk,
  KecIndexMetadata,
  KecSearchResult,
} from "./vectorStore.js";

export type KecKnowledgeMetadata = {
  clause: string | null;
};

const kecCollection = "kec";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeKecMetadata(value: unknown): KecKnowledgeMetadata {
  if (!isRecord(value)) {
    throw new Error("KEC knowledge metadata is invalid");
  }

  const clause = value.clause;

  if (clause !== null && typeof clause !== "string") {
    throw new Error("KEC knowledge metadata is invalid");
  }

  return { clause };
}

function decodePageLocator(value: unknown): PageLocator {
  if (
    !isRecord(value) ||
    value.kind !== "page" ||
    !Number.isInteger(value.page) ||
    Number(value.page) < 1
  ) {
    throw new Error("KEC page locator is invalid");
  }

  return { kind: "page", page: Number(value.page) };
}

export const kecKnowledgeCodecs: KnowledgeCodecs<KecKnowledgeMetadata, PageLocator> = {
  metadata: {
    encode: (value): KnowledgeMetadata => ({ ...decodeKecMetadata(value) }),
    decode: decodeKecMetadata,
  },
  locator: {
    encode: (value): KnowledgeLocator => ({ ...decodePageLocator(value) }),
    decode: decodePageLocator,
  },
};

function documentId(sourcePath: string): string {
  return `${kecCollection}:${sourcePath}`;
}

function stableTextHash(value: string): string {
  let hash = 2166136261;

  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

function compatibilitySearchChunkId(result: KecSearchResult): string {
  const clause = result.clause ?? "unknown";
  const source = [result.sourcePath, result.page, result.clause ?? "", result.text].join("\u0000");

  return `${kecCollection}:${result.sourcePath}:p${result.page}:${clause}:${stableTextHash(source)}`;
}

export function kecChunkToKnowledgeChunk(
  chunk: KecChunk,
): KnowledgeChunk<KecKnowledgeMetadata, PageLocator> {
  return {
    chunkId: chunk.id,
    documentId: documentId(chunk.sourcePath),
    sourcePath: chunk.sourcePath,
    chunkIndex: chunk.chunkIndex,
    locator: { kind: "page", page: chunk.page },
    metadata: { clause: chunk.clause },
    text: chunk.text,
  };
}

export function knowledgeChunkToKecChunk(
  chunk: KnowledgeChunk<KecKnowledgeMetadata, PageLocator>,
): KecChunk {
  return {
    id: chunk.chunkId,
    sourcePath: chunk.sourcePath,
    page: chunk.locator.page,
    chunkIndex: chunk.chunkIndex,
    clause: chunk.metadata.clause,
    text: chunk.text,
  };
}

export function kecEmbeddedChunkToKnowledgeEmbeddedChunk(
  chunk: EmbeddedKecChunk,
): EmbeddedKnowledgeChunk<KecKnowledgeMetadata, PageLocator> {
  const { embedding, ...kecChunk } = chunk;

  return {
    ...kecChunkToKnowledgeChunk(kecChunk),
    embedding: [...embedding],
  };
}

export function knowledgeEmbeddedChunkToKecEmbeddedChunk(
  chunk: EmbeddedKnowledgeChunk<KecKnowledgeMetadata, PageLocator>,
): EmbeddedKecChunk {
  const { embedding, ...knowledgeChunk } = chunk;

  return {
    ...knowledgeChunkToKecChunk(knowledgeChunk),
    embedding: [...embedding],
  };
}

export function kecSearchResultToKnowledgeSearchResult(
  result: KecSearchResult,
): KnowledgeSearchResult<KecKnowledgeMetadata, PageLocator> {
  return {
    chunkId: compatibilitySearchChunkId(result),
    documentId: documentId(result.sourcePath),
    sourcePath: result.sourcePath,
    locator: { kind: "page", page: result.page },
    metadata: { clause: result.clause },
    text: result.text,
    similarity: result.similarity,
  };
}

export function knowledgeSearchResultToKecSearchResult(
  result: KnowledgeSearchResult<KecKnowledgeMetadata, PageLocator>,
): KecSearchResult {
  return {
    clause: result.metadata.clause,
    page: result.locator.page,
    text: result.text,
    similarity: result.similarity,
    sourcePath: result.sourcePath,
  };
}

export function kecIndexMetadataToKnowledgeIndexMetadata(
  metadata: KecIndexMetadata,
): KnowledgeIndexMetadata {
  return { ...metadata };
}

export function knowledgeIndexMetadataToKecIndexMetadata(
  metadata: KnowledgeIndexMetadata,
): KecIndexMetadata {
  return { ...metadata };
}
