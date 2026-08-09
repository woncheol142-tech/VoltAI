import type {
  KecBatchIndexResultV1,
  KecBatchIndexStatus,
  KecBatchSourceResult,
} from "./types.js";

const INTERNAL_ERROR = "KEC_BATCH_INDEX: INTERNAL_ERROR";
const RESULT_KEYS = [
  "schemaVersion",
  "status",
  "requestedSourceCount",
  "indexedSourceCount",
  "failedSourceCount",
  "notAttemptedSourceCount",
  "indexedChunkCount",
  "sources",
] as const;
const SOURCE_KEYS = [
  "sourceId",
  "status",
  "indexedChunkCount",
  "failureCode",
] as const;
const SOURCE_ID_PATTERN = /^kecsrc_[0-9a-f]{64}$/u;

type ValidatedResult = Readonly<{
  status: KecBatchIndexStatus;
  requestedSourceCount: number;
  indexedSourceCount: number;
  failedSourceCount: number;
  notAttemptedSourceCount: number;
  indexedChunkCount: number;
  sources: readonly KecBatchSourceResult[];
}>;

function invalidResult(): Error {
  return new Error(INTERNAL_ERROR);
}

function inspectObject(
  value: unknown,
  expectedKeys: readonly string[],
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidResult();
  }

  let prototype: object | null;
  let names: string[];
  let symbols: symbol[];
  try {
    prototype = Object.getPrototypeOf(value);
    names = Object.getOwnPropertyNames(value);
    symbols = Object.getOwnPropertySymbols(value);
  } catch {
    throw invalidResult();
  }
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    symbols.length !== 0 ||
    names.length !== expectedKeys.length ||
    expectedKeys.some((key) => !names.includes(key))
  ) {
    throw invalidResult();
  }

  const properties: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  for (const key of expectedKeys) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      throw invalidResult();
    }
    if (descriptor === undefined || !("value" in descriptor)) {
      throw invalidResult();
    }
    properties[key] = descriptor.value;
  }
  return properties;
}

function inspectDenseArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw invalidResult();

  let prototype: object | null;
  let names: string[];
  let symbols: symbol[];
  let lengthDescriptor: PropertyDescriptor | undefined;
  try {
    prototype = Object.getPrototypeOf(value);
    names = Object.getOwnPropertyNames(value);
    symbols = Object.getOwnPropertySymbols(value);
    lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  } catch {
    throw invalidResult();
  }
  if (
    prototype !== Array.prototype ||
    symbols.length !== 0 ||
    lengthDescriptor === undefined ||
    !("value" in lengthDescriptor) ||
    typeof lengthDescriptor.value !== "number" ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 1 ||
    names.length !== lengthDescriptor.value + 1
  ) {
    throw invalidResult();
  }

  const values: unknown[] = [];
  const nameSet = new Set(names);
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    const key = String(index);
    if (!nameSet.has(key)) throw invalidResult();

    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      throw invalidResult();
    }
    if (descriptor === undefined || !("value" in descriptor)) {
      throw invalidResult();
    }
    values.push(descriptor.value);
  }
  return values;
}

function readCount(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    Object.is(value, -0)
  ) {
    throw invalidResult();
  }
  return value;
}

function validateSource(value: unknown): KecBatchSourceResult {
  const properties = inspectObject(value, SOURCE_KEYS);
  const sourceId = properties.sourceId;
  const status = properties.status;
  const indexedChunkCount = readCount(properties.indexedChunkCount);
  const failureCode = properties.failureCode;

  if (typeof sourceId !== "string" || !SOURCE_ID_PATTERN.test(sourceId)) {
    throw invalidResult();
  }
  if (
    status !== "INDEXED" &&
    status !== "FAILED" &&
    status !== "NOT_ATTEMPTED"
  ) {
    throw invalidResult();
  }

  let validatedFailureCode: KecBatchSourceResult["failureCode"];
  if (status === "INDEXED") {
    if (failureCode !== null) throw invalidResult();
    validatedFailureCode = null;
  } else if (status === "FAILED") {
    if (indexedChunkCount !== 0 || failureCode !== "INDEXING_FAILED") {
      throw invalidResult();
    }
    validatedFailureCode = "INDEXING_FAILED";
  } else {
    if (indexedChunkCount !== 0 || failureCode !== "NOT_ATTEMPTED") {
      throw invalidResult();
    }
    validatedFailureCode = "NOT_ATTEMPTED";
  }

  return {
    sourceId,
    status,
    indexedChunkCount,
    failureCode: validatedFailureCode,
  };
}

function validateResult(result: unknown): ValidatedResult {
  const properties = inspectObject(result, RESULT_KEYS);
  if (properties.schemaVersion !== 1) throw invalidResult();

  const status = properties.status;
  if (status !== "SUCCEEDED" && status !== "PARTIAL" && status !== "FAILED") {
    throw invalidResult();
  }

  const requestedSourceCount = readCount(properties.requestedSourceCount);
  const indexedSourceCount = readCount(properties.indexedSourceCount);
  const failedSourceCount = readCount(properties.failedSourceCount);
  const notAttemptedSourceCount = readCount(properties.notAttemptedSourceCount);
  const indexedChunkCount = readCount(properties.indexedChunkCount);
  const sourceValues = inspectDenseArray(properties.sources);
  const sources: KecBatchSourceResult[] = [];
  let computedIndexedSourceCount = 0;
  let computedFailedSourceCount = 0;
  let computedNotAttemptedSourceCount = 0;
  let computedIndexedChunkCount = 0;
  let failureSeen = false;
  let previousSourceId: string | undefined;

  for (const sourceValue of sourceValues) {
    const source = validateSource(sourceValue);
    if (previousSourceId !== undefined && previousSourceId >= source.sourceId) {
      throw invalidResult();
    }
    previousSourceId = source.sourceId;

    if (source.status === "INDEXED") {
      if (failureSeen) throw invalidResult();
      computedIndexedSourceCount += 1;
      if (
        computedIndexedChunkCount >
        Number.MAX_SAFE_INTEGER - source.indexedChunkCount
      ) {
        throw invalidResult();
      }
      computedIndexedChunkCount += source.indexedChunkCount;
    } else if (source.status === "FAILED") {
      if (failureSeen) throw invalidResult();
      failureSeen = true;
      computedFailedSourceCount += 1;
    } else {
      if (!failureSeen) throw invalidResult();
      computedNotAttemptedSourceCount += 1;
    }
    sources.push(source);
  }

  if (
    requestedSourceCount !== sources.length ||
    requestedSourceCount < 1 ||
    requestedSourceCount !==
      indexedSourceCount + failedSourceCount + notAttemptedSourceCount ||
    indexedSourceCount !== computedIndexedSourceCount ||
    failedSourceCount !== computedFailedSourceCount ||
    notAttemptedSourceCount !== computedNotAttemptedSourceCount ||
    indexedChunkCount !== computedIndexedChunkCount ||
    failedSourceCount > 1
  ) {
    throw invalidResult();
  }

  if (
    (status === "SUCCEEDED" &&
      (indexedSourceCount !== requestedSourceCount ||
        failedSourceCount !== 0 ||
        notAttemptedSourceCount !== 0)) ||
    (status === "PARTIAL" &&
      (indexedSourceCount < 1 || failedSourceCount !== 1)) ||
    (status === "FAILED" &&
      (indexedSourceCount !== 0 || failedSourceCount !== 1))
  ) {
    throw invalidResult();
  }

  return {
    status,
    requestedSourceCount,
    indexedSourceCount,
    failedSourceCount,
    notAttemptedSourceCount,
    indexedChunkCount,
    sources,
  };
}

export function serializeKecBatchIndexResult(
  result: KecBatchIndexResultV1,
): string {
  const validated = validateResult(result);
  return `${JSON.stringify({
    schemaVersion: 1,
    status: validated.status,
    requestedSourceCount: validated.requestedSourceCount,
    indexedSourceCount: validated.indexedSourceCount,
    failedSourceCount: validated.failedSourceCount,
    notAttemptedSourceCount: validated.notAttemptedSourceCount,
    indexedChunkCount: validated.indexedChunkCount,
    sources: validated.sources.map((source) => ({
      sourceId: source.sourceId,
      status: source.status,
      indexedChunkCount: source.indexedChunkCount,
      failureCode: source.failureCode,
    })),
  })}\n`;
}
