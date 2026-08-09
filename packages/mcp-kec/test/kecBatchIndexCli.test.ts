import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  KecBatchIndexConfig,
  KecBatchIndexExecutionDependencies,
  KecBatchIndexResultV1,
  PreparedKecBatchIndex,
} from "../src/batchIndexing/index.js";
import { SqliteVectorStore } from "../src/knowledge/sqliteVectorStore.js";
import * as packageRoot from "../src/index.js";
import {
  batchIndexErrors,
  captureTask58ArtifactBoundary,
  createKecBatchIndexFixture,
  createHostileThrownValue,
  expectedBatchSourceId,
  firstCanonicalSource,
  secondCanonicalSource,
} from "./helpers/kecBatchIndexFixture.js";

type KecBatchIndexCliDependencies = Readonly<{
  cwd: string;
  readConfig: (environment: unknown, cwd: string) => KecBatchIndexConfig;
  prepare: (
    config: KecBatchIndexConfig,
    request: unknown,
  ) => PreparedKecBatchIndex;
  execute: (
    prepared: PreparedKecBatchIndex,
    dependencies: KecBatchIndexExecutionDependencies,
  ) => Promise<KecBatchIndexResultV1>;
  serialize: (result: KecBatchIndexResultV1) => string;
  createExecutionDependencies: (
    prepared: PreparedKecBatchIndex,
  ) => KecBatchIndexExecutionDependencies;
  writeStdout: (text: string) => void;
  writeStderr: (text: string) => void;
}>;

type KecBatchIndexCliModule = Readonly<{
  runKecBatchIndexCli: (
    argv: readonly string[],
    environment: unknown,
    dependencies: KecBatchIndexCliDependencies,
  ) => Promise<number>;
  main: () => Promise<void>;
}>;

const testFile = fileURLToPath(import.meta.url);
const packageDirectory = join(dirname(testFile), "..");
const workspaceRoot = resolve(packageDirectory, "..", "..");
const cliSourcePath = join(packageDirectory, "src", "indexKecBatch.ts");
const directoryCliSourcePath = join(
  packageDirectory,
  "src",
  "indexKecDirectory.ts",
);
const runtimeBindingSourcePath = join(
  packageDirectory,
  "src",
  "batchIndexing",
  "createKecBatchExecutionDependencies.ts",
);
const packageIndexPath = join(packageDirectory, "src", "index.ts");
const batchBarrelPath = join(
  packageDirectory,
  "src",
  "batchIndexing",
  "index.ts",
);
const typescriptCli = join(
  workspaceRoot,
  "node_modules",
  "typescript",
  "bin",
  "tsc",
);
const approvedEnvironmentKeys = [
  "PROJECT_ROOT",
  "KEC_DB_PATH",
  "KEC_EMBED_PROVIDER",
  "OLLAMA_BASE_URL",
  "OLLAMA_EMBED_MODEL",
  "OLLAMA_EMBED_TIMEOUT_MS",
  "KEC_EMBED_CONCURRENCY",
  "KEC_EMBED_MAX_ATTEMPTS",
  "KEC_EMBED_RETRY_DELAY_MS",
] as const;
const preflightMessages = [
  batchIndexErrors.invalidConfiguration,
  batchIndexErrors.invalidArgument,
  batchIndexErrors.duplicateSource,
  batchIndexErrors.sourceNotFound,
  batchIndexErrors.sourceNotRegularFile,
  batchIndexErrors.unsupportedSource,
  batchIndexErrors.unsafeSource,
] as const;
const executionMessages = [
  batchIndexErrors.invalidConfiguration,
  batchIndexErrors.databaseUnavailable,
  batchIndexErrors.finalizationFailed,
  batchIndexErrors.internalError,
] as const;
let cliModule: Promise<KecBatchIndexCliModule> | undefined;

async function loadCliModule(): Promise<KecBatchIndexCliModule | undefined> {
  if (!existsSync(cliSourcePath)) return undefined;
  cliModule ??=
    import("../src/indexKecBatch.js") as Promise<KecBatchIndexCliModule>;
  return cliModule;
}

function moduleSpecifier(fromDirectory: string, targetPath: string): string {
  const path = relative(fromDirectory, targetPath)
    .replaceAll("\\", "/")
    .replace(/\.ts$/u, ".js");
  return path.startsWith(".") ? path : `./${path}`;
}

function compileCliTypeContract(): void {
  const temporaryRoot = mkdtempSync(
    join(tmpdir(), "voltai-kec-batch-cli-types-"),
  );
  const contractPath = join(temporaryRoot, "contract.ts");
  const cliModule = moduleSpecifier(temporaryRoot, cliSourcePath);
  const batchModule = moduleSpecifier(temporaryRoot, batchBarrelPath);
  const contract = `
import type {
  KecBatchIndexConfig,
  KecBatchIndexExecutionDependencies,
  KecBatchIndexResultV1,
  PreparedKecBatchIndex,
} from ${JSON.stringify(batchModule)};
import type { KecBatchIndexCliDependencies } from ${JSON.stringify(cliModule)};
import { main, runKecBatchIndexCli } from ${JSON.stringify(cliModule)};

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? (<Value>() => Value extends Right ? 1 : 2) extends
        (<Value>() => Value extends Left ? 1 : 2)
      ? true
      : false
    : false;
type Assert<Value extends true> = Value;
type ExpectedDependencies = Readonly<{
  cwd: string;
  readConfig: (environment: unknown, cwd: string) => KecBatchIndexConfig;
  prepare: (config: KecBatchIndexConfig, request: unknown) => PreparedKecBatchIndex;
  execute: (
    prepared: PreparedKecBatchIndex,
    dependencies: KecBatchIndexExecutionDependencies,
  ) => Promise<KecBatchIndexResultV1>;
  serialize: (result: KecBatchIndexResultV1) => string;
  createExecutionDependencies: (
    prepared: PreparedKecBatchIndex,
  ) => KecBatchIndexExecutionDependencies;
  writeStdout: (text: string) => void;
  writeStderr: (text: string) => void;
}>;
type ExpectedRunner = (
  argv: readonly string[],
  environment: unknown,
  dependencies: KecBatchIndexCliDependencies,
) => Promise<number>;

type _Dependencies = Assert<Equal<KecBatchIndexCliDependencies, ExpectedDependencies>>;
type _Runner = Assert<Equal<typeof runKecBatchIndexCli, ExpectedRunner>>;
type _Main = Assert<Equal<typeof main, () => Promise<void>>>;

declare const dependencies: KecBatchIndexCliDependencies;
// @ts-expect-error dependencies are readonly
dependencies.cwd = "/other";
// @ts-expect-error runner has exactly three arguments
runKecBatchIndexCli([], {}, dependencies, "extra");
`;

  try {
    writeFileSync(contractPath, contract, "utf8");
    execFileSync(
      process.execPath,
      [
        typescriptCli,
        "--noEmit",
        "--strict",
        "--target",
        "ES2022",
        "--module",
        "NodeNext",
        "--moduleResolution",
        "NodeNext",
        "--skipLibCheck",
        contractPath,
      ],
      { cwd: workspaceRoot, stdio: "pipe" },
    );
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function sourceResult(
  sourceId: string,
  status: "INDEXED" | "FAILED" | "NOT_ATTEMPTED",
  indexedChunkCount: number,
) {
  return Object.freeze({
    sourceId,
    status,
    indexedChunkCount,
    failureCode:
      status === "INDEXED"
        ? null
        : status === "FAILED"
          ? ("INDEXING_FAILED" as const)
          : ("NOT_ATTEMPTED" as const),
  });
}

function createTextPdf(text: string): string {
  const stream = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  for (const [index, object] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    pdf += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;

  return pdf;
}

function batchResult(
  status: "SUCCEEDED" | "PARTIAL" | "FAILED" = "SUCCEEDED",
): KecBatchIndexResultV1 {
  const firstId = expectedBatchSourceId(firstCanonicalSource);
  const secondId = expectedBatchSourceId(secondCanonicalSource);
  const sources =
    status === "SUCCEEDED"
      ? [sourceResult(firstId, "INDEXED", 2)]
      : status === "PARTIAL"
        ? [
            sourceResult(firstId, "INDEXED", 2),
            sourceResult(secondId, "FAILED", 0),
          ]
        : [sourceResult(firstId, "FAILED", 0)];

  return Object.freeze({
    schemaVersion: 1,
    status,
    requestedSourceCount: sources.length,
    indexedSourceCount:
      status === "SUCCEEDED" ? 1 : status === "PARTIAL" ? 1 : 0,
    failedSourceCount: status === "SUCCEEDED" ? 0 : 1,
    notAttemptedSourceCount: 0,
    indexedChunkCount: status === "SUCCEEDED" || status === "PARTIAL" ? 2 : 0,
    sources: Object.freeze(sources),
  });
}

function preparedPlan(sources = [firstCanonicalSource]): PreparedKecBatchIndex {
  return Object.freeze({
    projectRoot: "/virtual/project",
    databasePath: "/virtual/project/.voltai/kec.sqlite",
    provider: "placeholder",
    sources: Object.freeze(
      sources.map((sourcePath) =>
        Object.freeze({
          sourcePath,
          sourceId: expectedBatchSourceId(sourcePath),
        }),
      ),
    ),
    concurrency: 4,
    maxAttempts: 3,
    retryDelayMs: 100,
  });
}

function createHarness(
  options: Readonly<{
    result?: KecBatchIndexResultV1;
    environment?: unknown;
  }> = {},
) {
  const calls: string[] = [];
  const config: KecBatchIndexConfig = Object.freeze({
    projectRoot: "/virtual/project",
    databasePath: "/virtual/project/.voltai/kec.sqlite",
    provider: "placeholder",
    concurrency: 4,
    maxAttempts: 3,
    retryDelayMs: 100,
  });
  const prepared = preparedPlan();
  const result = options.result ?? batchResult();
  const executionDependencies: KecBatchIndexExecutionDependencies =
    Object.freeze({
      createProvider: vi.fn(() => ({})),
      createStore: vi.fn(() => ({})),
      indexSource: vi.fn(async () => ({ indexedChunks: 1 })),
      closeStore: vi.fn(),
      closeProvider: vi.fn(),
    });
  const readConfig = vi.fn((environment: unknown, cwd: string) => {
    calls.push("readConfig");
    void environment;
    void cwd;
    return config;
  });
  const prepare = vi.fn(
    (receivedConfig: KecBatchIndexConfig, request: unknown) => {
      calls.push("prepare");
      void receivedConfig;
      void request;
      return prepared;
    },
  );
  const createExecutionDependencies = vi.fn(
    (received: PreparedKecBatchIndex) => {
      calls.push("createExecutionDependencies");
      void received;
      return executionDependencies;
    },
  );
  const execute = vi.fn(async () => {
    calls.push("execute");
    return result;
  });
  const serialize = vi.fn(() => {
    calls.push("serialize");
    return '{"schemaVersion":1}\n';
  });
  const writeStdout = vi.fn((text: string) => {
    calls.push("stdout");
    void text;
  });
  const writeStderr = vi.fn((text: string) => {
    calls.push("stderr");
    void text;
  });
  const dependencies: KecBatchIndexCliDependencies = Object.freeze({
    cwd: "/virtual/cwd",
    readConfig,
    prepare,
    execute,
    serialize,
    createExecutionDependencies,
    writeStdout,
    writeStderr,
  });

  return {
    calls,
    config,
    prepared,
    result,
    executionDependencies,
    environment:
      options.environment ??
      Object.freeze({ PROJECT_ROOT: "/virtual/project" }),
    readConfig,
    prepare,
    createExecutionDependencies,
    execute,
    serialize,
    writeStdout,
    writeStderr,
    dependencies,
  };
}

async function runInvalidArgv(argv: unknown): Promise<void> {
  const module = await loadCliModule();
  if (!module) return;
  const harness = createHarness();

  const exitCode = await module.runKecBatchIndexCli(
    argv as readonly string[],
    harness.environment,
    harness.dependencies,
  );

  expect(exitCode).toBe(1);
  expect(harness.readConfig).not.toHaveBeenCalled();
  expect(harness.createExecutionDependencies).not.toHaveBeenCalled();
  expect(harness.writeStdout).not.toHaveBeenCalled();
  expect(harness.writeStderr).toHaveBeenCalledTimes(1);
  expect(harness.writeStderr).toHaveBeenCalledWith(
    `${batchIndexErrors.invalidArgument}\n`,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Task 58 batch index CLI module and import boundary", () => {
  it("is intentionally RED until the package-local CLI exists", () => {
    expect(existsSync(cliSourcePath)).toBe(true);
  });

  it("exports only the injected runner and guarded main function at runtime", async () => {
    const module = await loadCliModule();
    if (!module) return;

    expect(Object.keys(module).sort()).toEqual(["main", "runKecBatchIndexCli"]);
    expect(packageRoot).not.toHaveProperty("runKecBatchIndexCli");
    expect(packageRoot).not.toHaveProperty("KecBatchIndexCliDependencies");
  });

  it("compiles the exact readonly CLI dependency and three-argument runner types", () => {
    if (!existsSync(cliSourcePath)) return;
    expect(() => compileCliTypeContract()).not.toThrow();
  });

  it("imports in a subprocess without output or observable startup", () => {
    if (!existsSync(cliSourcePath)) return;
    const fixture = createKecBatchIndexFixture();
    try {
      fixture.writeProjectFile(".voltai/existing-user-index.sqlite", "user");
      fixture.writeProjectFile(".volt-ai/existing-user-index.db", "user");
      const before = captureTask58ArtifactBoundary(fixture.projectRoot);
      const result = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "--input-type=module",
          "--eval",
          `await import(${JSON.stringify(pathToFileURL(cliSourcePath).href)})`,
        ],
        {
          cwd: packageDirectory,
          encoding: "utf8",
          env: {
            ...process.env,
            NODE_NO_WARNINGS: "1",
            PROJECT_ROOT: fixture.projectRoot,
            KEC_DB_PATH: fixture.databasePath,
          },
          timeout: 10_000,
        },
      );

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
      expect(captureTask58ArtifactBoundary(fixture.projectRoot)).toBe(before);
    } finally {
      fixture.cleanup();
    }
  });

  it("has no import-time fetch, timers, output, process exit, or exit-code mutation", async () => {
    if (!existsSync(cliSourcePath)) return;
    vi.useFakeTimers();
    const originalExitCode = process.exitCode;
    const fetchFunction = vi.fn();
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    vi.stubGlobal("fetch", fetchFunction);

    try {
      process.exitCode = 74;
      await loadCliModule();
      expect(fetchFunction).not.toHaveBeenCalled();
      expect(stdout).not.toHaveBeenCalled();
      expect(stderr).not.toHaveBeenCalled();
      expect(exit).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(74);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      process.exitCode = originalExitCode;
    }
  });

  it("reports a source committed by the existing indexKec runtime as successful", async () => {
    const module = await loadCliModule();
    if (!module) return;
    const fixture = createKecBatchIndexFixture();
    fixture.writeProjectFile(
      firstCanonicalSource,
      createTextPdf("KEC 232.5 cable sizing rule"),
    );
    const originalArgv = process.argv;
    const originalExitCode = process.exitCode;
    const environmentKeys = [
      "PROJECT_ROOT",
      "KEC_DB_PATH",
      "KEC_EMBED_PROVIDER",
    ] as const;
    const originalEnvironment = new Map(
      environmentKeys.map((key) => [key, process.env[key]]),
    );
    let stdoutText = "";
    let stderrText = "";
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk) => {
        stdoutText += String(chunk);
        return true;
      });
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk) => {
        stderrText += String(chunk);
        return true;
      });

    try {
      process.argv = [process.execPath, cliSourcePath, firstCanonicalSource];
      process.exitCode = undefined;
      process.env.PROJECT_ROOT = fixture.projectRoot;
      process.env.KEC_DB_PATH = fixture.databasePath;
      process.env.KEC_EMBED_PROVIDER = "placeholder";

      await module.main();

      expect(stderr).not.toHaveBeenCalled();
      expect(stderrText).toBe("");
      expect(process.exitCode).toBe(0);
      expect(JSON.parse(stdoutText)).toMatchObject({
        status: "SUCCEEDED",
        indexedSourceCount: 1,
        failedSourceCount: 0,
        indexedChunkCount: 1,
        sources: [
          {
            status: "INDEXED",
            indexedChunkCount: 1,
            failureCode: null,
          },
        ],
      });

      const inspectionStore = new SqliteVectorStore(fixture.databasePath);
      try {
        expect(await inspectionStore.listChunks("kec")).toHaveLength(1);
      } finally {
        await inspectionStore.close();
      }
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      process.argv = originalArgv;
      process.exitCode = originalExitCode;
      for (const key of environmentKeys) {
        const value = originalEnvironment.get(key);
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      fixture.cleanup();
    }
  });
});

describe("Task 58 batch index CLI argument and request contracts", () => {
  it.each([
    [],
    [""],
    ["--help"],
    ["--version"],
    ["--recursive"],
    ["--continue-on-error"],
    ["-"],
    [firstCanonicalSource, 1],
  ])("rejects malformed positional argv %j before preflight", async (argv) => {
    await runInvalidArgv(argv);
  });

  it("rejects sparse, accessor, inherited, typed, decorated, symbol, and hostile argv", async () => {
    const sparse = new Array<string>(1);
    let accessorCalls = 0;
    const accessor = [firstCanonicalSource];
    Object.defineProperty(accessor, 0, {
      get: () => {
        accessorCalls += 1;
        return firstCanonicalSource;
      },
    });
    const inherited = [firstCanonicalSource];
    const inheritedPrototype = Object.create(Array.prototype) as unknown[];
    Object.defineProperty(inheritedPrototype, 0, {
      value: firstCanonicalSource,
    });
    delete inherited[0];
    Object.setPrototypeOf(inherited, inheritedPrototype);
    const decorated = [firstCanonicalSource];
    Object.defineProperty(decorated, "extra", { value: true });
    const symbol = [firstCanonicalSource];
    Object.defineProperty(symbol, Symbol("extra"), { value: true });
    const hostile = new Proxy([firstCanonicalSource], {
      getOwnPropertyDescriptor: () => {
        throw new Error("hostile argv descriptor trap");
      },
    });

    for (const argv of [
      sparse,
      accessor,
      inherited,
      new Uint8Array([1]),
      decorated,
      symbol,
      hostile,
    ]) {
      await runInvalidArgv(argv);
    }
    expect(accessorCalls).toBe(0);
  });

  it("maps one source to a fresh exact request without retaining or mutating argv", async () => {
    const module = await loadCliModule();
    if (!module) return;
    const harness = createHarness();
    const argv = Object.freeze([firstCanonicalSource]);
    const descriptors = Object.getOwnPropertyDescriptors(argv);

    await module.runKecBatchIndexCli(
      argv,
      harness.environment,
      harness.dependencies,
    );

    const request = harness.prepare.mock.calls[0]?.[1] as { sources: string[] };
    expect(Object.keys(request)).toEqual(["sources"]);
    expect(request.sources).toEqual(argv);
    expect(request.sources).not.toBe(argv);
    expect(Object.getPrototypeOf(request.sources)).toBe(Array.prototype);
    expect(Object.getOwnPropertyDescriptors(argv)).toEqual(descriptors);
  });

  it("preserves multiple caller arguments byte-for-byte and in caller order", async () => {
    const module = await loadCliModule();
    if (!module) return;
    const harness = createHarness();
    const argv = [secondCanonicalSource, firstCanonicalSource];

    await module.runKecBatchIndexCli(
      argv,
      harness.environment,
      harness.dependencies,
    );

    expect(harness.prepare.mock.calls[0]?.[1]).toEqual({ sources: argv });
    expect(argv).toEqual([secondCanonicalSource, firstCanonicalSource]);
  });
});

describe("Task 58 batch index CLI injected execution seam", () => {
  it("forwards the exact environment and injected cwd without enumeration or mutation", async () => {
    const module = await loadCliModule();
    if (!module) return;
    let getterCalls = 0;
    let enumerationCalls = 0;
    const target = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(target, "PROJECT_ROOT", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        throw new Error("environment getter sentinel");
      },
    });
    const environment = new Proxy(target, {
      ownKeys: () => {
        enumerationCalls += 1;
        throw new Error("environment enumeration sentinel");
      },
    });
    const harness = createHarness({ environment });

    await module.runKecBatchIndexCli(
      [firstCanonicalSource],
      environment,
      harness.dependencies,
    );

    expect(harness.readConfig).toHaveBeenCalledTimes(1);
    expect(harness.readConfig.mock.calls[0]?.[0]).toBe(environment);
    expect(harness.readConfig.mock.calls[0]?.[1]).toBe("/virtual/cwd");
    expect(getterCalls).toBe(0);
    expect(enumerationCalls).toBe(0);
  });

  it("runs readConfig, prepare, runtime binding, execute, serialize, and stdout in order", async () => {
    const module = await loadCliModule();
    if (!module) return;
    const harness = createHarness();

    const exitCode = await module.runKecBatchIndexCli(
      [firstCanonicalSource],
      harness.environment,
      harness.dependencies,
    );

    expect(exitCode).toBe(0);
    expect(harness.calls).toEqual([
      "readConfig",
      "prepare",
      "createExecutionDependencies",
      "execute",
      "serialize",
      "stdout",
    ]);
    expect(harness.createExecutionDependencies).toHaveBeenCalledWith(
      harness.prepared,
    );
    expect(harness.execute).toHaveBeenCalledWith(
      harness.prepared,
      harness.executionDependencies,
    );
    expect(harness.serialize).toHaveBeenCalledWith(harness.result);
  });

  it.each([
    ["SUCCEEDED", 0],
    ["PARTIAL", 2],
    ["FAILED", 2],
  ] as const)(
    "writes the serialized %s result once and exits %i",
    async (status, expectedExit) => {
      const module = await loadCliModule();
      if (!module) return;
      const harness = createHarness({ result: batchResult(status) });
      const bytes = `${status}\n`;
      harness.serialize.mockReturnValue(bytes);

      const exitCode = await module.runKecBatchIndexCli(
        [firstCanonicalSource],
        harness.environment,
        harness.dependencies,
      );

      expect(exitCode).toBe(expectedExit);
      expect(harness.writeStdout).toHaveBeenCalledTimes(1);
      expect(harness.writeStdout).toHaveBeenCalledWith(bytes);
      expect(harness.writeStderr).not.toHaveBeenCalled();
    },
  );

  it.each(preflightMessages)(
    "preserves fixed preflight failure %s",
    async (message) => {
      const module = await loadCliModule();
      if (!module) return;
      const harness = createHarness();
      harness.prepare.mockImplementation(() => {
        throw new Error(message);
      });

      const exitCode = await module.runKecBatchIndexCli(
        [firstCanonicalSource],
        harness.environment,
        harness.dependencies,
      );

      expect(exitCode).toBe(1);
      expect(harness.createExecutionDependencies).not.toHaveBeenCalled();
      expect(harness.execute).not.toHaveBeenCalled();
      expect(harness.writeStdout).not.toHaveBeenCalled();
      expect(harness.writeStderr).toHaveBeenCalledTimes(1);
      expect(harness.writeStderr).toHaveBeenCalledWith(`${message}\n`);
    },
  );

  it.each(executionMessages)(
    "preserves fixed execution failure %s",
    async (message) => {
      const module = await loadCliModule();
      if (!module) return;
      const harness = createHarness();
      harness.execute.mockRejectedValueOnce(new Error(message));

      const exitCode = await module.runKecBatchIndexCli(
        [firstCanonicalSource],
        harness.environment,
        harness.dependencies,
      );

      expect(exitCode).toBe(1);
      expect(harness.serialize).not.toHaveBeenCalled();
      expect(harness.writeStdout).not.toHaveBeenCalled();
      expect(harness.writeStderr).toHaveBeenCalledWith(`${message}\n`);
    },
  );

  it.each([
    "readConfig",
    "prepare",
    "createExecutionDependencies",
    "execute",
    "serialize",
  ] as const)(
    "normalizes a hostile unknown failure from %s without coercion",
    async (stage) => {
      const module = await loadCliModule();
      if (!module) return;
      const harness = createHarness();
      const hostile = createHostileThrownValue();
      if (stage === "execute")
        harness.execute.mockRejectedValueOnce(hostile.thrown);
      else {
        (harness[stage] as ReturnType<typeof vi.fn>).mockImplementationOnce(
          () => {
            throw hostile.thrown;
          },
        );
      }

      const exitCode = await module.runKecBatchIndexCli(
        [firstCanonicalSource],
        harness.environment,
        harness.dependencies,
      );

      expect(exitCode).toBe(1);
      expect(hostile.calls()).toBe(0);
      expect(harness.writeStdout).not.toHaveBeenCalled();
      expect(harness.writeStderr).toHaveBeenCalledWith(
        `${batchIndexErrors.internalError}\n`,
      );
    },
  );

  it("normalizes stdout writer failure once without duplicate stdout", async () => {
    const module = await loadCliModule();
    if (!module) return;
    const harness = createHarness();
    harness.writeStdout.mockImplementationOnce(() => {
      throw createHostileThrownValue().thrown;
    });

    const exitCode = await module.runKecBatchIndexCli(
      [firstCanonicalSource],
      harness.environment,
      harness.dependencies,
    );

    expect(exitCode).toBe(1);
    expect(harness.writeStdout).toHaveBeenCalledTimes(1);
    expect(harness.writeStderr).toHaveBeenCalledTimes(1);
    expect(harness.writeStderr).toHaveBeenCalledWith(
      `${batchIndexErrors.internalError}\n`,
    );
  });

  it("returns 1 without recursive logging when stderr itself throws", async () => {
    const module = await loadCliModule();
    if (!module) return;
    const harness = createHarness();
    harness.prepare.mockImplementationOnce(() => {
      throw new Error(batchIndexErrors.invalidConfiguration);
    });
    harness.writeStderr.mockImplementationOnce(() => {
      throw createHostileThrownValue().thrown;
    });

    await expect(
      module.runKecBatchIndexCli(
        [firstCanonicalSource],
        harness.environment,
        harness.dependencies,
      ),
    ).resolves.toBe(1);
    expect(harness.writeStderr).toHaveBeenCalledTimes(1);
  });
});

describe("Task 58 batch index CLI descriptor and authority boundaries", () => {
  it("rejects non-object environments before preflight without coercion", async () => {
    const module = await loadCliModule();
    if (!module) return;
    for (const environment of [null, [], new Date(), () => undefined]) {
      const harness = createHarness();
      const exitCode = await module.runKecBatchIndexCli(
        [firstCanonicalSource],
        environment,
        harness.dependencies,
      );
      expect(exitCode).toBe(1);
      expect(harness.readConfig).not.toHaveBeenCalled();
    }
  });

  it("rejects extra, symbol, accessor, inherited, and custom dependency shapes", async () => {
    const module = await loadCliModule();
    if (!module) return;
    const base = createHarness();
    const extra = { ...base.dependencies, extra: true };
    const symbol = { ...base.dependencies };
    Object.defineProperty(symbol, Symbol("extra"), { value: true });
    let accessorCalls = 0;
    const accessor = { ...base.dependencies } as Record<string, unknown>;
    Object.defineProperty(accessor, "execute", {
      get: () => {
        accessorCalls += 1;
        return base.execute;
      },
    });
    const inherited = Object.create(
      base.dependencies,
    ) as KecBatchIndexCliDependencies;
    const custom = Object.assign(
      Object.create({ custom: true }),
      base.dependencies,
    );

    for (const dependencies of [extra, symbol, accessor, inherited, custom]) {
      const exitCode = await module.runKecBatchIndexCli(
        [firstCanonicalSource],
        base.environment,
        dependencies as KecBatchIndexCliDependencies,
      );
      expect(exitCode).toBe(1);
    }
    expect(accessorCalls).toBe(0);
  });

  it("uses the standard guard, argv slice, selected environment copy, and exitCode", () => {
    if (!existsSync(cliSourcePath)) return;
    const source = readFileSync(cliSourcePath, "utf8");

    expect(source).toMatch(
      /if\s*\(\s*isMainModule\(import\.meta\.url,\s*process\.argv\[1\]\)\s*\)/u,
    );
    expect(source).toContain("process.argv.slice(2)");
    expect(source).toContain("process.exitCode");
    expect(source).not.toMatch(/process\.exit\s*\(/u);
    expect(source).toContain("Object.getOwnPropertyDescriptor");
    expect(source).toMatch(/descriptor\s*===\s*undefined/u);
    expect(source).toMatch(/["']value["']\s+in\s+descriptor/u);
    for (const key of approvedEnvironmentKeys)
      expect(source).toContain(JSON.stringify(key));
    expect(source).not.toMatch(
      /Object\.(?:keys|values|entries|assign)\s*\(\s*process\.env|\.\.\.process\.env/gu,
    );
  });

  it("keeps the approved provider, store, and index lifecycle in one Task 58-owned binding", () => {
    if (!existsSync(cliSourcePath)) return;
    expect(existsSync(runtimeBindingSourcePath)).toBe(true);
    expect(existsSync(directoryCliSourcePath)).toBe(true);

    const batchCli = readFileSync(cliSourcePath, "utf8");
    const directoryCli = readFileSync(directoryCliSourcePath, "utf8");
    const runtimeBinding = readFileSync(runtimeBindingSourcePath, "utf8");
    const packageIndex = readFileSync(packageIndexPath, "utf8");
    const sharedImport =
      /import\s*\{\s*createKecBatchExecutionDependencies\s*\}\s*from\s*["']\.\/batchIndexing\/createKecBatchExecutionDependencies\.js["']/gu;

    expect(batchCli.match(sharedImport)).toHaveLength(1);
    expect(directoryCli.match(sharedImport)).toHaveLength(1);
    expect(
      batchCli.match(
        /createExecutionDependencies:\s*createKecBatchExecutionDependencies/gu,
      ),
    ).toHaveLength(1);
    expect(
      directoryCli.match(
        /createExecutionDependencies:\s*createKecBatchExecutionDependencies/gu,
      ),
    ).toHaveLength(1);

    for (const cli of [batchCli, directoryCli]) {
      expect(cli).not.toMatch(
        /\bcreateEmbeddingProviderFromEnv\b|\bSqliteVectorStore\b|\bindexKec\b/u,
      );
      expect(cli).not.toMatch(
        /\b(?:createProvider|createStore|indexSource|closeStore|closeProvider)\s*:/u,
      );
    }

    for (const member of [
      "createProvider",
      "createStore",
      "indexSource",
      "closeStore",
      "closeProvider",
    ]) {
      expect(
        runtimeBinding.match(new RegExp(`\\b${member}\\s*:`, "gu")),
      ).toHaveLength(1);
    }
    expect(
      runtimeBinding.match(/return\s+createEmbeddingProviderFromEnv\(\);/gu),
    ).toHaveLength(1);
    expect(
      runtimeBinding.match(/new\s+SqliteVectorStore\(databasePath\)/gu),
    ).toHaveLength(1);
    expect(
      runtimeBinding.match(/const\s+result\s*=\s*await\s+indexKec\(/gu),
    ).toHaveLength(1);
    expect(runtimeBinding).toMatch(
      /return\s+Object\.freeze\(\{\s*indexedChunks:\s*result\.indexedChunks\s*\}\);/u,
    );
    expect(runtimeBinding.match(/await\s+store\.close\(\);/gu)).toHaveLength(1);
    expect(runtimeBinding).toMatch(/closeProvider:\s*\(\)\s*=>\s*\{\}/u);
    expect(packageIndex).not.toContain("createKecBatchExecutionDependencies");

    expect(runtimeBinding).not.toMatch(
      /readPdfPages|createPageChunks|runStdioServer|createVoltAiMcpServer|searchKec|smokeOllamaEmbedding|probeOllamaEmbedding|Promise\.(?:all|allSettled)|setTimeout|setInterval|console\.|logger/iu,
    );
    expect(runtimeBinding).not.toMatch(
      /\b(?:SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|VACUUM|REINDEX)\b/iu,
    );
  });
});
