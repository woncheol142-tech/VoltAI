import { describe, expect, it, vi } from "vitest";

import type {
  DecisionRecord,
  DecisionRecordKeyCodec,
  DecisionValueCodec,
  JsonValue,
} from "@voltai/knowledge-core";

import * as decisionSqlite from "../src/index.js";
import type {
  DecisionIdentityNamespace,
  DecisionRecordValueCodecs,
  StoredDecisionRecord,
} from "../src/index.js";
import { DecisionStoreError } from "../src/index.js";

type DecodeStoredDecision = <
  TId extends NonNullable<unknown>,
  TSelection,
  TContext,
>(
  record: StoredDecisionRecord,
  identity: DecisionIdentityNamespace<TId>,
  codecs: DecisionRecordValueCodecs<TSelection, TContext>,
) => DecisionRecord<TId, TSelection, TContext>;

const decodeStoredDecision = (
  decisionSqlite as unknown as { decodeStoredDecision: DecodeStoredDecision }
).decodeStoredDecision;

function expectStoreError(
  action: () => unknown,
  category: string,
  field: string,
): DecisionStoreError {
  try {
    action();
    throw new Error(`expected ${category}/${field}`);
  } catch (error) {
    expect(error).toBeInstanceOf(DecisionStoreError);
    expect(error).toMatchObject({ category, field });
    return error as DecisionStoreError;
  }
}

const identity: DecisionIdentityNamespace<number> = {
  namespace: "decisions",
  keyCodec: {
    encode: (value) => `id:${value}`,
    decode: (value) => {
      if (!value.startsWith("id:")) throw new Error("not a numeric id");
      return Number(value.slice(3));
    },
  },
};

const valueCodecs: DecisionRecordValueCodecs<
  { choice: string },
  { revision: number }
> = {
  selection: {
    encode: ({ choice }) => ({ choiceWire: choice }),
    decode: (value) => ({
      choice: String((value as { choiceWire: unknown }).choiceWire),
    }),
  },
  context: {
    encode: ({ revision }) => ["revision", revision],
    decode: (value) => ({ revision: Number((value as JsonValue[])[1]) }),
  },
};

describe("Task79 decodeStoredDecision RED", () => {
  it("Q8 reconstructs a typed DecisionRecord through one caller-scoped identity and value codecs", () => {
    const stored: StoredDecisionRecord = {
      address: { namespace: "decisions", recordKey: "id:17" },
      selection: { choiceWire: "approve" },
      context: ["revision", 4],
    };

    expect(decodeStoredDecision(stored, identity, valueCodecs)).toEqual({
      id: 17,
      decision: {
        selection: { choice: "approve" },
        context: { revision: 4 },
      },
    });
  });

  it("keeps identity and value codecs caller-scoped across independent decodes", () => {
    const first = decodeStoredDecision(
      {
        address: { namespace: "shared", recordKey: "first:7" },
        selection: "first-selection",
        context: "first-context",
      },
      {
        namespace: "shared",
        keyCodec: {
          encode: (value: number) => `first:${value}`,
          decode: (value) => Number(value.slice("first:".length)),
        },
      },
      {
        selection: { encode: String, decode: (value) => `A:${value}` },
        context: { encode: String, decode: (value) => `A:${value}` },
      },
    );
    const second = decodeStoredDecision(
      {
        address: { namespace: "shared", recordKey: "second:x" },
        selection: "second-selection",
        context: "second-context",
      },
      {
        namespace: "shared",
        keyCodec: {
          encode: (value: string) => `second:${value}`,
          decode: (value) => value.slice("second:".length),
        },
      },
      {
        selection: { encode: String, decode: (value) => `B:${value}` },
        context: { encode: String, decode: (value) => `B:${value}` },
      },
    );

    expect(first).toEqual({
      id: 7,
      decision: {
        selection: "A:first-selection",
        context: "A:first-context",
      },
    });
    expect(second).toEqual({
      id: "x",
      decision: {
        selection: "B:second-selection",
        context: "B:second-context",
      },
    });
  });

  it("Q8 rejects namespace binding mismatch before invoking any caller codec", () => {
    const keyDecode = vi.fn(() => 1);
    const selectionDecode = vi.fn(() => "selection");
    const contextDecode = vi.fn(() => "context");
    const stored: StoredDecisionRecord = {
      address: { namespace: "other", recordKey: "secret-key" },
      selection: "secret-selection",
      context: "secret-context",
    };

    const error = expectStoreError(
      () =>
        decodeStoredDecision(
          stored,
          {
            namespace: "decisions",
            keyCodec: { encode: String, decode: keyDecode },
          },
          {
            selection: { encode: String, decode: selectionDecode },
            context: { encode: String, decode: contextDecode },
          },
        ),
      "query",
      "namespace-binding",
    );

    expect(keyDecode).not.toHaveBeenCalled();
    expect(selectionDecode).not.toHaveBeenCalled();
    expect(contextDecode).not.toHaveBeenCalled();
    expect(error.message).not.toContain("other");
    expect(error.message).not.toContain("secret");
  });

  it("Q8 normalizes key codec rejection as codec-decode/record-key", () => {
    const rejectingKeyCodec: DecisionRecordKeyCodec<string> = {
      encode: String,
      decode: () => {
        throw new Error("PRIVATE-KEY-CODEC-FAILURE");
      },
    };

    const error = expectStoreError(
      () =>
        decodeStoredDecision(
          {
            address: { namespace: "decisions", recordKey: "private-key" },
            selection: null,
            context: null,
          },
          { namespace: "decisions", keyCodec: rejectingKeyCodec },
          {
            selection: { encode: () => null, decode: () => null },
            context: { encode: () => null, decode: () => null },
          },
        ),
      "codec-decode",
      "record-key",
    );

    expect(error.message).not.toContain("PRIVATE-KEY-CODEC-FAILURE");
    expect(error.message).not.toContain("private-key");
  });

  it.each(["selection", "context"] as const)(
    "Q8 normalizes %s codec rejection with its exact error field",
    (failingField) => {
      const rejectingCodec: DecisionValueCodec<null> = {
        encode: () => null,
        decode: () => {
          throw new Error(`PRIVATE-${failingField}-FAILURE`);
        },
      };
      const acceptingCodec: DecisionValueCodec<null> = {
        encode: () => null,
        decode: () => null,
      };
      const codecs = {
        selection:
          failingField === "selection" ? rejectingCodec : acceptingCodec,
        context: failingField === "context" ? rejectingCodec : acceptingCodec,
      };

      const error = expectStoreError(
        () =>
          decodeStoredDecision(
            {
              address: { namespace: "decisions", recordKey: "id:1" },
              selection: null,
              context: null,
            },
            identity,
            codecs,
          ),
        "codec-decode",
        failingField,
      );
      expect(error.message).not.toContain("PRIVATE");
    },
  );

  it.each([
    ["selection", NaN],
    ["selection", Infinity],
    ["selection", -Infinity],
    ["selection", -0],
    ["context", NaN],
    ["context", Infinity],
    ["context", -Infinity],
    ["context", -0],
  ] as const)(
    "Q9 rejects caller-constructed non-JsonValue %s %# before value codecs",
    (field, invalidNumber) => {
      const selectionDecode = vi.fn((value: JsonValue) => value);
      const contextDecode = vi.fn((value: JsonValue) => value);
      const stored = {
        address: { namespace: "decisions", recordKey: "id:1" },
        selection:
          field === "selection"
            ? (invalidNumber as unknown as JsonValue)
            : "valid",
        context:
          field === "context"
            ? (invalidNumber as unknown as JsonValue)
            : "valid",
      } satisfies StoredDecisionRecord;

      expectStoreError(
        () =>
          decodeStoredDecision(stored, identity, {
            selection: { encode: (value) => value, decode: selectionDecode },
            context: { encode: (value) => value, decode: contextDecode },
          }),
        "value-decode",
        field,
      );
      expect(selectionDecode).not.toHaveBeenCalled();
      expect(contextDecode).not.toHaveBeenCalled();
    },
  );

  it.each(["selection", "context"] as const)(
    "Q9 rejects a nested invalid %s DTO value before either value codec",
    (field) => {
      const selectionDecode = vi.fn((value: JsonValue) => value);
      const contextDecode = vi.fn((value: JsonValue) => value);
      const invalid = { nested: [1, -0] } as unknown as JsonValue;
      const stored = {
        address: { namespace: "decisions", recordKey: "id:1" },
        selection: field === "selection" ? invalid : null,
        context: field === "context" ? invalid : null,
      } satisfies StoredDecisionRecord;

      expectStoreError(
        () =>
          decodeStoredDecision(stored, identity, {
            selection: { encode: (value) => value, decode: selectionDecode },
            context: { encode: (value) => value, decode: contextDecode },
          }),
        "value-decode",
        field,
      );
      expect(selectionDecode).not.toHaveBeenCalled();
      expect(contextDecode).not.toHaveBeenCalled();
    },
  );

  it.each([
    [{ namespace: "bad\0namespace", recordKey: "id:1" }, "namespace"],
    [{ namespace: "\ud800", recordKey: "id:1" }, "namespace"],
    [{ namespace: "decisions", recordKey: "bad\0key" }, "record-key"],
    [{ namespace: "decisions", recordKey: "\udc00" }, "record-key"],
    [{ namespace: 7, recordKey: "id:1" }, "namespace"],
    [{ namespace: "decisions", recordKey: null }, "record-key"],
  ] as const)(
    "Q9 validates caller-constructed malformed address %#",
    (address, field) => {
      const selectionDecode = vi.fn((value: JsonValue) => value);
      const contextDecode = vi.fn((value: JsonValue) => value);
      const record = {
        address,
        selection: null,
        context: null,
      } as unknown as StoredDecisionRecord;

      expectStoreError(
        () =>
          decodeStoredDecision(record, identity, {
            selection: { encode: (value) => value, decode: selectionDecode },
            context: { encode: (value) => value, decode: contextDecode },
          }),
        "address",
        field,
      );
      expect(selectionDecode).not.toHaveBeenCalled();
      expect(contextDecode).not.toHaveBeenCalled();
    },
  );
});
