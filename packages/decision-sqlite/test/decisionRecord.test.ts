import { afterEach, describe, expect, it } from "vitest";

import type {
  DecisionRecordKeyCodec,
  DecisionValueCodec,
  JsonValue,
} from "@voltai/knowledge-core";

import { DecisionStoreError, SqliteDecisionStore } from "../src/index.js";
import {
  cleanupTempDatabases,
  createDecisionRecord,
  createTempDatabase,
  jsonValueCodec,
  readOwnedRows,
  stringKeyCodec,
} from "./fixtures/decisionFixtures.js";

function expectCategory(
  action: () => unknown,
  category: string,
): DecisionStoreError {
  try {
    action();
    throw new Error(`expected DecisionStoreError category ${category}`);
  } catch (error) {
    expect(error).toBeInstanceOf(DecisionStoreError);
    expect(error).toMatchObject({ category });
    return error as DecisionStoreError;
  }
}

describe("R5 DecisionRecord round trip", () => {
  afterEach(cleanupTempDatabases);

  it("uses the key codec for physical identity and reconstructs id through key.decode", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const keyCodec: DecisionRecordKeyCodec<{ local: number }> = {
      encode: ({ local }) => `encoded:${local}`,
      decode: (value) => ({
        local: Number(String(value).slice("encoded:".length)),
      }),
    };
    const record = {
      id: { local: 17 },
      decision: { selection: "approve", context: { reason: "safe" } },
    };

    try {
      store.insertDecision(
        "records",
        record,
        keyCodec,
        jsonValueCodec,
        jsonValueCodec,
      );

      expect(
        store.readDecision(
          "records",
          { local: 17 },
          keyCodec,
          jsonValueCodec,
          jsonValueCodec,
        ),
      ).toEqual(record);
    } finally {
      store.close();
    }
  });

  it("uses independent selection and context codecs on write and read", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const calls: string[] = [];
    const selectionCodec: DecisionValueCodec<{ selected: string }> = {
      encode: (value) => {
        calls.push("selection.encode");
        return { selectionWire: value.selected };
      },
      decode: (value) => {
        calls.push("selection.decode");
        return {
          selected: String((value as { selectionWire: unknown }).selectionWire),
        };
      },
    };
    const contextCodec: DecisionValueCodec<{ revision: number }> = {
      encode: (value) => {
        calls.push("context.encode");
        return ["context-wire", value.revision];
      },
      decode: (value) => {
        calls.push("context.decode");
        return { revision: Number((value as unknown[])[1]) };
      },
    };
    const record = {
      id: "separate-codecs",
      decision: { selection: { selected: "A" }, context: { revision: 3 } },
    };

    try {
      store.insertDecision(
        "records",
        record,
        stringKeyCodec,
        selectionCodec,
        contextCodec,
      );
      expect(
        store.readDecision(
          "records",
          record.id,
          stringKeyCodec,
          selectionCodec,
          contextCodec,
        ),
      ).toEqual(record);
      expect(calls).toEqual([
        "selection.encode",
        "context.encode",
        "selection.decode",
        "context.decode",
      ]);
    } finally {
      store.close();
    }
  });

  it.each([
    ["primitive values", true, 12],
    [
      "structured values",
      { choice: ["A", "B"] },
      { revision: 4, flags: [true, null] },
    ],
  ] as const)("round-trips %s", (_name, selection, context) => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const record = createDecisionRecord("round-trip", selection, context);

    try {
      store.insertDecision(
        "records",
        record,
        stringKeyCodec,
        jsonValueCodec,
        jsonValueCodec,
      );
      expect(
        store.readDecision(
          "records",
          record.id,
          stringKeyCodec,
          jsonValueCodec,
          jsonValueCodec,
        ),
      ).toEqual(record);
    } finally {
      store.close();
    }
  });

  it("returns null for an unknown full address", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);

    try {
      expect(
        store.readDecision(
          "missing",
          "unknown",
          stringKeyCodec,
          jsonValueCodec,
          jsonValueCodec,
        ),
      ).toBeNull();
    } finally {
      store.close();
    }
  });
});

describe("R6 insert-only DecisionRecord identity policy", () => {
  afterEach(cleanupTempDatabases);

  it("accepts the first insert and an identical physical reinsertion", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const first = createDecisionRecord(
      "stable",
      { selected: "A" },
      { revision: 1 },
    );
    const equivalent = createDecisionRecord(
      "stable",
      { selected: "A" },
      { revision: 1 },
    );

    try {
      expect(
        store.insertDecision(
          "records",
          first,
          stringKeyCodec,
          jsonValueCodec,
          jsonValueCodec,
        ),
      ).toBeUndefined();
      expect(
        store.insertDecision(
          "records",
          equivalent,
          stringKeyCodec,
          jsonValueCodec,
          jsonValueCodec,
        ),
      ).toBeUndefined();
      expect(readOwnedRows(dbPath).decision_records).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it.each([
    ["selection", { selected: "B" }, { revision: 1 }],
    ["context", { selected: "A" }, { revision: 2 }],
  ])(
    "rejects a different physical %s at the same address and preserves the original",
    (_field, selection, context) => {
      const { dbPath } = createTempDatabase();
      const store = new SqliteDecisionStore(dbPath);
      const original = createDecisionRecord(
        "stable",
        { selected: "A" },
        { revision: 1 },
      );

      try {
        store.insertDecision(
          "records",
          original,
          stringKeyCodec,
          jsonValueCodec,
          jsonValueCodec,
        );
        expectCategory(
          () =>
            store.insertDecision(
              "records",
              createDecisionRecord("stable", selection, context),
              stringKeyCodec,
              jsonValueCodec,
              jsonValueCodec,
            ),
          "identity-conflict",
        );

        expect(
          store.readDecision(
            "records",
            "stable",
            stringKeyCodec,
            jsonValueCodec,
            jsonValueCodec,
          ),
        ).toEqual(original);
        expect(readOwnedRows(dbPath).decision_records).toHaveLength(1);
      } finally {
        store.close();
      }
    },
  );
});

describe("R10 failure and transaction safety", () => {
  afterEach(cleanupTempDatabases);

  it("normalizes key codec encode failure before any SQL mutation", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const before = readOwnedRows(dbPath);
    const throwingKeyCodec: DecisionRecordKeyCodec<string> = {
      encode: () => {
        throw new Error("raw-key-codec-secret");
      },
      decode: String,
    };

    try {
      expectCategory(
        () =>
          store.insertDecision(
            "records",
            createDecisionRecord(),
            throwingKeyCodec,
            jsonValueCodec,
            jsonValueCodec,
          ),
        "codec-encode",
      );
      expect(readOwnedRows(dbPath)).toEqual(before);
    } finally {
      store.close();
    }
  });

  it.each(["selection", "context"] as const)(
    "normalizes %s codec encode failure before any SQL mutation",
    (field) => {
      const { dbPath } = createTempDatabase();
      const store = new SqliteDecisionStore(dbPath);
      const before = readOwnedRows(dbPath);
      const throwingCodec: DecisionValueCodec<JsonValue> = {
        encode: () => {
          throw new Error("raw-value-codec-secret");
        },
        decode: (value) => value as JsonValue,
      };

      try {
        expectCategory(
          () =>
            store.insertDecision(
              "records",
              createDecisionRecord(),
              stringKeyCodec,
              field === "selection" ? throwingCodec : jsonValueCodec,
              field === "context" ? throwingCodec : jsonValueCodec,
            ),
          "codec-encode",
        );
        expect(readOwnedRows(dbPath)).toEqual(before);
      } finally {
        store.close();
      }
    },
  );

  it("does not mutate record rows when physical encoding rejects a codec result", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const before = readOwnedRows(dbPath);
    const invalidCodec: DecisionValueCodec<string> = {
      encode: () => ({ nested: -0 }),
      decode: String,
    };

    try {
      expectCategory(
        () =>
          store.insertDecision(
            "records",
            {
              id: "invalid",
              decision: { selection: "input", context: "context" },
            },
            stringKeyCodec,
            invalidCodec,
            invalidCodec,
          ),
        "value-encode",
      );
      expect(readOwnedRows(dbPath)).toEqual(before);
    } finally {
      store.close();
    }
  });

  it("leaves logical owned rows unchanged after identity conflict", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const original = createDecisionRecord("stable", "first", { revision: 1 });

    try {
      store.insertDecision(
        "records",
        original,
        stringKeyCodec,
        jsonValueCodec,
        jsonValueCodec,
      );
      const before = readOwnedRows(dbPath);
      expectCategory(
        () =>
          store.insertDecision(
            "records",
            createDecisionRecord("stable", "second", { revision: 1 }),
            stringKeyCodec,
            jsonValueCodec,
            jsonValueCodec,
          ),
        "identity-conflict",
      );
      expect(readOwnedRows(dbPath)).toEqual(before);
    } finally {
      store.close();
    }
  });
});
