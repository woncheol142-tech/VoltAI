import type { PageLocator } from "@voltai/knowledge-core";
import {
  SqliteKnowledgeStore,
  type SqliteKnowledgeWriteOptions,
} from "@voltai/knowledge-sqlite";

import {
  kecEmbeddedChunkToKnowledgeEmbeddedChunk,
  kecIndexMetadataToKnowledgeIndexMetadata,
  kecKnowledgeCodecs,
  knowledgeChunkToKecChunk,
  knowledgeIndexMetadataToKecIndexMetadata,
  knowledgeSearchResultToKecSearchResult,
  type KecKnowledgeMetadata,
} from "./kecKnowledgeAdapter.js";
import type {
  EmbeddedKecChunk,
  KecChunk,
  KecIndexMetadata,
  KecSearchResult,
  KnowledgeCollection,
  VectorStore,
} from "./vectorStore.js";

const kecWriteOptions: SqliteKnowledgeWriteOptions<KecKnowledgeMetadata, PageLocator> = {
  compatibilityProjection: (chunk) => ({
    page: chunk.locator.page,
    clause: chunk.metadata.clause,
  }),
};

export class SqliteVectorStore implements VectorStore {
  private readonly knowledgeStore: SqliteKnowledgeStore;

  constructor(dbPath: string) {
    this.knowledgeStore = new SqliteKnowledgeStore(dbPath);
  }

  async upsert(collection: KnowledgeCollection, chunks: EmbeddedKecChunk[]): Promise<void> {
    await this.knowledgeStore.upsert(
      collection,
      chunks.map(kecEmbeddedChunkToKnowledgeEmbeddedChunk),
      kecKnowledgeCodecs,
      kecWriteOptions,
    );
  }

  async replaceSource(
    collection: KnowledgeCollection,
    sourcePath: string,
    chunks: EmbeddedKecChunk[],
    metadata: KecIndexMetadata,
  ): Promise<void> {
    await this.knowledgeStore.replaceSource(
      collection,
      sourcePath,
      chunks.map(kecEmbeddedChunkToKnowledgeEmbeddedChunk),
      kecIndexMetadataToKnowledgeIndexMetadata(metadata),
      kecKnowledgeCodecs,
      kecWriteOptions,
    );
  }

  async deleteBySourcePath(
    collection: KnowledgeCollection,
    sourcePath: string,
  ): Promise<void> {
    await this.knowledgeStore.deleteBySourcePath(collection, sourcePath);
  }

  async search(
    collection: KnowledgeCollection,
    embedding: number[],
    topK: number,
  ): Promise<KecSearchResult[]> {
    const results = await this.knowledgeStore.search(
      collection,
      embedding,
      topK,
      kecKnowledgeCodecs,
    );

    return results.map(knowledgeSearchResultToKecSearchResult);
  }

  async listChunks(collection: KnowledgeCollection): Promise<KecChunk[]> {
    const chunks = await this.knowledgeStore.listChunks(collection, kecKnowledgeCodecs);

    return chunks.map(knowledgeChunkToKecChunk);
  }

  async saveIndexMetadata(
    collection: KnowledgeCollection,
    metadata: KecIndexMetadata,
  ): Promise<void> {
    await this.knowledgeStore.saveIndexMetadata(
      collection,
      kecIndexMetadataToKnowledgeIndexMetadata(metadata),
    );
  }

  async getIndexMetadata(collection: KnowledgeCollection): Promise<KecIndexMetadata | null> {
    const metadata = await this.knowledgeStore.getIndexMetadata(collection);

    return metadata ? knowledgeIndexMetadataToKecIndexMetadata(metadata) : null;
  }

  async close(): Promise<void> {
    await this.knowledgeStore.close();
  }
}
