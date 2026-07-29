import type {
  KnowledgeChunk,
  KnowledgeCodecs,
  KnowledgeIndexMetadata,
  KnowledgeLocator,
  KnowledgeMetadata,
  KnowledgeSearchResult,
  KnowledgeVectorStore,
  PageLocator,
} from "@voltai/knowledge-core";

import type { EmbeddingProvider } from "../../src/knowledge/embedding.js";
import {
  kecKnowledgeCodecs,
  type KecKnowledgeMetadata,
} from "../../src/knowledge/kecKnowledgeAdapter.js";
import type { ExistingKecHybridSearchDependencies } from "../../src/searchIntegration/index.js";

export type PersistedKecSemanticHit = KnowledgeSearchResult<
  KecKnowledgeMetadata,
  PageLocator
>;

export type PersistedKecLexicalChunk = KnowledgeChunk<
  KecKnowledgeMetadata,
  PageLocator
>;

export type IntegrationStoreCall = {
  readonly collection: string;
  readonly codecs?: unknown;
  readonly embedding?: number[];
  readonly limit?: number;
};

export type IntegrationHarnessOptions = {
  readonly embedding?: number[];
  readonly indexMetadata?: KnowledgeIndexMetadata | null;
  readonly semanticResults?: PersistedKecSemanticHit[];
  readonly lexicalChunks?: PersistedKecLexicalChunk[];
  readonly embeddingError?: unknown;
  readonly metadataError?: unknown;
  readonly searchError?: unknown;
  readonly listChunksError?: unknown;
};

export type IntegrationHarness = {
  readonly dependencies: ExistingKecHybridSearchDependencies;
  readonly embeddingProvider: EmbeddingProvider;
  readonly vectorStore: Pick<
    KnowledgeVectorStore,
    "getIndexMetadata" | "search" | "listChunks"
  >;
  readonly embedding: number[];
  readonly semanticResults: PersistedKecSemanticHit[];
  readonly lexicalChunks: PersistedKecLexicalChunk[];
  readonly calls: {
    readonly embed: string[];
    readonly getMetadata: IntegrationStoreCall[];
    readonly search: IntegrationStoreCall[];
    readonly listChunks: IntegrationStoreCall[];
  };
};

export function persistedSemanticHit(
  overrides: Partial<PersistedKecSemanticHit> = {},
): PersistedKecSemanticHit {
  return {
    chunkId: "chunk-semantic",
    documentId: "kec:knowledge/kec.pdf",
    sourcePath: "knowledge/kec.pdf",
    locator: { kind: "page", page: 12 },
    metadata: { clause: "KEC 232.5" },
    text: "케이블 허용전류와 보호장치 선정 기준",
    similarity: 0.92,
    ...overrides,
  };
}

export function persistedLexicalChunk(
  overrides: Partial<PersistedKecLexicalChunk> = {},
): PersistedKecLexicalChunk {
  return {
    chunkId: "chunk-lexical",
    documentId: "kec:knowledge/kec.pdf",
    sourcePath: "knowledge/kec.pdf",
    chunkIndex: 1,
    locator: { kind: "page", page: 18 },
    metadata: { clause: "KEC 211.2" },
    text: "접지 보호 접지 도체의 시설 기준",
    ...overrides,
  };
}

export function integrationHarness(
  options: IntegrationHarnessOptions = {},
): IntegrationHarness {
  const embedding = options.embedding ?? [1, 0, 0];
  const semanticResults = options.semanticResults ?? [];
  const lexicalChunks = options.lexicalChunks ?? [];
  const indexMetadata =
    options.indexMetadata === undefined
      ? {
          embeddingProvider: "fixture",
          embeddingModel: "fixed",
          dimensions: embedding.length,
          indexedAt: "2026-07-29T00:00:00.000Z",
        }
      : options.indexMetadata;
  const calls: IntegrationHarness["calls"] = {
    embed: [],
    getMetadata: [],
    search: [],
    listChunks: [],
  };

  const embeddingProvider: EmbeddingProvider = {
    embed: async (text) => {
      calls.embed.push(text);
      if (options.embeddingError !== undefined) {
        throw options.embeddingError;
      }
      return embedding;
    },
    getMetadata: () => ({
      provider: "fixture",
      model: "fixed",
    }),
  };

  const getIndexMetadata: KnowledgeVectorStore["getIndexMetadata"] = async (
    collection,
  ) => {
    calls.getMetadata.push({ collection });
    if (options.metadataError !== undefined) {
      throw options.metadataError;
    }
    return indexMetadata;
  };

  const search: KnowledgeVectorStore["search"] = async <
    TMetadata extends KnowledgeMetadata,
    TLocator extends KnowledgeLocator,
  >(
    collection: string,
    receivedEmbedding: number[],
    limit: number,
    codecs: KnowledgeCodecs<TMetadata, TLocator>,
  ): Promise<KnowledgeSearchResult<TMetadata, TLocator>[]> => {
    calls.search.push({
      collection,
      codecs,
      embedding: receivedEmbedding,
      limit,
    });
    if (options.searchError !== undefined) {
      throw options.searchError;
    }
    return semanticResults as unknown as KnowledgeSearchResult<
      TMetadata,
      TLocator
    >[];
  };

  const listChunks: KnowledgeVectorStore["listChunks"] = async <
    TMetadata extends KnowledgeMetadata,
    TLocator extends KnowledgeLocator,
  >(
    collection: string,
    codecs: KnowledgeCodecs<TMetadata, TLocator>,
  ): Promise<KnowledgeChunk<TMetadata, TLocator>[]> => {
    calls.listChunks.push({ collection, codecs });
    if (options.listChunksError !== undefined) {
      throw options.listChunksError;
    }
    return lexicalChunks as unknown as KnowledgeChunk<TMetadata, TLocator>[];
  };

  const vectorStore = {
    getIndexMetadata,
    search,
    listChunks,
  };

  return {
    dependencies: { embeddingProvider, vectorStore },
    embeddingProvider,
    vectorStore,
    embedding,
    semanticResults,
    lexicalChunks,
    calls,
  };
}

export function expectKecCodecIdentity(call: IntegrationStoreCall): boolean {
  return call.codecs === kecKnowledgeCodecs;
}
