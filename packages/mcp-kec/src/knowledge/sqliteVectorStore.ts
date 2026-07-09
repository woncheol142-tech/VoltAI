import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";

import type {
  EmbeddedKecChunk,
  KecChunk,
  KecIndexMetadata,
  KecSearchResult,
  KnowledgeCollection,
  VectorStore,
} from "./vectorStore.js";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

type StoredChunkRow = {
  collection: string;
  id: string;
  source_path: string;
  page: number;
  chunk_index: number;
  clause: string | null;
  text: string;
  embedding: string;
};

type StoredMetadataRow = {
  id: string;
  embedding_provider: string;
  embedding_model: string;
  dimensions: number;
  indexed_at: string;
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

export class SqliteVectorStore implements VectorStore {
  private readonly database: InstanceType<typeof DatabaseSync>;

  constructor(private readonly dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.database = new DatabaseSync(dbPath);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS kec_chunks (
        collection TEXT NOT NULL DEFAULT 'kec',
        id TEXT NOT NULL,
        source_path TEXT NOT NULL,
        page INTEGER NOT NULL,
        chunk_index INTEGER NOT NULL DEFAULT 0,
        clause TEXT,
        text TEXT NOT NULL,
        embedding TEXT NOT NULL,
        PRIMARY KEY (collection, id)
      );

      CREATE TABLE IF NOT EXISTS index_metadata (
        id TEXT PRIMARY KEY,
        embedding_provider TEXT NOT NULL,
        embedding_model TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        indexed_at TEXT NOT NULL
      );
    `);
    this.migrateCollectionColumn();
    this.migrateChunkIndexColumn();
    this.migrateChunkPrimaryKey();
    this.database.exec(`
      CREATE INDEX IF NOT EXISTS idx_kec_chunks_collection_source
      ON kec_chunks(collection, source_path);
    `);
  }

  private migrateCollectionColumn(): void {
    const columns = this.database
      .prepare("PRAGMA table_info(kec_chunks)")
      .all() as Array<{ name: string }>;

    if (!columns.some((column) => column.name === "collection")) {
      this.database.exec("ALTER TABLE kec_chunks ADD COLUMN collection TEXT NOT NULL DEFAULT 'kec'");
    }
  }

  private migrateChunkIndexColumn(): void {
    const columns = this.database
      .prepare("PRAGMA table_info(kec_chunks)")
      .all() as Array<{ name: string }>;

    if (!columns.some((column) => column.name === "chunk_index")) {
      this.database.exec("ALTER TABLE kec_chunks ADD COLUMN chunk_index INTEGER NOT NULL DEFAULT 0");
    }
  }

  private migrateChunkPrimaryKey(): void {
    const indexRows = this.database
      .prepare("PRAGMA index_list(kec_chunks)")
      .all() as Array<{ name: string; origin: string }>;
    const primaryKeyIndex = indexRows.find((row) => row.origin === "pk");

    if (!primaryKeyIndex) {
      return;
    }

    const primaryKeyColumns = this.database
      .prepare(`PRAGMA index_info(${JSON.stringify(primaryKeyIndex.name)})`)
      .all() as Array<{ name: string }>;

    if (
      primaryKeyColumns.length === 2 &&
      primaryKeyColumns[0].name === "collection" &&
      primaryKeyColumns[1].name === "id"
    ) {
      return;
    }

    this.database.exec(`
      ALTER TABLE kec_chunks RENAME TO kec_chunks_legacy_pk;

      CREATE TABLE kec_chunks (
        collection TEXT NOT NULL DEFAULT 'kec',
        id TEXT NOT NULL,
        source_path TEXT NOT NULL,
        page INTEGER NOT NULL,
        chunk_index INTEGER NOT NULL DEFAULT 0,
        clause TEXT,
        text TEXT NOT NULL,
        embedding TEXT NOT NULL,
        PRIMARY KEY (collection, id)
      );

      INSERT INTO kec_chunks (
        collection,
        id,
        source_path,
        page,
        chunk_index,
        clause,
        text,
        embedding
      )
      SELECT
        collection,
        id,
        source_path,
        page,
        chunk_index,
        clause,
        text,
        embedding
      FROM kec_chunks_legacy_pk;

      DROP TABLE kec_chunks_legacy_pk;
    `);
  }

  private insertChunks(collection: KnowledgeCollection, chunks: EmbeddedKecChunk[]): void {
    const insert = this.database.prepare(`
      INSERT INTO kec_chunks (collection, id, source_path, page, chunk_index, clause, text, embedding)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(collection, id) DO UPDATE SET
        collection = excluded.collection,
        source_path = excluded.source_path,
        page = excluded.page,
        chunk_index = excluded.chunk_index,
        clause = excluded.clause,
        text = excluded.text,
        embedding = excluded.embedding;
    `);

    for (const chunk of chunks) {
      insert.run(
        collection,
        chunk.id,
        chunk.sourcePath,
        chunk.page,
        chunk.chunkIndex,
        chunk.clause,
        chunk.text,
        JSON.stringify(chunk.embedding),
      );
    }
  }

  private saveIndexMetadataInTransaction(
    collection: KnowledgeCollection,
    metadata: KecIndexMetadata,
  ): void {
    if (metadata.dimensions < 1) {
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
        )
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          embedding_provider = excluded.embedding_provider,
          embedding_model = excluded.embedding_model,
          dimensions = excluded.dimensions,
          indexed_at = excluded.indexed_at;
      `)
      .run(
        collection,
        metadata.embeddingProvider,
        metadata.embeddingModel,
        metadata.dimensions,
        metadata.indexedAt,
      );
  }

  async upsert(collection: KnowledgeCollection, chunks: EmbeddedKecChunk[]): Promise<void> {
    this.database.exec("BEGIN");

    try {
      this.insertChunks(collection, chunks);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  async replaceSource(
    collection: KnowledgeCollection,
    sourcePath: string,
    chunks: EmbeddedKecChunk[],
    metadata: KecIndexMetadata,
  ): Promise<void> {
    this.database.exec("BEGIN");

    try {
      this.database
        .prepare("DELETE FROM kec_chunks WHERE collection = ? AND source_path = ?")
        .run(collection, sourcePath);
      this.insertChunks(collection, chunks);
      this.saveIndexMetadataInTransaction(collection, metadata);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  async deleteBySourcePath(collection: KnowledgeCollection, sourcePath: string): Promise<void> {
    this.database
      .prepare("DELETE FROM kec_chunks WHERE collection = ? AND source_path = ?")
      .run(collection, sourcePath);
  }

  async search(
    collection: KnowledgeCollection,
    embedding: number[],
    topK: number,
  ): Promise<KecSearchResult[]> {
    const rows = this.database
      .prepare(
        "SELECT collection, id, source_path, page, chunk_index, clause, text, embedding FROM kec_chunks WHERE collection = ?",
      )
      .all(collection) as StoredChunkRow[];

    return rows
      .map((row) => ({
        clause: row.clause,
        page: row.page,
        text: row.text,
        similarity: cosineSimilarity(embedding, JSON.parse(row.embedding) as number[]),
        sourcePath: row.source_path,
      }))
      .sort((left, right) => right.similarity - left.similarity)
      .slice(0, topK);
  }

  async listChunks(collection: KnowledgeCollection): Promise<KecChunk[]> {
    const rows = this.database
      .prepare(
        "SELECT collection, id, source_path, page, chunk_index, clause, text FROM kec_chunks WHERE collection = ? ORDER BY page, chunk_index, id",
      )
      .all(collection) as Omit<StoredChunkRow, "embedding">[];

    return rows.map((row) => ({
      id: row.id,
      sourcePath: row.source_path,
      page: row.page,
      chunkIndex: row.chunk_index,
      clause: row.clause,
      text: row.text,
    }));
  }

  async saveIndexMetadata(
    collection: KnowledgeCollection,
    metadata: KecIndexMetadata,
  ): Promise<void> {
    this.saveIndexMetadataInTransaction(collection, metadata);
  }

  async getIndexMetadata(collection: KnowledgeCollection): Promise<KecIndexMetadata | null> {
    const row = this.database
      .prepare(`
        SELECT id, embedding_provider, embedding_model, dimensions, indexed_at
        FROM index_metadata
        WHERE id = ?
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
    this.database.close();
  }
}
