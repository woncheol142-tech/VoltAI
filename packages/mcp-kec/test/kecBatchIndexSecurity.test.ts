import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertNoBatchArtifacts,
  batchEnvironment,
  batchIndexErrors,
  captureErrorMessage,
  createHostileCoercionValue,
  createKecBatchIndexFixture,
  expectedBatchSourceId,
  firstCanonicalSource,
  type KecBatchIndexFixture,
} from "./helpers/kecBatchIndexFixture.js";

type BatchConfig = Readonly<{
  projectRoot: string;
  databasePath: string;
  provider: "placeholder" | "ollama";
  concurrency: number;
  maxAttempts: number;
  retryDelayMs: number;
}>;

type BatchModule = Readonly<{
  readKecBatchIndexConfig: (environment: unknown, cwd: string) => BatchConfig;
  prepareKecBatchIndex: (
    config: BatchConfig,
    request: unknown,
  ) => Readonly<{
    projectRoot: string;
    databasePath: string;
    provider: "placeholder" | "ollama";
    sources: readonly Readonly<{ sourcePath: string; sourceId: string }>[];
    concurrency: number;
    maxAttempts: number;
    retryDelayMs: number;
  }>;
}>;

const testFile = fileURLToPath(import.meta.url);
const packageRoot = join(dirname(testFile), "..");
const batchRoot = join(packageRoot, "src", "batchIndexing");
const configPath = join(batchRoot, "readKecBatchIndexConfig.ts");
const preflightPath = join(batchRoot, "prepareKecBatchIndex.ts");
const barrelPath = join(batchRoot, "index.ts");

async function loadBatchModule(): Promise<BatchModule> {
  const [configModule, preflightModule] = await Promise.all([
    import(/* @vite-ignore */ configPath),
    import(/* @vite-ignore */ preflightPath),
  ]);
  return {
    readKecBatchIndexConfig:
      configModule.readKecBatchIndexConfig as BatchModule["readKecBatchIndexConfig"],
    prepareKecBatchIndex:
      preflightModule.prepareKecBatchIndex as BatchModule["prepareKecBatchIndex"],
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

function validConfig(
  batchModule: BatchModule,
  fixture: KecBatchIndexFixture,
  overrides: Readonly<Record<string, unknown>> = {},
): BatchConfig {
  return batchModule.readKecBatchIndexConfig(
    batchEnvironment(fixture.projectRoot, overrides),
    fixture.fixtureRoot,
  );
}

describe("Task 58 preflight descriptor and coercion safety", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("is RED until the pure preflight namespace exists", () => {
    expect(existsSync(configPath)).toBe(true);
    expect(existsSync(preflightPath)).toBe(true);
    expect(existsSync(barrelPath)).toBe(true);
  });

  it("does not execute getters on environment, request, sources, or source elements", async () => {
    await withFixture(async (fixture) => {
      const batchModule = await loadBatchModule();
      let getterCalls = 0;
      const environment = batchEnvironment(fixture.projectRoot);
      Object.defineProperty(environment, "PROJECT_ROOT", {
        enumerable: true,
        get: () => {
          getterCalls += 1;
          return fixture.projectRoot;
        },
      });
      expect(
        captureErrorMessage(() =>
          batchModule.readKecBatchIndexConfig(environment, fixture.fixtureRoot),
        ),
      ).toBe(batchIndexErrors.invalidConfiguration);

      const config = validConfig(batchModule, fixture);
      const request = {};
      Object.defineProperty(request, "sources", {
        enumerable: true,
        get: () => {
          getterCalls += 1;
          return [firstCanonicalSource];
        },
      });
      expect(
        captureErrorMessage(() =>
          batchModule.prepareKecBatchIndex(config, request),
        ),
      ).toBe(batchIndexErrors.invalidArgument);

      const sourceArray = [firstCanonicalSource];
      Object.defineProperty(sourceArray, "0", {
        enumerable: true,
        get: () => {
          getterCalls += 1;
          return firstCanonicalSource;
        },
      });
      expect(
        captureErrorMessage(() =>
          batchModule.prepareKecBatchIndex(config, { sources: sourceArray }),
        ),
      ).toBe(batchIndexErrors.invalidArgument);
      expect(getterCalls).toBe(0);
    });
  });

  it("does not coerce hostile environment, request, source, or configuration values", async () => {
    await withFixture(async (fixture) => {
      const batchModule = await loadBatchModule();
      const counter = { count: 0 };
      const hostile = createHostileCoercionValue(counter);
      expect(
        captureErrorMessage(() =>
          batchModule.readKecBatchIndexConfig(
            {
              PROJECT_ROOT: hostile,
              KEC_EMBED_PROVIDER: "placeholder",
            },
            fixture.fixtureRoot,
          ),
        ),
      ).toBe(batchIndexErrors.invalidConfiguration);

      const config = validConfig(batchModule, fixture);
      expect(
        captureErrorMessage(() =>
          batchModule.prepareKecBatchIndex(config, { sources: [hostile] }),
        ),
      ).toBe(batchIndexErrors.invalidArgument);
      expect(counter.count).toBe(0);
    });
  });

  it("does not enumerate environment or consume inherited and unrelated values", async () => {
    await withFixture(async (fixture) => {
      const batchModule = await loadBatchModule();
      let ownKeysCalls = 0;
      let unrelatedGetterCalls = 0;
      const target = batchEnvironment(fixture.projectRoot);
      Object.defineProperty(target, "API_KEY_SECRET_SENTINEL", {
        enumerable: true,
        get: () => {
          unrelatedGetterCalls += 1;
          return "secret-api-key-value";
        },
      });
      const environment = new Proxy(target, {
        ownKeys: () => {
          ownKeysCalls += 1;
          throw new Error("secret-enumeration-sentinel");
        },
      });

      expect(
        batchModule.readKecBatchIndexConfig(environment, fixture.fixtureRoot)
          .provider,
      ).toBe("placeholder");
      expect(ownKeysCalls).toBe(0);
      expect(unrelatedGetterCalls).toBe(0);
    });
  });

  it("normalizes hostile Proxy trap failures to fixed messages without leaking details", async () => {
    const batchModule = await loadBatchModule();
    const secret = "secret-proxy-trap-detail";
    const environment = new Proxy(
      {},
      {
        getOwnPropertyDescriptor: () => {
          throw new Error(secret);
        },
      },
    );
    const message = captureErrorMessage(() =>
      batchModule.readKecBatchIndexConfig(environment, process.cwd()),
    );
    expect(message).toBe(batchIndexErrors.invalidConfiguration);
    expect(message).not.toContain(secret);
  });
});

describe("Task 58 preflight redaction and authority boundaries", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses only fixed redacted messages for every approved preflight failure category", async () => {
    await withFixture(async (fixture) => {
      const batchModule = await loadBatchModule();
      const config = validConfig(batchModule, fixture, {
        KEC_DB_PATH: "secret-database-path/kec.sqlite",
      });
      fixture.createProjectDirectory("knowledge/secret-directory.pdf");
      const cases: Array<
        Readonly<{ operation: () => unknown; expected: string }>
      > = [
        {
          operation: () =>
            batchModule.readKecBatchIndexConfig(
              {
                PROJECT_ROOT: fixture.projectRoot,
                KEC_EMBED_PROVIDER: "secret-provider-model",
              },
              fixture.fixtureRoot,
            ),
          expected: batchIndexErrors.invalidConfiguration,
        },
        {
          operation: () =>
            batchModule.prepareKecBatchIndex(config, { sources: [42] }),
          expected: batchIndexErrors.invalidArgument,
        },
        {
          operation: () =>
            batchModule.prepareKecBatchIndex(config, {
              sources: [firstCanonicalSource, firstCanonicalSource],
            }),
          expected: batchIndexErrors.duplicateSource,
        },
        {
          operation: () =>
            batchModule.prepareKecBatchIndex(config, {
              sources: ["knowledge/secret-missing.pdf"],
            }),
          expected: batchIndexErrors.sourceNotFound,
        },
        {
          operation: () =>
            batchModule.prepareKecBatchIndex(config, {
              sources: ["knowledge/secret-directory.pdf"],
            }),
          expected: batchIndexErrors.sourceNotRegularFile,
        },
        {
          operation: () =>
            batchModule.prepareKecBatchIndex(config, {
              sources: ["knowledge/secret-source.txt"],
            }),
          expected: batchIndexErrors.unsupportedSource,
        },
        {
          operation: () =>
            batchModule.prepareKecBatchIndex(config, {
              sources: ["../secret-outside.pdf"],
            }),
          expected: batchIndexErrors.unsafeSource,
        },
      ];
      const forbidden = [
        fixture.projectRoot,
        fixture.databasePath,
        "secret-database-path",
        "secret-provider-model",
        "secret-missing.pdf",
        "secret-directory.pdf",
        "secret-source.txt",
        "secret-outside.pdf",
        "secret-api-key-value",
        "ENOENT",
        "stack",
        "cause",
      ];

      for (const testCase of cases) {
        const message = captureErrorMessage(testCase.operation);
        expect(message).toBe(testCase.expected);
        for (const sentinel of forbidden)
          expect(message).not.toContain(sentinel);
      }
    });
  });

  it("rejects symlink escape and alias collisions without disclosing link targets", async () => {
    await withFixture(async (fixture) => {
      const batchModule = await loadBatchModule();
      const config = validConfig(batchModule, fixture);
      const escape = fixture.tryCreateSymlink(
        fixture.outsideAbsoluteSource,
        "knowledge/secret-link.pdf",
      );
      const alias = fixture.tryCreateSymlink(
        fixture.firstAbsoluteSource,
        "knowledge/secret-alias.pdf",
      );
      if (!escape.supported || !alias.supported) return;

      const escapeMessage = captureErrorMessage(() =>
        batchModule.prepareKecBatchIndex(config, {
          sources: ["knowledge/secret-link.pdf"],
        }),
      );
      const duplicateMessage = captureErrorMessage(() =>
        batchModule.prepareKecBatchIndex(config, {
          sources: [firstCanonicalSource, "knowledge/secret-alias.pdf"],
        }),
      );
      expect(escapeMessage).toBe(batchIndexErrors.unsafeSource);
      expect(duplicateMessage).toBe(batchIndexErrors.duplicateSource);
      for (const message of [escapeMessage, duplicateMessage]) {
        expect(message).not.toContain(fixture.outsideAbsoluteSource);
        expect(message).not.toContain(fixture.firstAbsoluteSource);
        expect(message).not.toContain("secret-link.pdf");
        expect(message).not.toContain("secret-alias.pdf");
      }
    });
  });

  it("creates only full deterministic pseudonymous source IDs and makes no secrecy claim", async () => {
    await withFixture(async (fixture) => {
      const batchModule = await loadBatchModule();
      const plan = batchModule.prepareKecBatchIndex(
        validConfig(batchModule, fixture),
        { sources: [firstCanonicalSource] },
      );
      const expected = expectedBatchSourceId(firstCanonicalSource);

      expect(plan.sources[0].sourceId).toBe(expected);
      expect(plan.sources[0].sourceId).toMatch(/^kecsrc_[0-9a-f]{64}$/u);
      expect(plan.sources[0].sourceId).not.toContain(firstCanonicalSource);
      expect(plan.sources[0].sourceId).toHaveLength("kecsrc_".length + 64);
    });
  });

  it("keeps the future pure namespace free of database, provider, parser, indexing, search, MCP, process, and network authority", () => {
    for (const path of [configPath, preflightPath, barrelPath]) {
      expect(existsSync(path)).toBe(true);
      const source = readFileSync(path, "utf8");
      expect(source).not.toMatch(
        /node:sqlite|Sqlite|VectorStore|EmbeddingProvider|createEmbeddingProvider|indexKec|readPdf|pdfjs|createPageChunks|searchKec|VoltAiTool|modelcontextprotocol|runStdioServer|child_process|localeCompare|\bfetch\s*\(|XMLHttpRequest|WebSocket|console\.|logger|process\.exit|process\.stdout|process\.stderr/iu,
      );
      expect(source).not.toMatch(
        /\b(?:eval|Function)\s*\(|new\s+Function|WeakMap|WeakSet|\b(?:let|var)\s+cache\b/iu,
      );
    }
  });

  it("does not encode whole-batch atomicity, smoke coupling, unchanged detection, content deduplication, deletion, or stable-move claims", () => {
    for (const path of [configPath, preflightPath, barrelPath]) {
      expect(existsSync(path)).toBe(true);
      const source = readFileSync(path, "utf8");
      expect(source).not.toMatch(
        /whole.?batch.?atomic|smokeOllama|unchanged|content.?dedup|deleteBySourcePath|stale.?source|stable.?across.?move/iu,
      );
    }
  });
});

describe("Task 58 preflight no-side-effect contract", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not call network, logging, output, process exit, PDF parsing, provider, store, or indexing authority", async () => {
    await withFixture(async (fixture) => {
      const fetch = vi.fn();
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const stdout = vi
        .spyOn(process.stdout, "write")
        .mockImplementation(() => true);
      const stderr = vi
        .spyOn(process.stderr, "write")
        .mockImplementation(() => true);
      const exit = vi
        .spyOn(process, "exit")
        .mockImplementation((() => undefined) as never);
      vi.stubGlobal("fetch", fetch);
      const batchModule = await loadBatchModule();
      const plan = batchModule.prepareKecBatchIndex(
        validConfig(batchModule, fixture),
        { sources: [firstCanonicalSource] },
      );

      expect(plan.sources).toHaveLength(1);
      expect(fetch).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
      expect(stdout).not.toHaveBeenCalled();
      expect(stderr).not.toHaveBeenCalled();
      expect(exit).not.toHaveBeenCalled();
      expect(existsSync(fixture.databasePath)).toBe(false);
      expect(existsSync(dirname(fixture.databasePath))).toBe(false);
      assertNoBatchArtifacts(fixture.fixtureRoot);
    });
  });

  it("leaves no database or artifact after every preflight failure", async () => {
    await withFixture(async (fixture) => {
      const batchModule = await loadBatchModule();
      const config = validConfig(batchModule, fixture);
      expect(
        captureErrorMessage(() =>
          batchModule.prepareKecBatchIndex(config, {
            sources: ["knowledge/missing.pdf"],
          }),
        ),
      ).toBe(batchIndexErrors.sourceNotFound);

      expect(existsSync(fixture.databasePath)).toBe(false);
      expect(existsSync(dirname(fixture.databasePath))).toBe(false);
      assertNoBatchArtifacts(fixture.fixtureRoot);
    });
  });
});
