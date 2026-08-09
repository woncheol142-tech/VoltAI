import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
  approvedPruneErrors,
  createPlan,
  expectedPruneSourceId,
  loadDirectoryPruningModule,
  packageRoot,
  pruneCliPath,
  pruneEnvironment,
  pruneErrors,
  task60ModulesExist,
  withPruneFixture,
  type KecDirectoryPruneDiscovery,
  type KecDirectoryPrunePlan,
  type KecDirectoryPruneResult,
} from "./helpers/kecDirectoryPruneFixture.js";

type CliDependencies = Readonly<{
  cwd: string;
  readConfig: (
    environment: unknown,
    cwd: string,
  ) => Readonly<{ projectRoot: string; databasePath: string }>;
  discover: (
    projectRoot: string,
    request: unknown,
  ) => KecDirectoryPruneDiscovery;
  assertDatabaseAvailable: (databasePath: string) => void;
  createStore: (databasePath: string) => unknown | Promise<unknown>;
  enumerateSources: (
    store: unknown,
    collection: "kec",
  ) => Promise<readonly string[]>;
  prepare: (
    discovery: KecDirectoryPruneDiscovery,
    sourcePaths: readonly string[],
  ) => KecDirectoryPrunePlan;
  execute: (
    plan: KecDirectoryPrunePlan,
    store: unknown,
  ) => Promise<KecDirectoryPruneResult>;
  serialize: (result: KecDirectoryPruneResult) => string;
  closeStore: (store: unknown) => void | Promise<void>;
  writeStdout: (text: string) => void;
  writeStderr: (text: string) => void;
}>;

type CliModule = Readonly<{
  runKecDirectoryPruneCli: (
    argv: readonly string[],
    environment: unknown,
    dependencies: CliDependencies,
  ) => Promise<number>;
}>;

async function loadCli(): Promise<CliModule> {
  return (await import(/* @vite-ignore */ pruneCliPath)) as CliModule;
}

function successResult(): KecDirectoryPruneResult {
  return Object.freeze({
    schemaVersion: 1,
    status: "SUCCEEDED",
    desiredSourceCount: 1,
    indexedSourceCount: 1,
    deletedSourceCount: 0,
    sources: Object.freeze([]),
  });
}

type HarnessOptions = Readonly<{
  failureAt?:
    "config" | "discover" | "database" | "enumerate" | "prepare" | "close";
  failure?: unknown;
  enumeratedSourcePaths?: readonly string[];
  plan?: KecDirectoryPrunePlan;
  result?: KecDirectoryPruneResult;
  prepareOverride?: (
    discovery: KecDirectoryPruneDiscovery,
    sourcePaths: readonly string[],
  ) => KecDirectoryPrunePlan;
  onExecute?: () => void | Promise<void>;
  onClose?: () => void;
}>;

function harness(
  paths: Readonly<{ projectRoot: string; databasePath: string }>,
  options: HarnessOptions = {},
) {
  const events: string[] = [];
  const stdout: string[] = [];
  const stderr: string[] = [];
  const store = Object.freeze({ kind: "prune-store" });
  const discovery = Object.freeze({
    directoryPath: "manuals",
    sources: Object.freeze(["manuals/active.pdf"]),
  });
  const plan =
    options.plan ??
    createPlan({
      staleSources: Object.freeze([]),
      indexedSourceCount: 1,
    });
  const dependencies: CliDependencies = Object.freeze({
    cwd: paths.projectRoot,
    readConfig: vi.fn(() => {
      events.push("config");
      if (options.failureAt === "config") throw options.failure;
      return paths;
    }),
    discover: vi.fn(() => {
      events.push("discover");
      if (options.failureAt === "discover") throw options.failure;
      return discovery;
    }),
    assertDatabaseAvailable: vi.fn(() => {
      events.push("database-available");
      if (options.failureAt === "database") throw options.failure;
    }),
    createStore: vi.fn(async () => {
      events.push("create-store");
      return store;
    }),
    enumerateSources: vi.fn(async () => {
      events.push("enumerate");
      if (options.failureAt === "enumerate") throw options.failure;
      return Object.freeze(
        options.enumeratedSourcePaths ?? ["manuals/active.pdf"],
      );
    }),
    prepare: vi.fn((discovered, sourcePaths) => {
      events.push("prepare");
      if (options.failureAt === "prepare") throw options.failure;
      return options.prepareOverride?.(discovered, sourcePaths) ?? plan;
    }),
    execute: vi.fn(async () => {
      events.push("execute");
      await options.onExecute?.();
      return options.result ?? successResult();
    }),
    serialize: vi.fn(() => {
      events.push("serialize");
      return `${JSON.stringify(successResult())}\n`;
    }),
    closeStore: vi.fn(async () => {
      events.push("close-store");
      options.onClose?.();
      if (options.failureAt === "close") throw options.failure;
    }),
    writeStdout: vi.fn((text: string) => stdout.push(text)),
    writeStderr: vi.fn((text: string) => stderr.push(text)),
  });
  return { dependencies, events, stdout, stderr, store, discovery, plan };
}

describe("Task 60 prune-only CLI", () => {
  it("is RED until the guarded pruneKecDirectory CLI exists", () => {
    expect(existsSync(pruneCliPath), "missing src/pruneKecDirectory.ts").toBe(
      true,
    );
  });

  it("imports without output, startup, exit mutation, timers, fetch, or file creation", () => {
    if (!existsSync(pruneCliPath)) return;
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--eval",
        `await import(${JSON.stringify(pathToFileURL(pruneCliPath).href)})`,
      ],
      {
        cwd: packageRoot,
        encoding: "utf8",
        timeout: 10_000,
        env: {},
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it.each([[], ["manuals", "extra"], ["--allow-empty"], ["--flag", "manuals"]])(
    "accepts exactly one positional directory and rejects argv %j",
    async (argv) => {
      if (!existsSync(pruneCliPath)) return;
      await withPruneFixture(async (fixture) => {
        const { runKecDirectoryPruneCli } = await loadCli();
        const test = harness(fixture);
        const exitCode = await runKecDirectoryPruneCli(
          argv,
          pruneEnvironment(fixture.projectRoot, fixture.databasePath),
          test.dependencies,
        );
        expect(exitCode).toBe(1);
        expect(test.stderr).toEqual([`${pruneErrors.invalidArgument}\n`]);
        expect(test.events).toEqual([]);
      });
    },
  );

  it("runs discovery before database/store authority and emits success only after close", async () => {
    if (!existsSync(pruneCliPath) || !task60ModulesExist()) return;
    await withPruneFixture(async (fixture) => {
      const { runKecDirectoryPruneCli } = await loadCli();
      const test = harness(fixture);
      const exitCode = await runKecDirectoryPruneCli(
        ["manuals"],
        pruneEnvironment(fixture.projectRoot, fixture.databasePath),
        test.dependencies,
      );

      expect(exitCode).toBe(0);
      expect(test.events).toEqual([
        "config",
        "discover",
        "database-available",
        "create-store",
        "enumerate",
        "prepare",
        "execute",
        "close-store",
        "serialize",
      ]);
      expect(test.stdout).toHaveLength(1);
      expect(test.stderr).toEqual([]);
    });
  });

  it("stops at NO_SOURCES before database validation or store construction", async () => {
    if (!existsSync(pruneCliPath)) return;
    await withPruneFixture(async (fixture) => {
      const { runKecDirectoryPruneCli } = await loadCli();
      const test = harness(fixture, {
        failureAt: "discover",
        failure: new Error(pruneErrors.noSources),
      });
      const exitCode = await runKecDirectoryPruneCli(
        ["manuals"],
        pruneEnvironment(fixture.projectRoot, fixture.databasePath),
        test.dependencies,
      );
      expect(exitCode).toBe(1);
      expect(test.events).toEqual(["config", "discover"]);
      expect(test.stderr).toEqual([`${pruneErrors.noSources}\n`]);
      expect(existsSync(fixture.databasePath)).toBe(false);
    });
  });

  it("does not create a missing database or parent directory", async () => {
    if (!existsSync(pruneCliPath)) return;
    await withPruneFixture(async (fixture) => {
      const { runKecDirectoryPruneCli } = await loadCli();
      fixture.writeProjectFile("manuals/active.pdf");
      const test = harness(fixture, {
        failureAt: "database",
        failure: new Error(pruneErrors.databaseUnavailable),
      });
      const exitCode = await runKecDirectoryPruneCli(
        ["manuals"],
        pruneEnvironment(fixture.projectRoot, fixture.databasePath),
        test.dependencies,
      );
      expect(exitCode).toBe(1);
      expect(test.events).toEqual(["config", "discover", "database-available"]);
      expect(existsSync(fixture.databasePath)).toBe(false);
      expect(test.stderr).toEqual([`${pruneErrors.databaseUnavailable}\n`]);
    });
  });

  it.each(["symlink", "directory", "fifo"] as const)(
    "stops before store authority when injected DB validation rejects a %s",
    async (kind) => {
      expect(
        existsSync(pruneCliPath),
        `missing Task 60 ${kind} database-path rejection orchestration`,
      ).toBe(true);
      if (!existsSync(pruneCliPath)) return;
      await withPruneFixture(async (fixture) => {
        const { runKecDirectoryPruneCli } = await loadCli();
        const hostileDatabasePath = `/hostile/${kind}/secret-kec.sqlite`;
        const test = harness(
          {
            projectRoot: fixture.projectRoot,
            databasePath: hostileDatabasePath,
          },
          {
            failureAt: "database",
            failure: new Error(pruneErrors.databaseUnavailable),
          },
        );
        const exitCode = await runKecDirectoryPruneCli(
          ["manuals"],
          pruneEnvironment(fixture.projectRoot, hostileDatabasePath),
          test.dependencies,
        );

        expect(exitCode).toBe(1);
        expect(test.events).toEqual([
          "config",
          "discover",
          "database-available",
        ]);
        expect(test.dependencies.createStore).not.toHaveBeenCalled();
        expect(test.dependencies.enumerateSources).not.toHaveBeenCalled();
        expect(test.dependencies.execute).not.toHaveBeenCalled();
        expect(test.stdout).toEqual([]);
        expect(test.stderr).toEqual([`${pruneErrors.databaseUnavailable}\n`]);
        expect(test.stderr.join("")).not.toContain("/hostile/");
      });
    },
  );

  it("maps enumeration and finalization failures without emitting success", async () => {
    if (!existsSync(pruneCliPath)) return;
    await withPruneFixture(async (fixture) => {
      const { runKecDirectoryPruneCli } = await loadCli();
      for (const [failureAt, expected] of [
        ["enumerate", pruneErrors.enumerationFailed],
        ["close", pruneErrors.finalizationFailed],
      ] as const) {
        const test = harness(fixture, {
          failureAt,
          failure: new Error(`/secret/database.sqlite ${expected}`),
        });
        const exitCode = await runKecDirectoryPruneCli(
          ["manuals"],
          pruneEnvironment(fixture.projectRoot, fixture.databasePath),
          test.dependencies,
        );
        expect(exitCode).toBe(1);
        expect(test.stdout).toEqual([]);
        expect(test.stderr).toEqual([`${expected}\n`]);
        expect(test.events).toContain("close-store");
      }
    });
  });

  it("preserves the primary enumeration failure when store finalization also fails", async () => {
    if (!existsSync(pruneCliPath)) return;
    await withPruneFixture(async (fixture) => {
      const { runKecDirectoryPruneCli } = await loadCli();
      const test = harness(fixture, {
        failureAt: "enumerate",
        failure: new Error("/secret/database.sqlite enumeration failure"),
        onClose: () => {
          throw new Error("/secret/database.sqlite close failure");
        },
      });
      const exitCode = await runKecDirectoryPruneCli(
        ["manuals"],
        pruneEnvironment(fixture.projectRoot, fixture.databasePath),
        test.dependencies,
      );

      expect(exitCode).toBe(1);
      expect(test.events).toEqual([
        "config",
        "discover",
        "database-available",
        "create-store",
        "enumerate",
        "close-store",
      ]);
      expect(test.stdout).toEqual([]);
      expect(test.stderr).toEqual([`${pruneErrors.enumerationFailed}\n`]);
      expect(test.stderr.join("")).not.toContain("FINALIZATION_FAILED");
      expect(test.stderr.join("")).not.toContain("/secret/");
      expect(test.stderr.join("")).not.toContain("close failure");
    });
  });

  it("closes without execution when complete snapshot validation fails", async () => {
    if (!existsSync(pruneCliPath)) return;
    await withPruneFixture(async (fixture) => {
      const { runKecDirectoryPruneCli } = await loadCli();
      const test = harness(fixture, {
        failureAt: "prepare",
        failure: new Error(pruneErrors.invalidIndexState),
      });
      const exitCode = await runKecDirectoryPruneCli(
        ["manuals"],
        pruneEnvironment(fixture.projectRoot, fixture.databasePath),
        test.dependencies,
      );
      expect(exitCode).toBe(1);
      expect(test.events).toEqual([
        "config",
        "discover",
        "database-available",
        "create-store",
        "enumerate",
        "prepare",
        "close-store",
      ]);
      expect(test.stdout).toEqual([]);
      expect(test.stderr).toEqual([`${pruneErrors.invalidIndexState}\n`]);
    });
  });

  it.each([
    ["duplicate normalized identity", ["manuals/a.pdf", "manuals/a.pdf"]],
    [
      "out-of-scope malformed identity",
      ["manuals/a.pdf", "../outside/secret.pdf"],
    ],
  ] as const)(
    "validates the complete %s snapshot before any prune transaction",
    async (_caseName, snapshot) => {
      expect(
        existsSync(pruneCliPath) && task60ModulesExist(),
        `missing Task 60 ${_caseName} fail-closed orchestration`,
      ).toBe(true);
      if (!existsSync(pruneCliPath) || !task60ModulesExist()) return;
      await withPruneFixture(async (fixture) => {
        const { runKecDirectoryPruneCli } = await loadCli();
        const { prepareKecDirectoryPrune } = await loadDirectoryPruningModule();
        const test = harness(fixture, {
          enumeratedSourcePaths: snapshot,
          prepareOverride: prepareKecDirectoryPrune,
        });
        const exitCode = await runKecDirectoryPruneCli(
          ["manuals"],
          pruneEnvironment(fixture.projectRoot, fixture.databasePath),
          test.dependencies,
        );

        expect(exitCode).toBe(1);
        expect(test.events).toEqual([
          "config",
          "discover",
          "database-available",
          "create-store",
          "enumerate",
          "prepare",
          "close-store",
        ]);
        expect(test.dependencies.enumerateSources).toHaveBeenCalledWith(
          test.store,
          "kec",
        );
        expect(test.dependencies.execute).not.toHaveBeenCalled();
        expect(test.stdout).toEqual([]);
        expect(test.stderr).toEqual([`${pruneErrors.invalidIndexState}\n`]);
        expect(test.stderr.join("")).not.toContain("outside/secret.pdf");
      });
    },
  );

  it("reports post-commit close failure without compensating rollback and reruns idempotently", async () => {
    expect(
      existsSync(pruneCliPath),
      "missing Task 60 post-commit finalization failure orchestration",
    ).toBe(true);
    if (!existsSync(pruneCliPath)) return;
    await withPruneFixture(async (fixture) => {
      const { runKecDirectoryPruneCli } = await loadCli();
      const active = "manuals/active.pdf";
      const stale = "manuals/stale.pdf";
      const { SqliteVectorStore } =
        await import("../src/knowledge/sqliteVectorStore.js");
      const seedStore = new SqliteVectorStore(fixture.databasePath);
      await seedStore.upsert(
        "kec",
        [active, stale].map((sourcePath, index) => ({
          id: `${sourcePath}#chunk=${index}`,
          sourcePath,
          page: 1,
          chunkIndex: index,
          clause: null,
          text: `post-commit ${sourcePath}`,
          embedding: [1, 0],
        })),
      );
      await seedStore.saveIndexMetadata("kec", {
        embeddingProvider: "test",
        embeddingModel: "post-commit-finalization",
        dimensions: 2,
        indexedAt: "2026-08-09T00:00:00.000Z",
      });
      await seedStore.close();

      const readPersistedSources = async (): Promise<readonly string[]> => {
        const store = new SqliteVectorStore(fixture.databasePath);
        try {
          const chunks = await store.listChunks("kec");
          return chunks.map((chunk) => chunk.sourcePath).sort();
        } finally {
          await store.close();
        }
      };
      const committedResult = Object.freeze({
        schemaVersion: 1 as const,
        status: "SUCCEEDED" as const,
        desiredSourceCount: 1,
        indexedSourceCount: 2,
        deletedSourceCount: 1,
        sources: Object.freeze([
          Object.freeze({
            sourceId: expectedPruneSourceId(stale),
            status: "DELETED" as const,
          }),
        ]),
      });
      const first = harness(fixture, {
        enumeratedSourcePaths: [active, stale],
        plan: createPlan(),
        result: committedResult,
        onExecute: async () => {
          const store = new SqliteVectorStore(fixture.databasePath);
          try {
            await store.deleteBySourcePath("kec", stale);
          } finally {
            await store.close();
          }
        },
        failureAt: "close",
        failure: new Error("/secret/close failure"),
      });

      const firstExit = await runKecDirectoryPruneCli(
        ["manuals"],
        pruneEnvironment(fixture.projectRoot, fixture.databasePath),
        first.dependencies,
      );
      expect(firstExit).toBe(1);
      expect(first.events).toEqual([
        "config",
        "discover",
        "database-available",
        "create-store",
        "enumerate",
        "prepare",
        "execute",
        "close-store",
      ]);
      expect(first.stdout).toEqual([]);
      expect(first.stderr).toEqual([`${pruneErrors.finalizationFailed}\n`]);
      await expect(readPersistedSources()).resolves.toEqual([active]);

      const secondResult = successResult();
      const postCommitSnapshot = await readPersistedSources();
      const second = harness(fixture, {
        enumeratedSourcePaths: postCommitSnapshot,
        plan: createPlan({
          expectedSourcePaths: Object.freeze([active]),
          staleSources: Object.freeze([]),
          indexedSourceCount: 1,
        }),
        result: secondResult,
      });
      const secondExit = await runKecDirectoryPruneCli(
        ["manuals"],
        pruneEnvironment(fixture.projectRoot, fixture.databasePath),
        second.dependencies,
      );
      expect(secondExit).toBe(0);
      expect(second.stdout).toEqual([`${JSON.stringify(secondResult)}\n`]);
      expect(second.stderr).toEqual([]);
      await expect(readPersistedSources()).resolves.toEqual([active]);
    });
  });

  it("emits only the approved fixed taxonomy and normalizes hostile errors", async () => {
    if (!existsSync(pruneCliPath)) return;
    await withPruneFixture(async (fixture) => {
      const { runKecDirectoryPruneCli } = await loadCli();
      for (const expected of approvedPruneErrors.slice(1)) {
        const test = harness(fixture, {
          failureAt: "config",
          failure: new Error(expected),
        });
        await runKecDirectoryPruneCli(
          ["manuals"],
          pruneEnvironment(fixture.projectRoot, fixture.databasePath),
          test.dependencies,
        );
        expect(test.stderr).toEqual([`${expected}\n`]);
      }

      const hostile = harness(fixture, {
        failureAt: "config",
        failure: new Error("/private/path SQLITE secret"),
      });
      await runKecDirectoryPruneCli(
        ["manuals"],
        pruneEnvironment(fixture.projectRoot, fixture.databasePath),
        hostile.dependencies,
      );
      expect(hostile.stderr).toEqual([`${pruneErrors.internalError}\n`]);
    });
  });
});
