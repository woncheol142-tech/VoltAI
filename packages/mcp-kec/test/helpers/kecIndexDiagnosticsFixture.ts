import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

export const diagnosticMetadata = Object.freeze({
  provider: "ollama",
  model: "nomic-embed-text",
  dimensions: 3,
  indexedAt: "2026-07-31T00:00:00.000Z",
});

export const firstSourcePath = "knowledge/private/kec-main.pdf";
export const secondSourcePath = "knowledge/archive/kec-supplement.pdf";

export type KecIndexDiagnosticsFixture = Readonly<{
  rootPath: string;
  databasePath: string;
  cleanup: () => void;
}>;

export type KecIndexArtifactSnapshot = Readonly<{
  parentExists: boolean;
  databaseExists: boolean;
  databaseIsSymlink: boolean;
  databaseSize: number | null;
  databaseMtimeNs: bigint | null;
  parentEntries: readonly string[];
  walExists: boolean;
  shmExists: boolean;
  journalExists: boolean;
}>;

type MetadataOverrides = Readonly<{
  provider?: unknown;
  model?: unknown;
  dimensions?: unknown;
  indexedAt?: unknown;
}>;

type ChunkOverrides = Readonly<{
  id?: string;
  sourcePath?: unknown;
  chunkIndex?: number;
  page?: number;
  clause?: string | null;
  text?: string;
  embeddingJson?: string;
}>;

function createFixturePath(
  fileName = "index.sqlite",
): KecIndexDiagnosticsFixture {
  const rootPath = mkdtempSync(join(tmpdir(), "voltai-kec-index-diagnostics-"));
  const databasePath = join(rootPath, fileName);
  let cleaned = false;

  return Object.freeze({
    rootPath,
    databasePath,
    cleanup: () => {
      if (cleaned) {
        return;
      }

      cleaned = true;
      rmSync(rootPath, { recursive: true, force: true });
    },
  });
}

function withDatabase(
  databasePath: string,
  operation: (database: InstanceType<typeof DatabaseSync>) => void,
): void {
  const database = new DatabaseSync(databasePath);

  try {
    operation(database);
  } finally {
    database.close();
  }
}

function initializeSchema(database: InstanceType<typeof DatabaseSync>): void {
  database.exec(`
    CREATE TABLE kec_chunks (
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
    );

    CREATE TABLE index_metadata (
      id TEXT PRIMARY KEY,
      embedding_provider TEXT NOT NULL,
      embedding_model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      indexed_at TEXT NOT NULL
    );

    CREATE INDEX idx_kec_chunks_collection_source
    ON kec_chunks(collection, source_path);

    PRAGMA user_version = 1;
  `);
}

function insertMetadata(
  database: InstanceType<typeof DatabaseSync>,
  overrides: MetadataOverrides = {},
): void {
  database
    .prepare(
      `
      INSERT INTO index_metadata (
        id,
        embedding_provider,
        embedding_model,
        dimensions,
        indexed_at
      ) VALUES (?, ?, ?, ?, ?)
    `,
    )
    .run(
      "kec",
      overrides.provider ?? diagnosticMetadata.provider,
      overrides.model ?? diagnosticMetadata.model,
      overrides.dimensions ?? diagnosticMetadata.dimensions,
      overrides.indexedAt ?? diagnosticMetadata.indexedAt,
    );
}

function insertChunk(
  database: InstanceType<typeof DatabaseSync>,
  overrides: ChunkOverrides = {},
): void {
  const sourcePath = overrides.sourcePath ?? firstSourcePath;
  const id = overrides.id ?? `${String(sourcePath)}#page=1#chunk=0`;
  const page = overrides.page ?? 1;
  const clause = overrides.clause ?? "KEC 232.5";

  database
    .prepare(
      `
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
    `,
    )
    .run(
      "kec",
      id,
      `kec:${String(sourcePath)}`,
      sourcePath,
      overrides.chunkIndex ?? 0,
      JSON.stringify({ kind: "page", page }),
      JSON.stringify({ clause }),
      overrides.text ?? "KEC deterministic diagnostic fixture text.",
      overrides.embeddingJson ?? "[0.1,0.2,0.3]",
      page,
      clause,
    );
}

function createInitializedFixture(
  populate?: (database: InstanceType<typeof DatabaseSync>) => void,
): KecIndexDiagnosticsFixture {
  const fixture = createFixturePath();
  withDatabase(fixture.databasePath, (database) => {
    initializeSchema(database);
    populate?.(database);
  });
  return fixture;
}

export function createMissingDatabaseFixture(
  parentExists: boolean,
): KecIndexDiagnosticsFixture {
  const fixture = createFixturePath();

  if (parentExists) {
    return fixture;
  }

  const missingParent = join(fixture.rootPath, "missing-parent");
  return Object.freeze({
    rootPath: fixture.rootPath,
    databasePath: join(missingParent, "index.sqlite"),
    cleanup: fixture.cleanup,
  });
}

export function createCorruptDatabaseFixture(): KecIndexDiagnosticsFixture {
  const fixture = createFixturePath();
  writeFileSync(fixture.databasePath, "not-a-sqlite-database", "utf8");
  return fixture;
}

export function createUninitializedDatabaseFixture(): KecIndexDiagnosticsFixture {
  const fixture = createFixturePath();
  withDatabase(fixture.databasePath, () => {});
  return fixture;
}

export function createPartialSchemaFixture(): KecIndexDiagnosticsFixture {
  const fixture = createFixturePath();
  withDatabase(fixture.databasePath, (database) => {
    database.exec(`
      CREATE TABLE kec_chunks (
        collection TEXT NOT NULL,
        id TEXT NOT NULL,
        source_path TEXT NOT NULL,
        embedding TEXT NOT NULL
      );
    `);
  });
  return fixture;
}

export function createMalformedSchemaFixture(): KecIndexDiagnosticsFixture {
  const fixture = createFixturePath();
  withDatabase(fixture.databasePath, (database) => {
    database.exec(`
      CREATE TABLE kec_chunks (
        collection TEXT NOT NULL,
        id TEXT NOT NULL,
        source_path TEXT NOT NULL
      );

      CREATE TABLE index_metadata (
        id TEXT PRIMARY KEY,
        embedding_provider TEXT NOT NULL
      );

      PRAGMA user_version = 1;
    `);
  });
  return fixture;
}

export function createEmptyIndexFixture(): KecIndexDiagnosticsFixture {
  return createInitializedFixture();
}

export function createMetadataOnlyIndexFixture(): KecIndexDiagnosticsFixture {
  return createInitializedFixture(insertMetadata);
}

export function createChunksOnlyIndexFixture(): KecIndexDiagnosticsFixture {
  return createInitializedFixture(insertChunk);
}

export function createReadyIndexFixture(): KecIndexDiagnosticsFixture {
  return createInitializedFixture((database) => {
    insertMetadata(database);
    insertChunk(database);
  });
}

export function createMultipleSourcesIndexFixture(): KecIndexDiagnosticsFixture {
  return createInitializedFixture((database) => {
    insertMetadata(database);
    insertChunk(database, {
      id: "first-0",
      sourcePath: firstSourcePath,
      chunkIndex: 0,
    });
    insertChunk(database, {
      id: "first-1",
      sourcePath: firstSourcePath,
      chunkIndex: 1,
    });
    insertChunk(database, {
      id: "second-0",
      sourcePath: secondSourcePath,
      chunkIndex: 0,
    });
  });
}

export function createMalformedMetadataFixture(): KecIndexDiagnosticsFixture {
  return createInitializedFixture((database) => {
    insertMetadata(database, { dimensions: 0 });
    insertChunk(database);
  });
}

export function createMalformedEmbeddingFixture(
  embeddingJson: string,
): KecIndexDiagnosticsFixture {
  return createInitializedFixture((database) => {
    insertMetadata(database);
    insertChunk(database, { embeddingJson });
  });
}

export function createMixedDimensionsFixture(): KecIndexDiagnosticsFixture {
  return createInitializedFixture((database) => {
    insertMetadata(database);
    insertChunk(database, { id: "dimension-2", embeddingJson: "[1,2]" });
    insertChunk(database, {
      id: "dimension-3",
      chunkIndex: 1,
      embeddingJson: "[1,2,3]",
    });
  });
}

export function createMetadataDimensionMismatchFixture(): KecIndexDiagnosticsFixture {
  return createInitializedFixture((database) => {
    insertMetadata(database, { dimensions: 4 });
    insertChunk(database);
  });
}

export function createInvalidSourcePathFixture(): KecIndexDiagnosticsFixture {
  return createInitializedFixture((database) => {
    insertMetadata(database);
    insertChunk(database, {
      id: "invalid-source",
      sourcePath: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
    });
  });
}

export function createSymlinkFixture(): KecIndexDiagnosticsFixture {
  const target = createReadyIndexFixture();
  const linkPath = join(target.rootPath, "index-link.sqlite");
  symlinkSync(target.databasePath, linkPath);
  return Object.freeze({
    rootPath: target.rootPath,
    databasePath: linkPath,
    cleanup: target.cleanup,
  });
}

export function createDirectoryPathFixture(): KecIndexDiagnosticsFixture {
  const fixture = createFixturePath("database-directory");
  mkdirSync(fixture.databasePath);
  return fixture;
}

export function createLockedDatabaseFixture(): KecIndexDiagnosticsFixture &
  Readonly<{ release: () => void }> {
  const fixture = createReadyIndexFixture();
  const database = new DatabaseSync(fixture.databasePath);
  database.exec("BEGIN EXCLUSIVE");
  let released = false;

  const release = () => {
    if (released) {
      return;
    }

    released = true;
    database.exec("ROLLBACK");
    database.close();
  };

  return Object.freeze({
    rootPath: fixture.rootPath,
    databasePath: fixture.databasePath,
    release,
    cleanup: () => {
      release();
      fixture.cleanup();
    },
  });
}

export function expectedSourceId(sourcePath: string): string {
  return `kecsrc_${createHash("sha256").update(sourcePath, "utf8").digest("hex")}`;
}

export function snapshotArtifacts(
  databasePath: string,
): KecIndexArtifactSnapshot {
  const parentPath = dirname(databasePath);
  const parentExists = existsSync(parentPath);
  const databaseExists = existsSync(databasePath);
  const databaseStat = databaseExists ? lstatSync(databasePath) : null;
  const regularStat = databaseStat?.isFile()
    ? statSync(databasePath, { bigint: true })
    : null;

  return Object.freeze({
    parentExists,
    databaseExists,
    databaseIsSymlink: databaseStat?.isSymbolicLink() ?? false,
    databaseSize: regularStat === null ? null : Number(regularStat.size),
    databaseMtimeNs: regularStat?.mtimeNs ?? null,
    parentEntries: Object.freeze(
      parentExists ? readdirSync(parentPath).sort() : [],
    ),
    walExists: existsSync(`${databasePath}-wal`),
    shmExists: existsSync(`${databasePath}-shm`),
    journalExists: existsSync(`${databasePath}-journal`),
  });
}

export function readDatabaseBytes(databasePath: string): Buffer {
  return readFileSync(databasePath);
}

export { DatabaseSync };
