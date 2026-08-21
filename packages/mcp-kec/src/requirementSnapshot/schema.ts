import type { DatabaseSync } from "node:sqlite";

import { KecRequirementSnapshotStoreError } from "./errors.js";

export const requirementSnapshotApplicationId = 0x56524831;
export const requirementSnapshotSchemaVersionV1 = 1;
export const requirementSnapshotSchemaVersion = 2;

export type RequirementSnapshotSchemaMode = 1 | 2;

type RequirementSnapshotDatabase = InstanceType<typeof DatabaseSync>;

type TableInfoRow = {
  readonly cid: number;
  readonly name: string;
  readonly type: string;
  readonly notnull: number;
  readonly dflt_value: unknown;
  readonly pk: number;
};

type IndexListRow = { readonly name: string; readonly unique: number };
type IndexInfoRow = {
  readonly name: string;
  readonly coll: string;
  readonly key: number;
};

const snapshotColumns: readonly TableInfoRow[] = [
  {
    cid: 0,
    name: "snapshot_id",
    type: "INTEGER",
    notnull: 0,
    dflt_value: null,
    pk: 1,
  },
  {
    cid: 1,
    name: "source_identity",
    type: "TEXT",
    notnull: 1,
    dflt_value: null,
    pk: 0,
  },
  {
    cid: 2,
    name: "revision_key",
    type: "TEXT",
    notnull: 1,
    dflt_value: null,
    pk: 0,
  },
  {
    cid: 3,
    name: "blob_algorithm",
    type: "TEXT",
    notnull: 1,
    dflt_value: null,
    pk: 0,
  },
  {
    cid: 4,
    name: "blob_digest",
    type: "TEXT",
    notnull: 1,
    dflt_value: null,
    pk: 0,
  },
  {
    cid: 5,
    name: "extraction_contract",
    type: "TEXT",
    notnull: 1,
    dflt_value: null,
    pk: 0,
  },
  {
    cid: 6,
    name: "locator_space",
    type: "TEXT",
    notnull: 1,
    dflt_value: null,
    pk: 0,
  },
];

const memberColumns: readonly TableInfoRow[] = [
  {
    cid: 0,
    name: "snapshot_id",
    type: "INTEGER",
    notnull: 1,
    dflt_value: null,
    pk: 1,
  },
  {
    cid: 1,
    name: "population_index",
    type: "INTEGER",
    notnull: 1,
    dflt_value: null,
    pk: 2,
  },
  {
    cid: 2,
    name: "requirement_id",
    type: "TEXT",
    notnull: 1,
    dflt_value: null,
    pk: 0,
  },
  {
    cid: 3,
    name: "statement",
    type: "TEXT",
    notnull: 1,
    dflt_value: null,
    pk: 0,
  },
  {
    cid: 4,
    name: "locators_json",
    type: "TEXT",
    notnull: 1,
    dflt_value: null,
    pk: 0,
  },
];

const captureColumns: readonly TableInfoRow[] = [
  {
    cid: 0,
    name: "snapshot_id",
    type: "INTEGER",
    notnull: 1,
    dflt_value: null,
    pk: 1,
  },
  {
    cid: 1,
    name: "capture_contract",
    type: "TEXT",
    notnull: 1,
    dflt_value: null,
    pk: 2,
  },
];

const observationColumns: readonly TableInfoRow[] = [
  {
    cid: 0,
    name: "snapshot_id",
    type: "INTEGER",
    notnull: 1,
    dflt_value: null,
    pk: 1,
  },
  {
    cid: 1,
    name: "capture_contract",
    type: "TEXT",
    notnull: 1,
    dflt_value: null,
    pk: 2,
  },
  {
    cid: 2,
    name: "observation_index",
    type: "INTEGER",
    notnull: 1,
    dflt_value: null,
    pk: 3,
  },
  { cid: 3, name: "kind", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
  {
    cid: 4,
    name: "payload_json",
    type: "TEXT",
    notnull: 1,
    dflt_value: null,
    pk: 0,
  },
];

function schemaFailure(): never {
  throw new KecRequirementSnapshotStoreError("schema");
}

function pragmaNumber(
  database: RequirementSnapshotDatabase,
  pragma: "application_id" | "user_version",
): number {
  const row = database.prepare(`PRAGMA ${pragma}`).get();
  const value = row?.[pragma];
  if (typeof value !== "number") schemaFailure();
  return value;
}

function sameColumns(
  observed: readonly TableInfoRow[],
  expected: readonly TableInfoRow[],
): boolean {
  return JSON.stringify(observed) === JSON.stringify(expected);
}

function indexShapes(
  database: RequirementSnapshotDatabase,
  table: string,
): readonly string[] {
  const indexes = database
    .prepare(`PRAGMA index_list(${table})`)
    .all() as IndexListRow[];
  const shapes: string[] = [];
  for (const index of indexes) {
    if (index.unique !== 1) schemaFailure();
    const columns = database
      .prepare(`PRAGMA index_xinfo('${index.name}')`)
      .all() as IndexInfoRow[];
    shapes.push(
      JSON.stringify(
        columns
          .filter(({ key }) => key === 1)
          .map(({ name, coll }) => [name, coll]),
      ),
    );
  }
  return shapes.sort();
}

function exactIndexShapes(
  database: RequirementSnapshotDatabase,
  table: string,
  expected: readonly (readonly (readonly [string, string])[])[],
): void {
  const encoded = expected.map((shape) => JSON.stringify(shape)).sort();
  if (
    JSON.stringify(indexShapes(database, table)) !== JSON.stringify(encoded)
  ) {
    schemaFailure();
  }
}

function validateOwnedTables(
  database: RequirementSnapshotDatabase,
  expectedNames: readonly string[],
): void {
  const objects = database
    .prepare("SELECT type, name, tbl_name, sql FROM sqlite_schema")
    .all() as Array<{
    readonly type: string;
    readonly name: string;
    readonly tbl_name: string;
    readonly sql: string | null;
  }>;
  const names = objects
    .filter(({ type }) => type === "table")
    .map(({ name }) => name)
    .sort();
  if (JSON.stringify(names) !== JSON.stringify([...expectedNames].sort())) {
    schemaFailure();
  }
  if (objects.some(({ type }) => type !== "table" && type !== "index")) {
    schemaFailure();
  }
  const tableSql = objects
    .filter(({ type }) => type === "table")
    .map(({ sql }) => sql ?? "")
    .join("\n");
  if (/\bCHECK\s*\(|\bFOREIGN\s+KEY\b/iu.test(tableSql)) schemaFailure();

  const tableList = database.prepare("PRAGMA table_list").all() as Array<{
    readonly name: string;
    readonly strict: number;
  }>;
  for (const table of names) {
    if (tableList.find(({ name }) => name === table)?.strict !== 1) {
      schemaFailure();
    }
  }
}

function validateRequirementTables(
  database: RequirementSnapshotDatabase,
): void {
  const observedSnapshots = database
    .prepare("PRAGMA table_info(kec_requirement_snapshots)")
    .all() as TableInfoRow[];
  const observedMembers = database
    .prepare("PRAGMA table_info(kec_requirement_snapshot_members)")
    .all() as TableInfoRow[];
  if (
    !sameColumns(observedSnapshots, snapshotColumns) ||
    !sameColumns(observedMembers, memberColumns)
  ) {
    schemaFailure();
  }
  exactIndexShapes(database, "kec_requirement_snapshots", [
    [
      ["source_identity", "BINARY"],
      ["revision_key", "BINARY"],
      ["blob_algorithm", "BINARY"],
      ["blob_digest", "BINARY"],
      ["extraction_contract", "BINARY"],
      ["locator_space", "BINARY"],
    ],
  ]);
  exactIndexShapes(database, "kec_requirement_snapshot_members", [
    [
      ["snapshot_id", "BINARY"],
      ["population_index", "BINARY"],
    ],
    [
      ["snapshot_id", "BINARY"],
      ["requirement_id", "BINARY"],
    ],
  ]);
}

export function validateRequirementSnapshotSchemaV1(
  database: RequirementSnapshotDatabase,
): void {
  validateOwnedTables(database, [
    "kec_requirement_snapshots",
    "kec_requirement_snapshot_members",
  ]);
  validateRequirementTables(database);
}

export function validateRequirementSnapshotSchemaV2(
  database: RequirementSnapshotDatabase,
): void {
  validateOwnedTables(database, [
    "kec_requirement_snapshots",
    "kec_requirement_snapshot_members",
    "kec_requirement_snapshot_captures",
    "kec_requirement_snapshot_capture_observations",
  ]);
  validateRequirementTables(database);
  const observedCaptures = database
    .prepare("PRAGMA table_info(kec_requirement_snapshot_captures)")
    .all() as TableInfoRow[];
  const observedObservations = database
    .prepare("PRAGMA table_info(kec_requirement_snapshot_capture_observations)")
    .all() as TableInfoRow[];
  if (
    !sameColumns(observedCaptures, captureColumns) ||
    !sameColumns(observedObservations, observationColumns)
  ) {
    schemaFailure();
  }
  exactIndexShapes(database, "kec_requirement_snapshot_captures", [
    [
      ["snapshot_id", "BINARY"],
      ["capture_contract", "BINARY"],
    ],
  ]);
  exactIndexShapes(database, "kec_requirement_snapshot_capture_observations", [
    [
      ["snapshot_id", "BINARY"],
      ["capture_contract", "BINARY"],
      ["observation_index", "BINARY"],
    ],
  ]);
}

function initializeSchema(database: RequirementSnapshotDatabase): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`
      CREATE TABLE kec_requirement_snapshots (
        snapshot_id INTEGER PRIMARY KEY,
        source_identity TEXT COLLATE BINARY NOT NULL,
        revision_key TEXT COLLATE BINARY NOT NULL,
        blob_algorithm TEXT COLLATE BINARY NOT NULL,
        blob_digest TEXT COLLATE BINARY NOT NULL,
        extraction_contract TEXT COLLATE BINARY NOT NULL,
        locator_space TEXT COLLATE BINARY NOT NULL,
        UNIQUE (
          source_identity,
          revision_key,
          blob_algorithm,
          blob_digest,
          extraction_contract,
          locator_space
        )
      ) STRICT;

      CREATE TABLE kec_requirement_snapshot_members (
        snapshot_id INTEGER NOT NULL,
        population_index INTEGER NOT NULL,
        requirement_id TEXT COLLATE BINARY NOT NULL,
        statement TEXT NOT NULL,
        locators_json TEXT NOT NULL,
        PRIMARY KEY (snapshot_id, population_index),
        UNIQUE (snapshot_id, requirement_id)
      ) STRICT;

      CREATE TABLE kec_requirement_snapshot_captures (
        snapshot_id INTEGER NOT NULL,
        capture_contract TEXT COLLATE BINARY NOT NULL,
        PRIMARY KEY (snapshot_id, capture_contract)
      ) STRICT;

      CREATE TABLE kec_requirement_snapshot_capture_observations (
        snapshot_id INTEGER NOT NULL,
        capture_contract TEXT COLLATE BINARY NOT NULL,
        observation_index INTEGER NOT NULL,
        kind TEXT COLLATE BINARY NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (snapshot_id, capture_contract, observation_index)
      ) STRICT;

      PRAGMA application_id = ${requirementSnapshotApplicationId};
      PRAGMA user_version = ${requirementSnapshotSchemaVersion};
    `);
    database.exec("COMMIT");
  } catch (failure) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // Keep the initiating failure.
    }
    throw failure;
  }
}

export function openRequirementSnapshotSchema(
  database: RequirementSnapshotDatabase,
): RequirementSnapshotSchemaMode {
  const applicationId = pragmaNumber(database, "application_id");
  const userVersion = pragmaNumber(database, "user_version");
  const countRow = database
    .prepare("SELECT COUNT(*) AS count FROM sqlite_schema")
    .get();
  const objectCount = countRow?.count;
  if (typeof objectCount !== "number") schemaFailure();

  if (applicationId === 0 && userVersion === 0 && objectCount === 0) {
    initializeSchema(database);
    return 2;
  }
  if (applicationId !== requirementSnapshotApplicationId) schemaFailure();
  if (userVersion === requirementSnapshotSchemaVersionV1) {
    validateRequirementSnapshotSchemaV1(database);
    return 1;
  }
  if (userVersion === requirementSnapshotSchemaVersion) {
    validateRequirementSnapshotSchemaV2(database);
    return 2;
  }
  schemaFailure();
}
