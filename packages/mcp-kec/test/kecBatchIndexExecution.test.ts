import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { expectedBatchSourceId } from "./helpers/kecBatchIndexFixture.js";

type PreparedSource = Readonly<{ sourcePath: string; sourceId: string }>;
type PreparedPlan = Readonly<{
  projectRoot: string;
  databasePath: string;
  provider: "placeholder" | "ollama";
  sources: readonly PreparedSource[];
  concurrency: number;
  maxAttempts: number;
  retryDelayMs: number;
}>;
type SourceResult = Readonly<{
  sourceId: string;
  status: "INDEXED" | "FAILED" | "NOT_ATTEMPTED";
  indexedChunkCount: number;
  failureCode: "INDEXING_FAILED" | "NOT_ATTEMPTED" | null;
}>;
type BatchResult = Readonly<{
  schemaVersion: 1;
  status: "SUCCEEDED" | "PARTIAL" | "FAILED";
  requestedSourceCount: number;
  indexedSourceCount: number;
  failedSourceCount: number;
  notAttemptedSourceCount: number;
  indexedChunkCount: number;
  sources: readonly SourceResult[];
}>;
type IndexInput = Readonly<{
  relativePath: string;
  embeddingConcurrency: number;
  embeddingMaxAttempts: number;
  embeddingRetryDelayMs: number;
}>;
type IndexDependencies = Readonly<{
  embeddingProvider: unknown;
  vectorStore: unknown;
}>;
type ExecutionDependencies = Readonly<{
  createProvider: (
    provider: PreparedPlan["provider"],
  ) => unknown | Promise<unknown>;
  createStore: (databasePath: string) => unknown | Promise<unknown>;
  indexSource: (
    projectRoot: string,
    input: IndexInput,
    dependencies: IndexDependencies,
  ) => Promise<Readonly<{ indexedChunks: number }>>;
  closeStore: (store: unknown) => void | Promise<void>;
  closeProvider: (provider: unknown) => void | Promise<void>;
}>;
type ExecutionModule = Readonly<{
  executeKecBatchIndex: (
    prepared: PreparedPlan,
    dependencies: ExecutionDependencies,
  ) => Promise<BatchResult>;
}>;

type SourceOutcome =
  | Readonly<{ kind: "SUCCESS"; value: unknown }>
  | Readonly<{ kind: "FAILURE"; error: unknown }>;

type HarnessOptions = Readonly<{
  outcomes?: ReadonlyMap<string, SourceOutcome>;
  providerFailure?: unknown;
  storeFailure?: unknown;
  closeStoreFailure?: unknown;
  closeProviderFailure?: unknown;
}>;

const executionModulePath = fileURLToPath(
  new URL("../src/batchIndexing/executeKecBatchIndex.ts", import.meta.url),
);
const executionErrors = Object.freeze({
  invalidConfiguration: "KEC_BATCH_INDEX: INVALID_CONFIGURATION",
  databaseUnavailable: "KEC_BATCH_INDEX: DATABASE_UNAVAILABLE",
  finalizationFailed: "KEC_BATCH_INDEX: FINALIZATION_FAILED",
  internalError: "KEC_BATCH_INDEX: INTERNAL_ERROR",
});

async function loadExecutionModule(): Promise<ExecutionModule> {
  return (await import(
    /* @vite-ignore */ executionModulePath
  )) as ExecutionModule;
}

function createPreparedPlan(
  sourcePaths: readonly string[],
  overrides: Partial<Omit<PreparedPlan, "sources">> = {},
): PreparedPlan {
  const sources = sourcePaths
    .map((sourcePath) =>
      Object.freeze({
        sourcePath,
        sourceId: expectedBatchSourceId(sourcePath),
      }),
    )
    .sort((left, right) =>
      left.sourceId < right.sourceId
        ? -1
        : left.sourceId > right.sourceId
          ? 1
          : 0,
    );

  return Object.freeze({
    projectRoot: "/tmp/voltai-task58-project",
    databasePath: "/tmp/voltai-task58-index.sqlite",
    provider: "placeholder",
    sources: Object.freeze(sources),
    concurrency: 4,
    maxAttempts: 3,
    retryDelayMs: 100,
    ...overrides,
  });
}

function frozenPlanWith(
  plan: PreparedPlan,
  overrides: Readonly<Record<string, unknown>>,
): PreparedPlan {
  return Object.freeze({ ...plan, ...overrides }) as PreparedPlan;
}

function createHarness(options: HarnessOptions = {}): Readonly<{
  dependencies: ExecutionDependencies;
  provider: Readonly<{ kind: "provider" }>;
  store: Readonly<{ kind: "store" }>;
  events: string[];
  attempted: string[];
  committed: string[];
  failed: string[];
  indexCalls: Array<
    Readonly<{
      projectRoot: string;
      input: IndexInput;
      dependencies: IndexDependencies;
    }>
  >;
  maxActive: () => number;
  createProvider: ReturnType<typeof vi.fn>;
  createStore: ReturnType<typeof vi.fn>;
  indexSource: ReturnType<typeof vi.fn>;
  closeStore: ReturnType<typeof vi.fn>;
  closeProvider: ReturnType<typeof vi.fn>;
}> {
  const provider = Object.freeze({ kind: "provider" as const });
  const store = Object.freeze({ kind: "store" as const });
  const events: string[] = [];
  const attempted: string[] = [];
  const committed: string[] = [];
  const failed: string[] = [];
  const indexCalls: Array<
    Readonly<{
      projectRoot: string;
      input: IndexInput;
      dependencies: IndexDependencies;
    }>
  > = [];
  let active = 0;
  let maximumActive = 0;

  const createProvider = vi.fn(
    async (providerName: PreparedPlan["provider"]): Promise<unknown> => {
      events.push(`createProvider:${providerName}`);
      if ("providerFailure" in options) throw options.providerFailure;
      return provider;
    },
  );
  const createStore = vi.fn(async (databasePath: string): Promise<unknown> => {
    events.push(`createStore:${databasePath}`);
    if ("storeFailure" in options) throw options.storeFailure;
    return store;
  });
  const indexSource = vi.fn(
    async (
      projectRoot: string,
      input: IndexInput,
      dependencies: IndexDependencies,
    ): Promise<Readonly<{ indexedChunks: number }>> => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      events.push(`index:${input.relativePath}`);
      attempted.push(input.relativePath);
      indexCalls.push({ projectRoot, input, dependencies });
      try {
        await Promise.resolve();
        const outcome = options.outcomes?.get(input.relativePath);
        if (outcome?.kind === "FAILURE") {
          failed.push(input.relativePath);
          throw outcome.error;
        }
        committed.push(input.relativePath);
        return (
          outcome?.kind === "SUCCESS" ? outcome.value : { indexedChunks: 1 }
        ) as Readonly<{ indexedChunks: number }>;
      } finally {
        active -= 1;
      }
    },
  );
  const closeStore = vi.fn(async (value: unknown): Promise<void> => {
    expect(value).toBe(store);
    events.push("closeStore");
    if ("closeStoreFailure" in options) throw options.closeStoreFailure;
  });
  const closeProvider = vi.fn(async (value: unknown): Promise<void> => {
    expect(value).toBe(provider);
    events.push("closeProvider");
    if ("closeProviderFailure" in options) throw options.closeProviderFailure;
  });

  return {
    dependencies: Object.freeze({
      createProvider,
      createStore,
      indexSource,
      closeStore,
      closeProvider,
    }),
    provider,
    store,
    events,
    attempted,
    committed,
    failed,
    indexCalls,
    maxActive: () => maximumActive,
    createProvider,
    createStore,
    indexSource,
    closeStore,
    closeProvider,
  };
}

async function captureAsyncErrorMessage(
  operation: () => Promise<unknown>,
): Promise<string> {
  try {
    await operation();
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

function expectedIndexed(source: PreparedSource, chunks: number): SourceResult {
  return {
    sourceId: source.sourceId,
    status: "INDEXED",
    indexedChunkCount: chunks,
    failureCode: null,
  };
}

function expectedFailed(source: PreparedSource): SourceResult {
  return {
    sourceId: source.sourceId,
    status: "FAILED",
    indexedChunkCount: 0,
    failureCode: "INDEXING_FAILED",
  };
}

function expectedNotAttempted(source: PreparedSource): SourceResult {
  return {
    sourceId: source.sourceId,
    status: "NOT_ATTEMPTED",
    indexedChunkCount: 0,
    failureCode: "NOT_ATTEMPTED",
  };
}

describe("Task 58 batch execution boundary", () => {
  it("is RED until the approved execution module exists", () => {
    expect(existsSync(executionModulePath)).toBe(true);
  });

  it.each([null, undefined, "plan", 42, true, []])(
    "rejects invalid prepared-plan root %s with one fixed message",
    async (prepared) => {
      const { executeKecBatchIndex } = await loadExecutionModule();
      const harness = createHarness();
      await expect(
        captureAsyncErrorMessage(() =>
          executeKecBatchIndex(prepared as PreparedPlan, harness.dependencies),
        ),
      ).resolves.toBe(executionErrors.invalidConfiguration);
      expect(harness.createProvider).not.toHaveBeenCalled();
    },
  );

  it("rejects hostile prepared-plan descriptors without getter execution or leakage", async () => {
    const { executeKecBatchIndex } = await loadExecutionModule();
    const harness = createHarness();
    let getterCalls = 0;
    const prepared = createPreparedPlan(["knowledge/a.pdf"]);
    const accessor = { ...prepared };
    Object.defineProperty(accessor, "sources", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        throw new Error("secret prepared getter");
      },
    });
    Object.freeze(accessor);

    await expect(
      captureAsyncErrorMessage(() =>
        executeKecBatchIndex(
          accessor as unknown as PreparedPlan,
          harness.dependencies,
        ),
      ),
    ).resolves.toBe(executionErrors.invalidConfiguration);
    expect(getterCalls).toBe(0);

    const hostile = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error("secret prepared proxy trap");
        },
      },
    );
    await expect(
      captureAsyncErrorMessage(() =>
        executeKecBatchIndex(
          hostile as unknown as PreparedPlan,
          harness.dependencies,
        ),
      ),
    ).resolves.toBe(executionErrors.invalidConfiguration);
  });

  it("rejects unfrozen, extra-key, symbol, numeric, provider, source, duplicate, and ordering forgeries", async () => {
    const { executeKecBatchIndex } = await loadExecutionModule();
    const valid = createPreparedPlan(["knowledge/a.pdf", "knowledge/b.pdf"]);
    const duplicateSources = Object.freeze([
      valid.sources[0],
      Object.freeze({
        sourcePath: "knowledge/c.pdf",
        sourceId: valid.sources[0].sourceId,
      }),
    ]);
    const reversedSources = Object.freeze([...valid.sources].reverse());
    const accessorSource = { ...valid.sources[0] };
    let getterCalls = 0;
    Object.defineProperty(accessorSource, "sourceId", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return valid.sources[0].sourceId;
      },
    });
    Object.freeze(accessorSource);
    const decoratedSources = [...valid.sources] as PreparedSource[] & {
      extra?: boolean;
    };
    decoratedSources.extra = true;
    Object.freeze(decoratedSources);
    const symbolPlan = { ...valid };
    Object.defineProperty(symbolPlan, Symbol("secret"), { value: true });
    Object.freeze(symbolPlan);

    const cases: readonly unknown[] = [
      { ...valid },
      frozenPlanWith(valid, { extra: true }),
      symbolPlan,
      frozenPlanWith(valid, { projectRoot: "relative/root" }),
      frozenPlanWith(valid, { databasePath: "" }),
      frozenPlanWith(valid, { provider: "openai" }),
      frozenPlanWith(valid, { concurrency: 0 }),
      frozenPlanWith(valid, { maxAttempts: 1.5 }),
      frozenPlanWith(valid, { retryDelayMs: -1 }),
      frozenPlanWith(valid, { sources: Object.freeze([]) }),
      frozenPlanWith(valid, { sources: duplicateSources }),
      frozenPlanWith(valid, { sources: reversedSources }),
      frozenPlanWith(valid, {
        sources: Object.freeze([Object.freeze(accessorSource)]),
      }),
      frozenPlanWith(valid, {
        sources: Object.freeze([
          Object.freeze({ ...valid.sources[0], sourcePath: "" }),
        ]),
      }),
      frozenPlanWith(valid, {
        sources: Object.freeze([
          Object.freeze({
            ...valid.sources[0],
            sourceId: expectedBatchSourceId("knowledge/other.pdf"),
          }),
        ]),
      }),
      frozenPlanWith(valid, { sources: decoratedSources }),
    ];

    for (const prepared of cases) {
      const harness = createHarness();
      await expect(
        captureAsyncErrorMessage(() =>
          executeKecBatchIndex(prepared as PreparedPlan, harness.dependencies),
        ),
      ).resolves.toBe(executionErrors.invalidConfiguration);
      expect(harness.createProvider).not.toHaveBeenCalled();
    }
    expect(getterCalls).toBe(0);
  });

  it("rejects malformed dependency containers before creating resources", async () => {
    const { executeKecBatchIndex } = await loadExecutionModule();
    const prepared = createPreparedPlan(["knowledge/a.pdf"]);
    const valid = createHarness().dependencies;
    let getterCalls = 0;
    const accessor = { ...valid };
    Object.defineProperty(accessor, "createProvider", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return valid.createProvider;
      },
    });
    const hostile = new Proxy(
      {},
      {
        getOwnPropertyDescriptor: () => {
          throw new Error("secret dependency proxy trap");
        },
      },
    );
    const cases: readonly unknown[] = [
      null,
      [],
      {},
      accessor,
      hostile,
      Object.freeze({ ...valid, extra: true }),
      Object.freeze({ ...valid, closeStore: null }),
    ];

    for (const dependencies of cases) {
      await expect(
        captureAsyncErrorMessage(() =>
          executeKecBatchIndex(prepared, dependencies as ExecutionDependencies),
        ),
      ).resolves.toBe(executionErrors.internalError);
    }
    expect(getterCalls).toBe(0);
  });
});

describe("Task 58 sequential execution and partial results", () => {
  it("creates one provider and store, indexes every source sequentially, and finalizes in fixed order", async () => {
    const { executeKecBatchIndex } = await loadExecutionModule();
    const prepared = createPreparedPlan([
      "knowledge/a.pdf",
      "knowledge/b.pdf",
      "knowledge/c.pdf",
    ]);
    const chunks = new Map(
      prepared.sources.map((source, index) => [
        source.sourcePath,
        { kind: "SUCCESS", value: { indexedChunks: index + 2 } } as const,
      ]),
    );
    const harness = createHarness({ outcomes: chunks });
    const result = await executeKecBatchIndex(prepared, harness.dependencies);

    expect(harness.createProvider).toHaveBeenCalledTimes(1);
    expect(harness.createProvider).toHaveBeenCalledWith(prepared.provider);
    expect(harness.createStore).toHaveBeenCalledTimes(1);
    expect(harness.createStore).toHaveBeenCalledWith(prepared.databasePath);
    expect(harness.attempted).toEqual(
      prepared.sources.map((source) => source.sourcePath),
    );
    expect(harness.maxActive()).toBe(1);
    expect(harness.indexCalls).toHaveLength(3);
    for (const call of harness.indexCalls) {
      expect(call.projectRoot).toBe(prepared.projectRoot);
      expect(call.input).toEqual({
        relativePath: call.input.relativePath,
        embeddingConcurrency: prepared.concurrency,
        embeddingMaxAttempts: prepared.maxAttempts,
        embeddingRetryDelayMs: prepared.retryDelayMs,
      });
      expect(call.dependencies).toEqual({
        embeddingProvider: harness.provider,
        vectorStore: harness.store,
      });
    }
    expect(harness.events.slice(0, 2)).toEqual([
      `createProvider:${prepared.provider}`,
      `createStore:${prepared.databasePath}`,
    ]);
    expect(harness.events.slice(-2)).toEqual(["closeStore", "closeProvider"]);
    expect(result).toEqual({
      schemaVersion: 1,
      status: "SUCCEEDED",
      requestedSourceCount: 3,
      indexedSourceCount: 3,
      failedSourceCount: 0,
      notAttemptedSourceCount: 0,
      indexedChunkCount: 9,
      sources: prepared.sources.map((source, index) =>
        expectedIndexed(source, index + 2),
      ),
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.sources)).toBe(true);
    expect(result.sources.every(Object.isFrozen)).toBe(true);
    expect(
      result.sources.every(
        (source, index) => source !== prepared.sources[index],
      ),
    ).toBe(true);
  });

  it("returns FAILED when the first source fails and marks every later source NOT_ATTEMPTED", async () => {
    const { executeKecBatchIndex } = await loadExecutionModule();
    const prepared = createPreparedPlan([
      "knowledge/a.pdf",
      "knowledge/b.pdf",
      "knowledge/c.pdf",
    ]);
    const first = prepared.sources[0];
    const harness = createHarness({
      outcomes: new Map([
        [first.sourcePath, { kind: "FAILURE", error: new Error("secret") }],
      ]),
    });

    const result = await executeKecBatchIndex(prepared, harness.dependencies);
    expect(harness.attempted).toEqual([first.sourcePath]);
    expect(harness.indexSource).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      schemaVersion: 1,
      status: "FAILED",
      requestedSourceCount: 3,
      indexedSourceCount: 0,
      failedSourceCount: 1,
      notAttemptedSourceCount: 2,
      indexedChunkCount: 0,
      sources: [
        expectedFailed(prepared.sources[0]),
        expectedNotAttempted(prepared.sources[1]),
        expectedNotAttempted(prepared.sources[2]),
      ],
    });
    expect(harness.events.slice(-2)).toEqual(["closeStore", "closeProvider"]);
  });

  it("returns PARTIAL without rollback when a middle source fails", async () => {
    const { executeKecBatchIndex } = await loadExecutionModule();
    const prepared = createPreparedPlan([
      "knowledge/a.pdf",
      "knowledge/b.pdf",
      "knowledge/c.pdf",
    ]);
    const second = prepared.sources[1];
    const outcomes = new Map<string, SourceOutcome>([
      [
        prepared.sources[0].sourcePath,
        { kind: "SUCCESS", value: { indexedChunks: 7 } },
      ],
      [second.sourcePath, { kind: "FAILURE", error: "secret failure" }],
    ]);
    const harness = createHarness({ outcomes });

    const result = await executeKecBatchIndex(prepared, harness.dependencies);
    expect(harness.attempted).toEqual(
      prepared.sources.slice(0, 2).map((source) => source.sourcePath),
    );
    expect(harness.committed).toEqual([prepared.sources[0].sourcePath]);
    expect(result.status).toBe("PARTIAL");
    expect(result.indexedSourceCount).toBe(1);
    expect(result.failedSourceCount).toBe(1);
    expect(result.notAttemptedSourceCount).toBe(1);
    expect(result.indexedChunkCount).toBe(7);
    expect(result.sources).toEqual([
      expectedIndexed(prepared.sources[0], 7),
      expectedFailed(prepared.sources[1]),
      expectedNotAttempted(prepared.sources[2]),
    ]);
  });

  it("returns PARTIAL with no NOT_ATTEMPTED result when the last source fails", async () => {
    const { executeKecBatchIndex } = await loadExecutionModule();
    const prepared = createPreparedPlan([
      "knowledge/a.pdf",
      "knowledge/b.pdf",
      "knowledge/c.pdf",
    ]);
    const last = prepared.sources[2];
    const harness = createHarness({
      outcomes: new Map([
        [
          prepared.sources[0].sourcePath,
          { kind: "SUCCESS", value: { indexedChunks: 2 } },
        ],
        [
          prepared.sources[1].sourcePath,
          { kind: "SUCCESS", value: { indexedChunks: 3 } },
        ],
        [last.sourcePath, { kind: "FAILURE", error: null }],
      ]),
    });
    const result = await executeKecBatchIndex(prepared, harness.dependencies);

    expect(harness.attempted).toEqual(
      prepared.sources.map((source) => source.sourcePath),
    );
    expect(result.status).toBe("PARTIAL");
    expect(result.notAttemptedSourceCount).toBe(0);
    expect(result.indexedChunkCount).toBe(5);
    expect(result.sources[2]).toEqual(expectedFailed(last));
  });

  it.each([
    ["Error", new Error("secret Error")],
    ["string", "secret string"],
    ["number", 42],
    ["symbol", Symbol("secret symbol")],
    ["null", null],
    ["undefined", undefined],
    [
      "throwing message",
      Object.defineProperty({}, "message", {
        get: () => {
          throw new Error("secret message getter");
        },
      }),
    ],
    [
      "throwing toString",
      {
        toString: () => {
          throw new Error("secret toString");
        },
      },
    ],
    [
      "throwing cause",
      Object.defineProperty({}, "cause", {
        get: () => {
          throw new Error("secret cause getter");
        },
      }),
    ],
  ])(
    "normalizes a source %s failure without coercion",
    async (_label, error) => {
      const { executeKecBatchIndex } = await loadExecutionModule();
      const prepared = createPreparedPlan(["knowledge/a.pdf"]);
      const harness = createHarness({
        outcomes: new Map([
          [prepared.sources[0].sourcePath, { kind: "FAILURE", error }],
        ]),
      });
      const result = await executeKecBatchIndex(prepared, harness.dependencies);

      expect(result.status).toBe("FAILED");
      expect(result.sources).toEqual([expectedFailed(prepared.sources[0])]);
      expect(harness.indexSource).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ["null", null],
    ["missing", {}],
    ["negative", { indexedChunks: -1 }],
    ["fraction", { indexedChunks: 1.5 }],
    ["NaN", { indexedChunks: Number.NaN }],
    ["Infinity", { indexedChunks: Number.POSITIVE_INFINITY }],
    ["string", { indexedChunks: "1" }],
    [
      "accessor",
      Object.defineProperty({}, "indexedChunks", {
        get: () => {
          throw new Error("secret indexedChunks getter");
        },
      }),
    ],
    ["inherited", Object.create({ indexedChunks: 1 })],
    [
      "hostile proxy",
      new Proxy(
        {},
        {
          getOwnPropertyDescriptor: () => {
            throw new Error("secret index result trap");
          },
        },
      ),
    ],
  ])(
    "treats an invalid successful index result (%s) as source failure",
    async (_label, value) => {
      const { executeKecBatchIndex } = await loadExecutionModule();
      const prepared = createPreparedPlan(["knowledge/a.pdf"]);
      const harness = createHarness({
        outcomes: new Map([
          [prepared.sources[0].sourcePath, { kind: "SUCCESS", value }],
        ]),
      });
      const result = await executeKecBatchIndex(prepared, harness.dependencies);

      expect(result.status).toBe("FAILED");
      expect(result.indexedChunkCount).toBe(0);
      expect(result.sources).toEqual([expectedFailed(prepared.sources[0])]);
    },
  );
});

describe("Task 58 execution resource lifecycle", () => {
  it("maps provider creation failure to INVALID_CONFIGURATION without creating a store", async () => {
    const { executeKecBatchIndex } = await loadExecutionModule();
    const prepared = createPreparedPlan(["knowledge/a.pdf"]);
    const harness = createHarness({
      providerFailure: new Error("secret provider configuration"),
    });

    await expect(
      captureAsyncErrorMessage(() =>
        executeKecBatchIndex(prepared, harness.dependencies),
      ),
    ).resolves.toBe(executionErrors.invalidConfiguration);
    expect(harness.createStore).not.toHaveBeenCalled();
    expect(harness.indexSource).not.toHaveBeenCalled();
    expect(harness.closeProvider).not.toHaveBeenCalled();
  });

  it("maps store creation failure to DATABASE_UNAVAILABLE and closes the owned provider", async () => {
    const { executeKecBatchIndex } = await loadExecutionModule();
    const prepared = createPreparedPlan(["knowledge/a.pdf"]);
    const harness = createHarness({
      storeFailure: new Error("secret database path"),
    });

    await expect(
      captureAsyncErrorMessage(() =>
        executeKecBatchIndex(prepared, harness.dependencies),
      ),
    ).resolves.toBe(executionErrors.databaseUnavailable);
    expect(harness.indexSource).not.toHaveBeenCalled();
    expect(harness.closeStore).not.toHaveBeenCalled();
    expect(harness.closeProvider).toHaveBeenCalledTimes(1);
    expect(harness.events).toEqual([
      `createProvider:${prepared.provider}`,
      `createStore:${prepared.databasePath}`,
      "closeProvider",
    ]);
  });

  it("attempts provider finalization after store finalization fails", async () => {
    const { executeKecBatchIndex } = await loadExecutionModule();
    const prepared = createPreparedPlan(["knowledge/a.pdf"]);
    const harness = createHarness({
      closeStoreFailure: new Error("secret store close"),
    });

    await expect(
      captureAsyncErrorMessage(() =>
        executeKecBatchIndex(prepared, harness.dependencies),
      ),
    ).resolves.toBe(executionErrors.finalizationFailed);
    expect(harness.closeStore).toHaveBeenCalledTimes(1);
    expect(harness.closeProvider).toHaveBeenCalledTimes(1);
    expect(harness.events.slice(-2)).toEqual(["closeStore", "closeProvider"]);
  });

  it.each([
    ["provider close", { closeProviderFailure: "secret provider close" }],
    [
      "both closes",
      {
        closeStoreFailure: "secret store close",
        closeProviderFailure: "secret provider close",
      },
    ],
  ])(
    "uses one fixed finalization error when %s fails",
    async (_label, options) => {
      const { executeKecBatchIndex } = await loadExecutionModule();
      const prepared = createPreparedPlan(["knowledge/a.pdf"]);
      const harness = createHarness(options);

      await expect(
        captureAsyncErrorMessage(() =>
          executeKecBatchIndex(prepared, harness.dependencies),
        ),
      ).resolves.toBe(executionErrors.finalizationFailed);
      expect(harness.closeProvider).toHaveBeenCalledTimes(1);
    },
  );

  it("gives finalization failure precedence over an explicit source failure result", async () => {
    const { executeKecBatchIndex } = await loadExecutionModule();
    const prepared = createPreparedPlan(["knowledge/a.pdf"]);
    const harness = createHarness({
      outcomes: new Map([
        [
          prepared.sources[0].sourcePath,
          { kind: "FAILURE", error: "secret source failure" },
        ],
      ]),
      closeStoreFailure: "secret finalization failure",
    });

    await expect(
      captureAsyncErrorMessage(() =>
        executeKecBatchIndex(prepared, harness.dependencies),
      ),
    ).resolves.toBe(executionErrors.finalizationFailed);
    expect(harness.closeProvider).toHaveBeenCalledTimes(1);
  });

  it("gives provider-finalization failure precedence over store creation failure", async () => {
    const { executeKecBatchIndex } = await loadExecutionModule();
    const prepared = createPreparedPlan(["knowledge/a.pdf"]);
    const harness = createHarness({
      storeFailure: "secret database failure",
      closeProviderFailure: "secret provider close",
    });

    await expect(
      captureAsyncErrorMessage(() =>
        executeKecBatchIndex(prepared, harness.dependencies),
      ),
    ).resolves.toBe(executionErrors.finalizationFailed);
  });
});

describe("Task 58 execution determinism and reference safety", () => {
  it("does not mutate prepared input, dependencies, or owned resource tokens", async () => {
    const { executeKecBatchIndex } = await loadExecutionModule();
    const prepared = createPreparedPlan(["knowledge/a.pdf", "knowledge/b.pdf"]);
    const harness = createHarness();
    const planDescriptors = Object.getOwnPropertyDescriptors(prepared);
    const sourceDescriptors = prepared.sources.map((source) =>
      Object.getOwnPropertyDescriptors(source),
    );
    const dependencyDescriptors = Object.getOwnPropertyDescriptors(
      harness.dependencies,
    );

    const result = await executeKecBatchIndex(prepared, harness.dependencies);
    expect(Object.getOwnPropertyDescriptors(prepared)).toEqual(planDescriptors);
    expect(
      prepared.sources.map((source) =>
        Object.getOwnPropertyDescriptors(source),
      ),
    ).toEqual(sourceDescriptors);
    expect(Object.getOwnPropertyDescriptors(harness.dependencies)).toEqual(
      dependencyDescriptors,
    );
    expect(Object.isFrozen(harness.provider)).toBe(true);
    expect(Object.isFrozen(harness.store)).toBe(true);
    expect(result.sources).not.toBe(prepared.sources);
  });

  it("keeps independent calls reentrant without result or resource sharing", async () => {
    const { executeKecBatchIndex } = await loadExecutionModule();
    const prepared = createPreparedPlan(["knowledge/a.pdf"]);
    const firstHarness = createHarness();
    const secondHarness = createHarness();
    const first = await executeKecBatchIndex(
      prepared,
      firstHarness.dependencies,
    );
    const second = await executeKecBatchIndex(
      prepared,
      secondHarness.dependencies,
    );

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.sources).not.toBe(second.sources);
    expect(first.sources[0]).not.toBe(second.sources[0]);
    expect(firstHarness.createProvider).toHaveBeenCalledTimes(1);
    expect(secondHarness.createProvider).toHaveBeenCalledTimes(1);
  });

  it("processes 100 prepared sources sequentially without recursion or reordering", async () => {
    const { executeKecBatchIndex } = await loadExecutionModule();
    const paths = Array.from(
      { length: 100 },
      (_, index) => `knowledge/source-${String(index).padStart(3, "0")}.pdf`,
    );
    const prepared = createPreparedPlan(paths);
    const harness = createHarness();
    const result = await executeKecBatchIndex(prepared, harness.dependencies);

    expect(harness.indexSource).toHaveBeenCalledTimes(100);
    expect(harness.maxActive()).toBe(1);
    expect(harness.attempted).toEqual(
      prepared.sources.map((source) => source.sourcePath),
    );
    expect(result.sources.map((source) => source.sourceId)).toEqual(
      prepared.sources.map((source) => source.sourceId),
    );
    expect(result.requestedSourceCount).toBe(100);
    expect(result.indexedSourceCount).toBe(100);
    expect(result.indexedChunkCount).toBe(100);
  });
});
