import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type {
  KecBatchIndexResultV1,
  KecBatchSourceResult,
} from "../src/batchIndexing/types.js";
import { expectedBatchSourceId } from "./helpers/kecBatchIndexFixture.js";

type SerializerModule = Readonly<{
  serializeKecBatchIndexResult: (result: KecBatchIndexResultV1) => string;
}>;

const serializerModulePath = fileURLToPath(
  new URL(
    "../src/batchIndexing/serializeKecBatchIndexResult.ts",
    import.meta.url,
  ),
);
const invalidResultError = "KEC_BATCH_INDEX: INTERNAL_ERROR";

async function loadSerializerModule(): Promise<SerializerModule> {
  return (await import(
    /* @vite-ignore */ serializerModulePath
  )) as SerializerModule;
}

function indexed(
  sourceId: string,
  indexedChunkCount: number,
): KecBatchSourceResult {
  return Object.freeze({
    sourceId,
    status: "INDEXED",
    indexedChunkCount,
    failureCode: null,
  });
}

function failed(sourceId: string): KecBatchSourceResult {
  return Object.freeze({
    sourceId,
    status: "FAILED",
    indexedChunkCount: 0,
    failureCode: "INDEXING_FAILED",
  });
}

function notAttempted(sourceId: string): KecBatchSourceResult {
  return Object.freeze({
    sourceId,
    status: "NOT_ATTEMPTED",
    indexedChunkCount: 0,
    failureCode: "NOT_ATTEMPTED",
  });
}

function sortedSourceIds(count: number): readonly string[] {
  return Array.from({ length: count }, (_, index) =>
    expectedBatchSourceId(`knowledge/source-${index}.pdf`),
  ).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function freezeResult(
  values: Omit<KecBatchIndexResultV1, "schemaVersion">,
): KecBatchIndexResultV1 {
  return Object.freeze({
    schemaVersion: 1,
    ...values,
    sources: Object.freeze([...values.sources]),
  });
}

function successResult(chunkCounts: readonly number[]): KecBatchIndexResultV1 {
  const ids = sortedSourceIds(chunkCounts.length);
  const sources = ids.map((sourceId, index) =>
    indexed(sourceId, chunkCounts[index]),
  );
  return freezeResult({
    status: "SUCCEEDED",
    requestedSourceCount: sources.length,
    indexedSourceCount: sources.length,
    failedSourceCount: 0,
    notAttemptedSourceCount: 0,
    indexedChunkCount: chunkCounts.reduce((sum, count) => sum + count, 0),
    sources,
  });
}

function partialResult(): KecBatchIndexResultV1 {
  const ids = sortedSourceIds(3);
  return freezeResult({
    status: "PARTIAL",
    requestedSourceCount: 3,
    indexedSourceCount: 1,
    failedSourceCount: 1,
    notAttemptedSourceCount: 1,
    indexedChunkCount: 4,
    sources: [indexed(ids[0], 4), failed(ids[1]), notAttempted(ids[2])],
  });
}

function failedResult(): KecBatchIndexResultV1 {
  const ids = sortedSourceIds(3);
  return freezeResult({
    status: "FAILED",
    requestedSourceCount: 3,
    indexedSourceCount: 0,
    failedSourceCount: 1,
    notAttemptedSourceCount: 2,
    indexedChunkCount: 0,
    sources: [failed(ids[0]), notAttempted(ids[1]), notAttempted(ids[2])],
  });
}

function resultWith(
  result: KecBatchIndexResultV1,
  overrides: Readonly<Record<string, unknown>>,
): KecBatchIndexResultV1 {
  return Object.freeze({ ...result, ...overrides }) as KecBatchIndexResultV1;
}

function captureErrorMessage(operation: () => unknown): string {
  try {
    operation();
  } catch (error) {
    const descriptor =
      typeof error === "object" && error !== null
        ? Object.getOwnPropertyDescriptor(error, "message")
        : undefined;
    if (descriptor !== undefined && "value" in descriptor) {
      return typeof descriptor.value === "string"
        ? descriptor.value
        : "NON_ERROR_FAILURE";
    }
    return "NON_ERROR_FAILURE";
  }
  throw new Error("Expected operation to fail");
}

describe("Task 58 batch result serialization bytes", () => {
  it("is RED until the approved serializer module exists", () => {
    expect(existsSync(serializerModulePath)).toBe(true);
  });

  it("serializes one successful source with exact compact key order and one LF", async () => {
    const { serializeKecBatchIndexResult } = await loadSerializerModule();
    const result = successResult([2]);
    const sourceId = result.sources[0].sourceId;
    const expected =
      `{"schemaVersion":1,"status":"SUCCEEDED","requestedSourceCount":1,` +
      `"indexedSourceCount":1,"failedSourceCount":0,` +
      `"notAttemptedSourceCount":0,"indexedChunkCount":2,"sources":[` +
      `{"sourceId":"${sourceId}","status":"INDEXED",` +
      `"indexedChunkCount":2,"failureCode":null}]}\n`;

    expect(serializeKecBatchIndexResult(result)).toBe(expected);
  });

  it.each([
    ["multiple success", successResult([0, 2, 7])],
    ["partial", partialResult()],
    ["failed", failedResult()],
  ])("serializes %s deterministically", async (_label, result) => {
    const { serializeKecBatchIndexResult } = await loadSerializerModule();
    const outputs = Array.from({ length: 100 }, () =>
      serializeKecBatchIndexResult(result),
    );
    expect(new Set(outputs).size).toBe(1);
    expect(outputs[0].endsWith("\n")).toBe(true);
    expect(outputs[0].endsWith("\n\n")).toBe(false);
    expect(outputs[0]).not.toContain("\r");
    expect(outputs[0]).not.toContain("  ");
  });

  it("preserves exact top-level and source-result key order", async () => {
    const { serializeKecBatchIndexResult } = await loadSerializerModule();
    const parsed = JSON.parse(
      serializeKecBatchIndexResult(partialResult()),
    ) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual([
      "schemaVersion",
      "status",
      "requestedSourceCount",
      "indexedSourceCount",
      "failedSourceCount",
      "notAttemptedSourceCount",
      "indexedChunkCount",
      "sources",
    ]);
    const sources = parsed.sources as Array<Record<string, unknown>>;
    expect(
      sources.every(
        (source) =>
          Object.keys(source).join(",") ===
          "sourceId,status,indexedChunkCount,failureCode",
      ),
    ).toBe(true);
  });

  it("accepts full 71-character source IDs and preserves zero chunk counts", async () => {
    const { serializeKecBatchIndexResult } = await loadSerializerModule();
    const result = successResult([0]);
    const output = serializeKecBatchIndexResult(result);
    expect(result.sources[0].sourceId).toMatch(/^kecsrc_[0-9a-f]{64}$/u);
    expect(result.sources[0].sourceId).toHaveLength(71);
    expect(output).toContain('"indexedChunkCount":0');
  });

  it("does not mutate or retain the frozen result and has no output side effect", async () => {
    const { serializeKecBatchIndexResult } = await loadSerializerModule();
    const result = partialResult();
    const descriptors = Object.getOwnPropertyDescriptors(result);
    const sourceDescriptors = result.sources.map((source) =>
      Object.getOwnPropertyDescriptors(source),
    );
    const first = serializeKecBatchIndexResult(result);
    const second = serializeKecBatchIndexResult(result);

    expect(first).toBe(second);
    expect(Object.getOwnPropertyDescriptors(result)).toEqual(descriptors);
    expect(
      result.sources.map((source) => Object.getOwnPropertyDescriptors(source)),
    ).toEqual(sourceDescriptors);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.sources)).toBe(true);
  });

  it("emits only the approved result schema without paths, provider details, or diagnostics", async () => {
    const { serializeKecBatchIndexResult } = await loadSerializerModule();
    const output = serializeKecBatchIndexResult(partialResult());
    for (const forbidden of [
      "sourcePath",
      "projectRoot",
      "databasePath",
      "provider",
      "endpoint",
      "model",
      "stack",
      "cause",
      "/tmp/",
      "knowledge/",
    ]) {
      expect(output).not.toContain(forbidden);
    }
  });
});

describe("Task 58 serializer hostile-boundary validation", () => {
  it.each([null, undefined, "result", 42, true, []])(
    "rejects invalid result root %s with one fixed message",
    async (value) => {
      const { serializeKecBatchIndexResult } = await loadSerializerModule();
      expect(
        captureErrorMessage(() =>
          serializeKecBatchIndexResult(value as KecBatchIndexResultV1),
        ),
      ).toBe(invalidResultError);
    },
  );

  it("rejects extra, symbol, custom-prototype, accessor, and hostile Proxy roots without getter execution", async () => {
    const { serializeKecBatchIndexResult } = await loadSerializerModule();
    const valid = successResult([1]);
    let getterCalls = 0;
    const accessor = { ...valid };
    Object.defineProperty(accessor, "sources", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        throw new Error("secret result getter");
      },
    });
    const symbol = { ...valid };
    Object.defineProperty(symbol, Symbol("secret"), { value: true });
    const custom = Object.create({ inherited: true }) as Record<
      string,
      unknown
    >;
    Object.assign(custom, valid);
    const hostile = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error("secret result proxy trap");
        },
      },
    );

    for (const value of [
      { ...valid, extra: true },
      symbol,
      custom,
      accessor,
      hostile,
    ]) {
      expect(
        captureErrorMessage(() =>
          serializeKecBatchIndexResult(
            value as unknown as KecBatchIndexResultV1,
          ),
        ),
      ).toBe(invalidResultError);
    }
    expect(getterCalls).toBe(0);
  });

  it("rejects sparse, accessor-indexed, decorated, symbol, and custom-prototype source arrays", async () => {
    const { serializeKecBatchIndexResult } = await loadSerializerModule();
    const valid = successResult([1]);
    const sparse = new Array<KecBatchSourceResult>(1);
    const accessor = [valid.sources[0]];
    let getterCalls = 0;
    Object.defineProperty(accessor, "0", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return valid.sources[0];
      },
    });
    const decorated = [valid.sources[0]] as KecBatchSourceResult[] & {
      extra?: boolean;
    };
    decorated.extra = true;
    const symbol = [valid.sources[0]];
    Object.defineProperty(symbol, Symbol("secret"), { value: true });
    const customPrototype = [valid.sources[0]];
    Object.setPrototypeOf(customPrototype, Object.create(Array.prototype));

    for (const sources of [
      sparse,
      accessor,
      decorated,
      symbol,
      customPrototype,
    ]) {
      expect(
        captureErrorMessage(() =>
          serializeKecBatchIndexResult(resultWith(valid, { sources })),
        ),
      ).toBe(invalidResultError);
    }
    expect(getterCalls).toBe(0);
  });

  it("rejects malformed source result descriptors and state combinations", async () => {
    const { serializeKecBatchIndexResult } = await loadSerializerModule();
    const valid = successResult([1]);
    const id = valid.sources[0].sourceId;
    let getterCalls = 0;
    const accessor = { ...valid.sources[0] };
    Object.defineProperty(accessor, "indexedChunkCount", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return 1;
      },
    });
    const malformed: readonly unknown[] = [
      { ...valid.sources[0], extra: true },
      accessor,
      { ...valid.sources[0], sourceId: "invalid" },
      { ...valid.sources[0], status: "UNKNOWN" },
      { ...valid.sources[0], indexedChunkCount: -1 },
      { ...valid.sources[0], indexedChunkCount: -0 },
      { ...valid.sources[0], indexedChunkCount: 1.5 },
      { ...valid.sources[0], indexedChunkCount: Number.NaN },
      { ...valid.sources[0], failureCode: "INDEXING_FAILED" },
      {
        sourceId: id,
        status: "FAILED",
        indexedChunkCount: 1,
        failureCode: "INDEXING_FAILED",
      },
      {
        sourceId: id,
        status: "FAILED",
        indexedChunkCount: 0,
        failureCode: null,
      },
      {
        sourceId: id,
        status: "NOT_ATTEMPTED",
        indexedChunkCount: 0,
        failureCode: null,
      },
    ];

    for (const source of malformed) {
      expect(
        captureErrorMessage(() =>
          serializeKecBatchIndexResult(
            resultWith(valid, { sources: Object.freeze([source]) }),
          ),
        ),
      ).toBe(invalidResultError);
    }
    expect(getterCalls).toBe(0);
  });
});

describe("Task 58 serializer result invariants", () => {
  it("rejects top-level count, sum, schema, and status mismatches", async () => {
    const { serializeKecBatchIndexResult } = await loadSerializerModule();
    const valid = successResult([2]);
    const cases: readonly Readonly<Record<string, unknown>>[] = [
      { schemaVersion: 2 },
      { status: "UNKNOWN" },
      { requestedSourceCount: 2 },
      { indexedSourceCount: 0 },
      { failedSourceCount: 1 },
      { notAttemptedSourceCount: 1 },
      { indexedChunkCount: 3 },
      { requestedSourceCount: -0 },
      { indexedSourceCount: -1 },
      { failedSourceCount: 1.5 },
      { notAttemptedSourceCount: Number.POSITIVE_INFINITY },
    ];

    for (const overrides of cases) {
      expect(
        captureErrorMessage(() =>
          serializeKecBatchIndexResult(resultWith(valid, overrides)),
        ),
      ).toBe(invalidResultError);
    }
  });

  it("rejects invalid SUCCEEDED, PARTIAL, and FAILED transitions", async () => {
    const { serializeKecBatchIndexResult } = await loadSerializerModule();
    const ids = sortedSourceIds(3);
    const invalidStates = [
      freezeResult({
        status: "SUCCEEDED",
        requestedSourceCount: 3,
        indexedSourceCount: 1,
        failedSourceCount: 1,
        notAttemptedSourceCount: 1,
        indexedChunkCount: 1,
        sources: [indexed(ids[0], 1), failed(ids[1]), notAttempted(ids[2])],
      }),
      freezeResult({
        status: "PARTIAL",
        requestedSourceCount: 3,
        indexedSourceCount: 0,
        failedSourceCount: 1,
        notAttemptedSourceCount: 2,
        indexedChunkCount: 0,
        sources: [failed(ids[0]), notAttempted(ids[1]), notAttempted(ids[2])],
      }),
      freezeResult({
        status: "FAILED",
        requestedSourceCount: 3,
        indexedSourceCount: 1,
        failedSourceCount: 1,
        notAttemptedSourceCount: 1,
        indexedChunkCount: 1,
        sources: [indexed(ids[0], 1), failed(ids[1]), notAttempted(ids[2])],
      }),
      freezeResult({
        status: "FAILED",
        requestedSourceCount: 3,
        indexedSourceCount: 0,
        failedSourceCount: 1,
        notAttemptedSourceCount: 2,
        indexedChunkCount: 0,
        sources: [notAttempted(ids[0]), failed(ids[1]), notAttempted(ids[2])],
      }),
    ];

    for (const result of invalidStates) {
      expect(
        captureErrorMessage(() => serializeKecBatchIndexResult(result)),
      ).toBe(invalidResultError);
    }
  });

  it("rejects duplicate and noncanonical source ID ordering", async () => {
    const { serializeKecBatchIndexResult } = await loadSerializerModule();
    const valid = successResult([1, 1]);
    const duplicate = Object.freeze([
      valid.sources[0],
      indexed(valid.sources[0].sourceId, 1),
    ]);
    const reversed = Object.freeze([...valid.sources].reverse());

    for (const sources of [duplicate, reversed]) {
      expect(
        captureErrorMessage(() =>
          serializeKecBatchIndexResult(resultWith(valid, { sources })),
        ),
      ).toBe(invalidResultError);
    }
  });
});
