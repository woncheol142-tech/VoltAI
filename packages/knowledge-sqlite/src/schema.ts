import type { DatabaseSync } from "node:sqlite";

const currentKnowledgeSchemaVersion = 1;
const chunksTable = "kec_chunks";
const migrationTable = "kec_chunks_generic_migration";

type TableColumn = {
  name: string;
  notnull: number;
  pk: number;
};

type LegacyRow = Record<string, unknown>;

function tableExists(database: DatabaseSync, tableName: string): boolean {
  return Boolean(
    database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName),
  );
}

function tableColumns(database: DatabaseSync, tableName: string): TableColumn[] {
  return database.prepare(`PRAGMA table_info(${tableName})`).all() as TableColumn[];
}

function createChunksTable(database: DatabaseSync, tableName: string): void {
  database.exec(`
    CREATE TABLE ${tableName} (
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      source_path TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      locator_json TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      text TEXT NOT NULL,
      embedding TEXT NOT NULL,
      page INTEGER,
      clause TEXT,
      PRIMARY KEY (collection, id)
    )
  `);
}

function createIndexMetadataTable(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS index_metadata (
      id TEXT PRIMARY KEY,
      embedding_provider TEXT NOT NULL,
      embedding_model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      indexed_at TEXT NOT NULL
    )
  `);
}

function isTargetSchema(columns: TableColumn[]): boolean {
  const byName = new Map(columns.map((column) => [column.name, column]));
  const requiredNotNull = [
    "collection",
    "id",
    "document_id",
    "source_path",
    "chunk_index",
    "locator_json",
    "metadata_json",
    "text",
    "embedding",
  ];

  return (
    requiredNotNull.every((name) => byName.get(name)?.notnull === 1) &&
    byName.get("page")?.notnull === 0 &&
    byName.get("clause")?.notnull === 0 &&
    byName.get("collection")?.pk === 1 &&
    byName.get("id")?.pk === 2
  );
}

function normalizeSourcePath(sourcePath: string): string {
  return sourcePath.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

export function createKnowledgeDocumentId(collection: string, sourcePath: string): string {
  return `${collection}:${normalizeSourcePath(sourcePath)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalPositiveInteger(value: unknown): boolean {
  return value === undefined || (Number.isInteger(value) && Number(value) >= 1);
}

function validateLocator(value: unknown): void {
  if (!isRecord(value) || typeof value.kind !== "string") {
    throw new Error("Knowledge locator is invalid");
  }

  switch (value.kind) {
    case "page":
      if (!Number.isInteger(value.page) || Number(value.page) < 1) {
        throw new Error("Knowledge locator is invalid");
      }
      return;
    case "section":
      if (typeof value.section !== "string" || !optionalPositiveInteger(value.page)) {
        throw new Error("Knowledge locator is invalid");
      }
      return;
    case "table":
      if (
        typeof value.table !== "string" ||
        !optionalPositiveInteger(value.rowIndex) ||
        (value.column !== undefined && typeof value.column !== "string")
      ) {
        throw new Error("Knowledge locator is invalid");
      }
      return;
    case "paragraph":
      if (!Number.isInteger(value.paragraphIndex) || !optionalPositiveInteger(value.page)) {
        throw new Error("Knowledge locator is invalid");
      }
      return;
    default:
      throw new Error("Knowledge locator is invalid");
  }
}

function parseJson(value: string, field: string, chunkId: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(`Knowledge schema migration failed for chunk "${chunkId}" field "${field}"`);
  }
}

function validateMetadataJson(value: string, chunkId: string): void {
  if (!isRecord(parseJson(value, "metadata", chunkId))) {
    throw new Error(`Knowledge schema migration failed for chunk "${chunkId}" field "metadata"`);
  }
}

function validateLocatorJson(value: string, chunkId: string): void {
  try {
    validateLocator(parseJson(value, "locator", chunkId));
  } catch {
    throw new Error(`Knowledge schema migration failed for chunk "${chunkId}" field "locator"`);
  }
}

function validateEmbeddingJson(value: string, chunkId: string): void {
  const parsed = parseJson(value, "embedding", chunkId);

  if (
    !Array.isArray(parsed) ||
    parsed.some((item) => typeof item !== "number" || !Number.isFinite(item))
  ) {
    throw new Error(`Knowledge schema migration failed for chunk "${chunkId}" field "embedding"`);
  }
}

function requiredString(row: LegacyRow, field: string): string {
  const value = row[field];

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Knowledge schema migration requires field "${field}"`);
  }

  return value;
}

function nullableString(row: LegacyRow, field: string): string | null {
  const value = row[field];

  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`Knowledge schema migration requires string field "${field}"`);
  }

  return value;
}

function migrateExistingChunks(database: DatabaseSync, columns: TableColumn[]): void {
  const names = new Set(columns.map((column) => column.name));
  const rows = database.prepare(`SELECT * FROM ${chunksTable}`).all() as LegacyRow[];

  database.exec(`DROP TABLE IF EXISTS ${migrationTable}`);
  createChunksTable(database, migrationTable);
  const insert = database.prepare(`
    INSERT INTO ${migrationTable} (
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
  `);

  for (const row of rows) {
    const collection = names.has("collection") ? requiredString(row, "collection") : "kec";
    const id = requiredString(row, "id");
    const sourcePath = requiredString(row, "source_path");
    const text = requiredString(row, "text");
    const embedding = requiredString(row, "embedding");
    const clause = names.has("clause") ? nullableString(row, "clause") : null;
    const pageValue = names.has("page") ? row.page : null;
    const page = pageValue === undefined || pageValue === null ? null : Number(pageValue);
    const chunkIndexValue = names.has("chunk_index") ? row.chunk_index : 0;
    const chunkIndex = Number(chunkIndexValue);

    if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
      throw new Error(`Knowledge schema migration rejected chunk "${id}" chunkIndex`);
    }

    if (page !== null && (!Number.isInteger(page) || page < 1)) {
      throw new Error(`Knowledge schema migration rejected chunk "${id}" page`);
    }

    const documentIdValue = names.has("document_id") ? row.document_id : null;
    const documentId =
      documentIdValue === undefined || documentIdValue === null
        ? createKnowledgeDocumentId(collection, sourcePath)
        : requiredString(row, "document_id");
    const locatorValue = names.has("locator_json") ? row.locator_json : null;
    const locatorJson =
      locatorValue === undefined || locatorValue === null
        ? (() => {
            if (page === null) {
              throw new Error(`Knowledge schema migration rejected chunk "${id}" locator`);
            }
            return JSON.stringify({ kind: "page", page });
          })()
        : requiredString(row, "locator_json");
    const metadataValue = names.has("metadata_json") ? row.metadata_json : null;
    const metadataJson =
      metadataValue === undefined || metadataValue === null
        ? JSON.stringify({ clause })
        : requiredString(row, "metadata_json");

    validateLocatorJson(locatorJson, id);
    validateMetadataJson(metadataJson, id);
    validateEmbeddingJson(embedding, id);
    insert.run(
      collection,
      id,
      documentId,
      sourcePath,
      chunkIndex,
      locatorJson,
      metadataJson,
      text,
      embedding,
      page,
      clause,
    );
  }

  database.exec(`DROP TABLE ${chunksTable}`);
  database.exec(`ALTER TABLE ${migrationTable} RENAME TO ${chunksTable}`);
}

function validateStoredRows(database: DatabaseSync): void {
  const rows = database
    .prepare(
      `SELECT id, document_id, locator_json, metadata_json, embedding FROM ${chunksTable}`,
    )
    .all() as Array<{
    id: string;
    document_id: string;
    locator_json: string;
    metadata_json: string;
    embedding: string;
  }>;

  for (const row of rows) {
    if (typeof row.document_id !== "string" || row.document_id.length === 0) {
      throw new Error(`Knowledge schema migration rejected chunk "${row.id}" documentId`);
    }
    validateLocatorJson(row.locator_json, row.id);
    validateMetadataJson(row.metadata_json, row.id);
    validateEmbeddingJson(row.embedding, row.id);
  }
}

function getUserVersion(database: DatabaseSync): number {
  const row = database.prepare("PRAGMA user_version").get() as { user_version: number };

  return row.user_version;
}

export function migrateKnowledgeSchema(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE");

  try {
    const userVersion = getUserVersion(database);

    if (userVersion > currentKnowledgeSchemaVersion) {
      throw new Error(
        `Knowledge database version ${userVersion} is newer than supported version ${currentKnowledgeSchemaVersion}`,
      );
    }

    createIndexMetadataTable(database);

    if (!tableExists(database, chunksTable)) {
      createChunksTable(database, chunksTable);
    } else {
      const columns = tableColumns(database, chunksTable);

      if (!isTargetSchema(columns)) {
        migrateExistingChunks(database, columns);
      }
    }

    validateStoredRows(database);
    database.exec(`
      CREATE INDEX IF NOT EXISTS idx_kec_chunks_collection_source
      ON ${chunksTable}(collection, source_path)
    `);
    database.exec(`PRAGMA user_version = ${currentKnowledgeSchemaVersion}`);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export { currentKnowledgeSchemaVersion };
