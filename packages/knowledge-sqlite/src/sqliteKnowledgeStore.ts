import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";

import type {
  EmbeddedKnowledgeChunk,
  KnowledgeChunk,
  KnowledgeCodecs,
  KnowledgeIndexMetadata,
  KnowledgeLocator,
  KnowledgeMetadata,
  KnowledgeSearchResult,
  KnowledgeVectorStore,
} from "@voltai/knowledge-core";

import { KnowledgeStoreDecodeError, type KnowledgeStoreDecodeField } from "./errors.js";
import { migrateKnowledgeSchema } from "./schema.js";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

type StoredChunkRow = {
  collection: string;
  id: string;
  document_id: string;
  source_path: string;
  chunk_index: number;
  locator_json: string;
  metadata_json: string;
  text: string;
  embedding: string;
  page: number | null;
  clause: string | null;
};

type StoredMetadataRow = {
  id: string;
  embedding_provider: string;
  embedding_model: string;
  dimensions: number;
  indexed_at: string;
};

type EncodedChunk = {
  chunkId: string;
  documentId: string;
  sourcePath: string;
  chunkIndex: number;
  locatorJson: string;
  metadataJson: string;
  text: string;
  embeddingJson: string;
  page: number | null;
  clause: string | null;
};

export type SqliteCompatibilityProjection = {
  page: number | null;
  clause: string | null;
};

export type SqliteKnowledgeWriteOptions<
  TMetadata extends KnowledgeMetadata,
  TLocator extends KnowledgeLocator,
> = {
  compatibilityProjection?: (
    chunk: EmbeddedKnowledgeChunk<TMetadata, TLocator>,
  ) => SqliteCompatibilityProjection;
};

function cosineSimilarity(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] * left[index];
    rightMagnitude += right[index] * right[index];
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function serializeJson(value: unknown, field: "metadata" | "locator"): string {
  try {
    const serialized = JSON.stringify(value);

    if (serialized === undefined) {
      throw new Error(`${field} is not JSON serializable`);
    }

    JSON.parse(serialized);
    return serialized;
  } catch {
    throw new Error(`Knowledge ${field} encode failed`);
  }
}

function validateEmbedding(embedding: number[]): number[] {
  if (
    !Array.isArray(embedding) ||
    embedding.some((value) => typeof value !== "number" || !Number.isFinite(value))
  ) {
    throw new Error("Knowledge embedding encode failed");
  }

  return [...embedding];
}

function validateProjection(projection: SqliteCompatibilityProjection): void {
  if (
    projection.page !== null &&
    (!Number.isInteger(projection.page) || projection.page < 1)
  ) {
    throw new Error("Knowledge compatibility page must be a positive integer or null");
  }

  if (projection.clause !== null && typeof projection.clause !== "string") {
    throw new Error("Knowledge compatibility clause must be a string or null");
  }
}

export class SqliteKnowledgeStore implements KnowledgeVectorStore {
  private readonly database: InstanceType<typeof DatabaseSync>;
  private closed = false;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.database = new DatabaseSync(dbPath);

    try {
      migrateKnowledgeSchema(this.database);
    } catch (error) {
      this.database.close();
      this.closed = true;
      throw error;
    }
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error("Knowledge store is closed");
    }
  }

  private encodeChunks<
    TMetadata extends KnowledgeMetadata,
    TLocator extends KnowledgeLocator,
  >(
    chunks: EmbeddedKnowledgeChunk<TMetadata, TLocator>[],
    codecs: KnowledgeCodecs<TMetadata, TLocator>,
    options: SqliteKnowledgeWriteOptions<TMetadata, TLocator> = {},
  ): EncodedChunk[] {
    return chunks.map((chunk) => {
      const projection = options.compatibilityProjection?.(chunk) ?? {
        page: null,
        clause: null,
      };
      validateProjection(projection);

      return {
        chunkId: chunk.chunkId,
        documentId: chunk.documentId,
        sourcePath: chunk.sourcePath,
        chunkIndex: chunk.chunkIndex,
        locatorJson: serializeJson(codecs.locator.encode(chunk.locator), "locator"),
        metadataJson: serializeJson(codecs.metadata.encode(chunk.metadata), "metadata"),
        text: chunk.text,
        embeddingJson: JSON.stringify(validateEmbedding(chunk.embedding)),
        page: projection.page,
        clause: projection.clause,
      };
    });
  }

  private insertChunks(collection: string, chunks: EncodedChunk[]): void {
    const insert = this.database.prepare(`
      INSERT INTO kec_chunks (
        collection,
        id,
        document_id,
        source_path,
        chunk_index,
        locator_json,
        metadata_json,
        text,
        embedding,
        page,
        clause
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(collection, id) DO UPDATE SET
        document_id = excluded.document_id,
        source_path = excluded.source_path,
        chunk_index = excluded.chunk_index,
        locator_json = excluded.locator_json,
        metadata_json = excluded.metadata_json,
        text = excluded.text,
        embedding = excluded.embedding,
        page = excluded.page,
        clause = excluded.clause
    `);

    for (const chunk of chunks) {
      insert.run(
        collection,
        chunk.chunkId,
        chunk.documentId,
        chunk.sourcePath,
        chunk.chunkIndex,
        chunk.locatorJson,
        chunk.metadataJson,
        chunk.text,
        chunk.embeddingJson,
        chunk.page,
        chunk.clause,
      );
    }
  }

  private transaction(operation: () => void): void {
    this.database.exec("BEGIN");

    try {
      operation();
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private saveIndexMetadataInTransaction(
    collection: string,
    metadata: KnowledgeIndexMetadata,
  ): void {
    if (!Number.isInteger(metadata.dimensions) || metadata.dimensions < 1) {
      throw new Error("metadata dimensions must be a positive integer");
    }

    this.database
      .prepare(`
        INSERT INTO index_metadata (
          id,
          embedding_provider,
          embedding_model,
          dimensions,
          indexed_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          embedding_provider = excluded.embedding_provider,
          embedding_model = excluded.embedding_model,
          dimensions = excluded.dimensions,
          indexed_at = excluded.indexed_at
      `)
      .run(
        collection,
        metadata.embeddingProvider,
        metadata.embeddingModel,
        metadata.dimensions,
        metadata.indexedAt,
      );
  }

  private decodeField(
    collection: string,
    chunkId: string,
    field: KnowledgeStoreDecodeField,
    value: string,
  ): unknown {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      throw new KnowledgeStoreDecodeError(collection, chunkId, field);
    }
  }

  private decodeMetadata<TMetadata extends KnowledgeMetadata>(
    row: StoredChunkRow,
    codec: KnowledgeCodecs<TMetadata, KnowledgeLocator>["metadata"],
  ): TMetadata {
    try {
      return codec.decode(this.decodeField(row.collection, row.id, "metadata", row.metadata_json));
    } catch (error) {
      if (error instanceof KnowledgeStoreDecodeError) {
        throw error;
      }
      throw new KnowledgeStoreDecodeError(row.collection, row.id, "metadata");
    }
  }

  private decodeLocator<TLocator extends KnowledgeLocator>(
    row: StoredChunkRow,
    codec: KnowledgeCodecs<KnowledgeMetadata, TLocator>["locator"],
  ): TLocator {
    try {
      return codec.decode(this.decodeField(row.collection, row.id, "locator", row.locator_json));
    } catch (error) {
      if (error instanceof KnowledgeStoreDecodeError) {
        throw error;
      }
      throw new KnowledgeStoreDecodeError(row.collection, row.id, "locator");
    }
  }

  private decodeEmbedding(row: StoredChunkRow): number[] {
    const value = this.decodeField(row.collection, row.id, "embedding", row.embedding);

    if (
      !Array.isArray(value) ||
      value.some((item) => typeof item !== "number" || !Number.isFinite(item))
    ) {
      throw new KnowledgeStoreDecodeError(row.collection, row.id, "embedding");
    }

    return value;
  }

  async upsert<TMetadata extends KnowledgeMetadata, TLocator extends KnowledgeLocator>(
    collection: string,
    chunks: EmbeddedKnowledgeChunk<TMetadata, TLocator>[],
    codecs: KnowledgeCodecs<TMetadata, TLocator>,
    options: SqliteKnowledgeWriteOptions<TMetadata, TLocator> = {},
  ): Promise<void> {
    this.assertOpen();
    const encodedChunks = this.encodeChunks(chunks, codecs, options);

    this.transaction(() => this.insertChunks(collection, encodedChunks));
  }

  async replaceSource<TMetadata extends KnowledgeMetadata, TLocator extends KnowledgeLocator>(
    collection: string,
    sourcePath: string,
    chunks: EmbeddedKnowledgeChunk<TMetadata, TLocator>[],
    metadata: KnowledgeIndexMetadata,
    codecs: KnowledgeCodecs<TMetadata, TLocator>,
    options: SqliteKnowledgeWriteOptions<TMetadata, TLocator> = {},
  ): Promise<void> {
    this.assertOpen();
    const encodedChunks = this.encodeChunks(chunks, codecs, options);

    this.transaction(() => {
      this.database
        .prepare("DELETE FROM kec_chunks WHERE collection = ? AND source_path = ?")
        .run(collection, sourcePath);
      this.insertChunks(collection, encodedChunks);
      this.saveIndexMetadataInTransaction(collection, metadata);
    });
  }

  async deleteBySourcePath(collection: string, sourcePath: string): Promise<void> {
    this.assertOpen();
    this.database
      .prepare("DELETE FROM kec_chunks WHERE collection = ? AND source_path = ?")
      .run(collection, sourcePath);
  }

  async search<TMetadata extends KnowledgeMetadata, TLocator extends KnowledgeLocator>(
    collection: string,
    embedding: number[],
    topK: number,
    codecs: KnowledgeCodecs<TMetadata, TLocator>,
  ): Promise<KnowledgeSearchResult<TMetadata, TLocator>[]> {
    this.assertOpen();
    const rows = this.database
      .prepare(
        `SELECT collection, id, document_id, source_path, chunk_index, locator_json,
          metadata_json, text, embedding, page, clause
        FROM kec_chunks WHERE collection = ?`,
      )
      .all(collection) as StoredChunkRow[];

    return rows
      .map((row) => ({
        chunkId: row.id,
        documentId: row.document_id,
        sourcePath: row.source_path,
        locator: this.decodeLocator(row, codecs.locator),
        metadata: this.decodeMetadata(row, codecs.metadata),
        text: row.text,
        similarity: cosineSimilarity(embedding, this.decodeEmbedding(row)),
      }))
      .sort((left, right) => right.similarity - left.similarity)
      .slice(0, topK);
  }

  async listChunks<TMetadata extends KnowledgeMetadata, TLocator extends KnowledgeLocator>(
    collection: string,
    codecs: KnowledgeCodecs<TMetadata, TLocator>,
  ): Promise<KnowledgeChunk<TMetadata, TLocator>[]> {
    this.assertOpen();
    const rows = this.database
      .prepare(
        `SELECT collection, id, document_id, source_path, chunk_index, locator_json,
          metadata_json, text, embedding, page, clause
        FROM kec_chunks WHERE collection = ? ORDER BY chunk_index, id`,
      )
      .all(collection) as StoredChunkRow[];

    return rows.map((row) => ({
      chunkId: row.id,
      documentId: row.document_id,
      sourcePath: row.source_path,
      chunkIndex: row.chunk_index,
      locator: this.decodeLocator(row, codecs.locator),
      metadata: this.decodeMetadata(row, codecs.metadata),
      text: row.text,
    }));
  }

  async saveIndexMetadata(
    collection: string,
    metadata: KnowledgeIndexMetadata,
  ): Promise<void> {
    this.assertOpen();
    this.saveIndexMetadataInTransaction(collection, metadata);
  }

  async getIndexMetadata(collection: string): Promise<KnowledgeIndexMetadata | null> {
    this.assertOpen();
    const row = this.database
      .prepare(`
        SELECT id, embedding_provider, embedding_model, dimensions, indexed_at
        FROM index_metadata WHERE id = ?
      `)
      .get(collection) as StoredMetadataRow | undefined;

    if (!row) {
      return null;
    }

    return {
      embeddingProvider: row.embedding_provider,
      embeddingModel: row.embedding_model,
      dimensions: row.dimensions,
      indexedAt: row.indexed_at,
    };
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.database.close();
    this.closed = true;
  }
}
