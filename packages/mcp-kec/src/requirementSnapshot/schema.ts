import type { DatabaseSync } from "node:sqlite";

import { KecRequirementSnapshotStoreError } from "./errors.js";

export const requirementSnapshotApplicationId = 0x56524831;
export const requirementSnapshotSchemaVersion = 1;

type RequirementSnapshotDatabase = InstanceType<typeof DatabaseSync>;

type TableInfoRow = {
  readonly cid: number;
  readonly name: string;
  readonly type: string;
  readonly notnull: number;
  readonly dflt_value: unknown;
  readonly pk: number;
};

type IndexListRow = {
  readonly name: string;
  readonly unique: number;
};

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

function schemaFailure(): never {
  throw new KecRequirementSnapshotStoreError("schema");
}

function memberFailure(): never {
  throw new KecRequirementSnapshotStoreError("member-corruption");
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

      PRAGMA application_id = ${requirementSnapshotApplicationId};
      PRAGMA user_version = ${requirementSnapshotSchemaVersion};
    `);
    database.exec("COMMIT");
  } catch (failure) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // Preserve the initialization failure.
    }
    throw failure;
  }
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

function validateSchema(database: RequirementSnapshotDatabase): void {
  const objects = database
    .prepare("SELECT type, name, tbl_name, sql FROM sqlite_schema")
    .all() as Array<{
    readonly type: string;
    readonly name: string;
    readonly tbl_name: string;
    readonly sql: string | null;
  }>;
  const tableNames = objects
    .filter(({ type }) => type === "table")
    .map(({ name }) => name)
    .sort();
  if (
    JSON.stringify(tableNames) !==
    JSON.stringify([
      "kec_requirement_snapshot_members",
      "kec_requirement_snapshots",
    ])
  ) {
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
  for (const table of tableNames) {
    if (tableList.find(({ name }) => name === table)?.strict !== 1) {
      schemaFailure();
    }
  }

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

  const expectedSnapshotIndexes = [
    JSON.stringify([
      ["source_identity", "BINARY"],
      ["revision_key", "BINARY"],
      ["blob_algorithm", "BINARY"],
      ["blob_digest", "BINARY"],
      ["extraction_contract", "BINARY"],
      ["locator_space", "BINARY"],
    ]),
  ].sort();
  const expectedMemberIndexes = [
    JSON.stringify([
      ["snapshot_id", "BINARY"],
      ["population_index", "BINARY"],
    ]),
    JSON.stringify([
      ["snapshot_id", "BINARY"],
      ["requirement_id", "BINARY"],
    ]),
  ].sort();
  if (
    JSON.stringify(indexShapes(database, "kec_requirement_snapshots")) !==
      JSON.stringify(expectedSnapshotIndexes) ||
    JSON.stringify(
      indexShapes(database, "kec_requirement_snapshot_members"),
    ) !== JSON.stringify(expectedMemberIndexes)
  ) {
    schemaFailure();
  }
}

function auditOrphans(database: RequirementSnapshotDatabase): void {
  const orphan = database
    .prepare(
      `SELECT 1 AS found
       FROM kec_requirement_snapshot_members AS m
       LEFT JOIN kec_requirement_snapshots AS s USING (snapshot_id)
       WHERE s.snapshot_id IS NULL
       LIMIT 1`,
    )
    .get();
  if (orphan !== undefined) memberFailure();
}

export function openRequirementSnapshotSchema(
  database: RequirementSnapshotDatabase,
): void {
  const applicationId = pragmaNumber(database, "application_id");
  const userVersion = pragmaNumber(database, "user_version");
  const countRow = database
    .prepare("SELECT COUNT(*) AS count FROM sqlite_schema")
    .get();
  const objectCount = countRow?.count;
  if (typeof objectCount !== "number") schemaFailure();

  if (applicationId === 0 && userVersion === 0 && objectCount === 0) {
    initializeSchema(database);
    return;
  }
  if (
    applicationId !== requirementSnapshotApplicationId ||
    userVersion !== requirementSnapshotSchemaVersion
  ) {
    schemaFailure();
  }
  validateSchema(database);
  auditOrphans(database);
}
