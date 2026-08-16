import { afterEach, describe, expect, it } from "vitest";

import * as decisionSqlite from "../src/index.js";
import type { StoredDecisionAddress } from "../src/index.js";
import {
  currentDecisionSchemaVersion,
  DecisionStoreError,
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

type Task79BoundaryStore = SqliteDecisionStore & {
  listStoredDecisions(query?: unknown): unknown;
  readStoredDecision(address: StoredDecisionAddress): unknown;
  listStoredBasisAddresses(query?: unknown): unknown;
  listStoredSupersessions(query?: unknown): unknown;
};

type SchemaObject = {
  readonly type: string;
  readonly name: string;
  readonly tbl_name: string;
};

function queryStore(store: SqliteDecisionStore): Task79BoundaryStore {
  return store as unknown as Task79BoundaryStore;
}

function expectStoreError(
  action: () => unknown,
  category: string,
  field?: string,
): void {
  try {
    action();
    throw new Error(`expected ${category}/${field ?? "<none>"}`);
  } catch (error) {
    expect(error).toBeInstanceOf(DecisionStoreError);
    expect(error).toMatchObject(
      field === undefined ? { category } : { category, field },
    );
  }
}

function readSchemaObjects(
  database: InstanceType<typeof DatabaseSync>,
): SchemaObject[] {
  return database
    .prepare(
      `SELECT type, name, tbl_name
       FROM sqlite_schema
       ORDER BY type COLLATE BINARY, name COLLATE BINARY`,
    )
    .all() as SchemaObject[];
}

function readPragmaNumber(
  database: InstanceType<typeof DatabaseSync>,
  pragma: "application_id" | "user_version",
): number {
  return (database.prepare(`PRAGMA ${pragma}`).get() as Record<string, number>)[
    pragma
  ];
}

function indexShapes(
  database: InstanceType<typeof DatabaseSync>,
  table: string,
): Array<{ unique: number; keys: Array<[string | null, string]> }> {
  const indexes = database
    .prepare("SELECT * FROM pragma_index_list(?)")
    .all(table) as Array<{ name: string; unique: number }>;

  return indexes.map((index) => {
    const columns = database
      .prepare("SELECT * FROM pragma_index_xinfo(?)")
      .all(index.name) as Array<{
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
}

describe("Task79 lifecycle and runtime boundary RED", () => {
  afterEach(cleanupTempDatabases);

  it.each([
    [
      "listStoredDecisions",
      (store: Task79BoundaryStore) => store.listStoredDecisions(null),
    ],
    [
      "readStoredDecision",
      (store: Task79BoundaryStore) =>
        store.readStoredDecision(null as unknown as StoredDecisionAddress),
    ],
    [
      "listStoredBasisAddresses",
      (store: Task79BoundaryStore) => store.listStoredBasisAddresses(17),
    ],
    [
      "listStoredSupersessions",
      (store: Task79BoundaryStore) => store.listStoredSupersessions([]),
    ],
  ] as const)(
    "Q18 returns closed before %s query validation",
    (_name, invoke) => {
      const { dbPath } = createTempDatabase();
      const store = new SqliteDecisionStore(dbPath);
      store.close();

      expectStoreError(() => invoke(queryStore(store)), "closed");
    },
  );

  it.each([null, 7, [], "address"])(
    "validates malformed readStoredDecision request %# as query/query",
    (address) => {
      const { dbPath } = createTempDatabase();
      const store = new SqliteDecisionStore(dbPath);

      try {
        expectStoreError(
          () =>
            (
              queryStore(store) as unknown as {
                readStoredDecision(value: unknown): unknown;
              }
            ).readStoredDecision(address),
          "query",
          "query",
        );
      } finally {
        store.close();
      }
    },
  );

  it.each([
    [{ recordKey: "key" }, "namespace"],
    [{ namespace: "records" }, "record-key"],
    [{ namespace: "bad\0namespace", recordKey: "key" }, "namespace"],
    [{ namespace: "records", recordKey: "bad\0key" }, "record-key"],
    [{ namespace: "\ud800", recordKey: "key" }, "namespace"],
    [{ namespace: "records", recordKey: "\udc00" }, "record-key"],
  ] as const)(
    "validates malformed readStoredDecision coordinate %# as an address error",
    (address, field) => {
      const { dbPath } = createTempDatabase();
      const store = new SqliteDecisionStore(dbPath);

      try {
        expectStoreError(
          () =>
            queryStore(store).readStoredDecision(
              address as unknown as StoredDecisionAddress,
            ),
          "address",
          field,
        );
      } finally {
        store.close();
      }
    },
  );
});

describe("Task79 exact public semantic boundary RED", () => {
  it("Q20 exposes exactly the Task78 runtime exports plus decodeStoredDecision", () => {
    expect(Object.keys(decisionSqlite).sort()).toEqual([
      "DecisionStoreError",
      "SqliteDecisionStore",
      "currentDecisionSchemaVersion",
      "decisionApplicationId",
      "decodeStoredDecision",
    ]);
    expect(currentDecisionSchemaVersion).toBe(1);
    expect(typeof decisionSqlite.decodeStoredDecision).toBe("function");
  });

  it("Q20 exposes the exact four-method Task79 store inventory", () => {
    const task79MethodNames = [
      "listStoredBasisAddresses",
      "listStoredDecisions",
      "listStoredSupersessions",
      "readStoredDecision",
    ] as const;

    expect(
      task79MethodNames.filter(
        (name) =>
          typeof (
            SqliteDecisionStore.prototype as unknown as Record<string, unknown>
          )[name] === "function",
      ),
    ).toEqual(task79MethodNames);
  });

  it("Q20 does not expose narrowly enumerated currentness, recommendation, registry, or traversal APIs", () => {
    const runtimeExports = new Set(Object.keys(decisionSqlite));
    const storeMethods = new Set(
      Object.getOwnPropertyNames(SqliteDecisionStore.prototype),
    );
    const forbiddenNames = [
      "currentDecision",
      "latestDecision",
      "activeDecision",
      "recommendedDecision",
      "bestDecision",
      "rankedDecision",
      "lookupDecisionAuthority",
      "resolveDecisionApplicability",
      "registerDecisionNamespace",
      "traverseDecisionSupersessions",
    ];

    for (const name of forbiddenNames) {
      expect(runtimeExports.has(name)).toBe(false);
      expect(storeMethods.has(name)).toBe(false);
    }
    expect(runtimeExports.has("currentDecisionSchemaVersion")).toBe(true);
  });
});

describe("Task79 zero-schema-change boundary RED", () => {
  afterEach(cleanupTempDatabases);

  it("Q21 preserves application id, user version, owned objects, and Task78 index semantics", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const database = new DatabaseSync(dbPath);

    try {
      const before = readSchemaObjects(database);
      const recordIndexesBefore = indexShapes(database, "decision_records");
      const basisIndexesBefore = indexShapes(database, "decision_bases");
      const supersessionIndexesBefore = indexShapes(
        database,
        "decision_supersessions",
      );

      expect(readPragmaNumber(database, "application_id")).toBe(
        DECISION_APPLICATION_ID,
      );
      expect(readPragmaNumber(database, "user_version")).toBe(
        DECISION_USER_VERSION,
      );
      expect(decisionApplicationId).toBe(DECISION_APPLICATION_ID);
      expect(currentDecisionSchemaVersion).toBe(DECISION_USER_VERSION);

      expect(recordIndexesBefore).toContainEqual({
        unique: 1,
        keys: [
          ["namespace", "BINARY"],
          ["record_key", "BINARY"],
        ],
      });
      expect(basisIndexesBefore).toContainEqual({
        unique: 0,
        keys: [
          ["decision_namespace", "BINARY"],
          ["decision_record_key", "BINARY"],
        ],
      });
      expect(supersessionIndexesBefore).toEqual(
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

      const task79 = queryStore(store);
      task79.listStoredDecisions();
      task79.readStoredDecision({ namespace: "records", recordKey: "missing" });
      task79.listStoredBasisAddresses();
      task79.listStoredSupersessions();

      expect(readSchemaObjects(database)).toEqual(before);
      expect(indexShapes(database, "decision_records")).toEqual(
        recordIndexesBefore,
      );
      expect(indexShapes(database, "decision_bases")).toEqual(
        basisIndexesBefore,
      );
      expect(indexShapes(database, "decision_supersessions")).toEqual(
        supersessionIndexesBefore,
      );
      expect(readPragmaNumber(database, "application_id")).toBe(
        DECISION_APPLICATION_ID,
      );
      expect(readPragmaNumber(database, "user_version")).toBe(
        DECISION_USER_VERSION,
      );
    } finally {
      database.close();
      store.close();
    }
  });
});
