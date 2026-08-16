import { afterEach, describe, expect, it } from "vitest";

import type { DecisionValueCodec, JsonValue } from "@voltai/knowledge-core";

import type {
  StoredDecisionAddress,
  StoredDecisionRecord,
} from "../src/index.js";
import { DecisionStoreError, SqliteDecisionStore } from "../src/index.js";
import {
  cleanupTempDatabases,
  createDecisionRecord,
  createTempDatabase,
  DatabaseSync,
  jsonValueCodec,
  numberKeyCodec,
  prefixedStringCodec,
  stringKeyCodec,
} from "./fixtures/decisionFixtures.js";

type DecisionQuery = {
  readonly namespace?: string;
  readonly after?: StoredDecisionAddress;
  readonly limit?: number;
};

type DecisionPage = {
  readonly records: readonly StoredDecisionRecord[];
  readonly nextCursor: StoredDecisionAddress | null;
};

type Task79DecisionStore = SqliteDecisionStore & {
  listStoredDecisions(query?: DecisionQuery): DecisionPage;
  readStoredDecision(
    address: StoredDecisionAddress,
  ): StoredDecisionRecord | null;
};

function queryStore(store: SqliteDecisionStore): Task79DecisionStore {
  return store as unknown as Task79DecisionStore;
}

function callList(store: SqliteDecisionStore, query: unknown): DecisionPage {
  return (
    store as unknown as {
      listStoredDecisions(value: unknown): DecisionPage;
    }
  ).listStoredDecisions(query);
}

function expectStoreError(
  action: () => unknown,
  category: string,
  field?: string,
): DecisionStoreError {
  try {
    action();
    throw new Error(`expected ${category}/${field ?? "<none>"}`);
  } catch (error) {
    expect(error).toBeInstanceOf(DecisionStoreError);
    expect(error).toMatchObject(
      field === undefined ? { category } : { category, field },
    );
    return error as DecisionStoreError;
  }
}

function insertRawRecord(
  store: SqliteDecisionStore,
  namespace: string,
  recordKey: string,
  selection: JsonValue = recordKey,
  context: JsonValue = { source: "query-red" },
): void {
  store.insertDecision(
    namespace,
    createDecisionRecord(recordKey, selection, context),
    stringKeyCodec,
    jsonValueCodec,
    jsonValueCodec,
  );
}

describe("Task79 stored decision enumeration RED", () => {
  afterEach(cleanupTempDatabases);

  it("Q1 walks a static data set by cursor and returns every record exactly once", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const expectedAddresses: StoredDecisionAddress[] = [];

    try {
      for (const namespace of ["alpha", "beta", "gamma"]) {
        for (let index = 0; index < 23; index += 1) {
          const recordKey = `record-${String(index).padStart(3, "0")}`;
          insertRawRecord(store, namespace, recordKey, index);
          expectedAddresses.push({ namespace, recordKey });
        }
      }

      const observed: StoredDecisionAddress[] = [];
      let after: StoredDecisionAddress | undefined;
      let pageCount = 0;

      do {
        const page = queryStore(store).listStoredDecisions({
          after,
          limit: 7,
        });
        pageCount += 1;
        observed.push(...page.records.map((record) => record.address));

        if (page.nextCursor === null) {
          after = undefined;
          break;
        }

        expect(page.nextCursor).toEqual(
          page.records[page.records.length - 1]?.address,
        );
        after = page.nextCursor;
      } while (pageCount < 100);

      expect(pageCount).toBe(10);
      expect(observed).toEqual(expectedAddresses);
      expect(new Set(observed.map(JSON.stringify)).size).toBe(
        expectedAddresses.length,
      );
    } finally {
      store.close();
    }
  });

  it("Q2 follows SQLite BINARY UTF-8 order when it differs from JavaScript UTF-16 order", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const astral = "\u{10000}";
    const bmp = "\ue000";

    try {
      insertRawRecord(store, "ordering", astral);
      insertRawRecord(store, "ordering", bmp);

      const javascriptOrder = [astral, bmp].sort();
      expect(javascriptOrder).toEqual([astral, bmp]);

      const database = new DatabaseSync(dbPath);
      const sqliteOrder = database
        .prepare(
          `SELECT record_key
           FROM decision_records
           WHERE namespace = ?
           ORDER BY record_key COLLATE BINARY`,
        )
        .all("ordering") as Array<{ record_key: string }>;
      database.close();

      expect(sqliteOrder.map((row) => row.record_key)).toEqual([bmp, astral]);
      expect(sqliteOrder.map((row) => row.record_key)).not.toEqual(
        javascriptOrder,
      );
      expect(
        queryStore(store)
          .listStoredDecisions({ namespace: "ordering" })
          .records.map((record) => record.address.recordKey),
      ).toEqual([bmp, astral]);
    } finally {
      store.close();
    }
  });

  it("Q3 applies an exact BINARY namespace filter without prefix, LIKE, or case folding", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);

    try {
      for (const namespace of [
        "records",
        "Records",
        "records-child",
        "records%",
        "é",
        "e\u0301",
      ]) {
        insertRawRecord(store, namespace, "same", namespace);
      }

      expect(
        queryStore(store).listStoredDecisions({ namespace: "records" }).records,
      ).toEqual([
        {
          address: { namespace: "records", recordKey: "same" },
          selection: "records",
          context: { source: "query-red" },
        },
      ]);
      expect(
        queryStore(store).listStoredDecisions({ namespace: "é" }).records,
      ).toHaveLength(1);
      expect(
        queryStore(store).listStoredDecisions({ namespace: "e\u0301" }).records,
      ).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it("Q4 uses an exclusive cursor, fetches limit plus one, and returns the last emitted address", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);

    try {
      for (let index = 0; index < 101; index += 1) {
        insertRawRecord(
          store,
          "records",
          `key-${String(index).padStart(3, "0")}`,
        );
      }

      const defaultPage = queryStore(store).listStoredDecisions();
      expect(defaultPage.records).toHaveLength(100);
      expect(defaultPage.nextCursor).toEqual({
        namespace: "records",
        recordKey: "key-099",
      });

      const finalPage = queryStore(store).listStoredDecisions({
        after: defaultPage.nextCursor ?? undefined,
        limit: 1000,
      });
      expect(
        finalPage.records.map((record) => record.address.recordKey),
      ).toEqual(["key-100"]);
      expect(finalPage.nextCursor).toBeNull();

      const exactBoundary = queryStore(store).listStoredDecisions({
        namespace: "records",
        after: { namespace: "records", recordKey: "key-049" },
        limit: 2,
      });
      expect(
        exactBoundary.records.map((record) => record.address.recordKey),
      ).toEqual(["key-050", "key-051"]);
      expect(exactBoundary.nextCursor).toEqual({
        namespace: "records",
        recordKey: "key-051",
      });
    } finally {
      store.close();
    }
  });

  it("Q5 rejects a filtered cursor from another namespace", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);

    try {
      expectStoreError(
        () =>
          queryStore(store).listStoredDecisions({
            namespace: "wanted",
            after: { namespace: "other", recordKey: "cursor" },
          }),
        "query",
        "cursor",
      );
    } finally {
      store.close();
    }
  });

  it.each([null, 17, [], "query"])(
    "Q6 rejects malformed request structure %# as query/query",
    (query) => {
      const { dbPath } = createTempDatabase();
      const store = new SqliteDecisionStore(dbPath);

      try {
        expectStoreError(() => callList(store, query), "query", "query");
      } finally {
        store.close();
      }
    },
  );

  it.each(["10", NaN, Infinity, 0, -1, 1.5, 1001])(
    "Q6 rejects invalid page size %# as query/page-size",
    (limit) => {
      const { dbPath } = createTempDatabase();
      const store = new SqliteDecisionStore(dbPath);

      try {
        expectStoreError(
          () => callList(store, { limit }),
          "query",
          "page-size",
        );
      } finally {
        store.close();
      }
    },
  );

  it.each([null, 7, [], "cursor"])(
    "Q6 rejects malformed cursor container %# as query/cursor",
    (after) => {
      const { dbPath } = createTempDatabase();
      const store = new SqliteDecisionStore(dbPath);

      try {
        expectStoreError(() => callList(store, { after }), "query", "cursor");
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
    "Q6 validates malformed cursor coordinate %# as an address error",
    (after, field) => {
      const { dbPath } = createTempDatabase();
      const store = new SqliteDecisionStore(dbPath);

      try {
        expectStoreError(() => callList(store, { after }), "address", field);
      } finally {
        store.close();
      }
    },
  );

  it("Q7 returns only address, selection, and context with no physical ordering metadata", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);

    try {
      insertRawRecord(store, "records", "opaque", { accepted: true }, [1, 2]);
      const page = queryStore(store).listStoredDecisions({ limit: 1 });
      const record = page.records[0];

      expect(record).toEqual({
        address: { namespace: "records", recordKey: "opaque" },
        selection: { accepted: true },
        context: [1, 2],
      });
      expect(Object.keys(record ?? {}).sort()).toEqual([
        "address",
        "context",
        "selection",
      ]);
      expect(Object.keys(page).sort()).toEqual(["nextCursor", "records"]);
      for (const forbidden of [
        "rowid",
        "timestamp",
        "ordinal",
        "offset",
        "total",
      ]) {
        expect(JSON.stringify(page)).not.toContain(`"${forbidden}"`);
      }
    } finally {
      store.close();
    }
  });

  it("exposes raw readStoredDecision lookup and returns null for a missing address", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);

    try {
      insertRawRecord(store, "records", "present", ["wire"], { revision: 1 });
      expect(
        queryStore(store).readStoredDecision({
          namespace: "records",
          recordKey: "present",
        }),
      ).toEqual({
        address: { namespace: "records", recordKey: "present" },
        selection: ["wire"],
        context: { revision: 1 },
      });
      expect(
        queryStore(store).readStoredDecision({
          namespace: "records",
          recordKey: "missing",
        }),
      ).toBeNull();
    } finally {
      store.close();
    }
  });

  it("Q10 keeps same-namespace heterogeneous value codecs raw on one page", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const objectWireCodec: DecisionValueCodec<{ choice: string }> = {
      encode: ({ choice }) => ({ objectWire: choice }),
      decode: () => {
        throw new Error("enumeration must not decode values");
      },
    };

    try {
      store.insertDecision(
        "mixed",
        { id: "first", decision: { selection: "A", context: "one" } },
        stringKeyCodec,
        prefixedStringCodec,
        prefixedStringCodec,
      );
      store.insertDecision(
        "mixed",
        {
          id: "second",
          decision: { selection: { choice: "B" }, context: { choice: "two" } },
        },
        stringKeyCodec,
        objectWireCodec,
        objectWireCodec,
      );

      expect(
        queryStore(store).listStoredDecisions({ namespace: "mixed" }).records,
      ).toEqual([
        {
          address: { namespace: "mixed", recordKey: "first" },
          selection: "string:A",
          context: "string:one",
        },
        {
          address: { namespace: "mixed", recordKey: "second" },
          selection: { objectWire: "B" },
          context: { objectWire: "two" },
        },
      ]);
    } finally {
      store.close();
    }
  });

  it("Q11 keeps heterogeneous namespaces and encoded key-ID domains raw until caller decode", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);

    try {
      store.insertDecision(
        "numeric-domain",
        { id: 42, decision: { selection: "number", context: null } },
        numberKeyCodec,
        jsonValueCodec,
        jsonValueCodec,
      );
      insertRawRecord(store, "string-domain", "42", "string", null);

      expect(queryStore(store).listStoredDecisions().records).toEqual([
        {
          address: {
            namespace: "numeric-domain",
            recordKey: "number:42",
          },
          selection: "number",
          context: null,
        },
        {
          address: { namespace: "string-domain", recordKey: "42" },
          selection: "string",
          context: null,
        },
      ]);
    } finally {
      store.close();
    }
  });

  it.each([
    ["selection", "{", "value-decode", "selection"],
    ["context", "{", "value-decode", "context"],
  ] as const)(
    "Q19 preserves physical %s corruption as value-decode",
    (column, corruptText, category, field) => {
      const { dbPath } = createTempDatabase();
      const store = new SqliteDecisionStore(dbPath);
      const database = new DatabaseSync(dbPath);

      try {
        database
          .prepare(
            `INSERT INTO decision_records (namespace, record_key, selection, context)
             VALUES (?, ?, ?, ?)`,
          )
          .run(
            "corrupt",
            "record",
            column === "selection" ? corruptText : "null",
            column === "context" ? corruptText : "null",
          );
        database.close();

        expectStoreError(
          () => queryStore(store).listStoredDecisions({ namespace: "corrupt" }),
          category,
          field,
        );
      } finally {
        if (database.isOpen) database.close();
        store.close();
      }
    },
  );

  it("Q19 preserves a physically malformed stored address as address/record-key", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const database = new DatabaseSync(dbPath);

    try {
      database
        .prepare(
          `INSERT INTO decision_records (namespace, record_key, selection, context)
           VALUES (?, ?, ?, ?)`,
        )
        .run("corrupt", "bad\0key", "null", "null");
      database.close();

      expectStoreError(
        () => queryStore(store).listStoredDecisions({ namespace: "corrupt" }),
        "address",
        "record-key",
      );
    } finally {
      if (database.isOpen) database.close();
      store.close();
    }
  });
});
