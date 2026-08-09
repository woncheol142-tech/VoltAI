import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  KecBatchIndexConfig,
  KecBatchIndexExecutionDependencies,
  KecBatchIndexResultV1,
  PreparedKecBatchIndex,
} from "../src/batchIndexing/index.js";
import {
  approvedDirectoryErrors,
  captureFixtureBoundary,
  createHostileValue,
  createKecBatchDirectoryFixture,
  directoryCliPath,
  directoryEnvironment,
  directoryErrors,
  expectedSourceId,
  packageRoot,
} from "./helpers/kecBatchDirectoryFixture.js";

type Discovery = Readonly<{ sources: readonly string[] }>;
type CliDependencies = Readonly<{
  cwd: string;
  readConfig: (environment: unknown, cwd: string) => KecBatchIndexConfig;
  discover: (projectRoot: string, request: unknown) => Discovery;
  prepareBatch: (
    config: KecBatchIndexConfig,
    request: unknown,
  ) => PreparedKecBatchIndex;
  executeBatch: (
    prepared: PreparedKecBatchIndex,
    dependencies: KecBatchIndexExecutionDependencies,
  ) => Promise<KecBatchIndexResultV1>;
  serializeBatch: (result: KecBatchIndexResultV1) => string;
  createExecutionDependencies: (
    prepared: PreparedKecBatchIndex,
  ) => KecBatchIndexExecutionDependencies;
  writeStdout: (text: string) => void;
  writeStderr: (text: string) => void;
}>;
type CliModule = Readonly<{
  main: () => Promise<void>;
  runKecBatchDirectoryCli: (
    argv: readonly string[],
    environment: unknown,
    dependencies: CliDependencies,
  ) => Promise<number>;
}>;

async function loadCli(): Promise<CliModule> {
  return (await import(/* @vite-ignore */ directoryCliPath)) as CliModule;
}

function result(
  status: "SUCCEEDED" | "PARTIAL" | "FAILED",
): KecBatchIndexResultV1 {
  const id = expectedSourceId("manuals/a.pdf");
  const sourceStatus = status === "SUCCEEDED" ? "INDEXED" : "FAILED";
  return Object.freeze({
    schemaVersion: 1,
    status,
    requestedSourceCount: 1,
    indexedSourceCount: status === "SUCCEEDED" ? 1 : 0,
    failedSourceCount: status === "SUCCEEDED" ? 0 : 1,
    notAttemptedSourceCount: 0,
    indexedChunkCount: status === "SUCCEEDED" ? 1 : 0,
    sources: Object.freeze([
      Object.freeze({
        sourceId: id,
        status: sourceStatus,
        indexedChunkCount: status === "SUCCEEDED" ? 1 : 0,
        failureCode: status === "SUCCEEDED" ? null : "INDEXING_FAILED",
      }),
    ]),
  });
}

function createHarness(
  overrides: Partial<CliDependencies> &
    Readonly<{ result?: KecBatchIndexResultV1 }> = {},
): Readonly<{
  environment: Readonly<Record<string, unknown>>;
  dependencies: CliDependencies;
  readConfig: ReturnType<typeof vi.fn>;
  discover: ReturnType<typeof vi.fn>;
  prepareBatch: ReturnType<typeof vi.fn>;
  executeBatch: ReturnType<typeof vi.fn>;
  serializeBatch: ReturnType<typeof vi.fn>;
  createExecutionDependencies: ReturnType<typeof vi.fn>;
  writeStdout: ReturnType<typeof vi.fn>;
  writeStderr: ReturnType<typeof vi.fn>;
}> {
  const { result: requestedResult, ...dependencyOverrides } = overrides;
  const config: KecBatchIndexConfig = Object.freeze({
    projectRoot: "/virtual/project",
    databasePath: "/virtual/project/.voltai/kec.sqlite",
    provider: "placeholder",
    concurrency: 4,
    maxAttempts: 3,
    retryDelayMs: 100,
  });
  const prepared: PreparedKecBatchIndex = Object.freeze({
    ...config,
    sources: Object.freeze([
      Object.freeze({
        sourcePath: "manuals/a.pdf",
        sourceId: expectedSourceId("manuals/a.pdf"),
      }),
    ]),
  });
  const executionDependencies = Object.freeze({
    createProvider: vi.fn(),
    createStore: vi.fn(),
    indexSource: vi.fn(),
    closeStore: vi.fn(),
    closeProvider: vi.fn(),
  }) as unknown as KecBatchIndexExecutionDependencies;
  const outputResult = requestedResult ?? result("SUCCEEDED");
  const readConfig = vi.fn(() => config);
  const discover = vi.fn(() =>
    Object.freeze({ sources: Object.freeze(["manuals/a.pdf"]) }),
  );
  const prepareBatch = vi.fn(() => prepared);
  const executeBatch = vi.fn(async () => outputResult);
  const serializeBatch = vi.fn(() => `${outputResult.status}\n`);
  const createExecutionDependencies = vi.fn(() => executionDependencies);
  const writeStdout = vi.fn();
  const writeStderr = vi.fn();
  const dependencies: CliDependencies = Object.freeze({
    cwd: "/virtual/cwd",
    readConfig,
    discover,
    prepareBatch,
    executeBatch,
    serializeBatch,
    createExecutionDependencies,
    writeStdout,
    writeStderr,
    ...dependencyOverrides,
  });
  return Object.freeze({
    environment: directoryEnvironment("/virtual/project"),
    dependencies,
    readConfig,
    discover,
    prepareBatch,
    executeBatch,
    serializeBatch,
    createExecutionDependencies,
    writeStdout,
    writeStderr,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Task 59 directory CLI import and argument boundary", () => {
  it("is RED until the guarded package-local CLI module exists", () => {
    expect(existsSync(directoryCliPath)).toBe(true);
  });

  it("exports only main and the injected runner", async () => {
    if (!existsSync(directoryCliPath)) return;
    const module = await loadCli();
    expect(Object.keys(module).sort()).toEqual([
      "main",
      "runKecBatchDirectoryCli",
    ]);
  });

  it("imports without output, startup, exit, exitCode mutation, timers, fetch, or fixture writes", () => {
    if (!existsSync(directoryCliPath)) return;
    const fixture = createKecBatchDirectoryFixture();
    try {
      const before = captureFixtureBoundary(fixture.fixtureRoot);
      const child = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "--input-type=module",
          "--eval",
          `await import(${JSON.stringify(pathToFileURL(directoryCliPath).href)})`,
        ],
        {
          cwd: packageRoot,
          encoding: "utf8",
          env: {
            ...process.env,
            NODE_NO_WARNINGS: "1",
            PROJECT_ROOT: fixture.projectRoot,
          },
          timeout: 10_000,
        },
      );
      expect(child.error).toBeUndefined();
      expect(child.status).toBe(0);
      expect(child.stdout).toBe("");
      expect(child.stderr).toBe("");
      expect(captureFixtureBoundary(fixture.fixtureRoot)).toBe(before);
    } finally {
      fixture.cleanup();
    }
  });

  it.each([
    { argv: [] },
    { argv: ["manuals", "extra"] },
    { argv: ["--recursive"] },
    { argv: ["--help"] },
    { argv: ["-"] },
    { argv: [""] },
  ])(
    "rejects unsupported argv $argv before config or discovery",
    async ({ argv }) => {
      if (!existsSync(directoryCliPath)) return;
      const harness = createHarness();
      const { runKecBatchDirectoryCli } = await loadCli();
      const exitCode = await runKecBatchDirectoryCli(
        argv,
        harness.environment,
        harness.dependencies,
      );
      expect(exitCode).toBe(1);
      expect(harness.readConfig).not.toHaveBeenCalled();
      expect(harness.discover).not.toHaveBeenCalled();
      expect(harness.writeStdout).not.toHaveBeenCalled();
      expect(harness.writeStderr).toHaveBeenCalledWith(
        `${directoryErrors.invalidArgument}\n`,
      );
    },
  );

  it("rejects sparse, accessor, decorated, symbol, and hostile argv descriptor-safely", async () => {
    if (!existsSync(directoryCliPath)) return;
    const sparse = new Array<string>(1);
    let getterCalls = 0;
    const accessor = ["manuals"];
    Object.defineProperty(accessor, 0, {
      get: () => {
        getterCalls += 1;
        return "manuals";
      },
    });
    const decorated = ["manuals"];
    Object.defineProperty(decorated, "extra", { value: true });
    const symbol = ["manuals"];
    Object.defineProperty(symbol, Symbol("extra"), { value: true });
    const hostile = new Proxy(["manuals"], {
      getOwnPropertyDescriptor: () => {
        throw new Error("secret argv trap");
      },
    });
    const { runKecBatchDirectoryCli } = await loadCli();
    for (const argv of [sparse, accessor, decorated, symbol, hostile]) {
      const harness = createHarness();
      expect(
        await runKecBatchDirectoryCli(
          argv,
          harness.environment,
          harness.dependencies,
        ),
      ).toBe(1);
      expect(harness.readConfig).not.toHaveBeenCalled();
      expect(harness.writeStderr).toHaveBeenCalledWith(
        `${directoryErrors.invalidArgument}\n`,
      );
    }
    expect(getterCalls).toBe(0);
  });

  it("rejects accessor-based injected dependencies without executing getters", async () => {
    if (!existsSync(directoryCliPath)) return;
    const harness = createHarness();
    let getterCalls = 0;
    const dependencies = { ...harness.dependencies } as Record<string, unknown>;
    Object.defineProperty(dependencies, "discover", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        throw new Error("secret dependency getter");
      },
    });
    const { runKecBatchDirectoryCli } = await loadCli();
    expect(
      await runKecBatchDirectoryCli(
        ["manuals"],
        harness.environment,
        dependencies as CliDependencies,
      ),
    ).toBe(1);
    expect(getterCalls).toBe(0);
    expect(harness.readConfig).not.toHaveBeenCalled();
    expect(harness.writeStdout).not.toHaveBeenCalled();
    expect(harness.writeStderr).not.toHaveBeenCalled();
  });

  it("maps exactly one positional directory to a fresh request without mutating argv", async () => {
    if (!existsSync(directoryCliPath)) return;
    const argv = Object.freeze(["manuals"]);
    const before = Object.getOwnPropertyDescriptors(argv);
    const harness = createHarness();
    const { runKecBatchDirectoryCli } = await loadCli();
    await runKecBatchDirectoryCli(
      argv,
      harness.environment,
      harness.dependencies,
    );
    const request = harness.discover.mock.calls[0]?.[1];
    expect(request).toEqual({ directory: "manuals" });
    expect(request).not.toBe(argv);
    expect(Object.getOwnPropertyDescriptors(argv)).toEqual(before);
  });
});

describe("Task 59 directory CLI errors, output, and exit codes", () => {
  it("emits only the seven fixed Task 59 error messages and never raw paths", async () => {
    if (!existsSync(directoryCliPath)) return;
    const secret = "/secret/project/manuals/private.pdf";
    const { runKecBatchDirectoryCli } = await loadCli();
    const cases = [
      ["readConfig", directoryErrors.invalidConfiguration],
      ["discover", directoryErrors.invalidDirectory],
      ["discover", directoryErrors.invalidSource],
      ["discover", directoryErrors.noSources],
      ["discover", directoryErrors.discoveryFailed],
      ["discover", directoryErrors.internalError],
    ] as const;
    for (const [stage, message] of cases) {
      const harness = createHarness();
      const failure = new Error(message);
      if (stage === "readConfig") {
        harness.readConfig.mockImplementationOnce(() => {
          throw failure;
        });
      } else {
        harness.discover.mockImplementationOnce(() => {
          throw failure;
        });
      }
      const exitCode = await runKecBatchDirectoryCli(
        ["manuals"],
        harness.environment,
        harness.dependencies,
      );
      const written = harness.writeStderr.mock.calls[0]?.[0] as string;
      expect(exitCode).toBe(1);
      expect(written).toBe(`${message}\n`);
      expect(approvedDirectoryErrors).toContain(written.trim());
      expect(written).not.toContain(secret);
      expect(harness.writeStdout).not.toHaveBeenCalled();
    }

    const harness = createHarness();
    harness.discover.mockImplementationOnce(() => {
      throw new Error(secret);
    });
    expect(
      await runKecBatchDirectoryCli(
        ["manuals"],
        harness.environment,
        harness.dependencies,
      ),
    ).toBe(1);
    const written = harness.writeStderr.mock.calls[0]?.[0] as string;
    expect(written).toBe(`${directoryErrors.internalError}\n`);
    expect(written).not.toContain(secret);
  });

  it("normalizes an unknown hostile failure to INTERNAL_ERROR without coercion", async () => {
    if (!existsSync(directoryCliPath)) return;
    const counter = { count: 0 };
    const hostile = createHostileValue(counter);
    const harness = createHarness();
    harness.discover.mockImplementationOnce(() => {
      throw hostile;
    });
    const { runKecBatchDirectoryCli } = await loadCli();
    expect(
      await runKecBatchDirectoryCli(
        ["manuals"],
        harness.environment,
        harness.dependencies,
      ),
    ).toBe(1);
    expect(counter.count).toBe(0);
    expect(harness.writeStderr).toHaveBeenCalledWith(
      `${directoryErrors.internalError}\n`,
    );
    expect(harness.writeStdout).not.toHaveBeenCalled();
  });

  it.each([
    ["SUCCEEDED", 0],
    ["PARTIAL", 2],
    ["FAILED", 2],
  ] as const)(
    "preserves Task 58 %s serialization and exit %i",
    async (status, expected) => {
      if (!existsSync(directoryCliPath)) return;
      const outputResult = result(status);
      const harness = createHarness({ result: outputResult });
      const bytes = `serialized-${status}\n`;
      harness.serializeBatch.mockReturnValue(bytes);
      const { runKecBatchDirectoryCli } = await loadCli();
      const exitCode = await runKecBatchDirectoryCli(
        ["manuals"],
        harness.environment,
        harness.dependencies,
      );
      expect(exitCode).toBe(expected);
      expect(harness.serializeBatch).toHaveBeenCalledWith(outputResult);
      expect(harness.writeStdout).toHaveBeenCalledTimes(1);
      expect(harness.writeStdout).toHaveBeenCalledWith(bytes);
      expect(harness.writeStderr).not.toHaveBeenCalled();
    },
  );

  it("uses process.exitCode, never hard process.exit, and selects only approved environment keys", () => {
    if (!existsSync(directoryCliPath)) return;
    const source = readFileSync(directoryCliPath, "utf8");
    expect(source).toMatch(/process\.exitCode\s*=\s*await/iu);
    expect(source).not.toMatch(/process\.exit\s*\(/u);
    expect(source).not.toMatch(
      /\.\.\.process\.env|Object\.(?:keys|entries|values)\(process\.env\)/u,
    );
    for (const key of [
      "PROJECT_ROOT",
      "KEC_DB_PATH",
      "KEC_EMBED_PROVIDER",
      "OLLAMA_BASE_URL",
      "OLLAMA_EMBED_MODEL",
      "OLLAMA_EMBED_TIMEOUT_MS",
      "KEC_EMBED_CONCURRENCY",
      "KEC_EMBED_MAX_ATTEMPTS",
      "KEC_EMBED_RETRY_DELAY_MS",
    ]) {
      expect(source).toContain(key);
    }
  });
});
