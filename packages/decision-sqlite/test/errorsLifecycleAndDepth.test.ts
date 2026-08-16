import { afterEach, describe, expect, it } from "vitest";

import type {
  DecisionRecordKeyCodec,
  DecisionValueCodec,
  JsonValue,
} from "@voltai/knowledge-core";

import { DecisionStoreError, SqliteDecisionStore } from "../src/index.js";
import {
  cleanupTempDatabases,
  createCandidateSchema,
  createDecisionRecord,
  createTempDatabase,
  DatabaseSync,
  insertPhysicalDecision,
  jsonValueCodec,
  stringKeyCodec,
} from "./fixtures/decisionFixtures.js";

function captureError(
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

function expectRedacted(error: Error, ...secrets: string[]): void {
  for (const secret of secrets) {
    expect(error.message).not.toContain(secret);
  }
}

describe("R11 DecisionStoreError categories and redaction", () => {
  afterEach(cleanupTempDatabases);

  it("exports the complete stable category union through observable failures", () => {
    const observed = new Set<string>();
    const observe = (action: () => unknown, category: string) => {
      const error = captureError(action, category);
      observed.add(error.category);
    };

    const addressDb = createTempDatabase().dbPath;
    const addressStore = new SqliteDecisionStore(addressDb);
    observe(
      () =>
        addressStore.insertDecision(
          "bad\0namespace",
          createDecisionRecord(),
          stringKeyCodec,
          jsonValueCodec,
          jsonValueCodec,
        ),
      "address",
    );

    const throwingEncodeCodec: DecisionValueCodec<JsonValue> = {
      encode: () => {
        throw new Error("raw encode failure");
      },
      decode: (value) => value as JsonValue,
    };
    observe(
      () =>
        addressStore.insertDecision(
          "records",
          createDecisionRecord(),
          stringKeyCodec,
          throwingEncodeCodec,
          jsonValueCodec,
        ),
      "codec-encode",
    );
    observe(
      () =>
        addressStore.insertDecision(
          "records",
          createDecisionRecord("invalid", -0),
          stringKeyCodec,
          jsonValueCodec,
          jsonValueCodec,
        ),
      "value-encode",
    );
    addressStore.insertDecision(
      "records",
      createDecisionRecord("conflict", "first"),
      stringKeyCodec,
      jsonValueCodec,
      jsonValueCodec,
    );
    observe(
      () =>
        addressStore.insertDecision(
          "records",
          createDecisionRecord("conflict", "second"),
          stringKeyCodec,
          jsonValueCodec,
          jsonValueCodec,
        ),
      "identity-conflict",
    );
    observe(
      () =>
        addressStore.insertDecisionSupersession(
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
    addressStore.close();
    observe(
      () =>
        addressStore.readDecision(
          "records",
          "closed",
          stringKeyCodec,
          jsonValueCodec,
          jsonValueCodec,
        ),
      "closed",
    );

    const decodeDb = createTempDatabase().dbPath;
    const decodeInitializer = new SqliteDecisionStore(decodeDb);
    decodeInitializer.close();
    insertPhysicalDecision(decodeDb, { selection: "{" });
    const decodeStore = new SqliteDecisionStore(decodeDb);
    observe(
      () =>
        decodeStore.readDecision(
          "records",
          "external",
          stringKeyCodec,
          jsonValueCodec,
          jsonValueCodec,
        ),
      "value-decode",
    );
    decodeStore.close();

    const codecDecodeDb = createTempDatabase().dbPath;
    const codecDecodeStore = new SqliteDecisionStore(codecDecodeDb);
    codecDecodeStore.insertDecision(
      "records",
      createDecisionRecord("decode"),
      stringKeyCodec,
      jsonValueCodec,
      jsonValueCodec,
    );
    const throwingDecodeKeyCodec: DecisionRecordKeyCodec<string> = {
      encode: (value) => value,
      decode: () => {
        throw new Error("raw decode failure");
      },
    };
    observe(
      () =>
        codecDecodeStore.readDecision(
          "records",
          "decode",
          throwingDecodeKeyCodec,
          jsonValueCodec,
          jsonValueCodec,
        ),
      "codec-decode",
    );
    codecDecodeStore.close();

    const schemaDb = createTempDatabase().dbPath;
    createCandidateSchema(schemaDb, { userVersion: 999 });
    observe(() => new SqliteDecisionStore(schemaDb), "schema");

    const storageRoot = createTempDatabase("storage-category-").root;
    observe(() => new SqliteDecisionStore(storageRoot), "storage");

    expect([...observed].sort()).toEqual(
      [
        "address",
        "closed",
        "codec-decode",
        "codec-encode",
        "identity-conflict",
        "schema",
        "self-supersession",
        "storage",
        "value-decode",
        "value-encode",
      ].sort(),
    );
  });

  it("redacts namespace, record key, payload, sentinel, and raw caller codec messages", () => {
    const sentinel = "TOP-SECRET-SENTINEL-78";
    const namespace = `${sentinel}-namespace`;
    const recordKey = `${sentinel}-record-key`;
    const payload = `${sentinel}-payload`;
    const rawCodecMessage = `${sentinel}-raw-caller-codec-error`;
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const invalidKeyCodec: DecisionRecordKeyCodec<string> = {
      encode: () => `${recordKey}\0invalid`,
      decode: String,
    };
    const throwingCodec: DecisionValueCodec<JsonValue> = {
      encode: () => {
        throw new Error(rawCodecMessage);
      },
      decode: (value) => value as JsonValue,
    };

    try {
      expectRedacted(
        captureError(
          () =>
            store.insertDecision(
              namespace,
              createDecisionRecord(recordKey, payload),
              invalidKeyCodec,
              jsonValueCodec,
              jsonValueCodec,
            ),
          "address",
        ),
        sentinel,
        namespace,
        recordKey,
        payload,
      );

      expectRedacted(
        captureError(
          () =>
            store.insertDecision(
              namespace,
              createDecisionRecord(recordKey, payload),
              stringKeyCodec,
              throwingCodec,
              jsonValueCodec,
            ),
          "codec-encode",
        ),
        sentinel,
        namespace,
        recordKey,
        payload,
        rawCodecMessage,
      );

      const invalidPhysicalCodec: DecisionValueCodec<string> = {
        encode: () => ({ secret: payload, invalid: -0 }),
        decode: String,
      };
      expectRedacted(
        captureError(
          () =>
            store.insertDecision(
              namespace,
              {
                id: recordKey,
                decision: { selection: payload, context: payload },
              },
              stringKeyCodec,
              invalidPhysicalCodec,
              invalidPhysicalCodec,
            ),
          "value-encode",
        ),
        sentinel,
        namespace,
        recordKey,
        payload,
      );

      store.insertDecision(
        namespace,
        createDecisionRecord(recordKey, "first"),
        stringKeyCodec,
        jsonValueCodec,
        jsonValueCodec,
      );
      expectRedacted(
        captureError(
          () =>
            store.insertDecision(
              namespace,
              createDecisionRecord(recordKey, payload),
              stringKeyCodec,
              jsonValueCodec,
              jsonValueCodec,
            ),
          "identity-conflict",
        ),
        sentinel,
        namespace,
        recordKey,
        payload,
      );

      expectRedacted(
        captureError(
          () =>
            store.insertDecisionSupersession(
              namespace,
              namespace,
              {
                supersededDecisionRecordId: recordKey,
                supersedingDecisionRecordId: recordKey,
              },
              stringKeyCodec,
              stringKeyCodec,
            ),
          "self-supersession",
        ),
        sentinel,
        namespace,
        recordKey,
      );
    } finally {
      store.close();
    }
  });

  it("redacts raw stored payload and caller decode errors", () => {
    const sentinel = "TOP-SECRET-READ-SENTINEL-78";
    const { dbPath } = createTempDatabase();
    const initializer = new SqliteDecisionStore(dbPath);
    initializer.close();
    insertPhysicalDecision(dbPath, {
      recordKey: "physical",
      selection: `{"${sentinel}"`,
    });
    insertPhysicalDecision(dbPath, {
      recordKey: "codec",
      selection: `"${sentinel}"`,
    });
    const store = new SqliteDecisionStore(dbPath);
    const throwingDecodeCodec: DecisionValueCodec<JsonValue> = {
      encode: (value) => value,
      decode: () => {
        throw new Error(`${sentinel}-raw-decode-error`);
      },
    };

    try {
      expectRedacted(
        captureError(
          () =>
            store.readDecision(
              "records",
              "physical",
              stringKeyCodec,
              jsonValueCodec,
              jsonValueCodec,
            ),
          "value-decode",
        ),
        sentinel,
      );
      expectRedacted(
        captureError(
          () =>
            store.readDecision(
              "records",
              "codec",
              stringKeyCodec,
              throwingDecodeCodec,
              jsonValueCodec,
            ),
          "codec-decode",
        ),
        sentinel,
      );
    } finally {
      store.close();
    }
  });

  it("maps deterministic database-open failure to storage without exposing caller path", () => {
    const { root } = createTempDatabase("TOP-SECRET-PATH-SENTINEL-78-");
    const error = captureError(() => new SqliteDecisionStore(root), "storage");

    expectRedacted(error, root, "TOP-SECRET-PATH-SENTINEL-78");
  });
});

describe("R14 synchronous store lifecycle", () => {
  afterEach(cleanupTempDatabases);

  it("makes close idempotent", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);

    expect(store.close()).toBeUndefined();
    expect(store.close()).toBeUndefined();
  });

  it("throws closed from every data method after close", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    store.close();

    const actions = [
      () =>
        store.insertDecision(
          "records",
          createDecisionRecord(),
          stringKeyCodec,
          jsonValueCodec,
          jsonValueCodec,
        ),
      () =>
        store.readDecision(
          "records",
          "decision-1",
          stringKeyCodec,
          jsonValueCodec,
          jsonValueCodec,
        ),
      () =>
        store.insertDecisionBasis(
          "records",
          { decisionRecordId: "decision-1", basis: "basis" },
          stringKeyCodec,
          jsonValueCodec,
        ),
      () => store.readDecisionBases("records", "decision-1", stringKeyCodec),
      () =>
        store.insertDecisionSupersession(
          "records",
          "records",
          {
            supersededDecisionRecordId: "old",
            supersedingDecisionRecordId: "new",
          },
          stringKeyCodec,
          stringKeyCodec,
        ),
      () => store.readDecisionSupersessions("records", "old", stringKeyCodec),
    ];

    for (const action of actions) {
      captureError(action, "closed");
    }
  });

  it("closes its SQLite handle when constructor schema validation fails", () => {
    const { dbPath } = createTempDatabase();
    createCandidateSchema(dbPath, { userVersion: 999 });
    captureError(() => new SqliteDecisionStore(dbPath), "schema");

    const database = new DatabaseSync(dbPath);
    expect(() => database.exec("BEGIN EXCLUSIVE; ROLLBACK;")).not.toThrow();
    database.close();
  });
});

describe("R15 depth and runtime resource failure normalization", () => {
  afterEach(cleanupTempDatabases);

  it("round-trips an ordinary deeply nested JsonValue", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    let value: JsonValue = "leaf";

    for (let depth = 0; depth < 64; depth += 1) {
      value = { nested: [value] };
    }

    try {
      store.insertDecision(
        "records",
        createDecisionRecord("deep", value),
        stringKeyCodec,
        jsonValueCodec,
        jsonValueCodec,
      );
      expect(
        store.readDecision(
          "records",
          "deep",
          stringKeyCodec,
          jsonValueCodec,
          jsonValueCodec,
        )?.decision.selection,
      ).toEqual(value);
    } finally {
      store.close();
    }
  });

  it("classifies a cycle as value-encode", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;

    try {
      captureError(
        () =>
          store.insertDecision(
            "records",
            createDecisionRecord("cycle", cycle as JsonValue),
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

  it("normalizes a runtime serializer depth failure without freezing a numeric ceiling", () => {
    const { dbPath } = createTempDatabase();
    const store = new SqliteDecisionStore(dbPath);
    const SAFE_MAX_ITERATIONS = 64;
    const NESTING_PER_ITERATION = 128;
    let extreme: JsonValue = null;
    let discoveredFailure: unknown;

    try {
      for (let iteration = 0; iteration < SAFE_MAX_ITERATIONS; iteration += 1) {
        for (let depth = 0; depth < NESTING_PER_ITERATION; depth += 1) {
          extreme = [extreme];
        }

        try {
          JSON.stringify(extreme);
        } catch (error) {
          discoveredFailure = error;
          break;
        }
      }

      if (discoveredFailure === undefined) {
        return;
      }

      expect(discoveredFailure).toBeInstanceOf(Error);
      const error = captureError(
        () =>
          store.insertDecision(
            "records",
            createDecisionRecord("runtime-extreme", extreme),
            stringKeyCodec,
            jsonValueCodec,
            jsonValueCodec,
          ),
        "value-encode",
      );
      expect(error).not.toBeInstanceOf(RangeError);
      expect(error).not.toBeInstanceOf(TypeError);
    } finally {
      store.close();
    }
  });
});
