import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { probeOllamaEmbedding } from "../src/ollamaEmbeddingSmoke/probeOllamaEmbedding.js";
import { readOllamaEmbeddingSmokeConfig } from "../src/ollamaEmbeddingSmoke/readOllamaEmbeddingSmokeConfig.js";
import { serializeOllamaEmbeddingSmoke } from "../src/ollamaEmbeddingSmoke/serializeOllamaEmbeddingSmoke.js";
import type {
  OllamaEmbeddingSmokeConfig,
  OllamaEmbeddingSmokeResultV1,
} from "../src/ollamaEmbeddingSmoke/types.js";
import * as packageRoot from "../src/index.js";
import {
  createHostileThrownValue,
  createJsonResponse,
  smokeConfig,
  smokeErrors,
} from "./helpers/kecOllamaEmbeddingSmokeFixture.js";

type CliEnvironment = Readonly<Record<string, unknown>>;
type OllamaEmbeddingSmokeCliDependencies = Readonly<{
  environment: CliEnvironment;
  argv: readonly string[];
  readConfig: typeof readOllamaEmbeddingSmokeConfig;
  probe: typeof probeOllamaEmbedding;
  serialize: typeof serializeOllamaEmbeddingSmoke;
  fetch: typeof fetch;
  writeStdout: (text: string) => void;
  writeStderr: (text: string) => void;
}>;
type OllamaEmbeddingSmokeCliModule = Readonly<{
  runOllamaEmbeddingSmokeCli: (
    dependencies: OllamaEmbeddingSmokeCliDependencies,
  ) => Promise<number>;
  main: () => Promise<void>;
}>;

const testFile = fileURLToPath(import.meta.url);
const packageRootPath = join(dirname(testFile), "..");
const workspaceRoot = resolve(packageRootPath, "..", "..");
const cliSourcePath = join(packageRootPath, "src", "smokeOllamaEmbedding.ts");
const approvedEnvironmentKeys = [
  "KEC_EMBED_PROVIDER",
  "OLLAMA_BASE_URL",
  "OLLAMA_EMBED_MODEL",
  "OLLAMA_EMBED_TIMEOUT_MS",
] as const;
const approvedMessages = Object.freeze(Object.values(smokeErrors));
let cliModule: Promise<OllamaEmbeddingSmokeCliModule> | undefined;

function loadCliModule(): Promise<OllamaEmbeddingSmokeCliModule> {
  cliModule ??=
    import("../src/smokeOllamaEmbedding.js") as Promise<OllamaEmbeddingSmokeCliModule>;
  return cliModule;
}

function readyResult(): OllamaEmbeddingSmokeResultV1 {
  return Object.freeze({
    schemaVersion: 1,
    status: "READY",
    provider: "ollama",
    observedDimension: 3,
  });
}

function createHarness(
  options: {
    environment?: CliEnvironment;
    argv?: readonly string[];
  } = {},
) {
  const config = smokeConfig() as OllamaEmbeddingSmokeConfig;
  const result = readyResult();
  const bytes = serializeOllamaEmbeddingSmoke(result);
  const fetchFunction = vi
    .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
    .mockResolvedValue(createJsonResponse([1]));
  const readConfig = vi
    .fn<typeof readOllamaEmbeddingSmokeConfig>()
    .mockReturnValue(config);
  const probe = vi.fn<typeof probeOllamaEmbedding>().mockResolvedValue(result);
  const serialize = vi
    .fn<typeof serializeOllamaEmbeddingSmoke>()
    .mockReturnValue(bytes);
  const writeStdout = vi.fn<(text: string) => void>();
  const writeStderr = vi.fn<(text: string) => void>();
  const dependencies: OllamaEmbeddingSmokeCliDependencies = Object.freeze({
    environment: options.environment ?? {
      KEC_EMBED_PROVIDER: "ollama",
    },
    argv: options.argv ?? [],
    readConfig,
    probe,
    serialize,
    fetch: fetchFunction as typeof fetch,
    writeStdout,
    writeStderr,
  });

  return {
    config,
    result,
    bytes,
    fetchFunction,
    readConfig,
    probe,
    serialize,
    writeStdout,
    writeStderr,
    dependencies,
  };
}

function controlledEnvironment(
  overrides: Readonly<Record<string, string | undefined>>,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_NO_WARNINGS: "1",
  };
  for (const key of approvedEnvironmentKeys) delete environment[key];
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete environment[key];
    else environment[key] = value;
  }
  return environment;
}

function runCliSubprocess(
  environment: NodeJS.ProcessEnv,
  argv: readonly string[] = [],
): SpawnSyncReturns<string> {
  return spawnSync(
    process.execPath,
    ["--conditions=voltai-source", "--import", "tsx", cliSourcePath, ...argv],
    {
      cwd: packageRootPath,
      encoding: "utf8",
      env: environment,
      timeout: 10_000,
    },
  );
}

function runImportSubprocess(): SpawnSyncReturns<string> {
  return spawnSync(
    process.execPath,
    [
      "--conditions=voltai-source",
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      `await import(${JSON.stringify(pathToFileURL(cliSourcePath).href)})`,
    ],
    {
      cwd: packageRootPath,
      encoding: "utf8",
      env: controlledEnvironment({ KEC_EMBED_PROVIDER: "ollama" }),
      timeout: 10_000,
    },
  );
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Ollama embedding smoke CLI module boundary", () => {
  it("is RED until the approved short-lived CLI module exists", () => {
    expect(existsSync(cliSourcePath)).toBe(true);
  });

  it("exports only the injected runner and main function internally", async () => {
    const module = await loadCliModule();

    expect(Object.keys(module).sort()).toEqual([
      "main",
      "runOllamaEmbeddingSmokeCli",
    ]);
    expect(packageRoot).not.toHaveProperty("runOllamaEmbeddingSmokeCli");
    expect(packageRoot).not.toHaveProperty("probeOllamaEmbedding");
  });

  it("imports without fetch, timers, output, or exit-code mutation", async () => {
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
      process.exitCode = 73;
      await loadCliModule();

      expect(fetchFunction).not.toHaveBeenCalled();
      expect(stdout).not.toHaveBeenCalled();
      expect(stderr).not.toHaveBeenCalled();
      expect(exit).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(73);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      process.exitCode = originalExitCode;
    }
  });

  it("uses the standard main guard and only the four approved environment reads", () => {
    expect(existsSync(cliSourcePath)).toBe(true);
    const source = existsSync(cliSourcePath)
      ? readFileSync(cliSourcePath, "utf8")
      : "";

    expect(source).toMatch(
      /if\s*\(\s*isMainModule\(import\.meta\.url,\s*process\.argv\[1\]\)\s*\)/u,
    );
    expect(source).toContain("process.exitCode");
    expect(source).not.toMatch(/process\.exit\s*\(/u);
    expect(source).toContain("readSelectedEnvironment(process.env)");
    expect(source).toContain("Object.getOwnPropertyDescriptor");
    for (const key of approvedEnvironmentKeys) {
      expect(source).toContain(JSON.stringify(key));
    }
    expect(source).not.toMatch(
      /Object\.(?:keys|values|entries|assign)\s*\(|\.\.\.process\.env/gu,
    );
    expect(source).not.toMatch(
      /runStdioServer|createVoltAiMcpServer|Sqlite|VectorStore|node:(?:fs|sqlite|child_process)|console\.|logger|PROJECT_ROOT|KEC_DB_PATH/iu,
    );
  });
});

describe("Ollama embedding smoke CLI injected seam", () => {
  it("uses real-reader defaults with only the provider present", async () => {
    const module = await loadCliModule();
    const harness = createHarness({
      environment: { KEC_EMBED_PROVIDER: "ollama" },
    });
    let capturedConfig: OllamaEmbeddingSmokeConfig | undefined;
    harness.readConfig.mockImplementation(readOllamaEmbeddingSmokeConfig);
    harness.probe.mockImplementation(async (config) => {
      capturedConfig = config;
      return harness.result;
    });

    const exitCode = await module.runOllamaEmbeddingSmokeCli(
      harness.dependencies,
    );

    expect(exitCode).toBe(0);
    expect(capturedConfig).toEqual({
      baseUrl: "http://localhost:11434",
      model: "nomic-embed-text",
      timeoutMs: 30_000,
    });
    expect(harness.fetchFunction).not.toHaveBeenCalled();
  });

  it("keeps a present empty optional value invalid", async () => {
    const module = await loadCliModule();
    const harness = createHarness({
      environment: {
        KEC_EMBED_PROVIDER: "ollama",
        OLLAMA_EMBED_MODEL: "",
      },
    });
    harness.readConfig.mockImplementation(readOllamaEmbeddingSmokeConfig);

    const exitCode = await module.runOllamaEmbeddingSmokeCli(
      harness.dependencies,
    );

    expect(exitCode).toBe(1);
    expect(harness.probe).not.toHaveBeenCalled();
    expect(harness.fetchFunction).not.toHaveBeenCalled();
    expect(harness.writeStderr).toHaveBeenCalledWith(
      `${smokeErrors.invalidConfiguration}\n`,
    );
  });

  it("runs the reader, probe, serializer, and one stdout write in order", async () => {
    const module = await loadCliModule();
    const harness = createHarness();

    const exitCode = await module.runOllamaEmbeddingSmokeCli(
      harness.dependencies,
    );

    expect(exitCode).toBe(0);
    expect(harness.readConfig).toHaveBeenCalledTimes(1);
    expect(harness.readConfig).toHaveBeenCalledWith(
      harness.dependencies.environment,
    );
    expect(harness.probe).toHaveBeenCalledTimes(1);
    expect(harness.probe).toHaveBeenCalledWith(harness.config, {
      fetch: harness.dependencies.fetch,
    });
    expect(harness.serialize).toHaveBeenCalledTimes(1);
    expect(harness.serialize).toHaveBeenCalledWith(harness.result);
    expect(harness.writeStdout).toHaveBeenCalledTimes(1);
    expect(harness.writeStdout).toHaveBeenCalledWith(harness.bytes);
    expect(harness.writeStderr).not.toHaveBeenCalled();
  });

  it.each([{ argv: ["sentinel"] }, { argv: ["first", "second"] }])(
    "rejects positional arguments before configuration: $argv",
    async ({ argv }) => {
      const module = await loadCliModule();
      const harness = createHarness({ argv });

      const exitCode = await module.runOllamaEmbeddingSmokeCli(
        harness.dependencies,
      );

      expect(exitCode).toBe(1);
      expect(harness.readConfig).not.toHaveBeenCalled();
      expect(harness.probe).not.toHaveBeenCalled();
      expect(harness.serialize).not.toHaveBeenCalled();
      expect(harness.writeStdout).not.toHaveBeenCalled();
      expect(harness.writeStderr).toHaveBeenCalledTimes(1);
      expect(harness.writeStderr).toHaveBeenCalledWith(
        `${smokeErrors.invalidConfiguration}\n`,
      );
      expect(harness.writeStderr.mock.calls.join("\n")).not.toContain(
        "sentinel",
      );
    },
  );

  it.each(approvedMessages)(
    "forwards the approved fixed failure %s as one line",
    async (message) => {
      const module = await loadCliModule();
      const harness = createHarness();
      harness.probe.mockRejectedValueOnce(new Error(message));

      const exitCode = await module.runOllamaEmbeddingSmokeCli(
        harness.dependencies,
      );

      expect(exitCode).toBe(1);
      expect(harness.probe).toHaveBeenCalledTimes(1);
      expect(harness.serialize).not.toHaveBeenCalled();
      expect(harness.writeStdout).not.toHaveBeenCalled();
      expect(harness.writeStderr).toHaveBeenCalledTimes(1);
      expect(harness.writeStderr).toHaveBeenCalledWith(`${message}\n`);
    },
  );

  it("forwards an approved configuration-reader error without probing", async () => {
    const module = await loadCliModule();
    const harness = createHarness();
    harness.readConfig.mockImplementationOnce(() => {
      throw new Error(smokeErrors.invalidConfiguration);
    });

    const exitCode = await module.runOllamaEmbeddingSmokeCli(
      harness.dependencies,
    );

    expect(exitCode).toBe(1);
    expect(harness.probe).not.toHaveBeenCalled();
    expect(harness.serialize).not.toHaveBeenCalled();
    expect(harness.writeStdout).not.toHaveBeenCalled();
    expect(harness.writeStderr).toHaveBeenCalledWith(
      `${smokeErrors.invalidConfiguration}\n`,
    );
  });

  it("normalizes a hostile unknown failure without reading or coercing it", async () => {
    const module = await loadCliModule();
    const harness = createHarness();
    const hostile = createHostileThrownValue();
    harness.probe.mockRejectedValueOnce(hostile.thrown);

    const exitCode = await module.runOllamaEmbeddingSmokeCli(
      harness.dependencies,
    );

    expect(exitCode).toBe(1);
    expect(hostile.calls()).toBe(0);
    expect(harness.serialize).not.toHaveBeenCalled();
    expect(harness.writeStdout).not.toHaveBeenCalled();
    expect(harness.writeStderr).toHaveBeenCalledTimes(1);
    expect(harness.writeStderr).toHaveBeenCalledWith(
      `${smokeErrors.internalError}\n`,
    );
  });

  it("passes the environment through without enumeration or property access", async () => {
    const module = await loadCliModule();
    let getterCalls = 0;
    let enumerationCalls = 0;
    const environment = new Proxy(
      {
        KEC_EMBED_PROVIDER: "ollama",
        PROJECT_ROOT: "ignored",
        KEC_DB_PATH: "ignored",
        RETRY_COUNT: "ignored",
      },
      {
        get: () => {
          getterCalls += 1;
          throw new Error("CLI environment access is forbidden");
        },
        ownKeys: () => {
          enumerationCalls += 1;
          throw new Error("CLI environment enumeration is forbidden");
        },
      },
    );
    const harness = createHarness({ environment });

    await module.runOllamaEmbeddingSmokeCli(harness.dependencies);

    expect(harness.readConfig).toHaveBeenCalledTimes(1);
    expect(harness.readConfig.mock.calls[0]?.[0]).toBe(environment);
    expect(getterCalls).toBe(0);
    expect(enumerationCalls).toBe(0);
  });

  it("passes the exact injected fetch function to the core without calling it", async () => {
    const module = await loadCliModule();
    const harness = createHarness();

    await module.runOllamaEmbeddingSmokeCli(harness.dependencies);

    expect(harness.fetchFunction).not.toHaveBeenCalled();
    expect(harness.probe.mock.calls[0]?.[1]?.fetch).toBe(
      harness.dependencies.fetch,
    );
    expect(globalThis.fetch).not.toBe(harness.dependencies.fetch);
  });

  it("forwards one LF-terminated success value without CR or extra writes", async () => {
    const module = await loadCliModule();
    const harness = createHarness();

    await module.runOllamaEmbeddingSmokeCli(harness.dependencies);

    expect(harness.bytes.endsWith("\n")).toBe(true);
    expect(harness.bytes.endsWith("\n\n")).toBe(false);
    expect(harness.bytes).not.toContain("\r");
    expect(harness.writeStdout).toHaveBeenCalledTimes(1);
    expect(harness.writeStderr).not.toHaveBeenCalled();
  });

  it("does not mutate the environment, argv, or dependency descriptors", async () => {
    const module = await loadCliModule();
    const environment = Object.freeze({ KEC_EMBED_PROVIDER: "ollama" });
    const argv = Object.freeze([] as string[]);
    const harness = createHarness({ environment, argv });
    const environmentDescriptors =
      Object.getOwnPropertyDescriptors(environment);
    const dependencyDescriptors = Object.getOwnPropertyDescriptors(
      harness.dependencies,
    );

    await module.runOllamaEmbeddingSmokeCli(harness.dependencies);

    expect(Object.getOwnPropertyDescriptors(environment)).toEqual(
      environmentDescriptors,
    );
    expect(Object.getOwnPropertyDescriptors(harness.dependencies)).toEqual(
      dependencyDescriptors,
    );
    expect(argv).toEqual([]);
  });

  it("preserves absent optional process environment values in main", async () => {
    const module = await loadCliModule();
    const originalExitCode = process.exitCode;
    const descriptors = new Map(
      approvedEnvironmentKeys.map(
        (key) =>
          [key, Object.getOwnPropertyDescriptor(process.env, key)] as const,
      ),
    );
    const fetchFunction = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(createJsonResponse([1, 2]));
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    vi.stubGlobal("fetch", fetchFunction);

    try {
      for (const key of approvedEnvironmentKeys) delete process.env[key];
      process.env.KEC_EMBED_PROVIDER = "ollama";

      await module.main();

      expect(process.exitCode).toBe(0);
      expect(fetchFunction).toHaveBeenCalledTimes(1);
      expect(fetchFunction.mock.calls[0]?.[0]).toBe(
        "http://localhost:11434/api/embeddings",
      );
      expect(
        JSON.parse(String(fetchFunction.mock.calls[0]?.[1]?.body)),
      ).toEqual({
        model: "nomic-embed-text",
        prompt: "volt-ai-ollama-embedding-smoke-v1",
      });
      expect(stdout).toHaveBeenCalledWith(
        '{"schemaVersion":1,"status":"READY","provider":"ollama","observedDimension":2}\n',
      );
      expect(stderr).not.toHaveBeenCalled();
    } finally {
      for (const key of approvedEnvironmentKeys) {
        delete process.env[key];
        const descriptor = descriptors.get(key);
        if (descriptor !== undefined) {
          Object.defineProperty(process.env, key, descriptor);
        }
      }
      process.exitCode = originalExitCode;
    }
  });

  it("preserves a present empty optional process environment value in main", async () => {
    const module = await loadCliModule();
    const originalExitCode = process.exitCode;
    const descriptors = new Map(
      approvedEnvironmentKeys.map(
        (key) =>
          [key, Object.getOwnPropertyDescriptor(process.env, key)] as const,
      ),
    );
    const fetchFunction = vi.fn<typeof fetch>();
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    vi.stubGlobal("fetch", fetchFunction);

    try {
      for (const key of approvedEnvironmentKeys) delete process.env[key];
      process.env.KEC_EMBED_PROVIDER = "ollama";
      process.env.OLLAMA_EMBED_MODEL = "";

      await module.main();

      expect(process.exitCode).toBe(1);
      expect(fetchFunction).not.toHaveBeenCalled();
      expect(stdout).not.toHaveBeenCalled();
      expect(stderr).toHaveBeenCalledWith(
        `${smokeErrors.invalidConfiguration}\n`,
      );
    } finally {
      for (const key of approvedEnvironmentKeys) {
        delete process.env[key];
        const descriptor = descriptors.get(key);
        if (descriptor !== undefined) {
          Object.defineProperty(process.env, key, descriptor);
        }
      }
      process.exitCode = originalExitCode;
    }
  });
});

describe("Ollama embedding smoke safe subprocess contract", () => {
  it("imports and terminates without output, fetch, or command execution", () => {
    const result = runImportSubprocess();

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("rejects a positional argument before any network-capable configuration", () => {
    const result = runCliSubprocess(
      controlledEnvironment({ KEC_EMBED_PROVIDER: "ollama" }),
      ["argument-sentinel"],
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(`${smokeErrors.invalidConfiguration}\n`);
    expect(result.stderr).not.toContain("argument-sentinel");
  });

  it("rejects an invalid provider and terminates without contacting Ollama", () => {
    const result = runCliSubprocess(
      controlledEnvironment({ KEC_EMBED_PROVIDER: "placeholder" }),
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(`${smokeErrors.invalidConfiguration}\n`);
    expect(existsSync(join(workspaceRoot, ".voltai"))).toBe(false);
    expect(existsSync(join(workspaceRoot, ".volt-ai"))).toBe(false);
  });
});
