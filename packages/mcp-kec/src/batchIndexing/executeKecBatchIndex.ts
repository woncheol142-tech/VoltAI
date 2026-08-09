import type {
  KecBatchIndexConfig,
  KecBatchIndexResultV1,
  KecBatchSourceResult,
  PreparedKecBatchIndex,
  PreparedKecBatchSource,
} from "./types.js";

const INVALID_CONFIGURATION = "KEC_BATCH_INDEX: INVALID_CONFIGURATION";
const DATABASE_UNAVAILABLE = "KEC_BATCH_INDEX: DATABASE_UNAVAILABLE";
const FINALIZATION_FAILED = "KEC_BATCH_INDEX: FINALIZATION_FAILED";
const INTERNAL_ERROR = "KEC_BATCH_INDEX: INTERNAL_ERROR";

const PLAN_KEYS = [
  "projectRoot",
  "databasePath",
  "provider",
  "sources",
  "concurrency",
  "maxAttempts",
  "retryDelayMs",
] as const;
const SOURCE_KEYS = ["sourcePath", "sourceId"] as const;
const DEPENDENCY_KEYS = [
  "createProvider",
  "createStore",
  "indexSource",
  "closeStore",
  "closeProvider",
] as const;
const INDEX_RESULT_KEYS = ["indexedChunks"] as const;
const SOURCE_ID_PATTERN = /^kecsrc_[0-9a-f]{64}$/u;

const SHA_256_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

type MaybePromise<Value> = Value | Promise<Value>;

export type KecBatchIndexExecutionDependencies = Readonly<{
  createProvider: (
    provider: KecBatchIndexConfig["provider"],
  ) => MaybePromise<unknown>;
  createStore: (databasePath: string) => MaybePromise<unknown>;
  indexSource: (
    projectRoot: string,
    input: Readonly<{
      relativePath: string;
      embeddingConcurrency: number;
      embeddingMaxAttempts: number;
      embeddingRetryDelayMs: number;
    }>,
    dependencies: Readonly<{
      embeddingProvider: unknown;
      vectorStore: unknown;
    }>,
  ) => Promise<Readonly<{ indexedChunks: number }>>;
  closeStore: (store: unknown) => MaybePromise<void>;
  closeProvider: (provider: unknown) => MaybePromise<void>;
}>;

type ValidatedDependencies = KecBatchIndexExecutionDependencies;

function failure(message: string): Error {
  return new Error(message);
}

function inspectObject(
  value: unknown,
  expectedKeys: readonly string[],
  errorMessage: string,
  requireFrozen: boolean,
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw failure(errorMessage);
  }

  let prototype: object | null;
  let names: string[];
  let symbols: symbol[];
  let frozen: boolean;
  try {
    prototype = Object.getPrototypeOf(value);
    names = Object.getOwnPropertyNames(value);
    symbols = Object.getOwnPropertySymbols(value);
    frozen = Object.isFrozen(value);
  } catch {
    throw failure(errorMessage);
  }

  if (
    (prototype !== Object.prototype && prototype !== null) ||
    symbols.length !== 0 ||
    names.length !== expectedKeys.length ||
    expectedKeys.some((key) => !names.includes(key)) ||
    (requireFrozen && !frozen)
  ) {
    throw failure(errorMessage);
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
      throw failure(errorMessage);
    }
    if (descriptor === undefined || !("value" in descriptor)) {
      throw failure(errorMessage);
    }
    properties[key] = descriptor.value;
  }
  return properties;
}

function inspectDenseFrozenArray(
  value: unknown,
  errorMessage: string,
): readonly unknown[] {
  if (!Array.isArray(value)) throw failure(errorMessage);

  let prototype: object | null;
  let names: string[];
  let symbols: symbol[];
  let frozen: boolean;
  let lengthDescriptor: PropertyDescriptor | undefined;
  try {
    prototype = Object.getPrototypeOf(value);
    names = Object.getOwnPropertyNames(value);
    symbols = Object.getOwnPropertySymbols(value);
    frozen = Object.isFrozen(value);
    lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  } catch {
    throw failure(errorMessage);
  }

  if (
    prototype !== Array.prototype ||
    symbols.length !== 0 ||
    !frozen ||
    lengthDescriptor === undefined ||
    !("value" in lengthDescriptor) ||
    typeof lengthDescriptor.value !== "number" ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 1 ||
    names.length !== lengthDescriptor.value + 1
  ) {
    throw failure(errorMessage);
  }

  const values: unknown[] = [];
  const nameSet = new Set(names);
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    const key = String(index);
    if (!nameSet.has(key)) throw failure(errorMessage);

    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      throw failure(errorMessage);
    }
    if (descriptor === undefined || !("value" in descriptor)) {
      throw failure(errorMessage);
    }
    values.push(descriptor.value);
  }
  return values;
}

function rotateRight(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount));
}

function sha256Hex(value: string): string {
  const input = new TextEncoder().encode(value);
  const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
  const bytes = new Uint8Array(paddedLength);
  bytes.set(input);
  bytes[input.length] = 0x80;
  const bitLength = input.length * 8;
  const view = new DataView(bytes.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  const state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  const schedule = new Uint32Array(64);

  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      schedule[index] = view.getUint32(offset + index * 4);
    }
    for (let index = 16; index < 64; index += 1) {
      const before15 = schedule[index - 15];
      const before2 = schedule[index - 2];
      const sigma0 =
        rotateRight(before15, 7) ^ rotateRight(before15, 18) ^ (before15 >>> 3);
      const sigma1 =
        rotateRight(before2, 17) ^ rotateRight(before2, 19) ^ (before2 >>> 10);
      schedule[index] =
        (schedule[index - 16] + sigma0 + schedule[index - 7] + sigma1) >>> 0;
    }

    let a = state[0];
    let b = state[1];
    let c = state[2];
    let d = state[3];
    let e = state[4];
    let f = state[5];
    let g = state[6];
    let h = state[7];

    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temporary1 =
        (h + sum1 + choice + SHA_256_CONSTANTS[index] + schedule[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sum0 + majority) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }

    state[0] = (state[0] + a) >>> 0;
    state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0;
    state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0;
    state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0;
    state[7] = (state[7] + h) >>> 0;
  }

  return Array.from(state, (word) => word.toString(16).padStart(8, "0")).join(
    "",
  );
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    !Object.is(value, -0)
  );
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    !Object.is(value, -0)
  );
}

function validateSource(value: unknown): PreparedKecBatchSource {
  const properties = inspectObject(
    value,
    SOURCE_KEYS,
    INVALID_CONFIGURATION,
    true,
  );
  const sourcePath = properties.sourcePath;
  const sourceId = properties.sourceId;
  if (
    typeof sourcePath !== "string" ||
    sourcePath.length === 0 ||
    typeof sourceId !== "string" ||
    !SOURCE_ID_PATTERN.test(sourceId) ||
    sourceId !== `kecsrc_${sha256Hex(sourcePath)}`
  ) {
    throw failure(INVALID_CONFIGURATION);
  }
  return { sourcePath, sourceId };
}

function validatePreparedPlan(prepared: unknown): PreparedKecBatchIndex {
  const properties = inspectObject(
    prepared,
    PLAN_KEYS,
    INVALID_CONFIGURATION,
    true,
  );
  const projectRoot = properties.projectRoot;
  const databasePath = properties.databasePath;
  const provider = properties.provider;
  const concurrency = properties.concurrency;
  const maxAttempts = properties.maxAttempts;
  const retryDelayMs = properties.retryDelayMs;

  if (
    typeof projectRoot !== "string" ||
    projectRoot.length === 0 ||
    !isAbsolutePath(projectRoot) ||
    typeof databasePath !== "string" ||
    databasePath.length === 0 ||
    (provider !== "placeholder" && provider !== "ollama") ||
    !isPositiveSafeInteger(concurrency) ||
    !isPositiveSafeInteger(maxAttempts) ||
    !isNonnegativeSafeInteger(retryDelayMs)
  ) {
    throw failure(INVALID_CONFIGURATION);
  }

  const sourceValues = inspectDenseFrozenArray(
    properties.sources,
    INVALID_CONFIGURATION,
  );
  const sources: PreparedKecBatchSource[] = [];
  let previousSourceId: string | undefined;
  for (const sourceValue of sourceValues) {
    const source = validateSource(sourceValue);
    if (previousSourceId !== undefined && previousSourceId >= source.sourceId) {
      throw failure(INVALID_CONFIGURATION);
    }
    previousSourceId = source.sourceId;
    sources.push(source);
  }

  return {
    projectRoot,
    databasePath,
    provider,
    sources,
    concurrency,
    maxAttempts,
    retryDelayMs,
  };
}

function validateDependencies(dependencies: unknown): ValidatedDependencies {
  const properties = inspectObject(
    dependencies,
    DEPENDENCY_KEYS,
    INTERNAL_ERROR,
    false,
  );
  for (const key of DEPENDENCY_KEYS) {
    if (typeof properties[key] !== "function") throw failure(INTERNAL_ERROR);
  }
  return {
    createProvider:
      properties.createProvider as ValidatedDependencies["createProvider"],
    createStore: properties.createStore as ValidatedDependencies["createStore"],
    indexSource: properties.indexSource as ValidatedDependencies["indexSource"],
    closeStore: properties.closeStore as ValidatedDependencies["closeStore"],
    closeProvider:
      properties.closeProvider as ValidatedDependencies["closeProvider"],
  };
}

function readIndexedChunks(value: unknown): number | null {
  let properties: Readonly<Record<string, unknown>>;
  try {
    properties = inspectObject(value, INDEX_RESULT_KEYS, INTERNAL_ERROR, false);
  } catch {
    return null;
  }
  return isNonnegativeSafeInteger(properties.indexedChunks)
    ? properties.indexedChunks
    : null;
}

function indexedSource(
  sourceId: string,
  indexedChunkCount: number,
): KecBatchSourceResult {
  return Object.freeze({
    sourceId,
    status: "INDEXED" as const,
    indexedChunkCount,
    failureCode: null,
  });
}

function failedSource(sourceId: string): KecBatchSourceResult {
  return Object.freeze({
    sourceId,
    status: "FAILED" as const,
    indexedChunkCount: 0,
    failureCode: "INDEXING_FAILED" as const,
  });
}

function notAttemptedSource(sourceId: string): KecBatchSourceResult {
  return Object.freeze({
    sourceId,
    status: "NOT_ATTEMPTED" as const,
    indexedChunkCount: 0,
    failureCode: "NOT_ATTEMPTED" as const,
  });
}

async function executeSources(
  prepared: PreparedKecBatchIndex,
  dependencies: ValidatedDependencies,
  provider: unknown,
  store: unknown,
): Promise<KecBatchIndexResultV1> {
  const sources: KecBatchSourceResult[] = [];
  let indexedSourceCount = 0;
  let indexedChunkCount = 0;
  let sourceFailed = false;

  for (const source of prepared.sources) {
    if (sourceFailed) {
      sources.push(notAttemptedSource(source.sourceId));
      continue;
    }

    let operationResult: unknown;
    let operationFailed = false;
    try {
      operationResult = await dependencies.indexSource(
        prepared.projectRoot,
        Object.freeze({
          relativePath: source.sourcePath,
          embeddingConcurrency: prepared.concurrency,
          embeddingMaxAttempts: prepared.maxAttempts,
          embeddingRetryDelayMs: prepared.retryDelayMs,
        }),
        Object.freeze({
          embeddingProvider: provider,
          vectorStore: store,
        }),
      );
    } catch {
      operationFailed = true;
    }

    const indexedChunks = operationFailed
      ? null
      : readIndexedChunks(operationResult);
    if (
      indexedChunks === null ||
      indexedChunkCount > Number.MAX_SAFE_INTEGER - indexedChunks
    ) {
      sourceFailed = true;
      sources.push(failedSource(source.sourceId));
      continue;
    }

    indexedSourceCount += 1;
    indexedChunkCount += indexedChunks;
    sources.push(indexedSource(source.sourceId, indexedChunks));
  }

  const failedSourceCount = sourceFailed ? 1 : 0;
  const notAttemptedSourceCount =
    prepared.sources.length - indexedSourceCount - failedSourceCount;
  const status = sourceFailed
    ? indexedSourceCount === 0
      ? "FAILED"
      : "PARTIAL"
    : "SUCCEEDED";

  return Object.freeze({
    schemaVersion: 1,
    status,
    requestedSourceCount: prepared.sources.length,
    indexedSourceCount,
    failedSourceCount,
    notAttemptedSourceCount,
    indexedChunkCount,
    sources: Object.freeze(sources),
  });
}

async function finalizeResources(
  dependencies: ValidatedDependencies,
  provider: unknown,
  store: unknown,
  storeCreated: boolean,
): Promise<boolean> {
  let finalizationFailed = false;
  if (storeCreated) {
    try {
      await dependencies.closeStore(store);
    } catch {
      finalizationFailed = true;
    }
  }
  try {
    await dependencies.closeProvider(provider);
  } catch {
    finalizationFailed = true;
  }
  return finalizationFailed;
}

export async function executeKecBatchIndex(
  prepared: PreparedKecBatchIndex,
  dependencies: KecBatchIndexExecutionDependencies,
): Promise<KecBatchIndexResultV1> {
  const validatedPrepared = validatePreparedPlan(prepared);
  const validatedDependencies = validateDependencies(dependencies);
  let provider: unknown;
  let store: unknown;
  let storeCreated = false;

  try {
    provider = await validatedDependencies.createProvider(
      validatedPrepared.provider,
    );
  } catch {
    throw failure(INVALID_CONFIGURATION);
  }

  let pendingError: Error | undefined;
  let result: KecBatchIndexResultV1 | undefined;
  try {
    store = await validatedDependencies.createStore(
      validatedPrepared.databasePath,
    );
    storeCreated = true;
  } catch {
    pendingError = failure(DATABASE_UNAVAILABLE);
  }

  if (pendingError === undefined) {
    try {
      result = await executeSources(
        validatedPrepared,
        validatedDependencies,
        provider,
        store,
      );
    } catch {
      pendingError = failure(INTERNAL_ERROR);
    }
  }

  const finalizationFailed = await finalizeResources(
    validatedDependencies,
    provider,
    store,
    storeCreated,
  );
  if (finalizationFailed) throw failure(FINALIZATION_FAILED);
  if (pendingError !== undefined) throw pendingError;
  if (result === undefined) throw failure(INTERNAL_ERROR);
  return result;
}
