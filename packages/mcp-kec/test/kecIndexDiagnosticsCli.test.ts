import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { inspectKecIndex } from "../src/indexDiagnostics/inspectKecIndex.js";
import { serializeKecIndexDiagnostics } from "../src/indexDiagnostics/serializeKecIndexDiagnostics.js";
import type {
  KecIndexDiagnosticStatus,
  KecIndexDiagnosticsV1,
} from "../src/indexDiagnostics/types.js";
import {
  createChunksOnlyIndexFixture,
  createCorruptDatabaseFixture,
  createMissingDatabaseFixture,
  createReadyIndexFixture,
  snapshotArtifacts,
  type KecIndexDiagnosticsFixture,
} from "./helpers/kecIndexDiagnosticsFixture.js";

type CliEnvironment = Readonly<Record<string, unknown>>;
type InspectIndexCliDependencies = Readonly<{
  environment: CliEnvironment;
  cwd: string;
  argv: readonly string[];
  inspect: (databasePath: string) => Promise<KecIndexDiagnosticsV1>;
  serialize: (diagnostics: KecIndexDiagnosticsV1) => string;
  writeStdout: (text: string) => void;
  writeStderr: (text: string) => void;
}>;
type InspectIndexCliModule = Readonly<{
  runInspectIndexCli: (
    dependencies: InspectIndexCliDependencies,
  ) => Promise<number>;
  main: () => Promise<void>;
}>;

const testFile = fileURLToPath(import.meta.url);
const packageRoot = resolve(testFile, "../..");
const workspaceRoot = resolve(packageRoot, "../..");
const cliSourcePath = join(packageRoot, "src", "inspectIndex.ts");
const approvedErrors = [
  "INVALID_CONFIGURATION",
  "UNSAFE_DATABASE_PATH",
  "DATABASE_UNAVAILABLE",
  "DATABASE_INVALID",
] as const;
const fixtures: KecIndexDiagnosticsFixture[] = [];
const temporaryRoots: string[] = [];
let cliModule: Promise<InspectIndexCliModule> | undefined;

function useFixture<T extends KecIndexDiagnosticsFixture>(fixture: T): T {
  fixtures.push(fixture);
  return fixture;
}

function useTemporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "voltai-kec-diagnostics-cli-"));
  temporaryRoots.push(root);
  return root;
}

function loadCliModule(): Promise<InspectIndexCliModule> {
  cliModule ??=
    import("../src/inspectIndex.js") as Promise<InspectIndexCliModule>;
  return cliModule;
}

function diagnostic(status: KecIndexDiagnosticStatus): KecIndexDiagnosticsV1 {
  const metadata = Object.freeze({
    provider: status === "READY" ? "provider" : null,
    model: status === "READY" ? "model" : null,
    dimensions: status === "READY" ? 3 : null,
    indexedAt: status === "READY" ? "2026-07-31T00:00:00.000Z" : null,
  });

  return Object.freeze({
    schemaVersion: 1,
    status,
    databaseExists: status !== "MISSING_DATABASE",
    databaseSchemaVersion:
      status === "MISSING_DATABASE"
        ? null
        : status === "UNINITIALIZED_DATABASE"
          ? 0
          : 1,
    metadata,
    chunkCount: status === "READY" ? 1 : 0,
    sourceCount: 0,
    sources: Object.freeze([]),
    observedDimensions: Object.freeze(status === "READY" ? [3] : []),
    issues: Object.freeze(
      status === "INCONSISTENT" ? ["INVALID_METADATA"] : [],
    ),
  });
}

function createHarness(
  options: {
    environment?: CliEnvironment;
    cwd?: string;
    argv?: readonly string[];
    result?: KecIndexDiagnosticsV1;
  } = {},
) {
  const result = options.result ?? diagnostic("READY");
  const bytes = serializeKecIndexDiagnostics(result);
  const inspect = vi
    .fn<(databasePath: string) => Promise<KecIndexDiagnosticsV1>>()
    .mockResolvedValue(result);
  const serialize = vi
    .fn<(diagnostics: KecIndexDiagnosticsV1) => string>()
    .mockReturnValue(bytes);
  const writeStdout = vi.fn<(text: string) => void>();
  const writeStderr = vi.fn<(text: string) => void>();
  const dependencies: InspectIndexCliDependencies = Object.freeze({
    environment: options.environment ?? {
      KEC_DB_PATH: "/tmp/kec-index.sqlite",
    },
    cwd: options.cwd ?? "/tmp",
    argv: options.argv ?? [],
    inspect,
    serialize,
    writeStdout,
    writeStderr,
  });

  return {
    result,
    bytes,
    inspect,
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
  delete environment.KEC_DB_PATH;
  delete environment.PROJECT_ROOT;

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete environment[key];
    } else {
      environment[key] = value;
    }
  }

  return environment;
}

function runCliSubprocess(
  overrides: Readonly<Record<string, string | undefined>>,
  positionalArguments: readonly string[] = [],
): SpawnSyncReturns<string> {
  return spawnSync(
    "pnpm",
    [
      "--silent",
      "--dir",
      "packages/mcp-kec",
      "run",
      "inspect:index",
      ...(positionalArguments.length === 0
        ? []
        : ["--", ...positionalArguments]),
    ],
    {
      cwd: workspaceRoot,
      encoding: "utf8",
      env: controlledEnvironment(overrides),
      timeout: 10_000,
    },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();

  for (const fixture of fixtures.splice(0).reverse()) {
    fixture.cleanup();
  }
  for (const root of temporaryRoots.splice(0).reverse()) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("KEC index diagnostics CLI import and architecture safety", () => {
  it("is RED until the approved short-lived CLI module exists", () => {
    expect(existsSync(cliSourcePath)).toBe(true);
  });

  it("imports without inspection, output, process exit, environment effects, or artifacts", async () => {
    const fixture = useFixture(createMissingDatabaseFixture(false));
    const before = snapshotArtifacts(fixture.databasePath);
    const originalDbPath = process.env.KEC_DB_PATH;
    const originalProjectRoot = process.env.PROJECT_ROOT;
    const originalExitCode = process.exitCode;
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    try {
      process.env.KEC_DB_PATH = fixture.databasePath;
      process.env.PROJECT_ROOT = fixture.rootPath;
      process.exitCode = 73;

      await loadCliModule();

      expect(stdout).not.toHaveBeenCalled();
      expect(stderr).not.toHaveBeenCalled();
      expect(exit).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(73);
      expect(snapshotArtifacts(fixture.databasePath)).toEqual(before);
    } finally {
      process.exitCode = originalExitCode;
      if (originalDbPath === undefined) delete process.env.KEC_DB_PATH;
      else process.env.KEC_DB_PATH = originalDbPath;
      if (originalProjectRoot === undefined) delete process.env.PROJECT_ROOT;
      else process.env.PROJECT_ROOT = originalProjectRoot;
    }
  });

  it("uses the repository main guard without MCP, provider, network, or direct exit authority", () => {
    expect(existsSync(cliSourcePath)).toBe(true);
    const source = readFileSync(cliSourcePath, "utf8");

    expect(source).toContain("isMainModule");
    expect(source).toMatch(
      /if\s*\(\s*isMainModule\(import\.meta\.url,\s*process\.argv\[1\]\)\s*\)/u,
    );
    expect(source).toContain("process.exitCode");
    expect(source).not.toMatch(/process\.exit\s*\(/u);
    expect(source).not.toMatch(
      /runStdioServer|createVoltAiMcpServer|EmbeddingProvider|SqliteKnowledgeStore|SqliteVectorStore|\bfetch\s*\(|node:child_process|console\.|logger/iu,
    );
    expect(
      [...source.matchAll(/process\.env\.([A-Z0-9_]+)/gu)].map(
        (match) => match[1],
      ),
    ).toEqual(["KEC_DB_PATH", "PROJECT_ROOT"]);
  });
});

describe("KEC index diagnostics CLI injected seam", () => {
  it.each<KecIndexDiagnosticStatus>([
    "MISSING_DATABASE",
    "UNINITIALIZED_DATABASE",
    "EMPTY_INDEX",
    "READY",
    "INCONSISTENT",
  ])(
    "forwards %s diagnostics unchanged as a successful single write",
    async (status) => {
      const module = await loadCliModule();
      const harness = createHarness({ result: diagnostic(status) });

      const exitCode = await module.runInspectIndexCli(harness.dependencies);

      expect(exitCode).toBe(0);
      expect(harness.inspect).toHaveBeenCalledTimes(1);
      expect(harness.inspect).toHaveBeenCalledWith("/tmp/kec-index.sqlite");
      expect(harness.serialize).toHaveBeenCalledTimes(1);
      expect(harness.serialize).toHaveBeenCalledWith(harness.result);
      expect(harness.writeStdout).toHaveBeenCalledTimes(1);
      expect(harness.writeStdout).toHaveBeenCalledWith(harness.bytes);
      expect(harness.writeStderr).not.toHaveBeenCalled();
    },
  );

  it.each(approvedErrors)(
    "forwards the approved %s error as one redacted failure line",
    async (reason) => {
      const module = await loadCliModule();
      const harness = createHarness();
      const message = `KEC_INDEX_DIAGNOSTICS: ${reason}`;
      harness.inspect.mockRejectedValueOnce(new Error(message));

      const exitCode = await module.runInspectIndexCli(harness.dependencies);

      expect(exitCode).toBe(1);
      expect(harness.inspect).toHaveBeenCalledTimes(1);
      expect(harness.serialize).not.toHaveBeenCalled();
      expect(harness.writeStdout).not.toHaveBeenCalled();
      expect(harness.writeStderr).toHaveBeenCalledTimes(1);
      expect(harness.writeStderr).toHaveBeenCalledWith(`${message}\n`);
    },
  );

  it("normalizes an unknown error without exposing its message or stack", async () => {
    const module = await loadCliModule();
    const harness = createHarness();
    harness.inspect.mockRejectedValueOnce(
      new Error("unknown-error-secret-path-api-key-vector-sentinel"),
    );

    const exitCode = await module.runInspectIndexCli(harness.dependencies);

    expect(exitCode).toBe(1);
    expect(harness.serialize).not.toHaveBeenCalled();
    expect(harness.writeStdout).not.toHaveBeenCalled();
    expect(harness.writeStderr).toHaveBeenCalledTimes(1);
    expect(harness.writeStderr).toHaveBeenCalledWith(
      "KEC_INDEX_DIAGNOSTICS: DATABASE_UNAVAILABLE\n",
    );
    expect(harness.writeStderr.mock.calls.join("\n")).not.toContain("sentinel");
  });

  it("rejects positional arguments before inspection", async () => {
    const module = await loadCliModule();
    const harness = createHarness({ argv: ["first", "second"] });

    const exitCode = await module.runInspectIndexCli(harness.dependencies);

    expect(exitCode).toBe(1);
    expect(harness.inspect).not.toHaveBeenCalled();
    expect(harness.serialize).not.toHaveBeenCalled();
    expect(harness.writeStdout).not.toHaveBeenCalled();
    expect(harness.writeStderr).toHaveBeenCalledTimes(1);
    expect(harness.writeStderr).toHaveBeenCalledWith(
      "KEC_INDEX_DIAGNOSTICS: INVALID_CONFIGURATION\n",
    );
  });

  it("emits one exact LF-terminated success line without CR, banners, or extra writes", async () => {
    const module = await loadCliModule();
    const harness = createHarness();

    await module.runInspectIndexCli(harness.dependencies);

    const output = harness.writeStdout.mock.calls[0]?.[0];
    expect(output).toBe(harness.bytes);
    expect(output?.endsWith("\n")).toBe(true);
    expect(output?.endsWith("\n\n")).toBe(false);
    expect(output).not.toContain("\r");
    expect(harness.writeStdout).toHaveBeenCalledTimes(1);
    expect(harness.writeStderr).not.toHaveBeenCalled();
  });

  it("does not mutate the injected environment, arguments, or dependency container", async () => {
    const module = await loadCliModule();
    const environment = Object.freeze({
      KEC_DB_PATH: "/tmp/kec-index.sqlite",
    });
    const argv = Object.freeze([] as string[]);
    const harness = createHarness({ environment, argv });
    const beforeEnvironment = { ...environment };
    const beforeArguments = [...argv];

    await module.runInspectIndexCli(harness.dependencies);

    expect(environment).toEqual(beforeEnvironment);
    expect(argv).toEqual(beforeArguments);
    expect(Object.isFrozen(harness.dependencies)).toBe(true);
    expect(Object.isFrozen(environment)).toBe(true);
    expect(Object.isFrozen(argv)).toBe(true);
  });
});

describe("KEC index diagnostics CLI path resolution", () => {
  it("resolves a relative KEC_DB_PATH from the injected cwd without reading PROJECT_ROOT", async () => {
    const module = await loadCliModule();
    const cwd = useTemporaryRoot();
    let projectRootReads = 0;
    const environment = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(environment, "KEC_DB_PATH", {
      enumerable: true,
      value: "state/index.sqlite",
    });
    Object.defineProperty(environment, "PROJECT_ROOT", {
      enumerable: true,
      get: () => {
        projectRootReads += 1;
        throw new Error("PROJECT_ROOT must not be read");
      },
    });
    const harness = createHarness({ environment, cwd });

    await module.runInspectIndexCli(harness.dependencies);

    expect(projectRootReads).toBe(0);
    expect(harness.inspect).toHaveBeenCalledWith(
      resolve(cwd, "state/index.sqlite"),
    );
  });

  it("preserves an absolute KEC_DB_PATH and does not enumerate the environment", async () => {
    const module = await loadCliModule();
    const absolutePath = join(useTemporaryRoot(), "index.sqlite");
    const environment = new Proxy(
      { KEC_DB_PATH: absolutePath },
      {
        ownKeys: () => {
          throw new Error("environment enumeration is forbidden");
        },
      },
    );
    const harness = createHarness({ environment });

    await module.runInspectIndexCli(harness.dependencies);

    expect(isAbsolute(absolutePath)).toBe(true);
    expect(harness.inspect).toHaveBeenCalledWith(absolutePath);
  });

  it("uses an existing relative PROJECT_ROOT fallback only when KEC_DB_PATH is absent", async () => {
    const module = await loadCliModule();
    const cwd = useTemporaryRoot();
    const harness = createHarness({ environment: { PROJECT_ROOT: "." }, cwd });

    await module.runInspectIndexCli(harness.dependencies);

    expect(harness.inspect).toHaveBeenCalledWith(
      join(cwd, ".voltai", "kec.sqlite"),
    );
  });

  it.each([
    ["neither value", {}],
    [
      "empty KEC_DB_PATH despite a valid fallback",
      { KEC_DB_PATH: "", PROJECT_ROOT: "/tmp" },
    ],
    ["empty PROJECT_ROOT", { PROJECT_ROOT: "" }],
    [
      "non-string KEC_DB_PATH",
      { KEC_DB_PATH: new String("/tmp/index.sqlite") },
    ],
  ])(
    "rejects %s without coercion or inspection",
    async (_name, environment) => {
      const module = await loadCliModule();
      const harness = createHarness({ environment });

      const exitCode = await module.runInspectIndexCli(harness.dependencies);

      expect(exitCode).toBe(1);
      expect(harness.inspect).not.toHaveBeenCalled();
      expect(harness.serialize).not.toHaveBeenCalled();
      expect(harness.writeStdout).not.toHaveBeenCalled();
      expect(harness.writeStderr).toHaveBeenCalledWith(
        "KEC_INDEX_DIAGNOSTICS: INVALID_CONFIGURATION\n",
      );
    },
  );

  it("rejects a hostile KEC_DB_PATH object without coercion", async () => {
    const module = await loadCliModule();
    let coercions = 0;
    const hostile = {
      toString: () => {
        coercions += 1;
        throw new Error("coercion-sentinel");
      },
      valueOf: () => {
        coercions += 1;
        throw new Error("coercion-sentinel");
      },
      [Symbol.toPrimitive]: () => {
        coercions += 1;
        throw new Error("coercion-sentinel");
      },
    };
    const harness = createHarness({
      environment: { KEC_DB_PATH: hostile },
    });

    const exitCode = await module.runInspectIndexCli(harness.dependencies);

    expect(exitCode).toBe(1);
    expect(coercions).toBe(0);
    expect(harness.inspect).not.toHaveBeenCalled();
    expect(harness.writeStderr).toHaveBeenCalledWith(
      "KEC_INDEX_DIAGNOSTICS: INVALID_CONFIGURATION\n",
    );
  });

  it("ignores unrelated provider, endpoint, ranking, retry, and secret values", async () => {
    const module = await loadCliModule();
    const accessed: string[] = [];
    const environment = new Proxy(
      {
        KEC_DB_PATH: "/tmp/kec-index.sqlite",
        KEC_EMBED_PROVIDER: "provider-sentinel",
        OLLAMA_BASE_URL: "endpoint-sentinel",
        KEC_HYBRID_SEMANTIC_WEIGHT: "weight-sentinel",
        RETRY_COUNT: "retry-sentinel",
        OPENAI_API_KEY: "secret-sentinel",
      },
      {
        get: (target, key, receiver) => {
          if (typeof key === "string") accessed.push(key);
          return Reflect.get(target, key, receiver);
        },
        ownKeys: () => {
          throw new Error("environment enumeration is forbidden");
        },
      },
    );
    const harness = createHarness({ environment });

    await module.runInspectIndexCli(harness.dependencies);

    expect(accessed).toEqual(["KEC_DB_PATH"]);
    expect(harness.inspect).toHaveBeenCalledWith("/tmp/kec-index.sqlite");
  });
});

describe("KEC index diagnostics short-lived subprocess contract", () => {
  it("returns missing-database diagnostics without creating the parent or target", async () => {
    const fixture = useFixture(createMissingDatabaseFixture(false));
    const before = snapshotArtifacts(fixture.databasePath);
    const expected = serializeKecIndexDiagnostics(
      await inspectKecIndex(fixture.databasePath),
    );

    const result = runCliSubprocess({ KEC_DB_PATH: fixture.databasePath });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(expected);
    expect(result.stderr).toBe("");
    expect(snapshotArtifacts(fixture.databasePath)).toEqual(before);
  });

  it.each([
    ["READY", createReadyIndexFixture],
    ["INCONSISTENT", createChunksOnlyIndexFixture],
  ])("prints exact %s diagnostics and terminates", async (_status, factory) => {
    const fixture = useFixture(factory());
    const expected = serializeKecIndexDiagnostics(
      await inspectKecIndex(fixture.databasePath),
    );

    const result = runCliSubprocess({ KEC_DB_PATH: fixture.databasePath });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(expected);
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toContain(fixture.databasePath);
  });

  it("fails once without raw details when configuration is absent", () => {
    const result = runCliSubprocess({
      KEC_DB_PATH: undefined,
      PROJECT_ROOT: undefined,
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "KEC_INDEX_DIAGNOSTICS: INVALID_CONFIGURATION\n",
    );
  });

  it("fails once without raw SQLite content for a corrupt database", () => {
    const fixture = useFixture(createCorruptDatabaseFixture());

    const result = runCliSubprocess({ KEC_DB_PATH: fixture.databasePath });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("KEC_INDEX_DIAGNOSTICS: DATABASE_INVALID\n");
    expect(result.stderr).not.toContain(fixture.databasePath);
    expect(result.stderr).not.toContain("not-a-sqlite-database");
  });

  it("rejects every positional argument instead of treating it as a database path", () => {
    const result = runCliSubprocess({ KEC_DB_PATH: "/tmp/configured.sqlite" }, [
      "/tmp/argument.sqlite",
    ]);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "KEC_INDEX_DIAGNOSTICS: INVALID_CONFIGURATION\n",
    );
    expect(result.stderr).not.toContain("argument.sqlite");
  });
});
