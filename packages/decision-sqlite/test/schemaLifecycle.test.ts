import { afterEach, describe, expect, it } from "vitest";

import { SqliteKnowledgeStore } from "@voltai/knowledge-sqlite";

import { DecisionStoreError, SqliteDecisionStore } from "../src/index.js";
import {
  cleanupTempDatabases,
  createCandidateSchema,
  createTempDatabase,
  DatabaseSync,
  DECISION_APPLICATION_ID,
  DECISION_APPLICATION_ID_DECIMAL,
  DECISION_USER_VERSION,
} from "./fixtures/decisionFixtures.js";

const ownedTables = [
  "decision_records",
  "decision_bases",
  "decision_supersessions",
];

function expectSchemaError(action: () => unknown): void {
  try {
    action();
    throw new Error("expected DecisionStoreError category schema");
  } catch (error) {
    expect(error).toBeInstanceOf(DecisionStoreError);
    expect(error).toMatchObject({ category: "schema" });
  }
}

describe("R12 schema initialization and structural validation", () => {
  afterEach(cleanupTempDatabases);

  it("initializes an empty database with the frozen application id and user version", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    store.close();

    const database = new DatabaseSync(dbPath);
    const applicationId = database.prepare("PRAGMA application_id").get();
    const userVersion = database.prepare("PRAGMA user_version").get();
    database.close();

    expect(DECISION_APPLICATION_ID).toBe(0x56444831);
    expect(DECISION_APPLICATION_ID_DECIMAL).toBe(1_447_315_505);
    expect(DECISION_APPLICATION_ID).toBe(DECISION_APPLICATION_ID_DECIMAL);
    expect(applicationId).toEqual({
      application_id: DECISION_APPLICATION_ID_DECIMAL,
    });
    expect(userVersion).toEqual({ user_version: DECISION_USER_VERSION });
  });

  it("creates only STRICT rowid owned tables", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    store.close();
    const database = new DatabaseSync(dbPath);
    const rows = database.prepare("PRAGMA table_list").all() as Array<{
      name: string;
      strict: number;
      wr: number;
    }>;
    database.close();

    for (const table of ownedTables) {
      expect(rows.find((row) => row.name === table)).toMatchObject({
        strict: 1,
        wr: 0,
      });
    }
  });

  it("creates BINARY address key indexes with no foreign keys or owned-table triggers", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    store.close();
    const database = new DatabaseSync(dbPath);

    try {
      for (const table of ownedTables) {
        expect(
          database.prepare(`PRAGMA foreign_key_list(${table})`).all(),
        ).toEqual([]);
      }

      const triggers = database
        .prepare(
          `SELECT tbl_name FROM sqlite_schema
           WHERE type = 'trigger' AND tbl_name IN (?, ?, ?)`,
        )
        .all(...ownedTables);
      expect(triggers).toEqual([]);

      const expectedKeyShapes = new Map([
        [
          "decision_records",
          [
            ["namespace", "BINARY"],
            ["record_key", "BINARY"],
          ],
        ],
        [
          "decision_bases",
          [
            ["decision_namespace", "BINARY"],
            ["decision_record_key", "BINARY"],
          ],
        ],
        [
          "decision_supersessions",
          [
            ["superseded_namespace", "BINARY"],
            ["superseded_record_key", "BINARY"],
            ["superseding_namespace", "BINARY"],
            ["superseding_record_key", "BINARY"],
          ],
        ],
      ]);

      for (const [table, expectedShape] of expectedKeyShapes) {
        const indexes = database
          .prepare(`PRAGMA index_list(${table})`)
          .all() as Array<{
          name: string;
          unique: number;
        }>;
        const shapes = indexes.map((index) => {
          const columns = database
            .prepare(`PRAGMA index_xinfo('${index.name}')`)
            .all() as Array<{
            name: string | null;
            coll: string;
            key: number;
          }>;

          return {
            unique: index.unique,
            keys: columns
              .filter((column) => column.key === 1)
              .map((column) => [column.name, column.coll]),
          };
        });

        expect(
          shapes.some(
            (shape) =>
              JSON.stringify(shape.keys) === JSON.stringify(expectedShape),
          ),
        ).toBe(true);
      }
    } finally {
      database.close();
    }
  });

  it("does not enforce self-supersession through a SQL CHECK constraint", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    store.close();
    const database = new DatabaseSync(dbPath);

    expect(() =>
      database
        .prepare(
          `INSERT INTO decision_supersessions (
             superseded_namespace,
             superseded_record_key,
             superseding_namespace,
             superseding_record_key
           ) VALUES (?, ?, ?, ?)`,
        )
        .run("records", "same", "records", "same"),
    ).not.toThrow();
    database.close();
  });

  it("reopens a current valid database", () => {
    const { dbPath } = createTempDatabase();
    const first = new SqliteDecisionStore(dbPath);
    first.close();

    const second = new SqliteDecisionStore(dbPath);
    expect(second.close()).toBeUndefined();
  });

  it.each([
    ["future user_version", { userVersion: 999 }],
    ["foreign application_id", { applicationId: 0x12345678 }],
    ["expected application_id with user_version zero", { userVersion: 0 }],
    ["NOCASE primary address", { recordNamespaceCollation: "NOCASE" as const }],
    ["non-STRICT owned table", { recordStrict: false }],
    ["WITHOUT ROWID owned table", { recordWithoutRowid: true }],
    ["unexpected foreign key", { includeForeignKey: true }],
    ["owned-table trigger", { includeTrigger: true }],
    [
      "unexpected semantics-changing UNIQUE index",
      { includeUnexpectedUniqueIndex: true },
    ],
  ])("rejects candidate schema: %s", (_name, options) => {
    const { dbPath } = createTempDatabase();
    createCandidateSchema(dbPath, options);

    expectSchemaError(() => new SqliteDecisionStore(dbPath));
  });

  it("rejects application_id zero when the database is nonempty", () => {
    const { dbPath } = createTempDatabase();
    const database = new DatabaseSync(dbPath);
    database.exec(`
      CREATE TABLE unrelated (value TEXT) STRICT;
      PRAGMA application_id = 0;
      PRAGMA user_version = 0;
    `);
    database.close();

    expectSchemaError(() => new SqliteDecisionStore(dbPath));
  });

  it("may recreate a missing required non-semantic index", () => {
    const { dbPath } = createTempDatabase();
    createCandidateSchema(dbPath);
    const before = new DatabaseSync(dbPath);
    before.exec("DROP INDEX decision_bases_address_idx");
    before.close();

    const store = new SqliteDecisionStore(dbPath);
    store.close();
    const after = new DatabaseSync(dbPath);
    const indexes = after
      .prepare("PRAGMA index_list(decision_bases)")
      .all() as Array<{
      name: string;
      unique: number;
    }>;
    const hasRequiredShape = indexes.some((index) => {
      if (index.unique !== 0) {
        return false;
      }

      const columns = after
        .prepare(`PRAGMA index_xinfo('${index.name}')`)
        .all() as Array<{
        name: string | null;
        coll: string;
        key: number;
      }>;
      return (
        JSON.stringify(
          columns
            .filter((column) => column.key === 1)
            .map((column) => [column.name, column.coll]),
        ) ===
        JSON.stringify([
          ["decision_namespace", "BINARY"],
          ["decision_record_key", "BINARY"],
        ])
      );
    });
    after.close();

    expect(hasRequiredShape).toBe(true);
  });
});

describe("R13 decision/knowledge SQLite isolation", () => {
  afterEach(cleanupTempDatabases);

  it("does not install or adopt knowledge-store schema in a decision database", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    store.close();
    const database = new DatabaseSync(dbPath);
    const knowledgeTables = database
      .prepare(
        `SELECT name FROM sqlite_schema
         WHERE type = 'table' AND name IN ('kec_chunks', 'index_metadata')`,
      )
      .all();
    database.close();

    expect(knowledgeTables).toEqual([]);
  });

  it("rejects a SqliteKnowledgeStore database instead of adopting or migrating it", async () => {
    const { dbPath } = createTempDatabase("voltai-knowledge-isolation-");
    const knowledgeStore = new SqliteKnowledgeStore(dbPath);
    await knowledgeStore.close();
    const before = new DatabaseSync(dbPath);
    const schemaBefore = before
      .prepare(
        "SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name",
      )
      .all();
    const applicationIdBefore = before.prepare("PRAGMA application_id").get();
    const userVersionBefore = before.prepare("PRAGMA user_version").get();
    before.close();

    expectSchemaError(() => new SqliteDecisionStore(dbPath));

    const after = new DatabaseSync(dbPath);
    const schemaAfter = after
      .prepare(
        "SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name",
      )
      .all();
    const applicationIdAfter = after.prepare("PRAGMA application_id").get();
    const userVersionAfter = after.prepare("PRAGMA user_version").get();
    after.close();

    expect(schemaAfter).toEqual(schemaBefore);
    expect(applicationIdAfter).toEqual(applicationIdBefore);
    expect(userVersionAfter).toEqual(userVersionBefore);
  });
});
