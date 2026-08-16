import { afterEach, describe, expect, it } from "vitest";

import type { DecisionRecordKeyCodec, JsonValue } from "@voltai/knowledge-core";

import { DecisionStoreError, SqliteDecisionStore } from "../src/index.js";
import {
  cleanupTempDatabases,
  createDecisionRecord,
  createTempDatabase,
  DatabaseSync,
  insertPhysicalDecision,
  jsonValueCodec,
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

function keyCodecReturning(encodedKey: string): DecisionRecordKeyCodec<string> {
  return {
    encode: () => encodedKey,
    decode: (value) => String(value),
  };
}

describe("R1-R2 decision address fidelity", () => {
  afterEach(cleanupTempDatabases);

  it("accepts empty namespace and empty encoded key", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const emptyKeyCodec = keyCodecReturning("");

    try {
      store.insertDecision(
        "",
        createDecisionRecord("ignored"),
        emptyKeyCodec,
        jsonValueCodec,
        jsonValueCodec,
      );

      expect(
        store.readDecision(
          "",
          "ignored",
          emptyKeyCodec,
          jsonValueCodec,
          jsonValueCodec,
        ),
      ).toEqual(createDecisionRecord("", "approve", { revision: 1 }));
    } finally {
      store.close();
    }
  });

  it.each([
    ["NUL namespace", "bad\0namespace", stringKeyCodec],
    ["NUL encoded key", "records", keyCodecReturning("bad\0key")],
    ["lone high surrogate namespace", "bad\ud800", stringKeyCodec],
    ["lone low surrogate namespace", "bad\udc00", stringKeyCodec],
    [
      "lone high surrogate encoded key",
      "records",
      keyCodecReturning("bad\ud800"),
    ],
    [
      "lone low surrogate encoded key",
      "records",
      keyCodecReturning("bad\udc00"),
    ],
  ])("rejects %s as address", (_name, namespace, keyCodec) => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);

    try {
      expectCategory(
        () =>
          store.insertDecision(
            namespace,
            createDecisionRecord(),
            keyCodec,
            jsonValueCodec,
            jsonValueCodec,
          ),
        "address",
      );
    } finally {
      store.close();
    }
  });

  it.each([
    ["valid surrogate pair", "pair-\ud83d\ude80"],
    ["astral character", "astral-🚀"],
  ])("accepts %s in both address components", (_name, text) => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const keyCodec = keyCodecReturning(text);

    try {
      store.insertDecision(
        text,
        createDecisionRecord(),
        keyCodec,
        jsonValueCodec,
        jsonValueCodec,
      );
      expect(
        store.readDecision(
          text,
          "ignored",
          keyCodec,
          jsonValueCodec,
          jsonValueCodec,
        ),
      ).not.toBeNull();
    } finally {
      store.close();
    }
  });

  it("validates surrogates without depending on String.prototype.isWellFormed", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const descriptor = Object.getOwnPropertyDescriptor(
      String.prototype,
      "isWellFormed",
    );
    Object.defineProperty(String.prototype, "isWellFormed", {
      configurable: true,
      value: () => {
        throw new Error("isWellFormed must not be called");
      },
    });

    try {
      store.insertDecision(
        "🚀",
        createDecisionRecord(),
        stringKeyCodec,
        jsonValueCodec,
        jsonValueCodec,
      );
      expect(
        store.readDecision(
          "🚀",
          "decision-1",
          stringKeyCodec,
          jsonValueCodec,
          jsonValueCodec,
        ),
      ).not.toBeNull();
      expectCategory(
        () =>
          store.insertDecision(
            "\ud800",
            createDecisionRecord("invalid-under-shadow"),
            stringKeyCodec,
            jsonValueCodec,
            jsonValueCodec,
          ),
        "address",
      );
    } finally {
      store.close();
      if (descriptor === undefined) {
        delete (String.prototype as { isWellFormed?: unknown }).isWellFormed;
      } else {
        Object.defineProperty(String.prototype, "isWellFormed", descriptor);
      }
    }
  });

  it("keeps concatenation-ambiguous address pairs distinct", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);

    try {
      store.insertDecision(
        "ab",
        createDecisionRecord("c", "first"),
        stringKeyCodec,
        jsonValueCodec,
        jsonValueCodec,
      );
      store.insertDecision(
        "a",
        createDecisionRecord("bc", "second"),
        stringKeyCodec,
        jsonValueCodec,
        jsonValueCodec,
      );

      expect(
        store.readDecision(
          "ab",
          "c",
          stringKeyCodec,
          jsonValueCodec,
          jsonValueCodec,
        )?.decision.selection,
      ).toBe("first");
      expect(
        store.readDecision(
          "a",
          "bc",
          stringKeyCodec,
          jsonValueCodec,
          jsonValueCodec,
        )?.decision.selection,
      ).toBe("second");
    } finally {
      store.close();
    }
  });

  it("uses exact BINARY identity without normalization, trimming, or case folding", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const addresses = [
      ["A", "same"],
      ["a", "same"],
      ["shared-one", "same"],
      ["shared-two", "same"],
      ["é", "key"],
      ["e\u0301", "key"],
      [" padded", "key"],
      ["padded", "key"],
    ] as const;

    try {
      addresses.forEach(([namespace, key], index) => {
        store.insertDecision(
          namespace,
          createDecisionRecord(key, index),
          stringKeyCodec,
          jsonValueCodec,
          jsonValueCodec,
        );
      });

      expect(
        addresses.map(
          ([namespace, key]) =>
            store.readDecision(
              namespace,
              key,
              stringKeyCodec,
              jsonValueCodec,
              jsonValueCodec,
            )?.decision.selection,
        ),
      ).toEqual(addresses.map((_address, index) => index));
    } finally {
      store.close();
    }
  });
});

describe("R3 write-side physical JsonValue fidelity", () => {
  afterEach(cleanupTempDatabases);

  const invalidNumbers = [NaN, Infinity, -Infinity, -0];

  it.each(invalidNumbers)("rejects the root number %s", (value) => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);

    try {
      expectCategory(
        () =>
          store.insertDecision(
            "records",
            createDecisionRecord("invalid", value),
            stringKeyCodec,
            jsonValueCodec,
            jsonValueCodec,
          ),
        "value-encode",
      );
    } finally {
      store.close();
    }
  });

  it.each(invalidNumbers)("rejects the nested number %s", (value) => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);

    try {
      expectCategory(
        () =>
          store.insertDecision(
            "records",
            createDecisionRecord("invalid", { nested: [value] }),
            stringKeyCodec,
            jsonValueCodec,
            jsonValueCodec,
          ),
        "value-encode",
      );
    } finally {
      store.close();
    }
  });

  it("accepts null, strings, booleans, finite numbers including +0, dense arrays, and ordinary objects", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const values: JsonValue[] = [
      null,
      "text",
      true,
      false,
      42.5,
      +0,
      [1, "two", null],
      { plain: [true, 3] },
    ];

    try {
      values.forEach((value, index) => {
        store.insertDecision(
          "records",
          createDecisionRecord(`valid-${index}`, value),
          stringKeyCodec,
          jsonValueCodec,
          jsonValueCodec,
        );
      });

      const roundTripped = values.map(
        (_value, index) =>
          store.readDecision(
            "records",
            `valid-${index}`,
            stringKeyCodec,
            jsonValueCodec,
            jsonValueCodec,
          )?.decision.selection,
      );
      expect(roundTripped).toEqual(values);
      expect(Object.is(roundTripped[5], +0)).toBe(true);
    } finally {
      store.close();
    }
  });

  it("round-trips an own __proto__ data key without prototype pollution", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const value: Record<string, JsonValue> = { safe: true };
    Object.defineProperty(value, "__proto__", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: { polluted: true },
    });

    try {
      store.insertDecision(
        "records",
        createDecisionRecord("proto", value),
        stringKeyCodec,
        jsonValueCodec,
        jsonValueCodec,
      );
      const result = store.readDecision(
        "records",
        "proto",
        stringKeyCodec,
        jsonValueCodec,
        jsonValueCodec,
      )?.decision.selection as Record<string, JsonValue>;

      expect(Object.prototype.hasOwnProperty.call(result, "__proto__")).toBe(
        true,
      );
      expect(result.__proto__).toEqual({ polluted: true });
      expect(
        (Object.prototype as { polluted?: boolean }).polluted,
      ).toBeUndefined();
    } finally {
      store.close();
    }
  });

  it("stores the exact JSON.stringify output in SQLite TEXT columns", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const selection = { ordered: [1, true, null], text: "exact" };
    const context = ["context", { revision: 2 }];

    store.insertDecision(
      "records",
      createDecisionRecord("physical", selection, context),
      stringKeyCodec,
      jsonValueCodec,
      jsonValueCodec,
    );
    store.close();

    const database = new DatabaseSync(dbPath);
    const row = database
      .prepare(
        `SELECT selection, context,
                typeof(selection) AS selection_type,
                typeof(context) AS context_type
         FROM decision_records
         WHERE namespace = ? AND record_key = ?`,
      )
      .get("records", "physical");
    database.close();

    expect(row).toEqual({
      selection: JSON.stringify(selection),
      context: JSON.stringify(context),
      selection_type: "text",
      context_type: "text",
    });
  });

  it.each([
    ["undefined root", undefined],
    ["undefined nested", { invalid: undefined }],
    ["bigint root", 1n],
    ["bigint nested", { invalid: 1n }],
    ["function root", () => true],
    ["function nested", { invalid: () => true }],
    ["symbol root", Symbol("invalid")],
    ["symbol nested", { invalid: Symbol("invalid") }],
    ["Date", new Date("2026-01-01T00:00:00.000Z")],
    ["Map", new Map([["key", "value"]])],
    ["Set", new Set(["value"])],
    [
      "class instance",
      new (class Example {
        value = "data";
      })(),
    ],
    [
      "null-prototype object",
      Object.assign(Object.create(null), { value: "data" }),
    ],
  ])("rejects JSON-silent transformation shape: %s", (name, value) => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const record = createDecisionRecord("invalid", value as JsonValue);

    if (name === "undefined root") {
      record.decision.selection = undefined as unknown as JsonValue;
      expect(record.decision.selection).toBeUndefined();
    }

    try {
      expectCategory(
        () =>
          store.insertDecision(
            "records",
            record,
            stringKeyCodec,
            jsonValueCodec,
            jsonValueCodec,
          ),
        "value-encode",
      );
    } finally {
      store.close();
    }
  });

  it("rejects accessors without accepting their transformed result", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const value = {} as Record<string, JsonValue>;
    Object.defineProperty(value, "secret", {
      enumerable: true,
      get: () => "transformed",
      set: () => undefined,
    });

    try {
      expectCategory(
        () =>
          store.insertDecision(
            "records",
            createDecisionRecord("invalid", value),
            stringKeyCodec,
            jsonValueCodec,
            jsonValueCodec,
          ),
        "value-encode",
      );
    } finally {
      store.close();
    }
  });

  it.each([true, false])(
    "rejects an array extra %s enumerable property",
    (enumerable) => {
      const { dbPath } = createTempDatabase();
      const store = new SqliteDecisionStore(dbPath);
      const value: JsonValue[] = ["ordinary"];
      Object.defineProperty(value, "extra", { enumerable, value: "hidden" });

      try {
        expectCategory(
          () =>
            store.insertDecision(
              "records",
              createDecisionRecord("invalid", value),
              stringKeyCodec,
              jsonValueCodec,
              jsonValueCodec,
            ),
          "value-encode",
        );
      } finally {
        store.close();
      }
    },
  );

  it("rejects sparse arrays, object non-enumerable properties, symbol properties, toJSON, and cycles", () => {
    const cases: unknown[] = [];
    const sparse = new Array(2) as JsonValue[];
    sparse[1] = "present";
    cases.push(sparse);

    const nonEnumerable = { visible: true };
    Object.defineProperty(nonEnumerable, "hidden", { value: true });
    cases.push(nonEnumerable);

    const symbolProperty = { visible: true } as Record<PropertyKey, unknown>;
    symbolProperty[Symbol("hidden")] = true;
    cases.push(symbolProperty);

    cases.push({ value: "original", toJSON: () => ({ value: "transformed" }) });

    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    cases.push(cycle);

    for (const [index, value] of cases.entries()) {
      const { dbPath } = createTempDatabase();
      const store = new SqliteDecisionStore(dbPath);
      try {
        expectCategory(
          () =>
            store.insertDecision(
              "records",
              createDecisionRecord(`invalid-${index}`, value as JsonValue),
              stringKeyCodec,
              jsonValueCodec,
              jsonValueCodec,
            ),
          "value-encode",
        );
      } finally {
        store.close();
      }
    }
  });
});

describe("R4 read-side physical JSON fidelity", () => {
  afterEach(cleanupTempDatabases);

  it.each([
    ["malformed JSON", "{"],
    ["positive overflow", "1e400"],
    ["negative overflow", "-1e400"],
    ["negative zero", "-0"],
    ["underflow", "1e-4000"],
    ["unsafe integer spelling", "9007199254740993"],
    ["duplicate object keys", '{"key":1,"key":2}'],
    ["added whitespace", '{"key":1 }'],
    ["unstable decimal spelling", "1.0"],
    ["unstable exponent spelling", "1E4"],
  ])("rejects externally stored %s", (_name, physicalSelection) => {
    const { dbPath } = createTempDatabase();
    const initializer = new SqliteDecisionStore(dbPath);
    initializer.close();
    insertPhysicalDecision(dbPath, { selection: physicalSelection });
    const store = new SqliteDecisionStore(dbPath);

    try {
      expectCategory(
        () =>
          store.readDecision(
            "records",
            "external",
            stringKeyCodec,
            jsonValueCodec,
            jsonValueCodec,
          ),
        "value-decode",
      );
    } finally {
      store.close();
    }
  });

  it("accepts only the round-trip-stable fixed-point physical spelling", () => {
    const { dbPath } = createTempDatabase();
    const initializer = new SqliteDecisionStore(dbPath);
    initializer.close();
    const physicalSelection = JSON.stringify({ exact: [1, 10_000, "text"] });
    insertPhysicalDecision(dbPath, { selection: physicalSelection });
    const store = new SqliteDecisionStore(dbPath);

    try {
      expect(
        store.readDecision(
          "records",
          "external",
          stringKeyCodec,
          jsonValueCodec,
          jsonValueCodec,
        )?.decision.selection,
      ).toEqual({ exact: [1, 10_000, "text"] });
    } finally {
      store.close();
    }
  });
});
