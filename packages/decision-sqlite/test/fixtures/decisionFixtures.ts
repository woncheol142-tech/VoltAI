import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  DecisionRecord,
  DecisionRecordKeyCodec,
  DecisionValueCodec,
  JsonValue,
} from "@voltai/knowledge-core";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

export const DECISION_APPLICATION_ID = 0x56444831;
export const DECISION_APPLICATION_ID_DECIMAL = 1_447_315_505;
export const DECISION_USER_VERSION = 1;

export const tempRoots: string[] = [];

export type TestDecisionId = string;
export type TestSelection = JsonValue;
export type TestContext = JsonValue;

export const stringKeyCodec: DecisionRecordKeyCodec<string> = {
  encode: (value) => value,
  decode: (value) => {
    if (typeof value !== "string") {
      throw new TypeError("test key decode rejected the stored value");
    }

    return value;
  },
};

export const numberKeyCodec: DecisionRecordKeyCodec<number> = {
  encode: (value) => `number:${value}`,
  decode: (value) => {
    if (typeof value !== "string" || !/^number:-?\d+$/.test(value)) {
      throw new TypeError("test number-key decode rejected the stored value");
    }

    return Number(value.slice("number:".length));
  },
};

export const jsonValueCodec: DecisionValueCodec<JsonValue> = {
  encode: (value) => value,
  decode: (value) => value as JsonValue,
};

export const prefixedStringCodec: DecisionValueCodec<string> = {
  encode: (value) => `string:${value}`,
  decode: (value) => {
    if (typeof value !== "string" || !value.startsWith("string:")) {
      throw new TypeError("test string decode rejected the stored value");
    }

    return value.slice("string:".length);
  },
};

export function createDecisionRecord(
  id = "decision-1",
  selection: JsonValue = "approve",
  context: JsonValue = { revision: 1 },
): DecisionRecord<string, JsonValue, JsonValue> {
  return { id, decision: { selection, context } };
}

export function createTempDatabase(prefix = "voltai-decision-"): {
  root: string;
  dbPath: string;
} {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const dbPath = join(root, "decision.sqlite");
  tempRoots.push(root);
  return { root, dbPath };
}

export function cleanupTempDatabases(): void {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
}

export function readOwnedRows(dbPath: string): Record<string, unknown[]> {
  const database = new DatabaseSync(dbPath);

  try {
    return {
      decision_records: database
        .prepare("SELECT * FROM decision_records ORDER BY rowid")
        .all(),
      decision_bases: database
        .prepare("SELECT * FROM decision_bases ORDER BY rowid")
        .all(),
      decision_supersessions: database
        .prepare("SELECT * FROM decision_supersessions ORDER BY rowid")
        .all(),
    };
  } finally {
    database.close();
  }
}

export function insertPhysicalDecision(
  dbPath: string,
  values: {
    namespace?: string;
    recordKey?: string;
    selection: string;
    context?: string;
  },
): void {
  const database = new DatabaseSync(dbPath);

  try {
    database
      .prepare(
        `
        INSERT INTO decision_records (namespace, record_key, selection, context)
        VALUES (?, ?, ?, ?)
      `,
      )
      .run(
        values.namespace ?? "records",
        values.recordKey ?? "external",
        values.selection,
        values.context ?? "null",
      );
  } finally {
    database.close();
  }
}

export type CandidateSchemaOptions = {
  recordNamespaceCollation?: "BINARY" | "NOCASE";
  recordStrict?: boolean;
  recordWithoutRowid?: boolean;
  includeForeignKey?: boolean;
  includeTrigger?: boolean;
  includeUnexpectedUniqueIndex?: boolean;
  applicationId?: number;
  userVersion?: number;
};

/** Builds adversarial candidates only in OS temp directories. */
export function createCandidateSchema(
  dbPath: string,
  options: CandidateSchemaOptions = {},
): void {
  const database = new DatabaseSync(dbPath);
  const collation = options.recordNamespaceCollation ?? "BINARY";
  const strict = options.recordStrict === false ? "" : " STRICT";
  const withoutRowid = options.recordWithoutRowid ? ", WITHOUT ROWID" : "";
  const foreignKey = options.includeForeignKey
    ? ", FOREIGN KEY (namespace, record_key) REFERENCES decisions(namespace, record_key)"
    : "";

  try {
    database.exec(`
      CREATE TABLE decision_records (
        namespace TEXT COLLATE ${collation} NOT NULL,
        record_key TEXT COLLATE BINARY NOT NULL,
        selection TEXT NOT NULL,
        context TEXT NOT NULL,
        PRIMARY KEY (namespace, record_key)
        ${foreignKey}
      )${strict}${withoutRowid};

      CREATE TABLE decision_bases (
        decision_namespace TEXT COLLATE BINARY NOT NULL,
        decision_record_key TEXT COLLATE BINARY NOT NULL,
        basis TEXT NOT NULL
      ) STRICT;

      CREATE INDEX decision_bases_address_idx
        ON decision_bases (decision_namespace, decision_record_key);

      CREATE TABLE decision_supersessions (
        superseded_namespace TEXT COLLATE BINARY NOT NULL,
        superseded_record_key TEXT COLLATE BINARY NOT NULL,
        superseding_namespace TEXT COLLATE BINARY NOT NULL,
        superseding_record_key TEXT COLLATE BINARY NOT NULL,
        UNIQUE (
          superseded_namespace,
          superseded_record_key,
          superseding_namespace,
          superseding_record_key
        )
      ) STRICT;

      CREATE INDEX decision_supersessions_superseded_idx
        ON decision_supersessions (superseded_namespace, superseded_record_key);
      CREATE INDEX decision_supersessions_superseding_idx
        ON decision_supersessions (superseding_namespace, superseding_record_key);
    `);

    if (options.includeTrigger) {
      database.exec(`
        CREATE TRIGGER decision_records_attack
        AFTER INSERT ON decision_records
        BEGIN
          DELETE FROM decision_records;
        END;
      `);
    }

    if (options.includeUnexpectedUniqueIndex) {
      database.exec(`
        CREATE UNIQUE INDEX decision_bases_attack_unique
          ON decision_bases (decision_namespace, decision_record_key, basis);
      `);
    }

    database.exec(`
      PRAGMA application_id = ${options.applicationId ?? DECISION_APPLICATION_ID};
      PRAGMA user_version = ${options.userVersion ?? DECISION_USER_VERSION};
    `);
  } finally {
    database.close();
  }
}

export { DatabaseSync };
