import { afterEach, describe, expect, it } from "vitest";

import type { DecisionValueCodec } from "@voltai/knowledge-core";

import type { StoredDecisionSupersession } from "../src/index.js";
import { DecisionStoreError, SqliteDecisionStore } from "../src/index.js";
import {
  cleanupTempDatabases,
  createDecisionRecord,
  createTempDatabase,
  jsonValueCodec,
  numberKeyCodec,
  prefixedStringCodec,
  readOwnedRows,
  stringKeyCodec,
} from "./fixtures/decisionFixtures.js";

function expectCategory(action: () => unknown, category: string): void {
  try {
    action();
    throw new Error(`expected DecisionStoreError category ${category}`);
  } catch (error) {
    expect(error).toBeInstanceOf(DecisionStoreError);
    expect(error).toMatchObject({ category });
  }
}

describe("R7 DecisionBasis multiplicity and codec heterogeneity", () => {
  afterEach(cleanupTempDatabases);

  it("stores different basis values encoded by different codecs and reads raw JsonValue values", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const objectCodec: DecisionValueCodec<{ source: string }> = {
      encode: ({ source }) => ({ codec: "object", source }),
      decode: () => {
        throw new Error("basis reads must not invoke caller decoders");
      },
    };

    try {
      store.insertDecisionBasis(
        "records",
        { decisionRecordId: "decision-1", basis: "manual" },
        stringKeyCodec,
        prefixedStringCodec,
      );
      store.insertDecisionBasis(
        "records",
        { decisionRecordId: "decision-1", basis: { source: "calculation" } },
        stringKeyCodec,
        objectCodec,
      );

      const bases = store.readDecisionBases(
        "records",
        "decision-1",
        stringKeyCodec,
      );
      expect(bases).toHaveLength(2);
      expect(bases).toEqual(
        expect.arrayContaining([
          "string:manual",
          { codec: "object", source: "calculation" },
        ]),
      );
    } finally {
      store.close();
    }
  });

  it("preserves two different basis assertions", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);

    try {
      store.insertDecisionBasis(
        "records",
        { decisionRecordId: "decision-1", basis: { source: "A" } },
        stringKeyCodec,
        jsonValueCodec,
      );
      store.insertDecisionBasis(
        "records",
        { decisionRecordId: "decision-1", basis: { source: "B" } },
        stringKeyCodec,
        jsonValueCodec,
      );

      const bases = store.readDecisionBases(
        "records",
        "decision-1",
        stringKeyCodec,
      );
      expect(bases).toHaveLength(2);
      expect(bases).toEqual(
        expect.arrayContaining([{ source: "A" }, { source: "B" }]),
      );
    } finally {
      store.close();
    }
  });

  it("preserves multiplicity when the exact same basis assertion is inserted twice", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const assertion = { source: "same", page: 7 };

    try {
      store.insertDecisionBasis(
        "records",
        { decisionRecordId: "decision-1", basis: assertion },
        stringKeyCodec,
        jsonValueCodec,
      );
      store.insertDecisionBasis(
        "records",
        { decisionRecordId: "decision-1", basis: assertion },
        stringKeyCodec,
        jsonValueCodec,
      );

      const bases = store.readDecisionBases(
        "records",
        "decision-1",
        stringKeyCodec,
      );
      expect(bases).toEqual([assertion, assertion]);
      expect(bases).toHaveLength(2);
      expect(readOwnedRows(dbPath).decision_bases).toHaveLength(2);
      expect(
        bases.every(
          (basis) => !Object.prototype.hasOwnProperty.call(basis, "rowid"),
        ),
      ).toBe(true);
    } finally {
      store.close();
    }
  });

  it("normalizes basis codec encode failures before any basis row mutation", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const throwingCodec: DecisionValueCodec<string> = {
      encode: () => {
        throw new Error("raw-basis-codec-secret");
      },
      decode: String,
    };

    try {
      const before = readOwnedRows(dbPath);
      expectCategory(
        () =>
          store.insertDecisionBasis(
            "records",
            { decisionRecordId: "decision-1", basis: "invalid" },
            stringKeyCodec,
            throwingCodec,
          ),
        "codec-encode",
      );
      expect(readOwnedRows(dbPath)).toEqual(before);
    } finally {
      store.close();
    }
  });

  it("does not mutate basis rows when physical encoding rejects a codec result", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const invalidCodec: DecisionValueCodec<string> = {
      encode: () => ({ invalid: -0 }),
      decode: String,
    };

    try {
      const before = readOwnedRows(dbPath);
      expectCategory(
        () =>
          store.insertDecisionBasis(
            "records",
            { decisionRecordId: "decision-1", basis: "invalid" },
            stringKeyCodec,
            invalidCodec,
          ),
        "value-encode",
      );
      expect(readOwnedRows(dbPath)).toEqual(before);
    } finally {
      store.close();
    }
  });
});

describe("R8 typed DecisionSupersession persistence", () => {
  afterEach(cleanupTempDatabases);

  it("preserves independent endpoint namespaces and heterogeneous encoded key types", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const relation = {
      supersededDecisionRecordId: 41,
      supersedingDecisionRecordId: "replacement",
    };
    const expected: StoredDecisionSupersession = {
      supersededNamespace: "legacy-decisions",
      supersededRecordKey: "number:41",
      supersedingNamespace: "new-decisions",
      supersedingRecordKey: "replacement",
    };

    try {
      store.insertDecisionSupersession(
        "legacy-decisions",
        "new-decisions",
        relation,
        numberKeyCodec,
        stringKeyCodec,
      );

      expect(
        store.readDecisionSupersessions("legacy-decisions", 41, numberKeyCodec),
      ).toEqual([expected]);
      expect(
        store.readDecisionSupersessions(
          "new-decisions",
          "replacement",
          stringKeyCodec,
        ),
      ).toEqual([expected]);
    } finally {
      store.close();
    }
  });

  it("returns a far endpoint in an unexpected third namespace without filtering it", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);

    try {
      store.insertDecisionSupersession(
        "expected",
        "unexpected-third-namespace",
        {
          supersededDecisionRecordId: "old",
          supersedingDecisionRecordId: "new",
        },
        stringKeyCodec,
        stringKeyCodec,
      );

      expect(
        store.readDecisionSupersessions("expected", "old", stringKeyCodec),
      ).toEqual([
        {
          supersededNamespace: "expected",
          supersededRecordKey: "old",
          supersedingNamespace: "unexpected-third-namespace",
          supersedingRecordKey: "new",
        },
      ]);
    } finally {
      store.close();
    }
  });

  it("treats an exact duplicate edge as an idempotent no-op stored once", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const relation = {
      supersededDecisionRecordId: "old",
      supersedingDecisionRecordId: "new",
    };

    try {
      store.insertDecisionSupersession(
        "records",
        "records",
        relation,
        stringKeyCodec,
        stringKeyCodec,
      );
      expect(
        store.insertDecisionSupersession(
          "records",
          "records",
          relation,
          stringKeyCodec,
          stringKeyCodec,
        ),
      ).toBeUndefined();

      expect(
        store.readDecisionSupersessions("records", "old", stringKeyCodec),
      ).toHaveLength(1);
      expect(readOwnedRows(dbPath).decision_supersessions).toHaveLength(1);
    } finally {
      store.close();
    }
  });
});

describe("R9 relation policy", () => {
  afterEach(cleanupTempDatabases);

  it("rejects self-supersession by the same full physical address", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);

    try {
      expectCategory(
        () =>
          store.insertDecisionSupersession(
            "records",
            "records",
            {
              supersededDecisionRecordId: "same",
              supersedingDecisionRecordId: "same",
            },
            stringKeyCodec,
            stringKeyCodec,
          ),
        "self-supersession",
      );
      expect(readOwnedRows(dbPath).decision_supersessions).toHaveLength(0);
    } finally {
      store.close();
    }
  });

  it("does not treat the same encoded key under different namespaces as a self-edge", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);

    try {
      expect(
        store.insertDecisionSupersession(
          "first",
          "second",
          {
            supersededDecisionRecordId: "same",
            supersedingDecisionRecordId: "same",
          },
          stringKeyCodec,
          stringKeyCodec,
        ),
      ).toBeUndefined();
      expect(readOwnedRows(dbPath).decision_supersessions).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it("permits dangling basis and dangling supersession relations", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);

    try {
      store.insertDecisionBasis(
        "missing-records",
        { decisionRecordId: "absent", basis: { external: true } },
        stringKeyCodec,
        jsonValueCodec,
      );
      store.insertDecisionSupersession(
        "missing-records",
        "also-missing",
        {
          supersededDecisionRecordId: "absent-old",
          supersedingDecisionRecordId: "absent-new",
        },
        stringKeyCodec,
        stringKeyCodec,
      );

      expect(
        store.readDecisionBases("missing-records", "absent", stringKeyCodec),
      ).toEqual([{ external: true }]);
      expect(
        store.readDecisionSupersessions(
          "missing-records",
          "absent-old",
          stringKeyCodec,
        ),
      ).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it.each([
    ["two-node", ["A", "B"]],
    ["three-node", ["A", "B", "C"]],
  ] as const)("permits a %s supersession cycle", (_name, nodes) => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);

    try {
      nodes.forEach((node, index) => {
        const next = nodes[(index + 1) % nodes.length];
        store.insertDecisionSupersession(
          "records",
          "records",
          {
            supersededDecisionRecordId: node,
            supersedingDecisionRecordId: next,
          },
          stringKeyCodec,
          stringKeyCodec,
        );
      });

      expect(readOwnedRows(dbPath).decision_supersessions).toHaveLength(
        nodes.length,
      );
    } finally {
      store.close();
    }
  });

  it("does not impose currentness: all records and both edge directions remain observable", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);

    try {
      for (const id of ["old", "current"]) {
        store.insertDecision(
          "records",
          createDecisionRecord(id, id),
          stringKeyCodec,
          jsonValueCodec,
          jsonValueCodec,
        );
      }
      store.insertDecisionSupersession(
        "records",
        "records",
        {
          supersededDecisionRecordId: "old",
          supersedingDecisionRecordId: "current",
        },
        stringKeyCodec,
        stringKeyCodec,
      );

      expect(
        store.readDecision(
          "records",
          "old",
          stringKeyCodec,
          jsonValueCodec,
          jsonValueCodec,
        ),
      ).not.toBeNull();
      expect(
        store.readDecision(
          "records",
          "current",
          stringKeyCodec,
          jsonValueCodec,
          jsonValueCodec,
        ),
      ).not.toBeNull();
      expect(
        store.readDecisionSupersessions("records", "old", stringKeyCodec),
      ).toHaveLength(1);
      expect(
        store.readDecisionSupersessions("records", "current", stringKeyCodec),
      ).toHaveLength(1);
    } finally {
      store.close();
    }
  });
});
