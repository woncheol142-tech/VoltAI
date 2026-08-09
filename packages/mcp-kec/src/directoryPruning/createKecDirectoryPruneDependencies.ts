import { createRequire } from "node:module";
import { lstatSync } from "node:fs";

import type { DatabaseSync as SqliteDatabase } from "node:sqlite";

import { executeKecDirectoryPrune } from "./executeKecDirectoryPrune.js";
import type {
  KecDirectoryPrunePlan,
  KecDirectoryPruneResult,
} from "./types.js";

const require = createRequire(import.meta.url);
type DatabaseConstructor = typeof import("node:sqlite").DatabaseSync;
let cachedDatabaseConstructor: DatabaseConstructor | undefined;

const DATABASE_UNAVAILABLE = "KEC_DIRECTORY_PRUNE: DATABASE_UNAVAILABLE";
const ENUMERATION_FAILED = "KEC_DIRECTORY_PRUNE: ENUMERATION_FAILED";

type DatabaseIdentity = Readonly<{ device: bigint; inode: bigint }>;

function databaseConstructor(): DatabaseConstructor {
  if (cachedDatabaseConstructor !== undefined) return cachedDatabaseConstructor;
  const originalEmitWarning = process.emitWarning;
  try {
    process.emitWarning = (() => undefined) as typeof process.emitWarning;
    cachedDatabaseConstructor = (
      require("node:sqlite") as typeof import("node:sqlite")
    ).DatabaseSync;
    return cachedDatabaseConstructor;
  } finally {
    process.emitWarning = originalEmitWarning;
  }
}

export type KecDirectoryPruneSourceStore = Readonly<{
  listSourcePaths: (collection: string) => Promise<readonly string[]>;
  pruneSourcePaths: (
    collection: string,
    expectedSourcePaths: readonly string[],
    staleSourcePaths: readonly string[],
  ) => Promise<void>;
  close: () => Promise<void>;
}>;

function failure(message: string): Error {
  return new Error(message);
}

function readRegularFileIdentity(databasePath: string): DatabaseIdentity {
  try {
    const stats = lstatSync(databasePath, { bigint: true });
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw failure(DATABASE_UNAVAILABLE);
    }
    return Object.freeze({ device: stats.dev, inode: stats.ino });
  } catch {
    throw failure(DATABASE_UNAVAILABLE);
  }
}

function sameIdentity(
  expected: DatabaseIdentity,
  actual: DatabaseIdentity,
): boolean {
  return expected.device === actual.device && expected.inode === actual.inode;
}

function asciiOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalSourcePaths(sourcePaths: readonly string[]): string[] {
  const unique = new Set(sourcePaths);
  if (unique.size !== sourcePaths.length) {
    throw new Error("KEC source snapshot contains duplicate paths");
  }
  return [...unique].sort(asciiOrder);
}

function equalSourcePaths(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((sourcePath, index) => sourcePath === right[index])
  );
}

class SqliteKecSourceStore implements KecDirectoryPruneSourceStore {
  private readonly database: SqliteDatabase;
  private closed = false;

  constructor(databasePath: string) {
    const Database = databaseConstructor();
    this.database = new Database(databasePath, {
      allowExtension: false,
      timeout: 0,
    });
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("KEC source store is closed");
  }

  async listSourcePaths(collection: string): Promise<readonly string[]> {
    this.assertOpen();
    const rows = this.database
      .prepare(
        `SELECT DISTINCT source_path
         FROM kec_chunks
         WHERE collection = ?
         ORDER BY source_path`,
      )
      .all(collection) as Array<{ source_path: string }>;
    return Object.freeze(rows.map((row) => row.source_path));
  }

  async pruneSourcePaths(
    collection: string,
    expectedSourcePaths: readonly string[],
    staleSourcePaths: readonly string[],
  ): Promise<void> {
    this.assertOpen();
    const expected = canonicalSourcePaths(expectedSourcePaths);
    const stale = canonicalSourcePaths(staleSourcePaths);
    const expectedSet = new Set(expected);
    if (stale.some((sourcePath) => !expectedSet.has(sourcePath))) {
      throw new Error("KEC prune source is outside the expected snapshot");
    }

    this.database.exec("BEGIN IMMEDIATE");
    try {
      const actualRows = this.database
        .prepare(
          `SELECT DISTINCT source_path
           FROM kec_chunks
           WHERE collection = ?
           ORDER BY source_path`,
        )
        .all(collection) as Array<{ source_path: string }>;
      const actual = canonicalSourcePaths(
        actualRows.map((row) => row.source_path),
      );
      if (!equalSourcePaths(expected, actual)) {
        throw new Error("KEC_DIRECTORY_PRUNE: INDEX_CHANGED");
      }

      const removeSource = this.database.prepare(
        "DELETE FROM kec_chunks WHERE collection = ? AND source_path = ?",
      );
      for (const sourcePath of staleSourcePaths) {
        removeSource.run(collection, sourcePath);
      }

      const remaining = this.database
        .prepare(
          "SELECT 1 AS present FROM kec_chunks WHERE collection = ? LIMIT 1",
        )
        .get(collection) as { present: number } | undefined;
      if (remaining === undefined) {
        this.database
          .prepare("DELETE FROM index_metadata WHERE id = ?")
          .run(collection);
      }
      this.database.exec("COMMIT");
    } catch (error) {
      try {
        this.database.exec("ROLLBACK");
      } catch {
        // Preserve the operation failure if SQLite already ended the transaction.
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.database.close();
    this.closed = true;
  }
}

function tableColumns(
  database: SqliteDatabase,
  table: string,
): readonly string[] {
  const rows = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  return rows.map((row) => row.name);
}

function hasRequiredSchema(database: SqliteDatabase): boolean {
  const version = database.prepare("PRAGMA user_version").get() as
    { user_version: number } | undefined;
  const chunkColumns = tableColumns(database, "kec_chunks");
  const metadataColumns = tableColumns(database, "index_metadata");
  return (
    version?.user_version === 1 &&
    ["collection", "id", "source_path"].every((column) =>
      chunkColumns.includes(column),
    ) &&
    [
      "id",
      "embedding_provider",
      "embedding_model",
      "dimensions",
      "indexed_at",
    ].every((column) => metadataColumns.includes(column))
  );
}

function validateUsableDatabase(databasePath: string): DatabaseIdentity {
  const identity = readRegularFileIdentity(databasePath);
  let database: SqliteDatabase | undefined;
  let validationFailed = false;
  try {
    const Database = databaseConstructor();
    database = new Database(databasePath, {
      readOnly: true,
      allowExtension: false,
      timeout: 0,
    });
    if (!hasRequiredSchema(database)) throw failure(DATABASE_UNAVAILABLE);
  } catch {
    validationFailed = true;
  }

  let closeFailed = false;
  if (database !== undefined) {
    try {
      database.close();
    } catch {
      closeFailed = true;
    }
  }
  if (validationFailed || closeFailed) throw failure(DATABASE_UNAVAILABLE);

  const finalIdentity = readRegularFileIdentity(databasePath);
  if (!sameIdentity(identity, finalIdentity)) {
    throw failure(DATABASE_UNAVAILABLE);
  }
  return identity;
}

export function createKecDirectoryPruneDependencies(): Readonly<{
  assertDatabaseAvailable: (databasePath: string) => void;
  createStore: (databasePath: string) => Promise<KecDirectoryPruneSourceStore>;
  enumerateSources: (
    store: KecDirectoryPruneSourceStore,
    collection: "kec",
  ) => Promise<readonly string[]>;
  execute: (
    plan: KecDirectoryPrunePlan,
    store: KecDirectoryPruneSourceStore,
  ) => Promise<KecDirectoryPruneResult>;
  closeStore: (store: KecDirectoryPruneSourceStore) => Promise<void>;
}> {
  let approvedPath: string | undefined;
  let approvedIdentity: DatabaseIdentity | undefined;

  return Object.freeze({
    assertDatabaseAvailable: (databasePath: string) => {
      approvedIdentity = validateUsableDatabase(databasePath);
      approvedPath = databasePath;
    },
    createStore: async (databasePath: string) => {
      if (
        approvedPath !== databasePath ||
        approvedIdentity === undefined ||
        !sameIdentity(approvedIdentity, readRegularFileIdentity(databasePath))
      ) {
        throw failure(DATABASE_UNAVAILABLE);
      }
      let store: SqliteKecSourceStore;
      try {
        store = new SqliteKecSourceStore(databasePath);
      } catch {
        throw failure(DATABASE_UNAVAILABLE);
      }
      try {
        if (
          !sameIdentity(approvedIdentity, readRegularFileIdentity(databasePath))
        ) {
          throw failure(DATABASE_UNAVAILABLE);
        }
        return store;
      } catch (error) {
        await store.close();
        throw error;
      }
    },
    enumerateSources: async (store, collection) => {
      try {
        return await store.listSourcePaths(collection);
      } catch {
        throw failure(ENUMERATION_FAILED);
      }
    },
    execute: (plan, store) =>
      executeKecDirectoryPrune(plan, {
        pruneSources: (expectedSourcePaths, staleSourcePaths) =>
          store.pruneSourcePaths("kec", expectedSourcePaths, staleSourcePaths),
      }),
    closeStore: (store) => store.close(),
  });
}
