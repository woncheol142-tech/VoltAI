import { createHash } from "node:crypto";
import { lstatSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute } from "node:path";

import type {
  KecIndexDiagnosticIssue,
  KecIndexDiagnosticMetadata,
  KecIndexDiagnosticsV1,
} from "./types.js";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

const REQUIRED_CHUNK_COLUMNS = Object.freeze([
  "collection",
  "id",
  "document_id",
  "source_path",
  "chunk_index",
  "locator_json",
  "metadata_json",
  "text",
  "embedding",
  "page",
  "clause",
]);
const REQUIRED_METADATA_COLUMNS = Object.freeze([
  "id",
  "embedding_provider",
  "embedding_model",
  "dimensions",
  "indexed_at",
]);
const ISSUE_AUTHORITY = Object.freeze([
  "SCHEMA_INCOMPLETE",
  "INVALID_METADATA",
  "METADATA_WITHOUT_CHUNKS",
  "CHUNKS_WITHOUT_METADATA",
  "INVALID_SOURCE_PATH",
  "INVALID_EMBEDDING",
  "MIXED_EMBEDDING_DIMENSIONS",
  "METADATA_DIMENSION_MISMATCH",
] as const);

type Database = InstanceType<typeof DatabaseSync>;
type UnknownRow = Record<string, unknown>;
type SourceGroup = { source: string; count: number };
type AuthorityIssue = (typeof ISSUE_AUTHORITY)[number];

function diagnosticError(
  reason:
    | "INVALID_CONFIGURATION"
    | "UNSAFE_DATABASE_PATH"
    | "DATABASE_INVALID"
    | "DATABASE_UNAVAILABLE",
): Error {
  return new Error(`KEC_INDEX_DIAGNOSTICS: ${reason}`);
}

function ownDataValue(value: unknown, key: string): unknown {
  if (
    (typeof value !== "object" || value === null) &&
    typeof value !== "function"
  ) {
    return undefined;
  }

  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && "value" in descriptor
    ? descriptor.value
    : undefined;
}

function errorCode(error: unknown): unknown {
  return ownDataValue(error, "code");
}

function isMissingPathError(error: unknown): boolean {
  return errorCode(error) === "ENOENT";
}

function classifyDatabaseError(error: unknown): Error {
  const sqliteCode = ownDataValue(error, "errcode");
  return diagnosticError(
    sqliteCode === 5 || sqliteCode === 6
      ? "DATABASE_UNAVAILABLE"
      : "DATABASE_INVALID",
  );
}

function classifyDatabaseOpenError(error: unknown): Error {
  return diagnosticError(
    ownDataValue(error, "errcode") === 26
      ? "DATABASE_INVALID"
      : "DATABASE_UNAVAILABLE",
  );
}

function freezeMetadata(
  provider: string | null,
  model: string | null,
  dimensions: number | null,
  indexedAt: string | null,
): KecIndexDiagnosticMetadata {
  return Object.freeze({ provider, model, dimensions, indexedAt });
}

function createDiagnostics(input: {
  status: KecIndexDiagnosticsV1["status"];
  databaseExists: boolean;
  databaseSchemaVersion: number | null;
  metadata?: KecIndexDiagnosticMetadata;
  chunkCount?: number;
  sources?: readonly Readonly<{ sourceId: string; chunkCount: number }>[];
  observedDimensions?: readonly number[];
  issues?: readonly KecIndexDiagnosticIssue[];
}): KecIndexDiagnosticsV1 {
  const frozenSources: Readonly<{ sourceId: string; chunkCount: number }>[] =
    [];
  for (const source of input.sources ?? []) {
    frozenSources.push(
      Object.freeze({
        sourceId: source.sourceId,
        chunkCount: source.chunkCount,
      }),
    );
  }
  const sources = Object.freeze(frozenSources);
  const observedDimensions = Object.freeze([
    ...(input.observedDimensions ?? []),
  ]);
  const issues = Object.freeze([...(input.issues ?? [])]);

  return Object.freeze({
    schemaVersion: 1,
    status: input.status,
    databaseExists: input.databaseExists,
    databaseSchemaVersion: input.databaseSchemaVersion,
    metadata: input.metadata ?? freezeMetadata(null, null, null, null),
    chunkCount: input.chunkCount ?? 0,
    sourceCount: sources.length,
    sources,
    observedDimensions,
    issues,
  });
}

function readSchemaVersion(database: Database): number {
  const row = database.prepare("PRAGMA user_version").get() as
    UnknownRow | undefined;
  const version = row?.user_version;
  if (
    typeof version !== "number" ||
    !Number.isSafeInteger(version) ||
    version < 0
  ) {
    throw diagnosticError("DATABASE_INVALID");
  }
  return version;
}

function readRelevantTables(database: Database): readonly string[] {
  const rows = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (?, ?)",
    )
    .all("kec_chunks", "index_metadata") as UnknownRow[];
  const names: string[] = [];

  for (const row of rows) {
    if (typeof row.name !== "string") {
      throw diagnosticError("DATABASE_INVALID");
    }
    names.push(row.name);
  }

  return names;
}

function hasRequiredColumns(
  database: Database,
  table: "kec_chunks" | "index_metadata",
  required: readonly string[],
): boolean {
  const rows = database
    .prepare(`PRAGMA table_info(${table})`)
    .all() as UnknownRow[];
  const names: string[] = [];

  for (const row of rows) {
    if (typeof row.name !== "string") {
      return false;
    }
    names.push(row.name);
  }

  return required.every((name) => names.includes(name));
}

function readMetadata(database: Database): {
  readonly metadata: KecIndexDiagnosticMetadata;
  readonly exists: boolean;
  readonly valid: boolean;
} {
  const rows = database
    .prepare(
      "SELECT embedding_provider, embedding_model, dimensions, indexed_at FROM index_metadata WHERE id = ?",
    )
    .all("kec") as UnknownRow[];
  const row = rows[0];
  const provider = row?.embedding_provider;
  const model = row?.embedding_model;
  const dimensions = row?.dimensions;
  const indexedAt = row?.indexed_at;
  const outputProvider =
    typeof provider === "string" && provider.length > 0 ? provider : null;
  const outputModel =
    typeof model === "string" && model.length > 0 ? model : null;
  const outputDimensions =
    typeof dimensions === "number" &&
    Number.isSafeInteger(dimensions) &&
    dimensions > 0
      ? dimensions
      : null;
  const outputIndexedAt =
    typeof indexedAt === "string" && indexedAt.length > 0 ? indexedAt : null;
  const exists = rows.length > 0;
  const valid =
    rows.length === 1 &&
    outputProvider !== null &&
    outputModel !== null &&
    outputDimensions !== null &&
    outputIndexedAt !== null;

  return {
    metadata: freezeMetadata(
      outputProvider,
      outputModel,
      outputDimensions,
      outputIndexedAt,
    ),
    exists,
    valid,
  };
}

function embeddingDimension(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }

  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    !Number.isSafeInteger(parsed.length)
  ) {
    return null;
  }

  for (const item of parsed) {
    if (typeof item !== "number" || !Number.isFinite(item)) {
      return null;
    }
  }

  return parsed.length;
}

function addUniqueNumber(values: number[], value: number): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}

function addSource(groups: SourceGroup[], source: string): void {
  const existing = groups.find((group) => group.source === source);
  if (existing === undefined) {
    groups.push({ source, count: 1 });
  } else {
    existing.count += 1;
  }
}

function sourceId(source: string): string {
  const hash = createHash("sha256");
  hash.write(source, "utf8");
  return `kecsrc_${hash.digest("hex")}`;
}

function inspectInitializedDatabase(
  database: Database,
  databaseSchemaVersion: number,
): KecIndexDiagnosticsV1 {
  const metadataResult = readMetadata(database);
  const rows = database
    .prepare(
      "SELECT source_path, embedding FROM kec_chunks WHERE collection = ?",
    )
    .all("kec") as UnknownRow[];
  const sourceGroups: SourceGroup[] = [];
  const observedDimensions: number[] = [];
  let invalidSource = false;
  let invalidEmbedding = false;

  for (const row of rows) {
    const source = row.source_path;
    if (typeof source === "string" && source.length > 0) {
      addSource(sourceGroups, source);
    } else {
      invalidSource = true;
    }

    const dimension = embeddingDimension(row.embedding);
    if (dimension === null) {
      invalidEmbedding = true;
    } else {
      addUniqueNumber(observedDimensions, dimension);
    }
  }

  observedDimensions.sort((left, right) => left - right);
  const issueFlags: Record<AuthorityIssue, boolean> = {
    SCHEMA_INCOMPLETE: false,
    INVALID_METADATA: metadataResult.exists && !metadataResult.valid,
    METADATA_WITHOUT_CHUNKS: metadataResult.exists && rows.length === 0,
    CHUNKS_WITHOUT_METADATA: !metadataResult.exists && rows.length > 0,
    INVALID_SOURCE_PATH: invalidSource,
    INVALID_EMBEDDING: invalidEmbedding,
    MIXED_EMBEDDING_DIMENSIONS: observedDimensions.length > 1,
    METADATA_DIMENSION_MISMATCH:
      metadataResult.valid &&
      observedDimensions.length === 1 &&
      metadataResult.metadata.dimensions !== observedDimensions[0],
  };
  const issues = ISSUE_AUTHORITY.filter((issue) => issueFlags[issue]);
  const sources: Array<{ sourceId: string; chunkCount: number }> = [];
  for (const group of sourceGroups) {
    sources.push({ sourceId: sourceId(group.source), chunkCount: group.count });
  }
  sources.sort((left, right) =>
    left.sourceId < right.sourceId
      ? -1
      : left.sourceId > right.sourceId
        ? 1
        : 0,
  );
  const status =
    issues.length > 0
      ? "INCONSISTENT"
      : rows.length === 0 && !metadataResult.exists
        ? "EMPTY_INDEX"
        : "READY";

  return createDiagnostics({
    status,
    databaseExists: true,
    databaseSchemaVersion,
    metadata: metadataResult.metadata,
    chunkCount: rows.length,
    sources,
    observedDimensions,
    issues,
  });
}

function inspectDatabase(database: Database): KecIndexDiagnosticsV1 {
  const databaseSchemaVersion = readSchemaVersion(database);
  const tables = readRelevantTables(database);

  if (tables.length === 0) {
    return createDiagnostics({
      status: "UNINITIALIZED_DATABASE",
      databaseExists: true,
      databaseSchemaVersion,
    });
  }

  const hasChunkTable = tables.includes("kec_chunks");
  const hasMetadataTable = tables.includes("index_metadata");
  if (
    !hasChunkTable ||
    !hasMetadataTable ||
    !hasRequiredColumns(database, "kec_chunks", REQUIRED_CHUNK_COLUMNS) ||
    !hasRequiredColumns(database, "index_metadata", REQUIRED_METADATA_COLUMNS)
  ) {
    return createDiagnostics({
      status: "INCONSISTENT",
      databaseExists: true,
      databaseSchemaVersion,
      issues: ["SCHEMA_INCOMPLETE"],
    });
  }

  return inspectInitializedDatabase(database, databaseSchemaVersion);
}

export async function inspectKecIndex(
  databasePath: string,
): Promise<KecIndexDiagnosticsV1> {
  if (
    typeof databasePath !== "string" ||
    databasePath.length === 0 ||
    databasePath.includes("\0") ||
    !isAbsolute(databasePath)
  ) {
    throw diagnosticError("INVALID_CONFIGURATION");
  }

  let pathStats;
  try {
    pathStats = lstatSync(databasePath);
  } catch (error) {
    if (isMissingPathError(error)) {
      return createDiagnostics({
        status: "MISSING_DATABASE",
        databaseExists: false,
        databaseSchemaVersion: null,
      });
    }
    throw diagnosticError("DATABASE_UNAVAILABLE");
  }

  if (pathStats.isSymbolicLink() || !pathStats.isFile()) {
    throw diagnosticError("UNSAFE_DATABASE_PATH");
  }

  let database: Database;
  try {
    database = new DatabaseSync(databasePath, {
      readOnly: true,
      allowExtension: false,
      timeout: 0,
    });
  } catch (error) {
    throw classifyDatabaseOpenError(error);
  }

  let diagnostics: KecIndexDiagnosticsV1 | undefined;
  let primaryError: Error | undefined;
  try {
    diagnostics = inspectDatabase(database);
  } catch (error) {
    primaryError =
      error instanceof Error &&
      error.message === "KEC_INDEX_DIAGNOSTICS: DATABASE_INVALID"
        ? error
        : classifyDatabaseError(error);
  }

  try {
    database.close();
  } catch {
    if (primaryError === undefined) {
      primaryError = diagnosticError("DATABASE_UNAVAILABLE");
    }
  }

  if (primaryError !== undefined) {
    throw primaryError;
  }

  return diagnostics as KecIndexDiagnosticsV1;
}
