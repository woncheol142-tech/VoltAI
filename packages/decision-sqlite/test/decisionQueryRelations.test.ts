import { afterEach, describe, expect, it } from "vitest";

import type { JsonValue } from "@voltai/knowledge-core";

import type {
  StoredDecisionAddress,
  StoredDecisionSupersession,
} from "../src/index.js";
import { DecisionStoreError, SqliteDecisionStore } from "../src/index.js";
import {
  cleanupTempDatabases,
  createTempDatabase,
  jsonValueCodec,
  stringKeyCodec,
} from "./fixtures/decisionFixtures.js";

type AddressQuery = {
  readonly namespace?: string;
  readonly after?: StoredDecisionAddress;
  readonly limit?: number;
};

type AddressPage = {
  readonly addresses: readonly StoredDecisionAddress[];
  readonly nextCursor: StoredDecisionAddress | null;
};

type SupersessionQuery = {
  readonly superseded?: StoredDecisionAddress;
  readonly superseding?: StoredDecisionAddress;
  readonly after?: StoredDecisionSupersession;
  readonly limit?: number;
};

type SupersessionPage = {
  readonly supersessions: readonly StoredDecisionSupersession[];
  readonly nextCursor: StoredDecisionSupersession | null;
};

type Task79RelationStore = SqliteDecisionStore & {
  listStoredBasisAddresses(query?: AddressQuery): AddressPage;
  listStoredSupersessions(query?: SupersessionQuery): SupersessionPage;
};

function queryStore(store: SqliteDecisionStore): Task79RelationStore {
  return store as unknown as Task79RelationStore;
}

function callBasisList(
  store: SqliteDecisionStore,
  query: unknown,
): AddressPage {
  return (
    store as unknown as {
      listStoredBasisAddresses(value: unknown): AddressPage;
    }
  ).listStoredBasisAddresses(query);
}

function callSupersessionList(
  store: SqliteDecisionStore,
  query: unknown,
): SupersessionPage {
  return (
    store as unknown as {
      listStoredSupersessions(value: unknown): SupersessionPage;
    }
  ).listStoredSupersessions(query);
}

function expectStoreError(
  action: () => unknown,
  category: string,
  field: string,
): void {
  try {
    action();
    throw new Error(`expected ${category}/${field}`);
  } catch (error) {
    expect(error).toBeInstanceOf(DecisionStoreError);
    expect(error).toMatchObject({ category, field });
  }
}

function insertBasis(
  store: SqliteDecisionStore,
  namespace: string,
  recordKey: string,
  basis: JsonValue,
): void {
  store.insertDecisionBasis(
    namespace,
    { decisionRecordId: recordKey, basis },
    stringKeyCodec,
    jsonValueCodec,
  );
}

function insertEdge(
  store: SqliteDecisionStore,
  edge: StoredDecisionSupersession,
): void {
  store.insertDecisionSupersession(
    edge.supersededNamespace,
    edge.supersedingNamespace,
    {
      supersededDecisionRecordId: edge.supersededRecordKey,
      supersedingDecisionRecordId: edge.supersedingRecordKey,
    },
    stringKeyCodec,
    stringKeyCodec,
  );
}

describe("Task79 stored basis discovery RED", () => {
  afterEach(cleanupTempDatabases);

  it("Q12 discovers a DISTINCT dangling basis address with no decision record row", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);

    try {
      insertBasis(store, "dangling", "missing", { source: "first" });
      insertBasis(store, "dangling", "missing", { source: "second" });

      expect(queryStore(store).listStoredBasisAddresses()).toEqual({
        addresses: [{ namespace: "dangling", recordKey: "missing" }],
        nextCursor: null,
      });
      expect(
        store.readDecision(
          "dangling",
          "missing",
          stringKeyCodec,
          jsonValueCodec,
          jsonValueCodec,
        ),
      ).toBeNull();
    } finally {
      store.close();
    }
  });

  it("Q13 preserves exact duplicate basis values after discovering their address", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const duplicate = { source: "same", revision: 7 };

    try {
      insertBasis(store, "dangling", "duplicate", duplicate);
      insertBasis(store, "dangling", "duplicate", duplicate);

      const page = queryStore(store).listStoredBasisAddresses({
        namespace: "dangling",
      });
      expect(page.addresses).toEqual([
        { namespace: "dangling", recordKey: "duplicate" },
      ]);
      expect(
        store.readDecisionBases("dangling", "duplicate", stringKeyCodec),
      ).toEqual([duplicate, duplicate]);
      expect(JSON.stringify(page)).not.toContain("rowid");
    } finally {
      store.close();
    }
  });

  it("paginates DISTINCT basis addresses by exclusive BINARY address cursor", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);

    try {
      for (const [namespace, recordKey] of [
        ["alpha", "one"],
        ["alpha", "two"],
        ["beta", "one"],
        ["beta", "two"],
        ["gamma", "one"],
      ] as const) {
        insertBasis(store, namespace, recordKey, { namespace, recordKey });
        insertBasis(store, namespace, recordKey, { duplicateGroup: true });
      }

      const first = queryStore(store).listStoredBasisAddresses({ limit: 2 });
      expect(first).toEqual({
        addresses: [
          { namespace: "alpha", recordKey: "one" },
          { namespace: "alpha", recordKey: "two" },
        ],
        nextCursor: { namespace: "alpha", recordKey: "two" },
      });
      const second = queryStore(store).listStoredBasisAddresses({
        after: first.nextCursor ?? undefined,
        limit: 2,
      });
      expect(second).toEqual({
        addresses: [
          { namespace: "beta", recordKey: "one" },
          { namespace: "beta", recordKey: "two" },
        ],
        nextCursor: { namespace: "beta", recordKey: "two" },
      });
      const third = queryStore(store).listStoredBasisAddresses({
        after: second.nextCursor ?? undefined,
        limit: 2,
      });
      expect(third).toEqual({
        addresses: [{ namespace: "gamma", recordKey: "one" }],
        nextCursor: null,
      });
    } finally {
      store.close();
    }
  });

  it("rejects basis namespace-filter/cursor mismatch as query/cursor", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);

    try {
      expectStoreError(
        () =>
          queryStore(store).listStoredBasisAddresses({
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

  it.each([null, 3, [], "query"])(
    "validates malformed basis query %# as query/query",
    (query) => {
      const { dbPath } = createTempDatabase();
      const store = new SqliteDecisionStore(dbPath);
      try {
        expectStoreError(() => callBasisList(store, query), "query", "query");
      } finally {
        store.close();
      }
    },
  );

  it.each(["10", NaN, Infinity, 0, -1, 1.5, 1001])(
    "validates malformed basis limit %# as query/page-size",
    (limit) => {
      const { dbPath } = createTempDatabase();
      const store = new SqliteDecisionStore(dbPath);
      try {
        expectStoreError(
          () => callBasisList(store, { limit }),
          "query",
          "page-size",
        );
      } finally {
        store.close();
      }
    },
  );

  it.each([null, 7, [], "cursor"])(
    "validates malformed basis cursor %# as query/cursor",
    (after) => {
      const { dbPath } = createTempDatabase();
      const store = new SqliteDecisionStore(dbPath);
      try {
        expectStoreError(
          () => callBasisList(store, { after }),
          "query",
          "cursor",
        );
      } finally {
        store.close();
      }
    },
  );

  it.each([
    [{ namespace: "records" }, "record-key"],
    [{ namespace: "\ud800", recordKey: "key" }, "namespace"],
    [{ namespace: "records", recordKey: "bad\0key" }, "record-key"],
  ] as const)(
    "validates malformed basis cursor coordinate %# as an address error",
    (after, field) => {
      const { dbPath } = createTempDatabase();
      const store = new SqliteDecisionStore(dbPath);
      try {
        expectStoreError(
          () => callBasisList(store, { after }),
          "address",
          field,
        );
      } finally {
        store.close();
      }
    },
  );
});

describe("Task79 direct stored supersession enumeration RED", () => {
  afterEach(cleanupTempDatabases);

  it("Q14 returns complete dangling direct edges without joining decision records", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const dangling: StoredDecisionSupersession = {
      supersededNamespace: "missing-old-domain",
      supersededRecordKey: "absent-old",
      supersedingNamespace: "missing-new-domain",
      supersedingRecordKey: "absent-new",
    };

    try {
      insertEdge(store, dangling);
      expect(queryStore(store).listStoredSupersessions()).toEqual({
        supersessions: [dangling],
        nextCursor: null,
      });
    } finally {
      store.close();
    }
  });

  it("Q15 enumerates cycle edges once as direct edges without traversal or rejection", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const cycle: StoredDecisionSupersession[] = [
      {
        supersededNamespace: "cycle",
        supersededRecordKey: "A",
        supersedingNamespace: "cycle",
        supersedingRecordKey: "B",
      },
      {
        supersededNamespace: "cycle",
        supersededRecordKey: "B",
        supersedingNamespace: "cycle",
        supersedingRecordKey: "C",
      },
      {
        supersededNamespace: "cycle",
        supersededRecordKey: "C",
        supersedingNamespace: "cycle",
        supersedingRecordKey: "A",
      },
    ];

    try {
      cycle.forEach((edge) => insertEdge(store, edge));
      const page = queryStore(store).listStoredSupersessions({ limit: 1000 });
      expect(page.supersessions).toEqual(cycle);
      expect(page.supersessions).toHaveLength(3);
      expect(page.nextCursor).toBeNull();
    } finally {
      store.close();
    }
  });

  it("Q16 retains all four cross-namespace coordinates and applies independent role filters", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const selected: StoredDecisionSupersession = {
      supersededNamespace: "legacy",
      supersededRecordKey: "shared",
      supersedingNamespace: "modern",
      supersedingRecordKey: "replacement",
    };
    const sameSupersededKeyElsewhere: StoredDecisionSupersession = {
      supersededNamespace: "other-legacy",
      supersededRecordKey: "shared",
      supersedingNamespace: "modern",
      supersedingRecordKey: "replacement",
    };
    const sameSupersedingKeyElsewhere: StoredDecisionSupersession = {
      supersededNamespace: "legacy",
      supersededRecordKey: "shared",
      supersedingNamespace: "other-modern",
      supersedingRecordKey: "replacement",
    };

    try {
      [
        selected,
        sameSupersededKeyElsewhere,
        sameSupersedingKeyElsewhere,
      ].forEach((edge) => insertEdge(store, edge));

      expect(
        queryStore(store).listStoredSupersessions({
          superseded: { namespace: "legacy", recordKey: "shared" },
          superseding: { namespace: "modern", recordKey: "replacement" },
        }).supersessions,
      ).toEqual([selected]);
      expect(
        queryStore(store).listStoredSupersessions({
          superseding: { namespace: "modern", recordKey: "replacement" },
        }).supersessions,
      ).toEqual([selected, sameSupersededKeyElsewhere]);
      expect(Object.keys(selected).sort()).toEqual([
        "supersededNamespace",
        "supersededRecordKey",
        "supersedingNamespace",
        "supersedingRecordKey",
      ]);
    } finally {
      store.close();
    }
  });

  it("orders and paginates by the complete four-coordinate BINARY edge tuple", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const ordered: StoredDecisionSupersession[] = [
      {
        supersededNamespace: "a",
        supersededRecordKey: "1",
        supersedingNamespace: "x",
        supersedingRecordKey: "1",
      },
      {
        supersededNamespace: "a",
        supersededRecordKey: "1",
        supersedingNamespace: "x",
        supersedingRecordKey: "2",
      },
      {
        supersededNamespace: "a",
        supersededRecordKey: "1",
        supersedingNamespace: "y",
        supersedingRecordKey: "1",
      },
      {
        supersededNamespace: "a",
        supersededRecordKey: "2",
        supersedingNamespace: "x",
        supersedingRecordKey: "1",
      },
      {
        supersededNamespace: "b",
        supersededRecordKey: "1",
        supersedingNamespace: "x",
        supersedingRecordKey: "1",
      },
    ];

    try {
      [...ordered].reverse().forEach((edge) => insertEdge(store, edge));
      const first = queryStore(store).listStoredSupersessions({ limit: 2 });
      expect(first.supersessions).toEqual(ordered.slice(0, 2));
      expect(first.nextCursor).toEqual(ordered[1]);

      const second = queryStore(store).listStoredSupersessions({
        after: first.nextCursor ?? undefined,
        limit: 2,
      });
      expect(second.supersessions).toEqual(ordered.slice(2, 4));
      expect(second.nextCursor).toEqual(ordered[3]);

      const final = queryStore(store).listStoredSupersessions({
        after: second.nextCursor ?? undefined,
        limit: 2,
      });
      expect(final.supersessions).toEqual(ordered.slice(4));
      expect(final.nextCursor).toBeNull();
    } finally {
      store.close();
    }
  });

  it.each([
    [
      { superseded: { namespace: "wanted", recordKey: "old" } },
      {
        supersededNamespace: "other",
        supersededRecordKey: "old",
        supersedingNamespace: "new",
        supersedingRecordKey: "next",
      },
    ],
    [
      { superseding: { namespace: "wanted", recordKey: "new" } },
      {
        supersededNamespace: "old",
        supersededRecordKey: "previous",
        supersedingNamespace: "other",
        supersedingRecordKey: "new",
      },
    ],
    [
      {
        superseded: { namespace: "old", recordKey: "previous" },
        superseding: { namespace: "new", recordKey: "next" },
      },
      {
        supersededNamespace: "old",
        supersededRecordKey: "previous",
        supersedingNamespace: "wrong",
        supersedingRecordKey: "next",
      },
    ],
  ] as const)(
    "Q17 rejects a cursor incompatible with its role filter %#",
    (filter, after) => {
      const { dbPath } = createTempDatabase();
      const store = new SqliteDecisionStore(dbPath);

      try {
        expectStoreError(
          () => queryStore(store).listStoredSupersessions({ ...filter, after }),
          "query",
          "cursor",
        );
      } finally {
        store.close();
      }
    },
  );

  it.each([null, 3, [], "query"])(
    "validates malformed supersession query %# as query/query",
    (query) => {
      const { dbPath } = createTempDatabase();
      const store = new SqliteDecisionStore(dbPath);
      try {
        expectStoreError(
          () => callSupersessionList(store, query),
          "query",
          "query",
        );
      } finally {
        store.close();
      }
    },
  );

  it.each(["10", NaN, Infinity, 0, -1, 1.5, 1001])(
    "validates malformed supersession limit %# as query/page-size",
    (limit) => {
      const { dbPath } = createTempDatabase();
      const store = new SqliteDecisionStore(dbPath);
      try {
        expectStoreError(
          () => callSupersessionList(store, { limit }),
          "query",
          "page-size",
        );
      } finally {
        store.close();
      }
    },
  );

  it.each([null, 7, [], "cursor"])(
    "validates malformed supersession cursor %# as query/cursor",
    (after) => {
      const { dbPath } = createTempDatabase();
      const store = new SqliteDecisionStore(dbPath);
      try {
        expectStoreError(
          () => callSupersessionList(store, { after }),
          "query",
          "cursor",
        );
      } finally {
        store.close();
      }
    },
  );

  it("validates a missing supersession cursor coordinate as an endpoint address error", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    try {
      expectStoreError(
        () =>
          callSupersessionList(store, {
            after: {
              supersededNamespace: "old",
              supersededRecordKey: "previous",
              supersedingNamespace: "new",
            },
          }),
        "address",
        "superseding-address",
      );
    } finally {
      store.close();
    }
  });

  it.each([
    [
      "superseded",
      { namespace: "bad\0namespace", recordKey: "old" },
      "superseded-address",
    ],
    [
      "superseding",
      { namespace: "new", recordKey: "\ud800" },
      "superseding-address",
    ],
  ] as const)(
    "validates malformed %s filter coordinates as an address error",
    (role, address, field) => {
      const { dbPath } = createTempDatabase();
      const store = new SqliteDecisionStore(dbPath);
      try {
        expectStoreError(
          () => callSupersessionList(store, { [role]: address }),
          "address",
          field,
        );
      } finally {
        store.close();
      }
    },
  );
});
