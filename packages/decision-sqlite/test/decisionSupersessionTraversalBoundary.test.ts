import { afterEach, describe, expect, it } from "vitest";

import * as decisionSqlite from "../src/index.js";
import {
  currentDecisionSchemaVersion,
  decisionApplicationId,
  SqliteDecisionStore,
} from "../src/index.js";
import {
  cleanupTempDatabases,
  createTempDatabase,
  DatabaseSync,
  DECISION_APPLICATION_ID,
  DECISION_USER_VERSION,
} from "./fixtures/decisionFixtures.js";

type SchemaObject = {
  readonly type: string;
  readonly name: string;
  readonly tbl_name: string;
  readonly sql: string | null;
};

const expectedOwnedTables = [
  "decision_bases",
  "decision_records",
  "decision_supersessions",
] as const;

function schemaObjects(
  database: InstanceType<typeof DatabaseSync>,
): SchemaObject[] {
  return database
    .prepare(
      `SELECT type, name, tbl_name, sql
       FROM sqlite_schema
       WHERE name NOT LIKE 'sqlite_%'
       ORDER BY type COLLATE BINARY, name COLLATE BINARY`,
    )
    .all() as SchemaObject[];
}

function indexKeys(
  database: InstanceType<typeof DatabaseSync>,
  table: string,
): Array<{ unique: number; keys: Array<[string | null, string]> }> {
  const indexes = database
    .prepare("SELECT * FROM pragma_index_list(?)")
    .all(table) as Array<{ name: string; unique: number }>;
  return indexes.map((index) => ({
    unique: index.unique,
    keys: (
      database
        .prepare("SELECT * FROM pragma_index_xinfo(?)")
        .all(index.name) as Array<{
        name: string | null;
        coll: string;
        key: number;
      }>
    )
      .filter((column) => column.key === 1)
      .map((column) => [column.name, column.coll]),
  }));
}

function nestedObjectKeys(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => nestedObjectKeys(item));
  }
  if (typeof value !== "object" || value === null) {
    return [];
  }
  return Object.entries(value).flatMap(([key, nested]) => [
    key,
    ...nestedObjectKeys(nested),
  ]);
}

describe("Task80 public and persistence boundary RED", () => {
  afterEach(cleanupTempDatabases);

  it("Q1 establishes that the required Task80 production capability is missing", () => {
    expect(
      (SqliteDecisionStore.prototype as unknown as Record<string, unknown>)
        .deriveStoredDecisionSupersessionSubgraph,
    ).toBeTypeOf("function");
  });

  it("Q34 introduces no current/latest/active/recommendation/rank/winner API names", () => {
    const names = [
      ...Object.keys(decisionSqlite),
      ...Object.getOwnPropertyNames(SqliteDecisionStore.prototype),
    ];
    const task80Forbidden =
      /^(?:derive|traverse|resolve).*(?:current|latest|active|recommend|rank|winner)/i;
    expect(names.filter((name) => task80Forbidden.test(name))).toEqual([]);
  });

  it("Q35 does not expose traverseDecisionSupersessions", () => {
    expect(
      (SqliteDecisionStore.prototype as unknown as Record<string, unknown>)
        .traverseDecisionSupersessions,
    ).toBeUndefined();
    expect(
      (decisionSqlite as unknown as Record<string, unknown>)
        .traverseDecisionSupersessions,
    ).toBeUndefined();
  });

  it("Q36 requires exactly deriveStoredDecisionSupersessionSubgraph as the Task80 method", () => {
    const prototype = SqliteDecisionStore.prototype as unknown as Record<
      string,
      unknown
    >;
    expect(prototype.deriveStoredDecisionSupersessionSubgraph).toBeTypeOf(
      "function",
    );
    expect(prototype.traverseDecisionSupersessions).toBeUndefined();
  });

  it("Q37 preserves exactly the five existing top-level runtime exports", () => {
    expect(Object.keys(decisionSqlite).sort()).toEqual([
      "DecisionStoreError",
      "SqliteDecisionStore",
      "currentDecisionSchemaVersion",
      "decisionApplicationId",
      "decodeStoredDecision",
    ]);
  });

  it("Q38 adds only the intended Task80 method within the Task80 prototype scope", () => {
    const task80Names = Object.getOwnPropertyNames(
      SqliteDecisionStore.prototype,
    ).filter(
      (name) =>
        name === "deriveStoredDecisionSupersessionSubgraph" ||
        /current|latest|active|winner|recommend|rank|preferred|effective/i.test(
          name,
        ),
    );
    expect(task80Names).toEqual(["deriveStoredDecisionSupersessionSubgraph"]);
  });

  it("Q39 creates no new schema object for Task80", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const database = new DatabaseSync(dbPath);
    try {
      const objects = schemaObjects(database);
      expect(
        objects.map(({ type, name, tbl_name: table }) => ({
          type,
          name,
          table,
        })),
      ).toEqual([
        {
          type: "index",
          name: "decision_bases_address_idx",
          table: "decision_bases",
        },
        {
          type: "index",
          name: "decision_supersessions_superseded_idx",
          table: "decision_supersessions",
        },
        {
          type: "index",
          name: "decision_supersessions_superseding_idx",
          table: "decision_supersessions",
        },
        {
          type: "table",
          name: "decision_bases",
          table: "decision_bases",
        },
        {
          type: "table",
          name: "decision_records",
          table: "decision_records",
        },
        {
          type: "table",
          name: "decision_supersessions",
          table: "decision_supersessions",
        },
      ]);
    } finally {
      database.close();
      store.close();
    }
  });

  it("Q40 preserves decisionApplicationId", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const database = new DatabaseSync(dbPath);
    try {
      expect(decisionApplicationId).toBe(DECISION_APPLICATION_ID);
      expect(database.prepare("PRAGMA application_id").get()).toEqual({
        application_id: DECISION_APPLICATION_ID,
      });
    } finally {
      database.close();
      store.close();
    }
  });

  it("Q41 keeps currentDecisionSchemaVersion at 1", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const database = new DatabaseSync(dbPath);
    try {
      expect(currentDecisionSchemaVersion).toBe(1);
      expect(DECISION_USER_VERSION).toBe(1);
      expect(database.prepare("PRAGMA user_version").get()).toEqual({
        user_version: 1,
      });
    } finally {
      database.close();
      store.close();
    }
  });

  it("Q42 preserves the existing owned BINARY index semantics", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const database = new DatabaseSync(dbPath);
    try {
      expect(indexKeys(database, "decision_records")).toContainEqual({
        unique: 1,
        keys: [
          ["namespace", "BINARY"],
          ["record_key", "BINARY"],
        ],
      });
      expect(indexKeys(database, "decision_bases")).toContainEqual({
        unique: 0,
        keys: [
          ["decision_namespace", "BINARY"],
          ["decision_record_key", "BINARY"],
        ],
      });
      expect(indexKeys(database, "decision_supersessions")).toEqual(
        expect.arrayContaining([
          {
            unique: 1,
            keys: [
              ["superseded_namespace", "BINARY"],
              ["superseded_record_key", "BINARY"],
              ["superseding_namespace", "BINARY"],
              ["superseding_record_key", "BINARY"],
            ],
          },
          {
            unique: 0,
            keys: [
              ["superseded_namespace", "BINARY"],
              ["superseded_record_key", "BINARY"],
            ],
          },
          {
            unique: 0,
            keys: [
              ["superseding_namespace", "BINARY"],
              ["superseding_record_key", "BINARY"],
            ],
          },
        ]),
      );
    } finally {
      database.close();
      store.close();
    }
  });

  it("Q43 introduces no foreign key, trigger, CHECK constraint, or migration", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const database = new DatabaseSync(dbPath);
    try {
      for (const table of expectedOwnedTables) {
        expect(
          database.prepare(`PRAGMA foreign_key_list(${table})`).all(),
        ).toEqual([]);
      }
      const objects = schemaObjects(database);
      expect(objects.filter((object) => object.type === "trigger")).toEqual([]);
      expect(
        objects
          .filter((object) => object.type === "table")
          .some((object) => /\bCHECK\s*\(/i.test(object.sql ?? "")),
      ).toBe(false);
      expect(database.prepare("PRAGMA user_version").get()).toEqual({
        user_version: 1,
      });
    } finally {
      database.close();
      store.close();
    }
  });

  it("Q44 keeps the Task80-specific public surface free of semantic path vocabulary", () => {
    const task80Surface = Object.getOwnPropertyNames(
      SqliteDecisionStore.prototype,
    ).filter((name) => /supersession|subgraph/i.test(name));
    const forbidden =
      /path|chain|history|terminal|current|latest|active|winner|final|effective|preferred|recommended|rank|precedence/i;

    expect(task80Surface).toContain("deriveStoredDecisionSupersessionSubgraph");
    expect(task80Surface.filter((name) => forbidden.test(name))).toEqual([]);
    expect(
      Object.keys(decisionSqlite).filter((name) =>
        /subgraph|travers/i.test(name),
      ),
    ).toEqual([]);

    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    try {
      const result = (
        store as unknown as {
          deriveStoredDecisionSupersessionSubgraph(request: unknown): unknown;
        }
      ).deriveStoredDecisionSupersessionSubgraph({
        seeds: [{ namespace: "decisions", recordKey: "A" }],
        directions: ["toward-superseding"],
        bounds: { maxEdgeHops: 0, maxNodes: 1, maxEdges: 1 },
      });
      expect(
        nestedObjectKeys(result).filter((key) => forbidden.test(key)),
      ).toEqual([]);
    } finally {
      store.close();
    }
  });
});
