import { existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  batchEnvironment,
  batchIndexErrors,
  batchRequest,
  captureErrorMessage,
  createHostileCoercionValue,
  createKecBatchIndexFixture,
  defaultBatchExecutionOptions,
  expectedBatchSourceId,
  expectedSourceIdOrder,
  firstCanonicalSource,
  nullPrototypeBatchRequest,
  sameBytesSource,
  secondCanonicalSource,
  unicodeCanonicalSource,
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

type PreparedSource = Readonly<{ sourcePath: string; sourceId: string }>;

type PreparedPlan = BatchConfig &
  Readonly<{
    sources: readonly PreparedSource[];
  }>;

type ConfigModule = Readonly<{
  readKecBatchIndexConfig: (environment: unknown, cwd: string) => BatchConfig;
}>;

type PreflightModule = Readonly<{
  prepareKecBatchIndex: (config: BatchConfig, request: unknown) => PreparedPlan;
}>;

const testFile = fileURLToPath(import.meta.url);
const packageRoot = join(dirname(testFile), "..");
const configModulePath = fileURLToPath(
  new URL("../src/batchIndexing/readKecBatchIndexConfig.ts", import.meta.url),
);
const preflightModulePath = fileURLToPath(
  new URL("../src/batchIndexing/prepareKecBatchIndex.ts", import.meta.url),
);

async function loadConfigModule(): Promise<ConfigModule> {
  return (await import(/* @vite-ignore */ configModulePath)) as ConfigModule;
}

async function loadPreflightModule(): Promise<PreflightModule> {
  return (await import(
    /* @vite-ignore */ preflightModulePath
  )) as PreflightModule;
}

async function loadPreflight(): Promise<{
  readConfig: ConfigModule["readKecBatchIndexConfig"];
  prepare: PreflightModule["prepareKecBatchIndex"];
}> {
  const [configModule, preflightModule] = await Promise.all([
    loadConfigModule(),
    loadPreflightModule(),
  ]);
  return {
    readConfig: configModule.readKecBatchIndexConfig,
    prepare: preflightModule.prepareKecBatchIndex,
  };
}

function expectFailure(operation: () => unknown, expected: string): void {
  expect(captureErrorMessage(operation)).toBe(expected);
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
  readConfig: ConfigModule["readKecBatchIndexConfig"],
  fixture: KecBatchIndexFixture,
  overrides: Readonly<Record<string, unknown>> = {},
): BatchConfig {
  return readConfig(
    batchEnvironment(fixture.projectRoot, overrides),
    fixture.fixtureRoot,
  );
}

describe("Task 58 batch configuration preflight", () => {
  it("is RED until the approved configuration and preflight modules exist", () => {
    expect(existsSync(configModulePath)).toBe(true);
    expect(existsSync(preflightModulePath)).toBe(true);
  });

  it("reads current defaults and derives the existing default database path without creating it", async () => {
    await withFixture(async (fixture) => {
      const { readConfig } = await loadPreflight();
      const config = validConfig(readConfig, fixture);

      expect(config).toEqual({
        projectRoot: fixture.projectRoot,
        databasePath: fixture.databasePath,
        provider: "placeholder",
        ...defaultBatchExecutionOptions,
      });
      expect(existsSync(fixture.databasePath)).toBe(false);
      expect(existsSync(dirname(fixture.databasePath))).toBe(false);
    });
  });

  it("accepts explicit existing provider, database, concurrency, retry, and Ollama settings", async () => {
    await withFixture(async (fixture) => {
      const { readConfig } = await loadPreflight();
      const explicitDatabase = "relative-index/kec.sqlite";
      const config = validConfig(readConfig, fixture, {
        KEC_DB_PATH: explicitDatabase,
        KEC_EMBED_PROVIDER: "ollama",
        OLLAMA_BASE_URL: "http://localhost:11434",
        OLLAMA_EMBED_MODEL: "nomic-embed-text",
        OLLAMA_EMBED_TIMEOUT_MS: "30000",
        KEC_EMBED_CONCURRENCY: "7",
        KEC_EMBED_MAX_ATTEMPTS: "5",
        KEC_EMBED_RETRY_DELAY_MS: "0",
      });

      expect(config).toEqual({
        projectRoot: fixture.projectRoot,
        databasePath: resolve(fixture.fixtureRoot, explicitDatabase),
        provider: "ollama",
        concurrency: 7,
        maxAttempts: 5,
        retryDelayMs: 0,
      });
      expect(existsSync(config.databasePath)).toBe(false);
    });
  });

  it("reads only selected own data descriptors without enumeration or unrelated getter execution", async () => {
    await withFixture(async (fixture) => {
      const { readConfig } = await loadPreflight();
      let ownKeysCalls = 0;
      let unrelatedGetterCalls = 0;
      const target = batchEnvironment(fixture.projectRoot);
      Object.defineProperty(target, "UNRELATED_SECRET", {
        enumerable: true,
        get: () => {
          unrelatedGetterCalls += 1;
          throw new Error("unrelated getter sentinel");
        },
      });
      const environment = new Proxy(target, {
        ownKeys: () => {
          ownKeysCalls += 1;
          throw new Error("environment enumeration sentinel");
        },
      });

      expect(readConfig(environment, fixture.fixtureRoot).provider).toBe(
        "placeholder",
      );
      expect(ownKeysCalls).toBe(0);
      expect(unrelatedGetterCalls).toBe(0);
    });
  });

  it("ignores inherited selected values and rejects selected accessors without invoking them", async () => {
    await withFixture(async (fixture) => {
      const { readConfig } = await loadPreflight();
      let getterCalls = 0;
      const inherited = Object.create({
        PROJECT_ROOT: fixture.projectRoot,
        KEC_EMBED_PROVIDER: "placeholder",
      }) as Record<string, unknown>;
      expectFailure(
        () => readConfig(inherited, fixture.fixtureRoot),
        batchIndexErrors.invalidConfiguration,
      );

      const accessor = batchEnvironment(fixture.projectRoot);
      Object.defineProperty(accessor, "KEC_EMBED_PROVIDER", {
        enumerable: true,
        get: () => {
          getterCalls += 1;
          return "placeholder";
        },
      });
      expectFailure(
        () => readConfig(accessor, fixture.fixtureRoot),
        batchIndexErrors.invalidConfiguration,
      );
      expect(getterCalls).toBe(0);
    });
  });

  it.each([
    [null, "null environment"],
    [[], "array environment"],
    ["environment", "primitive environment"],
  ])("rejects %s as configuration (%s)", async (environment) => {
    const { readKecBatchIndexConfig } = await loadConfigModule();
    expectFailure(
      () => readKecBatchIndexConfig(environment, process.cwd()),
      batchIndexErrors.invalidConfiguration,
    );
  });

  it.each([
    ["KEC_EMBED_PROVIDER", "", "present-empty provider"],
    ["KEC_EMBED_PROVIDER", "openai", "unsupported provider"],
    ["KEC_EMBED_CONCURRENCY", "0", "zero concurrency"],
    ["KEC_EMBED_CONCURRENCY", "1.5", "fractional concurrency"],
    ["KEC_EMBED_MAX_ATTEMPTS", "0", "zero attempts"],
    ["KEC_EMBED_MAX_ATTEMPTS", " 2", "trim-dependent attempts"],
    ["KEC_EMBED_RETRY_DELAY_MS", "-1", "negative retry delay"],
    ["KEC_EMBED_RETRY_DELAY_MS", "", "present-empty retry delay"],
    ["OLLAMA_EMBED_TIMEOUT_MS", "0", "zero Ollama timeout"],
    ["OLLAMA_EMBED_TIMEOUT_MS", "invalid", "malformed Ollama timeout"],
  ])("rejects malformed %s value %s (%s)", async (key, value) => {
    await withFixture(async (fixture) => {
      const { readConfig } = await loadPreflight();
      expectFailure(
        () => validConfig(readConfig, fixture, { [key]: value }),
        batchIndexErrors.invalidConfiguration,
      );
    });
  });

  it("distinguishes absent values from present undefined or empty values", async () => {
    await withFixture(async (fixture) => {
      const { readConfig } = await loadPreflight();
      expect(validConfig(readConfig, fixture).concurrency).toBe(4);

      for (const value of [undefined, ""]) {
        expectFailure(
          () =>
            validConfig(readConfig, fixture, {
              KEC_EMBED_CONCURRENCY: value,
            }),
          batchIndexErrors.invalidConfiguration,
        );
      }
    });
  });

  it.each([
    [undefined, "missing project root"],
    ["", "empty project root"],
    ["relative/project", "relative project root"],
    ["/missing/task-58-project-root", "missing project root"],
  ])("rejects %s for %s", async (projectRoot) => {
    const { readKecBatchIndexConfig } = await loadConfigModule();
    expectFailure(
      () =>
        readKecBatchIndexConfig(
          {
            PROJECT_ROOT: projectRoot,
            KEC_EMBED_PROVIDER: "placeholder",
          },
          process.cwd(),
        ),
      batchIndexErrors.invalidConfiguration,
    );
  });

  it("rejects a regular file as PROJECT_ROOT and rejects malformed database paths without creating them", async () => {
    await withFixture(async (fixture) => {
      const { readConfig } = await loadPreflight();
      expectFailure(
        () =>
          readConfig(
            batchEnvironment(fixture.firstAbsoluteSource),
            fixture.fixtureRoot,
          ),
        batchIndexErrors.invalidConfiguration,
      );

      for (const databasePath of ["", "unsafe\0index.sqlite", 42]) {
        expectFailure(
          () => validConfig(readConfig, fixture, { KEC_DB_PATH: databasePath }),
          batchIndexErrors.invalidConfiguration,
        );
      }
      expect(existsSync(fixture.databasePath)).toBe(false);
    });
  });
});

describe("Task 58 request and source preflight", () => {
  it("accepts exact plain and null-prototype requests", async () => {
    await withFixture(async (fixture) => {
      const { readConfig, prepare } = await loadPreflight();
      const config = validConfig(readConfig, fixture);

      for (const request of [
        batchRequest([firstCanonicalSource]),
        nullPrototypeBatchRequest([firstCanonicalSource]),
      ]) {
        expect(prepare(config, request).sources).toEqual([
          {
            sourcePath: firstCanonicalSource,
            sourceId: expectedBatchSourceId(firstCanonicalSource),
          },
        ]);
      }
    });
  });

  it.each([null, [], "request", 42, true])(
    "rejects invalid request root %s",
    async (request) => {
      await withFixture(async (fixture) => {
        const { readConfig, prepare } = await loadPreflight();
        expectFailure(
          () => prepare(validConfig(readConfig, fixture), request),
          batchIndexErrors.invalidArgument,
        );
      });
    },
  );

  it("rejects missing, inherited, accessor, extra, symbol, and custom-prototype request fields", async () => {
    await withFixture(async (fixture) => {
      const { readConfig, prepare } = await loadPreflight();
      const config = validConfig(readConfig, fixture);
      let getterCalls = 0;
      const accessor = {};
      Object.defineProperty(accessor, "sources", {
        enumerable: true,
        get: () => {
          getterCalls += 1;
          return [firstCanonicalSource];
        },
      });
      const inherited = Object.create({
        sources: [firstCanonicalSource],
      }) as Record<string, unknown>;
      const extra = { sources: [firstCanonicalSource], extra: true };
      const symbol = { sources: [firstCanonicalSource] };
      Object.defineProperty(symbol, Symbol("secret"), { value: true });
      const customPrototype = Object.create({ custom: true }) as Record<
        string,
        unknown
      >;
      customPrototype.sources = [firstCanonicalSource];

      for (const request of [
        {},
        inherited,
        accessor,
        extra,
        symbol,
        customPrototype,
      ]) {
        expectFailure(
          () => prepare(config, request),
          batchIndexErrors.invalidArgument,
        );
      }
      expect(getterCalls).toBe(0);
    });
  });

  it("rejects empty, sparse, accessor-backed, inherited, typed, custom-prototype, and decorated source arrays", async () => {
    await withFixture(async (fixture) => {
      const { readConfig, prepare } = await loadPreflight();
      const config = validConfig(readConfig, fixture);
      let getterCalls = 0;
      const sparse = new Array<string>(1);
      const accessor = [firstCanonicalSource];
      Object.defineProperty(accessor, "0", {
        enumerable: true,
        get: () => {
          getterCalls += 1;
          return firstCanonicalSource;
        },
      });
      const inherited = new Array<string>(1);
      Object.setPrototypeOf(inherited, {
        0: firstCanonicalSource,
        length: 1,
        __proto__: Array.prototype,
      });
      const customPrototype = [firstCanonicalSource];
      Object.setPrototypeOf(customPrototype, Object.create(Array.prototype));
      const extra = [firstCanonicalSource] as string[] & { extra?: boolean };
      extra.extra = true;
      const symbol = [firstCanonicalSource];
      Object.defineProperty(symbol, Symbol("secret"), { value: true });

      for (const sources of [
        [],
        sparse,
        accessor,
        inherited,
        new Uint8Array([1]),
        customPrototype,
        extra,
        symbol,
      ]) {
        expectFailure(
          () => prepare(config, { sources }),
          batchIndexErrors.invalidArgument,
        );
      }
      expect(getterCalls).toBe(0);
    });
  });

  it.each([
    ["", batchIndexErrors.invalidArgument],
    ["unsafe\0.pdf", batchIndexErrors.unsafeSource],
    [new String(firstCanonicalSource), batchIndexErrors.invalidArgument],
    [42, batchIndexErrors.invalidArgument],
  ])("rejects invalid source value %s", async (source, expected) => {
    await withFixture(async (fixture) => {
      const { readConfig, prepare } = await loadPreflight();
      expectFailure(
        () => prepare(validConfig(readConfig, fixture), { sources: [source] }),
        expected,
      );
    });
  });

  it("does not coerce hostile source values", async () => {
    await withFixture(async (fixture) => {
      const { readConfig, prepare } = await loadPreflight();
      const counter = { count: 0 };
      const hostile = createHostileCoercionValue(counter);
      expectFailure(
        () => prepare(validConfig(readConfig, fixture), { sources: [hostile] }),
        batchIndexErrors.invalidArgument,
      );
      expect(counter.count).toBe(0);
    });
  });

  it.each([
    ["./knowledge/kec-a.pdf", batchIndexErrors.unsafeSource],
    ["knowledge//kec-a.pdf", batchIndexErrors.unsafeSource],
    ["knowledge/../knowledge/kec-a.pdf", batchIndexErrors.unsafeSource],
    ["knowledge\\kec-a.pdf", batchIndexErrors.unsafeSource],
    [".", batchIndexErrors.unsafeSource],
    ["..", batchIndexErrors.unsafeSource],
    ["../outside.pdf", batchIndexErrors.unsafeSource],
    ["knowledge/kec-a.txt", batchIndexErrors.unsupportedSource],
    ["knowledge/missing.pdf", batchIndexErrors.sourceNotFound],
  ])("rejects noncanonical source spelling %s", async (source, expected) => {
    await withFixture(async (fixture) => {
      const { readConfig, prepare } = await loadPreflight();
      expectFailure(
        () => prepare(validConfig(readConfig, fixture), { sources: [source] }),
        expected,
      );
    });
  });

  it("rejects absolute source paths and directories named .pdf", async () => {
    await withFixture(async (fixture) => {
      const { readConfig, prepare } = await loadPreflight();
      const config = validConfig(readConfig, fixture);
      fixture.createProjectDirectory("knowledge/directory.pdf");

      expectFailure(
        () => prepare(config, { sources: [fixture.firstAbsoluteSource] }),
        batchIndexErrors.unsafeSource,
      );
      expectFailure(
        () => prepare(config, { sources: ["knowledge/directory.pdf"] }),
        batchIndexErrors.sourceNotRegularFile,
      );
    });
  });

  it("accepts canonical nested and Unicode PDF paths exactly without repair", async () => {
    await withFixture(async (fixture) => {
      const { readConfig, prepare } = await loadPreflight();
      const plan = prepare(validConfig(readConfig, fixture), {
        sources: [unicodeCanonicalSource, secondCanonicalSource],
      });

      expect(new Set(plan.sources.map((source) => source.sourcePath))).toEqual(
        new Set([unicodeCanonicalSource, secondCanonicalSource]),
      );
    });
  });

  it("rejects in-root symlink aliases and symlink escapes without exposing targets", async () => {
    await withFixture(async (fixture) => {
      const { readConfig, prepare } = await loadPreflight();
      const config = validConfig(readConfig, fixture);
      const alias = fixture.tryCreateSymlink(
        fixture.firstAbsoluteSource,
        "knowledge/alias.pdf",
      );
      const escape = fixture.tryCreateSymlink(
        fixture.outsideAbsoluteSource,
        "knowledge/escape.pdf",
      );
      if (!alias.supported || !escape.supported) return;

      expectFailure(
        () => prepare(config, { sources: ["knowledge/alias.pdf"] }),
        batchIndexErrors.unsafeSource,
      );
      expectFailure(
        () => prepare(config, { sources: ["knowledge/escape.pdf"] }),
        batchIndexErrors.unsafeSource,
      );
    });
  });

  it.each([
    [firstCanonicalSource, firstCanonicalSource],
    [firstCanonicalSource, `./${firstCanonicalSource}`],
  ])("rejects duplicate source forms %s and %s", async (left, right) => {
    await withFixture(async (fixture) => {
      const { readConfig, prepare } = await loadPreflight();
      expectFailure(
        () =>
          prepare(validConfig(readConfig, fixture), {
            sources: [left, right],
          }),
        batchIndexErrors.duplicateSource,
      );
    });
  });

  it("rejects a real path plus symlink alias as a duplicate resolved source", async () => {
    await withFixture(async (fixture) => {
      const { readConfig, prepare } = await loadPreflight();
      const alias = fixture.tryCreateSymlink(
        fixture.firstAbsoluteSource,
        "knowledge/alias.pdf",
      );
      if (!alias.supported) return;

      expectFailure(
        () =>
          prepare(validConfig(readConfig, fixture), {
            sources: [firstCanonicalSource, "knowledge/alias.pdf"],
          }),
        batchIndexErrors.duplicateSource,
      );
    });
  });

  it("allows identical bytes at different canonical paths without content deduplication", async () => {
    await withFixture(async (fixture) => {
      const { readConfig, prepare } = await loadPreflight();
      const plan = prepare(validConfig(readConfig, fixture), {
        sources: [sameBytesSource, firstCanonicalSource],
      });

      expect(plan.sources).toHaveLength(2);
      expect(new Set(plan.sources.map((source) => source.sourcePath))).toEqual(
        new Set([sameBytesSource, firstCanonicalSource]),
      );
      expect(new Set(plan.sources.map((source) => source.sourceId)).size).toBe(
        2,
      );
    });
  });

  it("computes full Task 56-compatible source IDs from canonical UTF-8 paths", async () => {
    await withFixture(async (fixture) => {
      const { readConfig, prepare } = await loadPreflight();
      const plan = prepare(validConfig(readConfig, fixture), {
        sources: [unicodeCanonicalSource],
      });
      const expected = expectedBatchSourceId(unicodeCanonicalSource);

      expect(plan.sources[0]).toEqual({
        sourcePath: unicodeCanonicalSource,
        sourceId: expected,
      });
      expect(expected).toMatch(/^kecsrc_[0-9a-f]{64}$/u);
    });
  });

  it("sorts by full source ID independently of caller order without localeCompare", async () => {
    await withFixture(async (fixture) => {
      const { readConfig, prepare } = await loadPreflight();
      const config = validConfig(readConfig, fixture);
      const sourcePaths = [
        firstCanonicalSource,
        secondCanonicalSource,
        unicodeCanonicalSource,
      ];
      const forwardInput = [...sourcePaths];
      const reverseInput = [...sourcePaths].reverse();
      const forward = prepare(config, { sources: forwardInput });
      const reverse = prepare(config, { sources: reverseInput });
      const expected = expectedSourceIdOrder(sourcePaths);

      expect(forward.sources.map((source) => source.sourceId)).toEqual(
        expected,
      );
      expect(reverse.sources.map((source) => source.sourceId)).toEqual(
        expected,
      );
      expect(forwardInput).toEqual(sourcePaths);
      expect(reverseInput).toEqual([...sourcePaths].reverse());
    });
  });

  it("returns fresh deeply frozen plans without retaining caller arrays or objects", async () => {
    await withFixture(async (fixture) => {
      const { readConfig, prepare } = await loadPreflight();
      const config = validConfig(readConfig, fixture);
      const inputSources = [secondCanonicalSource, firstCanonicalSource];
      const request = { sources: inputSources };
      const first = prepare(config, request);
      const second = prepare(config, request);

      expect(first).toEqual(second);
      expect(first).not.toBe(second);
      expect(first.sources).not.toBe(second.sources);
      expect(first.sources).not.toBe(inputSources);
      expect(Object.isFrozen(first)).toBe(true);
      expect(Object.isFrozen(first.sources)).toBe(true);
      expect(first.sources.every(Object.isFrozen)).toBe(true);
      expect(
        first.sources.every(
          (source, index) => source !== second.sources[index],
        ),
      ).toBe(true);
      expect(inputSources).toEqual([
        secondCanonicalSource,
        firstCanonicalSource,
      ]);
    });
  });

  it("does not retain or mutate configuration, request, environment, or source arrays", async () => {
    await withFixture(async (fixture) => {
      const { readConfig, prepare } = await loadPreflight();
      const environment = batchEnvironment(fixture.projectRoot);
      const config = readConfig(environment, fixture.fixtureRoot);
      const sources = [firstCanonicalSource];
      const request = { sources };
      const environmentSnapshot = Object.getOwnPropertyDescriptors(environment);
      const requestSnapshot = Object.getOwnPropertyDescriptors(request);
      const plan = prepare(config, request);

      expect(Object.getOwnPropertyDescriptors(environment)).toEqual(
        environmentSnapshot,
      );
      expect(Object.getOwnPropertyDescriptors(request)).toEqual(
        requestSnapshot,
      );
      expect(plan).not.toBe(config);
      expect(plan.sources).not.toBe(sources);
      expect(sources).toEqual([firstCanonicalSource]);
    });
  });

  it("treats source files as preflight-only regular files without parsing their bytes", async () => {
    await withFixture(async (fixture) => {
      const { readConfig, prepare } = await loadPreflight();
      const placeholderPath = fixture.writeProjectFile(
        "knowledge/not-a-real-pdf.pdf",
        "plain fixture bytes that must not be parsed",
      );
      expect(() =>
        prepare(validConfig(readConfig, fixture), {
          sources: ["knowledge/not-a-real-pdf.pdf"],
        }),
      ).not.toThrow();
      expect(existsSync(placeholderPath)).toBe(true);
    });
  });

  it("rejects a source removed after fixture setup as not found", async () => {
    await withFixture(async (fixture) => {
      const { readConfig, prepare } = await loadPreflight();
      const transient = fixture.writeProjectFile("knowledge/transient.pdf");
      rmSync(transient);
      expect(existsSync(transient)).toBe(false);
      expectFailure(
        () =>
          prepare(validConfig(readConfig, fixture), {
            sources: ["knowledge/transient.pdf"],
          }),
        batchIndexErrors.sourceNotFound,
      );
    });
  });
});

describe("Task 58 preflight deterministic error behavior", () => {
  it("uses one fixed error message across repeated identical failures", async () => {
    await withFixture(async (fixture) => {
      const { readConfig, prepare } = await loadPreflight();
      const config = validConfig(readConfig, fixture);
      const messages = Array.from({ length: 20 }, () =>
        captureErrorMessage(() =>
          prepare(config, { sources: ["knowledge/missing.pdf"] }),
        ),
      );
      expect(new Set(messages)).toEqual(
        new Set([batchIndexErrors.sourceNotFound]),
      );
    });
  });

  it("never includes package or repository paths in fixed preflight errors", async () => {
    await withFixture(async (fixture) => {
      const { readConfig, prepare } = await loadPreflight();
      const message = captureErrorMessage(() =>
        prepare(validConfig(readConfig, fixture), {
          sources: ["knowledge/missing-private-name.pdf"],
        }),
      );
      expect(Object.values(batchIndexErrors)).toContain(message);
      expect(message).not.toContain(packageRoot);
      expect(message).not.toContain(fixture.projectRoot);
      expect(message).not.toContain("missing-private-name.pdf");
    });
  });
});
