import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { prepareKecBatchIndex } from "../src/batchIndexing/prepareKecBatchIndex.js";
import { readKecBatchIndexConfig } from "../src/batchIndexing/readKecBatchIndexConfig.js";
import type {
  KecBatchIndexConfig,
  KecBatchIndexResultV1,
  PreparedKecBatchIndex,
} from "../src/batchIndexing/types.js";
import {
  assertNoBatchArtifacts,
  batchEnvironment,
  createKecBatchIndexFixture,
  firstCanonicalSource,
  sameBytesSource,
  secondCanonicalSource,
  type KecBatchIndexFixture,
} from "./helpers/kecBatchIndexFixture.js";

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
    provider: KecBatchIndexConfig["provider"],
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
type RuntimeModules = Readonly<{
  executeKecBatchIndex: (
    prepared: PreparedKecBatchIndex,
    dependencies: ExecutionDependencies,
  ) => Promise<KecBatchIndexResultV1>;
  serializeKecBatchIndexResult: (result: KecBatchIndexResultV1) => string;
}>;

const testFile = fileURLToPath(import.meta.url);
const packageRoot = join(dirname(testFile), "..");
const executionModulePath = join(
  packageRoot,
  "src",
  "batchIndexing",
  "executeKecBatchIndex.ts",
);
const serializerModulePath = join(
  packageRoot,
  "src",
  "batchIndexing",
  "serializeKecBatchIndexResult.ts",
);

async function loadRuntimeModules(): Promise<RuntimeModules> {
  const [executionModule, serializerModule] = await Promise.all([
    import(/* @vite-ignore */ executionModulePath),
    import(/* @vite-ignore */ serializerModulePath),
  ]);
  return {
    executeKecBatchIndex:
      executionModule.executeKecBatchIndex as RuntimeModules["executeKecBatchIndex"],
    serializeKecBatchIndexResult:
      serializerModule.serializeKecBatchIndexResult as RuntimeModules["serializeKecBatchIndexResult"],
  };
}

async function withFixture(
  operation: (fixture: KecBatchIndexFixture) => Promise<void> | void,
): Promise<void> {
  const fixture = createKecBatchIndexFixture();
  try {
    await operation(fixture);
  } finally {
    fixture.cleanup();
  }
}

function prepare(
  fixture: KecBatchIndexFixture,
  sourcePaths: readonly string[],
): PreparedKecBatchIndex {
  const config = readKecBatchIndexConfig(
    batchEnvironment(fixture.projectRoot),
    fixture.fixtureRoot,
  );
  return prepareKecBatchIndex(config, { sources: [...sourcePaths] });
}

function createLedgerHarness(
  options: Readonly<{
    failurePath?: string;
    failureError?: unknown;
    chunks?: ReadonlyMap<string, number>;
    ledger?: Map<string, number>;
  }> = {},
): Readonly<{
  dependencies: ExecutionDependencies;
  attempted: string[];
  committed: string[];
  failed: string[];
  ledger: Map<string, number>;
  indexSource: ReturnType<typeof vi.fn>;
}> {
  const provider = Object.freeze({ kind: "fake-provider" });
  const store = Object.freeze({ kind: "fake-store" });
  const attempted: string[] = [];
  const committed: string[] = [];
  const failed: string[] = [];
  const ledger = options.ledger ?? new Map<string, number>();
  const indexSource = vi.fn(
    async (
      _projectRoot: string,
      input: IndexInput,
      dependencies: IndexDependencies,
    ): Promise<Readonly<{ indexedChunks: number }>> => {
      expect(dependencies).toEqual({
        embeddingProvider: provider,
        vectorStore: store,
      });
      attempted.push(input.relativePath);
      if (input.relativePath === options.failurePath) {
        failed.push(input.relativePath);
        throw options.failureError;
      }
      const indexedChunks = options.chunks?.get(input.relativePath) ?? 1;
      ledger.set(input.relativePath, indexedChunks);
      committed.push(input.relativePath);
      return Object.freeze({ indexedChunks });
    },
  );

  return {
    dependencies: Object.freeze({
      createProvider: vi.fn(() => provider),
      createStore: vi.fn(() => store),
      indexSource,
      closeStore: vi.fn(async () => undefined),
      closeProvider: vi.fn(async () => undefined),
    }),
    attempted,
    committed,
    failed,
    ledger,
    indexSource,
  };
}

describe("Task 58 preflight-to-execution integration", () => {
  it("is RED until execution and serialization modules exist", () => {
    expect(existsSync(executionModulePath)).toBe(true);
    expect(existsSync(serializerModulePath)).toBe(true);
  });

  it("preflights two real placeholder files and executes both through injected seams", async () => {
    await withFixture(async (fixture) => {
      const { executeKecBatchIndex } = await loadRuntimeModules();
      const prepared = prepare(fixture, [
        firstCanonicalSource,
        secondCanonicalSource,
      ]);
      const harness = createLedgerHarness();
      const result = await executeKecBatchIndex(prepared, harness.dependencies);

      expect(result.status).toBe("SUCCEEDED");
      expect(harness.attempted).toEqual(
        prepared.sources.map((source) => source.sourcePath),
      );
      expect(harness.committed).toEqual(harness.attempted);
      expect(harness.ledger.size).toBe(2);
      expect(existsSync(fixture.databasePath)).toBe(false);
      assertNoBatchArtifacts(fixture.fixtureRoot);
    });
  });

  it("produces identical preflight and execution order for caller input permutations", async () => {
    await withFixture(async (fixture) => {
      const { executeKecBatchIndex } = await loadRuntimeModules();
      const forward = prepare(fixture, [
        firstCanonicalSource,
        secondCanonicalSource,
      ]);
      const reverse = prepare(fixture, [
        secondCanonicalSource,
        firstCanonicalSource,
      ]);
      const forwardHarness = createLedgerHarness();
      const reverseHarness = createLedgerHarness();

      const first = await executeKecBatchIndex(
        forward,
        forwardHarness.dependencies,
      );
      const second = await executeKecBatchIndex(
        reverse,
        reverseHarness.dependencies,
      );
      expect(forward).toEqual(reverse);
      expect(forwardHarness.attempted).toEqual(reverseHarness.attempted);
      expect(first).toEqual(second);
    });
  });

  it("attempts same-byte files at distinct canonical paths independently", async () => {
    await withFixture(async (fixture) => {
      const { executeKecBatchIndex } = await loadRuntimeModules();
      const prepared = prepare(fixture, [
        firstCanonicalSource,
        sameBytesSource,
      ]);
      const harness = createLedgerHarness();
      const result = await executeKecBatchIndex(prepared, harness.dependencies);

      expect(result.indexedSourceCount).toBe(2);
      expect(harness.indexSource).toHaveBeenCalledTimes(2);
      expect(new Set(harness.committed)).toEqual(
        new Set([firstCanonicalSource, sameBytesSource]),
      );
    });
  });

  it("represents existing-source replacement only through the fake source-atomic callback", async () => {
    await withFixture(async (fixture) => {
      const { executeKecBatchIndex } = await loadRuntimeModules();
      const prepared = prepare(fixture, [firstCanonicalSource]);
      const ledger = new Map<string, number>();
      const firstHarness = createLedgerHarness({
        ledger,
        chunks: new Map([[firstCanonicalSource, 2]]),
      });
      const secondHarness = createLedgerHarness({
        ledger,
        chunks: new Map([[firstCanonicalSource, 5]]),
      });

      await executeKecBatchIndex(prepared, firstHarness.dependencies);
      await executeKecBatchIndex(prepared, secondHarness.dependencies);
      expect(ledger).toEqual(new Map([[firstCanonicalSource, 5]]));
      expect(firstHarness.committed).toEqual([firstCanonicalSource]);
      expect(secondHarness.committed).toEqual([firstCanonicalSource]);
      expect(existsSync(fixture.databasePath)).toBe(false);
    });
  });

  it.each([
    "parse-like",
    "provider-like",
    "compatibility-like",
    "write-like",
    "commit-like",
  ])(
    "keeps source 1 committed and stops after a source 2 %s failure",
    async (failureKind) => {
      await withFixture(async (fixture) => {
        const { executeKecBatchIndex } = await loadRuntimeModules();
        const thirdSource = "knowledge/third.pdf";
        fixture.writeProjectFile(thirdSource);
        const prepared = prepare(fixture, [
          firstCanonicalSource,
          secondCanonicalSource,
          thirdSource,
        ]);
        const failurePath = prepared.sources[1].sourcePath;
        const harness = createLedgerHarness({
          failurePath,
          failureError: new Error(`fake ${failureKind} failure`),
        });
        const result = await executeKecBatchIndex(
          prepared,
          harness.dependencies,
        );

        expect(result.status).toBe("PARTIAL");
        expect(harness.attempted).toEqual(
          prepared.sources.slice(0, 2).map((source) => source.sourcePath),
        );
        expect(harness.committed).toEqual([prepared.sources[0].sourcePath]);
        expect(harness.failed).toEqual([failurePath]);
        expect(harness.ledger.has(prepared.sources[0].sourcePath)).toBe(true);
        expect(harness.ledger.has(failurePath)).toBe(false);
        expect(harness.ledger.has(prepared.sources[2].sourcePath)).toBe(false);
        expect(result.sources[2].status).toBe("NOT_ATTEMPTED");
        expect(harness.indexSource).toHaveBeenCalledTimes(2);
        expect(existsSync(fixture.databasePath)).toBe(false);
      });
    },
  );
});

describe("Task 58 integrated serialization and authority boundaries", () => {
  it("serializes repeated equivalent executions to identical compact bytes", async () => {
    await withFixture(async (fixture) => {
      const { executeKecBatchIndex, serializeKecBatchIndexResult } =
        await loadRuntimeModules();
      const prepared = prepare(fixture, [
        firstCanonicalSource,
        secondCanonicalSource,
      ]);
      const first = await executeKecBatchIndex(
        prepared,
        createLedgerHarness().dependencies,
      );
      const second = await executeKecBatchIndex(
        prepared,
        createLedgerHarness().dependencies,
      );
      const serialized = Array.from({ length: 20 }, (_, index) =>
        serializeKecBatchIndexResult(index % 2 === 0 ? first : second),
      );

      expect(new Set(serialized).size).toBe(1);
      expect(serialized[0].endsWith("\n")).toBe(true);
      expect(serialized[0]).not.toContain("\r");
    });
  });

  it("keeps raw filesystem and configuration paths out of serialized output", async () => {
    await withFixture(async (fixture) => {
      const { executeKecBatchIndex, serializeKecBatchIndexResult } =
        await loadRuntimeModules();
      const prepared = prepare(fixture, [firstCanonicalSource]);
      const result = await executeKecBatchIndex(
        prepared,
        createLedgerHarness().dependencies,
      );
      const serialized = serializeKecBatchIndexResult(result);

      for (const forbidden of [
        fixture.projectRoot,
        fixture.databasePath,
        fixture.firstAbsoluteSource,
        firstCanonicalSource,
        "placeholder",
      ]) {
        expect(serialized).not.toContain(forbidden);
      }
      expect(Object.keys(JSON.parse(serialized) as object)).toEqual([
        "schemaVersion",
        "status",
        "requestedSourceCount",
        "indexedSourceCount",
        "failedSourceCount",
        "notAttemptedSourceCount",
        "indexedChunkCount",
        "sources",
      ]);
    });
  });

  it("keeps future orchestration modules free of concrete database, provider, parser, network, and logging authority", () => {
    for (const path of [executionModulePath, serializerModulePath]) {
      expect(existsSync(path)).toBe(true);
      if (!existsSync(path)) continue;
      const source = readFileSync(path, "utf8");
      expect(source).not.toMatch(
        /node:sqlite|SqliteKnowledgeStore|KnowledgeVectorStore|OllamaEmbeddingProvider|PlaceholderEmbeddingProvider|createEmbeddingProvider|indexKec|readPdf|pdfjs|createPageChunks|searchKec|modelcontextprotocol|child_process|\bfetch\s*\(|XMLHttpRequest|WebSocket|console\.|logger|process\.env|process\.exit/iu,
      );
      expect(source).not.toMatch(
        /whole.?batch.?atomic|rollback|continue.?on.?error/iu,
      );
    }
  });
});
