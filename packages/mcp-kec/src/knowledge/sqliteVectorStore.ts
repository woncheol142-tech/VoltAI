import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";

import type {
  EmbeddedKecChunk,
  KecChunk,
  KecIndexMetadata,
  KecSearchResult,
  VectorStore,
} from "./vectorStore.js";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

type StoredChunkRow = {
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
        id TEXT PRIMARY KEY,
        source_path TEXT NOT NULL,
        page INTEGER NOT NULL,
        chunk_index INTEGER NOT NULL DEFAULT 0,
        clause TEXT,
        text TEXT NOT NULL,
        embedding TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS index_metadata (
        id TEXT PRIMARY KEY,
        embedding_provider TEXT NOT NULL,
        embedding_model TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        indexed_at TEXT NOT NULL
      );
    `);
    this.migrateChunkIndexColumn();
  }

  private migrateChunkIndexColumn(): void {
    const columns = this.database
      .prepare("PRAGMA table_info(kec_chunks)")
      .all() as Array<{ name: string }>;

    if (!columns.some((column) => column.name === "chunk_index")) {
      this.database.exec("ALTER TABLE kec_chunks ADD COLUMN chunk_index INTEGER NOT NULL DEFAULT 0");
    }
  }

  async upsert(chunks: EmbeddedKecChunk[]): Promise<void> {
    const insert = this.database.prepare(`
      INSERT INTO kec_chunks (id, source_path, page, chunk_index, clause, text, embedding)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        source_path = excluded.source_path,
        page = excluded.page,
        chunk_index = excluded.chunk_index,
        clause = excluded.clause,
        text = excluded.text,
        embedding = excluded.embedding;
    `);

    this.database.exec("BEGIN");

    try {
      for (const chunk of chunks) {
        insert.run(
          chunk.id,
          chunk.sourcePath,
          chunk.page,
          chunk.chunkIndex,
          chunk.clause,
          chunk.text,
          JSON.stringify(chunk.embedding),
        );
      }

      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  async search(embedding: number[], topK: number): Promise<KecSearchResult[]> {
    const rows = this.database
      .prepare("SELECT id, source_path, page, chunk_index, clause, text, embedding FROM kec_chunks")
      .all() as StoredChunkRow[];

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

  async listChunks(): Promise<KecChunk[]> {
    const rows = this.database
      .prepare("SELECT id, source_path, page, chunk_index, clause, text FROM kec_chunks ORDER BY page, chunk_index, id")
      .all() as Omit<StoredChunkRow, "embedding">[];

    return rows.map((row) => ({
      id: row.id,
      sourcePath: row.source_path,
      page: row.page,
      chunkIndex: row.chunk_index,
      clause: row.clause,
      text: row.text,
    }));
  }

  async saveIndexMetadata(metadata: KecIndexMetadata): Promise<void> {
    this.database
      .prepare(`
        INSERT INTO index_metadata (
          id,
          embedding_provider,
          embedding_model,
          dimensions,
          indexed_at
        )
        VALUES ('kec', ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          embedding_provider = excluded.embedding_provider,
          embedding_model = excluded.embedding_model,
          dimensions = excluded.dimensions,
          indexed_at = excluded.indexed_at;
      `)
      .run(
        metadata.embeddingProvider,
        metadata.embeddingModel,
        metadata.dimensions,
        metadata.indexedAt,
      );
  }

  async getIndexMetadata(): Promise<KecIndexMetadata | null> {
    const row = this.database
      .prepare(`
        SELECT id, embedding_provider, embedding_model, dimensions, indexed_at
        FROM index_metadata
        WHERE id = 'kec'
      `)
      .get() as StoredMetadataRow | undefined;

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
}
