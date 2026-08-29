import { JudgementLedgerError } from "./judgementLedgerError.js";
import type { SqliteDatabase } from "./sqlite.js";

export const judgementLedgerApplicationId = 0x564a4c31;
export const currentJudgementLedgerSchemaVersion = 1;

function schemaError(): never {
  throw new JudgementLedgerError("schema");
}

function pragmaNumber(
  database: SqliteDatabase,
  pragma: "application_id" | "user_version",
): number {
  const value = database.prepare(`PRAGMA ${pragma}`).get()?.[pragma];
  if (typeof value !== "number") {
    schemaError();
  }
  return value;
}

function initialize(database: SqliteDatabase): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`
      CREATE TABLE judgement_records (
        namespace TEXT COLLATE BINARY NOT NULL,
        record_key TEXT COLLATE BINARY NOT NULL,
        record_id TEXT COLLATE BINARY NOT NULL,
        applicability_key TEXT COLLATE BINARY NOT NULL,
        record_json TEXT NOT NULL,
        PRIMARY KEY (namespace, record_key)
      ) STRICT;

      CREATE INDEX judgement_records_applicability_idx
        ON judgement_records (applicability_key);

      CREATE TABLE judgement_supersessions (
        superseded_namespace TEXT COLLATE BINARY NOT NULL,
        superseded_record_key TEXT COLLATE BINARY NOT NULL,
        superseding_namespace TEXT COLLATE BINARY NOT NULL,
        superseding_record_key TEXT COLLATE BINARY NOT NULL,
        UNIQUE (
          superseded_namespace,
          superseded_record_key,
          superseding_namespace,
          superseding_record_key
        ),
        FOREIGN KEY (superseded_namespace, superseded_record_key)
          REFERENCES judgement_records (namespace, record_key),
        FOREIGN KEY (superseding_namespace, superseding_record_key)
          REFERENCES judgement_records (namespace, record_key)
      ) STRICT;

      CREATE INDEX judgement_supersessions_superseded_idx
        ON judgement_supersessions (
          superseded_namespace,
          superseded_record_key
        );

      CREATE INDEX judgement_supersessions_superseding_idx
        ON judgement_supersessions (
          superseding_namespace,
          superseding_record_key
        );

      PRAGMA application_id = ${judgementLedgerApplicationId};
      PRAGMA user_version = ${currentJudgementLedgerSchemaVersion};
    `);
    database.exec("COMMIT");
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // The original schema failure remains authoritative.
    }
    throw error;
  }
}

function hasRequiredTables(database: SqliteDatabase): boolean {
  const rows = database
    .prepare(
      `SELECT name
       FROM sqlite_schema
       WHERE type = 'table' AND name IN (?, ?)
       ORDER BY name`,
    )
    .all("judgement_records", "judgement_supersessions");

  return (
    rows.length === 2 &&
    rows[0]?.name === "judgement_records" &&
    rows[1]?.name === "judgement_supersessions"
  );
}

export function openJudgementLedgerSchema(database: SqliteDatabase): void {
  database.exec("PRAGMA foreign_keys = ON");

  const applicationId = pragmaNumber(database, "application_id");
  const userVersion = pragmaNumber(database, "user_version");
  const objectCount = database
    .prepare("SELECT COUNT(*) AS count FROM sqlite_schema")
    .get()?.count;

  if (typeof objectCount !== "number") {
    schemaError();
  }

  if (applicationId === 0 && userVersion === 0 && objectCount === 0) {
    initialize(database);
    return;
  }

  if (
    applicationId !== judgementLedgerApplicationId ||
    userVersion !== currentJudgementLedgerSchemaVersion ||
    !hasRequiredTables(database)
  ) {
    schemaError();
  }
}
