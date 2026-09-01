import { BindingCorruptionFailure } from "./errors.js";
import type { SqliteDatabase } from "./sqlite.js";

export const bindingStoreApplicationId = 0x56424144;
export const currentBindingStoreSchemaVersion = 1;

interface TableInfoRow {
  readonly cid: number;
  readonly name: string;
  readonly type: string;
  readonly notnull: number;
  readonly dflt_value: unknown;
  readonly pk: number;
}

interface IndexListRow {
  readonly name: string;
  readonly unique: number;
}

interface IndexInfoRow {
  readonly name: string;
  readonly coll: string;
  readonly key: number;
}

const expectedColumns: readonly TableInfoRow[] = [
  {
    cid: 0,
    name: "source_identity",
    type: "TEXT",
    notnull: 1,
    dflt_value: null,
    pk: 1,
  },
  {
    cid: 1,
    name: "revision_key",
    type: "TEXT",
    notnull: 1,
    dflt_value: null,
    pk: 2,
  },
  {
    cid: 2,
    name: "blob_algorithm",
    type: "TEXT",
    notnull: 1,
    dflt_value: null,
    pk: 3,
  },
  {
    cid: 3,
    name: "blob_digest",
    type: "TEXT",
    notnull: 1,
    dflt_value: null,
    pk: 4,
  },
  {
    cid: 4,
    name: "admission_sequence",
    type: "INTEGER",
    notnull: 1,
    dflt_value: null,
    pk: 5,
  },
  {
    cid: 5,
    name: "event_kind",
    type: "TEXT",
    notnull: 1,
    dflt_value: null,
    pk: 0,
  },
  {
    cid: 6,
    name: "authority",
    type: "TEXT",
    notnull: 1,
    dflt_value: null,
    pk: 0,
  },
  { cid: 7, name: "basis", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
  {
    cid: 8,
    name: "withdraws_sequence",
    type: "INTEGER",
    notnull: 0,
    dflt_value: null,
    pk: 0,
  },
];

function pragmaNumber(
  database: SqliteDatabase,
  pragma: "application_id" | "user_version",
): number {
  const row = database.prepare(`PRAGMA ${pragma}`).get() as
    Record<string, unknown> | undefined;
  const value = row?.[pragma];
  if (typeof value !== "number") {
    throw new BindingCorruptionFailure(`invalid ${pragma}`);
  }
  return value;
}

function tableExists(database: SqliteDatabase): boolean {
  return (
    database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get("source_binding_admission_events") !== undefined
  );
}

function validateSchemaShape(database: SqliteDatabase): void {
  const tables = database
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name",
    )
    .all() as Array<{ readonly name: string }>;
  if (
    JSON.stringify(tables.map(({ name }) => name)) !==
    JSON.stringify(["source_binding_admission_events"])
  ) {
    throw new BindingCorruptionFailure("unexpected binding store tables");
  }

  const tableList = database
    .prepare("PRAGMA table_list('source_binding_admission_events')")
    .all() as Array<{ readonly strict: number }>;
  if (tableList.length !== 1 || tableList[0]?.strict !== 1) {
    throw new BindingCorruptionFailure("binding store table must be STRICT");
  }

  const columns = database
    .prepare("PRAGMA table_info(source_binding_admission_events)")
    .all() as unknown as TableInfoRow[];
  if (JSON.stringify(columns) !== JSON.stringify(expectedColumns)) {
    throw new BindingCorruptionFailure("invalid binding store columns");
  }

  const indexes = database
    .prepare("PRAGMA index_list(source_binding_admission_events)")
    .all() as unknown as IndexListRow[];
  if (indexes.length !== 1 || indexes[0]?.unique !== 1) {
    throw new BindingCorruptionFailure("invalid binding store indexes");
  }
  const indexColumns = database
    .prepare(`PRAGMA index_xinfo('${indexes[0]!.name}')`)
    .all() as unknown as IndexInfoRow[];
  const shape = indexColumns
    .filter(({ key }) => key === 1)
    .map(({ name, coll }) => [name, coll]);
  if (
    JSON.stringify(shape) !==
    JSON.stringify([
      ["source_identity", "BINARY"],
      ["revision_key", "BINARY"],
      ["blob_algorithm", "BINARY"],
      ["blob_digest", "BINARY"],
      ["admission_sequence", "BINARY"],
    ])
  ) {
    throw new BindingCorruptionFailure("invalid binding store index shape");
  }
}

export function initializeBindingStoreSchema(database: SqliteDatabase): void {
  const applicationId = pragmaNumber(database, "application_id");
  const userVersion = pragmaNumber(database, "user_version");
  const exists = tableExists(database);

  if (!exists && applicationId === 0 && userVersion === 0) {
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(`
        CREATE TABLE source_binding_admission_events (
          source_identity TEXT COLLATE BINARY NOT NULL,
          revision_key TEXT COLLATE BINARY NOT NULL,
          blob_algorithm TEXT COLLATE BINARY NOT NULL,
          blob_digest TEXT COLLATE BINARY NOT NULL,
          admission_sequence INTEGER NOT NULL,
          event_kind TEXT COLLATE BINARY NOT NULL,
          authority TEXT COLLATE BINARY NOT NULL,
          basis TEXT COLLATE BINARY NOT NULL,
          withdraws_sequence INTEGER,
          PRIMARY KEY (
            source_identity,
            revision_key,
            blob_algorithm,
            blob_digest,
            admission_sequence
          )
        ) STRICT;
        PRAGMA application_id = ${bindingStoreApplicationId};
        PRAGMA user_version = ${currentBindingStoreSchemaVersion};
      `);
      database.exec("COMMIT");
    } catch (failure) {
      database.exec("ROLLBACK");
      throw failure;
    }
    validateSchemaShape(database);
    return;
  }

  if (
    !exists ||
    applicationId !== bindingStoreApplicationId ||
    userVersion !== currentBindingStoreSchemaVersion
  ) {
    throw new BindingCorruptionFailure("unsupported binding store schema");
  }
  validateSchemaShape(database);
}
