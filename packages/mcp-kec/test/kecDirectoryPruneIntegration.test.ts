import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  expectedPruneSourceId,
  pruneCliPath,
  pruneErrors,
  withPruneFixture,
} from "./helpers/kecDirectoryPruneFixture.js";

const testFile = fileURLToPath(import.meta.url);
const packageRoot = join(dirname(testFile), "..");

function runCli(
  projectRoot: string,
  databasePath: string,
  directory = "manuals",
) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", pruneCliPath, directory],
    {
      cwd: packageRoot,
      encoding: "utf8",
      timeout: 15_000,
      env: {
        PROJECT_ROOT: projectRoot,
        KEC_DB_PATH: databasePath,
      },
    },
  );
}

async function createIndexedStore(
  databasePath: string,
  sourcePaths: readonly string[],
) {
  const { SqliteVectorStore } =
    await import("../src/knowledge/sqliteVectorStore.js");
  const store = new SqliteVectorStore(databasePath);
  await store.upsert(
    "kec",
    sourcePaths.map((sourcePath, index) => ({
      id: `${sourcePath}#page=1#chunk=${index}`,
      sourcePath,
      page: 1,
      chunkIndex: index,
      clause: null,
      text: `indexed ${sourcePath}`,
      embedding: [1, 0],
    })),
  );
  await store.saveIndexMetadata("kec", {
    embeddingProvider: "test",
    embeddingModel: "provider-free-prune",
    dimensions: 2,
    indexedAt: "2026-08-09T00:00:00.000Z",
  });
  return store;
}

describe("Task 60 provider-free CLI integration", () => {
  it("is RED until the executable prune-only CLI exists", () => {
    expect(
      existsSync(pruneCliPath),
      "missing Task 60 CLI integration target",
    ).toBe(true);
  });

  it("does not create a missing database or its missing parent", async () => {
    if (!existsSync(pruneCliPath)) return;
    await withPruneFixture((fixture) => {
      fixture.writeProjectFile("manuals/active.pdf");
      expect(existsSync(dirname(fixture.databasePath))).toBe(false);
      const result = runCli(fixture.projectRoot, fixture.databasePath);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(`${pruneErrors.databaseUnavailable}\n`);
      expect(existsSync(fixture.databasePath)).toBe(false);
      expect(existsSync(dirname(fixture.databasePath))).toBe(false);
    });
  });

  it("rejects an unusable existing database without replacing or modifying it", async () => {
    if (!existsSync(pruneCliPath)) return;
    await withPruneFixture((fixture) => {
      fixture.writeProjectFile("manuals/active.pdf");
      mkdirSync(dirname(fixture.databasePath), { recursive: true });
      const sentinel = Buffer.from("not a SQLite database\n", "utf8");
      writeFileSync(fixture.databasePath, sentinel);
      const result = runCli(fixture.projectRoot, fixture.databasePath);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(`${pruneErrors.databaseUnavailable}\n`);
      expect(readFileSync(fixture.databasePath)).toEqual(sentinel);
    });
  });

  it("rejects a symlink KEC_DB_PATH without reading or mutating its SQLite target", async (context) => {
    expect(
      existsSync(pruneCliPath),
      "missing Task 60 native DB-symlink rejection",
    ).toBe(true);
    if (!existsSync(pruneCliPath)) return;
    await withPruneFixture(async (fixture) => {
      fixture.writeProjectFile("manuals/active.pdf");
      const targetPath = join(fixture.outsideRoot, "target.sqlite");
      const targetStore = await createIndexedStore(targetPath, [
        "manuals/active.pdf",
        "manuals/stale.pdf",
      ]);
      await targetStore.close();
      const before = readFileSync(targetPath);
      const link = fixture.tryCreateFileSymlink(
        targetPath,
        ".voltai/kec.sqlite",
      );
      if (!link.supported) {
        context.skip("native file symlink creation is unsupported");
        return;
      }

      const result = runCli(fixture.projectRoot, fixture.databasePath);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(`${pruneErrors.databaseUnavailable}\n`);
      expect(result.stderr).not.toContain(targetPath);
      expect(readFileSync(targetPath)).toEqual(before);
      expect(lstatSync(fixture.databasePath).isSymbolicLink()).toBe(true);
    });
  });

  it("rejects a directory KEC_DB_PATH without mutation", async () => {
    expect(
      existsSync(pruneCliPath),
      "missing Task 60 native DB-directory rejection",
    ).toBe(true);
    if (!existsSync(pruneCliPath)) return;
    await withPruneFixture((fixture) => {
      fixture.writeProjectFile("manuals/active.pdf");
      mkdirSync(fixture.databasePath, { recursive: true });

      const result = runCli(fixture.projectRoot, fixture.databasePath);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(`${pruneErrors.databaseUnavailable}\n`);
      expect(lstatSync(fixture.databasePath).isDirectory()).toBe(true);
      expect(readdirSync(fixture.databasePath)).toEqual([]);
    });
  });

  it("rejects a native FIFO KEC_DB_PATH without opening or replacing it", async (context) => {
    expect(
      existsSync(pruneCliPath),
      "missing Task 60 native DB-FIFO rejection",
    ).toBe(true);
    if (!existsSync(pruneCliPath)) return;
    await withPruneFixture((fixture) => {
      fixture.writeProjectFile("manuals/active.pdf");
      mkdirSync(dirname(fixture.databasePath), { recursive: true });
      const created = spawnSync("mkfifo", [fixture.databasePath], {
        encoding: "utf8",
        timeout: 5_000,
      });
      if (created.error !== undefined || created.status !== 0) {
        context.skip("native FIFO creation is unsupported on this platform");
        return;
      }

      const result = runCli(fixture.projectRoot, fixture.databasePath);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(`${pruneErrors.databaseUnavailable}\n`);
      expect(lstatSync(fixture.databasePath).isFIFO()).toBe(true);
    });
  });

  it("prunes stale rows without provider configuration, parsing, or network", async () => {
    if (!existsSync(pruneCliPath)) return;
    await withPruneFixture(async (fixture) => {
      const active = "manuals/active.pdf";
      const stale = "manuals/stale.PDF";
      fixture.writeProjectFile(active);
      const store = await createIndexedStore(fixture.databasePath, [
        active,
        stale,
        stale,
        stale,
      ]);
      const beforeChunks = await store.listChunks("kec");
      expect(
        beforeChunks.filter((entry) => entry.sourcePath === stale),
      ).toHaveLength(3);
      await store.close();

      const result = runCli(fixture.projectRoot, fixture.databasePath);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual({
        schemaVersion: 1,
        status: "SUCCEEDED",
        desiredSourceCount: 1,
        indexedSourceCount: 2,
        deletedSourceCount: 1,
        sources: [
          { sourceId: expectedPruneSourceId(stale), status: "DELETED" },
        ],
      });

      const { SqliteVectorStore } =
        await import("../src/knowledge/sqliteVectorStore.js");
      const reopened = new SqliteVectorStore(fixture.databasePath);
      try {
        await expect(reopened.listChunks("kec")).resolves.toEqual([
          expect.objectContaining({ sourcePath: active }),
        ]);
      } finally {
        await reopened.close();
      }
    });
  });

  it("succeeds when the desired directory has more sources than the no-stale index", async () => {
    if (!existsSync(pruneCliPath)) return;
    await withPruneFixture(async (fixture) => {
      const indexed = "manuals/a.pdf";
      fixture.writeProjectFile(indexed);
      fixture.writeProjectFile("manuals/b.pdf");
      const store = await createIndexedStore(fixture.databasePath, [indexed]);
      await store.close();

      const result = runCli(fixture.projectRoot, fixture.databasePath);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual({
        schemaVersion: 1,
        status: "SUCCEEDED",
        desiredSourceCount: 2,
        indexedSourceCount: 1,
        deletedSourceCount: 0,
        sources: [],
      });

      const { SqliteVectorStore } =
        await import("../src/knowledge/sqliteVectorStore.js");
      const reopened = new SqliteVectorStore(fixture.databasePath);
      try {
        await expect(reopened.listChunks("kec")).resolves.toEqual([
          expect.objectContaining({ sourcePath: indexed }),
        ]);
      } finally {
        await reopened.close();
      }
    });
  });

  it("emits a successful destructive result when desired sources outnumber a stale-only index", async () => {
    if (!existsSync(pruneCliPath)) return;
    await withPruneFixture(async (fixture) => {
      const stale = "manuals/stale.pdf";
      const otherCollectionSource = "manuals/company.pdf";
      fixture.writeProjectFile("manuals/a.pdf");
      fixture.writeProjectFile("manuals/b.pdf");
      const store = await createIndexedStore(fixture.databasePath, [stale]);
      await store.upsert("company", [
        {
          id: `${otherCollectionSource}#page=1#chunk=0`,
          sourcePath: otherCollectionSource,
          page: 1,
          chunkIndex: 0,
          clause: null,
          text: "other collection sentinel",
          embedding: [1, 0],
        },
      ]);
      await store.saveIndexMetadata("company", {
        embeddingProvider: "test",
        embeddingModel: "other-collection-sentinel",
        dimensions: 2,
        indexedAt: "2026-08-09T00:00:00.000Z",
      });
      await store.close();

      const result = runCli(fixture.projectRoot, fixture.databasePath);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual({
        schemaVersion: 1,
        status: "SUCCEEDED",
        desiredSourceCount: 2,
        indexedSourceCount: 1,
        deletedSourceCount: 1,
        sources: [
          { sourceId: expectedPruneSourceId(stale), status: "DELETED" },
        ],
      });

      const { SqliteVectorStore } =
        await import("../src/knowledge/sqliteVectorStore.js");
      const reopened = new SqliteVectorStore(fixture.databasePath);
      try {
        await expect(reopened.listChunks("kec")).resolves.toEqual([]);
        await expect(reopened.getIndexMetadata("kec")).resolves.toBeNull();
        await expect(reopened.listChunks("company")).resolves.toEqual([
          expect.objectContaining({
            sourcePath: otherCollectionSource,
            text: "other collection sentinel",
          }),
        ]);
        await expect(reopened.getIndexMetadata("company")).resolves.toEqual(
          expect.objectContaining({
            embeddingModel: "other-collection-sentinel",
          }),
        );
      } finally {
        await reopened.close();
      }
    });
  });

  it("does not report INDEX_CHANGED for an unchanged Unicode snapshot with different SQLite and JavaScript orderings", async () => {
    if (!existsSync(pruneCliPath)) return;
    await withPruneFixture(async (fixture) => {
      const active = "manuals/active.pdf";
      const privateUse = "manuals/\uE000.pdf";
      const emoji = "manuals/😀.pdf";
      fixture.writeProjectFile(active);
      const store = await createIndexedStore(fixture.databasePath, [
        active,
        privateUse,
        emoji,
      ]);
      await store.close();

      const expectedSources = [privateUse, emoji]
        .map((sourcePath) => ({
          sourceId: expectedPruneSourceId(sourcePath),
          status: "DELETED" as const,
        }))
        .sort((left, right) =>
          left.sourceId < right.sourceId
            ? -1
            : left.sourceId > right.sourceId
              ? 1
              : 0,
        );
      const result = runCli(fixture.projectRoot, fixture.databasePath);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual({
        schemaVersion: 1,
        status: "SUCCEEDED",
        desiredSourceCount: 1,
        indexedSourceCount: 3,
        deletedSourceCount: 2,
        sources: expectedSources,
      });

      const { SqliteVectorStore } =
        await import("../src/knowledge/sqliteVectorStore.js");
      const reopened = new SqliteVectorStore(fixture.databasePath);
      try {
        await expect(reopened.listChunks("kec")).resolves.toEqual([
          expect.objectContaining({ sourcePath: active }),
        ]);
      } finally {
        await reopened.close();
      }
    });
  });
});
