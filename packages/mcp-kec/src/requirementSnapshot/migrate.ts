import { createRequire } from "node:module";

import { KecRequirementSnapshotStoreError } from "./errors.js";
import * as schema from "./schema.js";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
type RequirementSnapshotDatabase = InstanceType<typeof DatabaseSync>;

function normalizeFailure(failure: unknown): never {
  if (failure instanceof KecRequirementSnapshotStoreError) throw failure;
  throw new KecRequirementSnapshotStoreError("storage");
}

function numberPragma(
  database: RequirementSnapshotDatabase,
  pragma: "application_id" | "user_version",
): number {
  const row = database.prepare(`PRAGMA ${pragma}`).get();
  const value = row?.[pragma];
  if (typeof value !== "number") {
    throw new KecRequirementSnapshotStoreError("schema");
  }
  return value;
}

function objectCount(database: RequirementSnapshotDatabase): number {
  const row = database
    .prepare("SELECT COUNT(*) AS count FROM sqlite_schema")
    .get();
  if (typeof row?.count !== "number") {
    throw new KecRequirementSnapshotStoreError("schema");
  }
  return row.count;
}

function auditMembers(database: RequirementSnapshotDatabase): void {
  const orphan = database
    .prepare(
      `SELECT 1 AS found
       FROM kec_requirement_snapshot_members AS m
       LEFT JOIN kec_requirement_snapshots AS s USING (snapshot_id)
       WHERE s.snapshot_id IS NULL
       LIMIT 1`,
    )
    .get();
  if (orphan !== undefined) {
    throw new KecRequirementSnapshotStoreError("member-corruption");
  }
}

function auditCaptures(database: RequirementSnapshotDatabase): void {
  const headerOrphan = database
    .prepare(
      `SELECT 1 AS found
       FROM kec_requirement_snapshot_captures AS c
       LEFT JOIN kec_requirement_snapshots AS s USING (snapshot_id)
       WHERE s.snapshot_id IS NULL
       LIMIT 1`,
    )
    .get();
  const observationOrphan = database
    .prepare(
      `SELECT 1 AS found
       FROM kec_requirement_snapshot_capture_observations AS o
       LEFT JOIN kec_requirement_snapshot_captures AS c
         ON c.snapshot_id = o.snapshot_id
        AND c.capture_contract = o.capture_contract
       WHERE c.snapshot_id IS NULL
       LIMIT 1`,
    )
    .get();
  const badKind = database
    .prepare(
      `SELECT 1 AS found
       FROM kec_requirement_snapshot_capture_observations
       WHERE kind NOT IN (
         'column-gap-region-excluded',
         'suppressed-assembly',
         'requirement-assembly'
       )
       LIMIT 1`,
    )
    .get();
  if (
    headerOrphan !== undefined ||
    observationOrphan !== undefined ||
    badKind !== undefined
  ) {
    throw new KecRequirementSnapshotStoreError("capture-corruption");
  }
}

export function migrateRequirementSnapshotSchemaToV2(dbPath: string): void {
  let database: RequirementSnapshotDatabase;
  try {
    database = new DatabaseSync(dbPath);
  } catch {
    throw new KecRequirementSnapshotStoreError("storage");
  }

  try {
    const applicationId = numberPragma(database, "application_id");
    const version = numberPragma(database, "user_version");
    const count = objectCount(database);

    if (
      applicationId === schema.requirementSnapshotApplicationId &&
      version === schema.requirementSnapshotSchemaVersionV1
    ) {
      database.exec("BEGIN IMMEDIATE");
      try {
        schema.validateRequirementSnapshotSchemaV1(database);
        auditMembers(database);
        database.exec(`
          CREATE TABLE kec_requirement_snapshot_captures (
            snapshot_id INTEGER NOT NULL,
            capture_contract TEXT COLLATE BINARY NOT NULL,
            PRIMARY KEY (snapshot_id, capture_contract)
          ) STRICT;
        `);
        database.exec(`
          CREATE TABLE kec_requirement_snapshot_capture_observations (
            snapshot_id INTEGER NOT NULL,
            capture_contract TEXT COLLATE BINARY NOT NULL,
            observation_index INTEGER NOT NULL,
            kind TEXT COLLATE BINARY NOT NULL,
            payload_json TEXT NOT NULL,
            PRIMARY KEY (snapshot_id, capture_contract, observation_index)
          ) STRICT;
        `);
        database.exec(
          `PRAGMA user_version = ${schema.requirementSnapshotSchemaVersion}`,
        );
        database.exec("COMMIT");
      } catch (failure) {
        try {
          database.exec("ROLLBACK");
        } catch {
          throw new KecRequirementSnapshotStoreError("storage");
        }
        normalizeFailure(failure);
      }
      return;
    }

    if (
      applicationId === schema.requirementSnapshotApplicationId &&
      version === schema.requirementSnapshotSchemaVersion
    ) {
      schema.validateRequirementSnapshotSchemaV2(database);
      auditMembers(database);
      auditCaptures(database);
      return;
    }

    if (applicationId === 0 && version === 0 && count === 0) {
      throw new KecRequirementSnapshotStoreError("schema");
    }
    throw new KecRequirementSnapshotStoreError("schema");
  } catch (failure) {
    normalizeFailure(failure);
  } finally {
    try {
      database.close();
    } catch {
      // Keep the operation result.
    }
  }
}
