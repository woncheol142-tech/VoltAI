import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  prepareKecBatchIndex,
  readKecBatchIndexConfig,
  serializeKecBatchIndexResult,
  type KecBatchIndexConfig,
  type KecBatchIndexExecutionDependencies,
  type KecBatchIndexResultV1,
  type PreparedKecBatchIndex,
} from "../src/batchIndexing/index.js";
import { discoverKecBatchDirectory } from "../src/directoryBatchIndexing/index.js";
import {
  directoryCliPath,
  directoryEnvironment,
  directoryErrors,
  expectedSourceId,
  withDirectoryFixture,
} from "./helpers/kecBatchDirectoryFixture.js";

type DirectoryDiscovery = Readonly<{ sources: readonly string[] }>;
type CliDependencies = Readonly<{
  cwd: string;
  readConfig: (environment: unknown, cwd: string) => KecBatchIndexConfig;
  discover: (projectRoot: string, request: unknown) => DirectoryDiscovery;
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
  runKecBatchDirectoryCli: (
    argv: readonly string[],
    environment: unknown,
    dependencies: CliDependencies,
  ) => Promise<number>;
}>;

async function loadCli(): Promise<CliModule> {
  return (await import(/* @vite-ignore */ directoryCliPath)) as CliModule;
}

function successResult(sourceIds: readonly string[]): KecBatchIndexResultV1 {
  return Object.freeze({
    schemaVersion: 1,
    status: "SUCCEEDED",
    requestedSourceCount: sourceIds.length,
    indexedSourceCount: sourceIds.length,
    failedSourceCount: 0,
    notAttemptedSourceCount: 0,
    indexedChunkCount: sourceIds.length,
    sources: Object.freeze(
      sourceIds.map((sourceId) =>
        Object.freeze({
          sourceId,
          status: "INDEXED" as const,
          indexedChunkCount: 1,
          failureCode: null,
        }),
      ),
    ),
  });
}

describe("Task 59 delegation to the existing Task 58 batch authority", () => {
  it("is RED until the directory CLI delegation boundary exists", () => {
    expect(existsSync(directoryCliPath)).toBe(true);
  });

  it("delegates one successful discovery exactly once and lets Task 58 order sourceIds", async () => {
    if (!existsSync(directoryCliPath)) return;
    await withDirectoryFixture(async (fixture) => {
      const inputs = ["manuals/z.pdf", "manuals/a.pdf"] as const;
      for (const source of inputs) fixture.writeProjectFile(source);
      const config = readKecBatchIndexConfig(
        directoryEnvironment(fixture.projectRoot),
        fixture.fixtureRoot,
      );
      const discovery = Object.freeze({ sources: Object.freeze([...inputs]) });
      let preparedByTask58: PreparedKecBatchIndex | undefined;
      const executionDependencies = Object.freeze({
        createProvider: vi.fn(),
        createStore: vi.fn(),
        indexSource: vi.fn(),
        closeStore: vi.fn(),
        closeProvider: vi.fn(),
      }) as unknown as KecBatchIndexExecutionDependencies;
      const resultIds = inputs.map(expectedSourceId).sort();
      const result = successResult(resultIds);
      const discover = vi.fn(() => discovery);
      const prepareBatch = vi.fn((receivedConfig, request) => {
        preparedByTask58 = prepareKecBatchIndex(receivedConfig, request);
        return preparedByTask58;
      });
      const createExecutionDependencies = vi.fn(() => executionDependencies);
      const executeBatch = vi.fn(async () => result);
      const dependencies: CliDependencies = Object.freeze({
        cwd: fixture.fixtureRoot,
        readConfig: vi.fn(() => config),
        discover,
        prepareBatch,
        executeBatch,
        serializeBatch: vi.fn(serializeKecBatchIndexResult),
        createExecutionDependencies,
        writeStdout: vi.fn(),
        writeStderr: vi.fn(),
      });
      const { runKecBatchDirectoryCli } = await loadCli();

      const exitCode = await runKecBatchDirectoryCli(
        ["manuals"],
        directoryEnvironment(fixture.projectRoot),
        dependencies,
      );

      expect(exitCode).toBe(0);
      expect(discover).toHaveBeenCalledTimes(1);
      expect(discover).toHaveBeenCalledWith(fixture.projectRoot, {
        directory: "manuals",
      });
      expect(prepareBatch).toHaveBeenCalledTimes(1);
      expect(prepareBatch.mock.calls[0]?.[1]).toEqual({ sources: inputs });
      expect(
        preparedByTask58?.sources.map((source) => source.sourceId),
      ).toEqual(resultIds);
      expect(createExecutionDependencies).toHaveBeenCalledTimes(1);
      expect(executeBatch).toHaveBeenCalledTimes(1);
      expect(executeBatch).toHaveBeenCalledWith(
        preparedByTask58,
        executionDependencies,
      );
      expect(executionDependencies.createProvider).not.toHaveBeenCalled();
      expect(executionDependencies.createStore).not.toHaveBeenCalled();
    });
  });

  it("passes discovered project-relative strings without normalization, repair, or reordering", async () => {
    if (!existsSync(directoryCliPath)) return;
    await withDirectoryFixture(async (fixture) => {
      const raw = Object.freeze(["manuals/./alias.pdf", "manuals/b.pdf"]);
      const prepareBatch = vi.fn(() => {
        throw new Error(directoryErrors.invalidSource);
      });
      const dependencies = createMinimalDependencies(fixture, {
        discover: vi.fn(() => Object.freeze({ sources: raw })),
        prepareBatch,
      });
      const { runKecBatchDirectoryCli } = await loadCli();
      const exitCode = await runKecBatchDirectoryCli(
        ["manuals"],
        directoryEnvironment(fixture.projectRoot),
        dependencies,
      );

      expect(exitCode).toBe(1);
      expect(prepareBatch.mock.calls[0]?.[1]).toEqual({ sources: raw });
      expect(dependencies.createExecutionDependencies).not.toHaveBeenCalled();
      expect(dependencies.executeBatch).not.toHaveBeenCalled();
      expect(dependencies.writeStderr).toHaveBeenCalledWith(
        `${directoryErrors.invalidSource}\n`,
      );
    });
  });

  it("does not let discovery aliases bypass Task 58 canonical preflight", async (context) => {
    if (!existsSync(directoryCliPath)) return;
    await withDirectoryFixture(async (fixture) => {
      const original = fixture.writeProjectFile("manuals/original.pdf");
      const alias = fixture.tryCreateFileSymlink(original, "manuals/alias.pdf");
      if (!alias.supported) {
        context.skip("native file symlinks are unsupported on this platform");
        return;
      }
      const config = readKecBatchIndexConfig(
        directoryEnvironment(fixture.projectRoot),
        fixture.fixtureRoot,
      );
      const prepareBatch = vi.fn((receivedConfig, request) =>
        prepareKecBatchIndex(receivedConfig, request),
      );
      const dependencies = createMinimalDependencies(fixture, {
        readConfig: vi.fn(() => config),
        discover: vi.fn(() =>
          Object.freeze({
            sources: Object.freeze([
              "manuals/original.pdf",
              "manuals/alias.pdf",
            ]),
          }),
        ),
        prepareBatch,
      });
      const { runKecBatchDirectoryCli } = await loadCli();
      const exitCode = await runKecBatchDirectoryCli(
        ["manuals"],
        directoryEnvironment(fixture.projectRoot),
        dependencies,
      );
      expect(exitCode).toBe(1);
      expect(prepareBatch).toHaveBeenCalledTimes(1);
      expect(dependencies.executeBatch).not.toHaveBeenCalled();
      expect(dependencies.writeStderr).toHaveBeenCalledWith(
        `${directoryErrors.invalidSource}\n`,
      );
    });
  });

  it("preserves the exact Task 58 result object and serializer bytes", async () => {
    if (!existsSync(directoryCliPath)) return;
    await withDirectoryFixture(async (fixture) => {
      fixture.writeProjectFile("manuals/a.pdf");
      const id = expectedSourceId("manuals/a.pdf");
      const result = successResult([id]);
      const bytes = serializeKecBatchIndexResult(result);
      const serializeBatch = vi.fn(() => bytes);
      const dependencies = createMinimalDependencies(fixture, {
        executeBatch: vi.fn(async () => result),
        serializeBatch,
      });
      const { runKecBatchDirectoryCli } = await loadCli();
      const exitCode = await runKecBatchDirectoryCli(
        ["manuals"],
        directoryEnvironment(fixture.projectRoot),
        dependencies,
      );

      expect(exitCode).toBe(0);
      expect(serializeBatch).toHaveBeenCalledTimes(1);
      expect(serializeBatch).toHaveBeenCalledWith(result);
      expect(dependencies.writeStdout).toHaveBeenCalledWith(bytes);
    });
  });

  it("does not construct provider, store, parser, network, or batch mutation authority when discovery fails", async () => {
    if (!existsSync(directoryCliPath)) return;
    await withDirectoryFixture(async (fixture) => {
      const provider = vi.fn();
      const store = vi.fn();
      const parser = vi.fn();
      const network = vi.fn();
      const mutation = vi.fn();
      const dependencies = createMinimalDependencies(fixture, {
        discover: vi.fn(() => {
          throw new Error(directoryErrors.discoveryFailed);
        }),
        createExecutionDependencies: vi.fn(() => {
          provider();
          store();
          parser();
          network();
          mutation();
          throw new Error("must not construct runtime authority");
        }),
      });
      const { runKecBatchDirectoryCli } = await loadCli();
      const exitCode = await runKecBatchDirectoryCli(
        ["manuals"],
        directoryEnvironment(fixture.projectRoot),
        dependencies,
      );

      expect(exitCode).toBe(1);
      for (const authority of [provider, store, parser, network, mutation]) {
        expect(authority).not.toHaveBeenCalled();
      }
      expect(dependencies.prepareBatch).not.toHaveBeenCalled();
      expect(dependencies.createExecutionDependencies).not.toHaveBeenCalled();
      expect(dependencies.executeBatch).not.toHaveBeenCalled();
      expect(dependencies.serializeBatch).not.toHaveBeenCalled();
      expect(dependencies.writeStdout).not.toHaveBeenCalled();
    });
  });

  it("does not delegate or construct runtime authority after verified directory identity changes", async () => {
    if (!existsSync(directoryCliPath)) return;
    await withDirectoryFixture(async (fixture) => {
      const directoryPath = join(fixture.projectRoot, "manuals");
      const sourcePath = join(directoryPath, "a.pdf");
      let directoryChecks = 0;
      const readDirectory = vi.fn(() => Object.freeze(["a.pdf"]));
      const lstat = vi.fn((path: string) => {
        if (path === directoryPath) {
          directoryChecks += 1;
          return Object.freeze({
            kind: "directory" as const,
            identity: Object.freeze({
              device: directoryChecks === 1 ? 1n : 2n,
              inode: directoryChecks === 1 ? 10n : 20n,
            }),
          });
        }
        if (path === sourcePath) {
          return Object.freeze({
            kind: "file" as const,
            identity: Object.freeze({ device: 1n, inode: 11n }),
          });
        }
        throw new Error("unexpected path");
      });
      const provider = vi.fn();
      const store = vi.fn();
      const parser = vi.fn();
      const network = vi.fn();
      const mutation = vi.fn();
      const dependencies = createMinimalDependencies(fixture, {
        discover: vi.fn((projectRoot, request) =>
          discoverKecBatchDirectory(projectRoot, request, {
            lstat,
            realpath: (path: string) => path,
            readDirectory,
          }),
        ),
        createExecutionDependencies: vi.fn(() => {
          provider();
          store();
          parser();
          network();
          mutation();
          throw new Error("must not construct runtime authority");
        }),
      });
      const { runKecBatchDirectoryCli } = await loadCli();

      const exitCode = await runKecBatchDirectoryCli(
        ["manuals"],
        directoryEnvironment(fixture.projectRoot),
        dependencies,
      );

      expect(exitCode).toBe(1);
      for (const authority of [provider, store, parser, network, mutation]) {
        expect(authority).not.toHaveBeenCalled();
      }
      expect(dependencies.prepareBatch).not.toHaveBeenCalled();
      expect(dependencies.createExecutionDependencies).not.toHaveBeenCalled();
      expect(dependencies.executeBatch).not.toHaveBeenCalled();
      expect(dependencies.serializeBatch).not.toHaveBeenCalled();
      expect(dependencies.writeStdout).not.toHaveBeenCalled();
      expect(readDirectory).toHaveBeenCalledTimes(1);
      expect(directoryChecks).toBe(2);
      expect(dependencies.writeStderr).toHaveBeenCalledWith(
        `${directoryErrors.discoveryFailed}\n`,
      );
    });
  });

  it("contains no duplicate indexing implementation in Task 59 source", () => {
    if (!existsSync(directoryCliPath)) return;
    const source = readFileSync(directoryCliPath, "utf8");
    expect(source).not.toMatch(
      /readPdf|pdfjs|createPageChunks|indexKec\s*\(|embed\s*\(|upsert|deleteBySource|beginTransaction|commit\s*\(|rollback\s*\(/iu,
    );
  });
});

function createMinimalDependencies(
  fixture: Readonly<{ fixtureRoot: string; projectRoot: string }>,
  overrides: Partial<CliDependencies> = {},
): CliDependencies {
  const config = readKecBatchIndexConfig(
    directoryEnvironment(fixture.projectRoot),
    fixture.fixtureRoot,
  );
  const prepared = Object.freeze({
    ...config,
    sources: Object.freeze([
      Object.freeze({
        sourcePath: "manuals/a.pdf",
        sourceId: expectedSourceId("manuals/a.pdf"),
      }),
    ]),
  });
  const result = successResult([expectedSourceId("manuals/a.pdf")]);
  const executionDependencies = Object.freeze({
    createProvider: vi.fn(),
    createStore: vi.fn(),
    indexSource: vi.fn(),
    closeStore: vi.fn(),
    closeProvider: vi.fn(),
  }) as unknown as KecBatchIndexExecutionDependencies;
  return Object.freeze({
    cwd: fixture.fixtureRoot,
    readConfig: vi.fn(() => config),
    discover: vi.fn(() =>
      Object.freeze({ sources: Object.freeze(["manuals/a.pdf"]) }),
    ),
    prepareBatch: vi.fn(() => prepared),
    executeBatch: vi.fn(async () => result),
    serializeBatch: vi.fn(serializeKecBatchIndexResult),
    createExecutionDependencies: vi.fn(() => executionDependencies),
    writeStdout: vi.fn(),
    writeStderr: vi.fn(),
    ...overrides,
  });
}
