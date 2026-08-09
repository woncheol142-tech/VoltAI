import { afterEach, describe, expect, it } from "vitest";

import {
  cleanupTempDatabases,
  createChunk,
  createTempDatabase,
  DatabaseSync,
  testCodecs,
  testIndexMetadata,
} from "./helpers/knowledgeFixtures.js";

type NarrowSourceStore = Readonly<{
  listSourcePaths: (collection: string) => Promise<readonly string[]>;
  pruneSourcePaths: (
    collection: string,
    expectedSourcePaths: readonly string[],
    staleSourcePaths: readonly string[],
  ) => Promise<void>;
}>;

type ClosableSourceStore = NarrowSourceStore &
  Readonly<{ close?: () => void | Promise<void> }>;

const auxiliarySourceStores: ClosableSourceStore[] = [];

async function createStore(dbPath: string) {
  const { SqliteKnowledgeStore } = await import("../src/index.js");
  return new SqliteKnowledgeStore(dbPath);
}

function narrowSourceContract(store: object): NarrowSourceStore | null {
  const candidate = store as Partial<NarrowSourceStore>;
  return typeof candidate.listSourcePaths === "function" &&
    typeof candidate.pruneSourcePaths === "function"
    ? (candidate as NarrowSourceStore)
    : null;
}

async function sourceContract(
  store: object,
  dbPath: string,
): Promise<NarrowSourceStore | null> {
  const existingStoreContract = narrowSourceContract(store);
  if (existingStoreContract !== null) return existingStoreContract;

  const module = (await import("../src/index.js")) as unknown as Readonly<{
    SqliteKnowledgeSourceStore?: new (path: string) => object;
    createSqliteKnowledgeSourceStore?: (path: string) => object;
  }>;
  const candidate =
    typeof module.createSqliteKnowledgeSourceStore === "function"
      ? module.createSqliteKnowledgeSourceStore(dbPath)
      : module.SqliteKnowledgeSourceStore !== undefined
        ? new module.SqliteKnowledgeSourceStore(dbPath)
        : null;
  if (candidate === null) return null;

  const contract = narrowSourceContract(candidate);
  if (contract === null) {
    await (candidate as Partial<ClosableSourceStore>).close?.();
    return null;
  }
  auxiliarySourceStores.push(candidate as ClosableSourceStore);
  return contract;
}

function chunk(collection: string, sourcePath: string, index = 0) {
  return createChunk(
    { kind: "page", page: index + 1 },
    {
      chunkId: `${collection}:${sourcePath}#chunk=${index}`,
      documentId: `${collection}:${sourcePath}`,
      sourcePath,
      chunkIndex: index,
      text: `${collection} ${sourcePath} ${index}`,
    },
  );
}

async function seed(
  store: Awaited<ReturnType<typeof createStore>>,
  collection: string,
  sourcePaths: readonly string[],
): Promise<void> {
  await store.upsert(
    collection,
    sourcePaths.map((sourcePath, index) =>
      chunk(collection, sourcePath, index),
    ),
    testCodecs,
  );
}

async function rawSourcePaths(
  dbPath: string,
  collection: string,
): Promise<readonly string[]> {
  const database = new DatabaseSync(dbPath);
  try {
    const rows = database
      .prepare(
        "SELECT DISTINCT source_path FROM kec_chunks WHERE collection = ? ORDER BY source_path",
      )
      .all(collection) as Array<{ source_path: string }>;
    return rows.map((row) => row.source_path);
  } finally {
    database.close();
  }
}

async function rawChunkCount(
  dbPath: string,
  collection: string,
  sourcePath: string,
): Promise<number> {
  const database = new DatabaseSync(dbPath);
  try {
    const row = database
      .prepare(
        "SELECT COUNT(*) AS count FROM kec_chunks WHERE collection = ? AND source_path = ?",
      )
      .get(collection, sourcePath) as { count: number };
    return row.count;
  } finally {
    database.close();
  }
}

function installTrigger(dbPath: string, sql: string): void {
  const database = new DatabaseSync(dbPath);
  try {
    database.exec(sql);
  } finally {
    database.close();
  }
}

async function metadataExists(
  dbPath: string,
  collection: string,
): Promise<boolean> {
  const database = new DatabaseSync(dbPath);
  try {
    return Boolean(
      database
        .prepare("SELECT id FROM index_metadata WHERE id = ?")
        .get(collection),
    );
  } finally {
    database.close();
  }
}

describe("Task 60 narrow SQLite source lifecycle contract", () => {
  afterEach(async () => {
    for (const store of auxiliarySourceStores.splice(0)) await store.close?.();
    cleanupTempDatabases();
  });

  it("is RED until a narrow enumeration and atomic prune contract exists", async () => {
    const { dbPath } = createTempDatabase("voltai-task60-store-");
    const store = await createStore(dbPath);
    try {
      expect(
        await sourceContract(store, dbPath),
        "SQLite package lacks listSourcePaths/pruneSourcePaths Task 60 behavior",
      ).not.toBeNull();
    } finally {
      await store.close();
    }
  });

  it("enumerates a complete unique deterministic source snapshot by collection", async () => {
    const { dbPath } = createTempDatabase("voltai-task60-store-");
    const store = await createStore(dbPath);
    const contract = await sourceContract(store, dbPath);
    if (contract === null) {
      await store.close();
      return;
    }
    try {
      await store.upsert(
        "kec",
        [
          chunk("kec", "manuals/zeta.pdf", 0),
          chunk("kec", "manuals/zeta.pdf", 1),
          chunk("kec", "manuals/zeta.pdf", 2),
          chunk("kec", "manuals/alpha.pdf", 0),
        ],
        testCodecs,
      );
      await seed(store, "company", [
        "../malformed-company.pdf",
        "manuals/company.pdf",
      ]);
      const snapshot = await contract.listSourcePaths("kec");
      expect(snapshot).toEqual(["manuals/alpha.pdf", "manuals/zeta.pdf"]);
      expect(snapshot).toHaveLength(2);
      await expect(contract.listSourcePaths("company")).resolves.toEqual([
        "../malformed-company.pdf",
        "manuals/company.pdf",
      ]);
      await expect(
        rawChunkCount(dbPath, "kec", "manuals/zeta.pdf"),
      ).resolves.toBe(3);
    } finally {
      await store.close();
    }
  });

  it("deletes all chunks for one deduplicated stale source in one atomic source operation", async () => {
    const { dbPath } = createTempDatabase("voltai-task60-store-");
    const store = await createStore(dbPath);
    const contract = await sourceContract(store, dbPath);
    if (contract === null) {
      await store.close();
      expect(
        contract,
        "missing Task 60 multi-chunk deduplicated source deletion",
      ).not.toBeNull();
      return;
    }
    try {
      const active = "kec/current/a.pdf";
      const stale = "kec/current/stale.pdf";
      const nested = "kec/current/nested/child.pdf";
      const archive = "kec/archive/archive.pdf";
      const prefix = "kec/currentity/prefix.pdf";
      const otherCollection = "kec/current/company.pdf";
      await store.upsert(
        "kec",
        [
          chunk("kec", active, 0),
          chunk("kec", stale, 0),
          chunk("kec", stale, 1),
          chunk("kec", stale, 2),
          chunk("kec", nested, 0),
          chunk("kec", archive, 0),
          chunk("kec", prefix, 0),
        ],
        testCodecs,
      );
      await seed(store, "company", [otherCollection]);
      await store.saveIndexMetadata("kec", testIndexMetadata);

      const snapshot = await contract.listSourcePaths("kec");
      expect(snapshot).toEqual([archive, active, nested, stale, prefix]);
      await contract.pruneSourcePaths("kec", snapshot, [stale]);

      await expect(rawChunkCount(dbPath, "kec", stale)).resolves.toBe(0);
      await expect(rawChunkCount(dbPath, "kec", active)).resolves.toBe(1);
      await expect(rawSourcePaths(dbPath, "kec")).resolves.toEqual([
        archive,
        active,
        nested,
        prefix,
      ]);
      await expect(rawSourcePaths(dbPath, "company")).resolves.toEqual([
        otherCollection,
      ]);
      await expect(metadataExists(dbPath, "kec")).resolves.toBe(true);
    } finally {
      await store.close();
    }
  });

  it("atomically deletes multiple stale KEC sources while retaining active and other collections", async () => {
    const { dbPath } = createTempDatabase("voltai-task60-store-");
    const store = await createStore(dbPath);
    const contract = await sourceContract(store, dbPath);
    if (contract === null) {
      await store.close();
      return;
    }
    try {
      const expected = [
        "manuals/active.pdf",
        "manuals/old-a.pdf",
        "manuals/old-b.pdf",
      ];
      await seed(store, "kec", expected);
      await seed(store, "company", ["manuals/old-a.pdf"]);
      await store.saveIndexMetadata("kec", testIndexMetadata);
      await contract.pruneSourcePaths("kec", expected, [
        expected[1],
        expected[2],
      ]);

      await expect(rawSourcePaths(dbPath, "kec")).resolves.toEqual([
        "manuals/active.pdf",
      ]);
      await expect(rawSourcePaths(dbPath, "company")).resolves.toEqual([
        "manuals/old-a.pdf",
      ]);
      await expect(metadataExists(dbPath, "kec")).resolves.toBe(true);
      await expect(store.listChunks("kec", testCodecs)).resolves.toEqual([
        expect.objectContaining({ sourcePath: "manuals/active.pdf" }),
      ]);
      await expect(store.search("kec", [1, 0], 5, testCodecs)).resolves.toEqual(
        [expect.objectContaining({ sourcePath: "manuals/active.pdf" })],
      );
    } finally {
      await store.close();
    }
  });

  it("treats an unchanged Unicode source snapshot as equal across SQLite and JavaScript orderings", async () => {
    const { dbPath } = createTempDatabase("voltai-task60-store-");
    const store = await createStore(dbPath);
    const contract = await sourceContract(store, dbPath);
    if (contract === null) {
      await store.close();
      return;
    }
    try {
      const active = "manuals/active.pdf";
      const privateUse = "manuals/\uE000.pdf";
      const emoji = "manuals/😀.pdf";
      await seed(store, "kec", [active, privateUse, emoji]);
      await store.saveIndexMetadata("kec", testIndexMetadata);

      const snapshot = await contract.listSourcePaths("kec");
      expect(snapshot).toEqual([active, privateUse, emoji]);
      await expect(
        contract.pruneSourcePaths("kec", snapshot, [privateUse]),
      ).resolves.toBeUndefined();

      await expect(rawSourcePaths(dbPath, "kec")).resolves.toEqual([
        active,
        emoji,
      ]);
      await expect(metadataExists(dbPath, "kec")).resolves.toBe(true);
    } finally {
      await store.close();
    }
  });

  it("rejects a changed complete snapshot and deletes nothing", async () => {
    const { dbPath } = createTempDatabase("voltai-task60-store-");
    const store = await createStore(dbPath);
    const contract = await sourceContract(store, dbPath);
    if (contract === null) {
      await store.close();
      return;
    }
    try {
      const expected = ["manuals/active.pdf", "manuals/stale.pdf"];
      await seed(store, "kec", expected);
      await seed(store, "kec", ["other/concurrent.pdf"]);
      await expect(
        contract.pruneSourcePaths("kec", expected, ["manuals/stale.pdf"]),
      ).rejects.toBeDefined();
      await expect(rawSourcePaths(dbPath, "kec")).resolves.toEqual([
        "manuals/active.pdf",
        "manuals/stale.pdf",
        "other/concurrent.pdf",
      ]);
    } finally {
      await store.close();
    }
  });

  it("rolls back when the first ordered source deletion fails", async () => {
    const { dbPath } = createTempDatabase("voltai-task60-store-");
    const store = await createStore(dbPath);
    const contract = await sourceContract(store, dbPath);
    if (contract === null) {
      await store.close();
      return;
    }
    try {
      const expected = ["manuals/first.pdf", "manuals/second.pdf"];
      await seed(store, "kec", expected);
      await store.saveIndexMetadata("kec", testIndexMetadata);
      installTrigger(
        dbPath,
        `CREATE TRIGGER task60_fail_first BEFORE DELETE ON kec_chunks
         WHEN OLD.collection = 'kec' AND OLD.source_path = 'manuals/first.pdf'
         BEGIN SELECT RAISE(ABORT, 'task60 first delete failure'); END`,
      );
      await expect(
        contract.pruneSourcePaths("kec", expected, expected),
      ).rejects.toBeDefined();
      await expect(rawSourcePaths(dbPath, "kec")).resolves.toEqual(expected);
      await expect(metadataExists(dbPath, "kec")).resolves.toBe(true);
    } finally {
      await store.close();
    }
  });

  it("rolls back an earlier deletion when a middle ordered deletion fails", async () => {
    const { dbPath } = createTempDatabase("voltai-task60-store-");
    const store = await createStore(dbPath);
    const contract = await sourceContract(store, dbPath);
    if (contract === null) {
      await store.close();
      return;
    }
    try {
      const expected = [
        "manuals/first.pdf",
        "manuals/middle.pdf",
        "manuals/last.pdf",
      ];
      await seed(store, "kec", expected);
      await store.saveIndexMetadata("kec", testIndexMetadata);
      installTrigger(
        dbPath,
        `CREATE TRIGGER task60_fail_middle BEFORE DELETE ON kec_chunks
         WHEN OLD.collection = 'kec' AND OLD.source_path = 'manuals/middle.pdf'
         BEGIN SELECT RAISE(ABORT, 'task60 middle delete failure'); END`,
      );
      await expect(
        contract.pruneSourcePaths("kec", expected, expected),
      ).rejects.toBeDefined();
      await expect(rawSourcePaths(dbPath, "kec")).resolves.toEqual([
        "manuals/first.pdf",
        "manuals/last.pdf",
        "manuals/middle.pdf",
      ]);
      await expect(metadataExists(dbPath, "kec")).resolves.toBe(true);
    } finally {
      await store.close();
    }
  });

  it("rolls back all source deletions when final metadata cleanup fails", async () => {
    const { dbPath } = createTempDatabase("voltai-task60-store-");
    const store = await createStore(dbPath);
    const contract = await sourceContract(store, dbPath);
    if (contract === null) {
      await store.close();
      return;
    }
    try {
      const expected = ["manuals/first.pdf", "manuals/second.pdf"];
      await seed(store, "kec", expected);
      await store.saveIndexMetadata("kec", testIndexMetadata);
      installTrigger(
        dbPath,
        `CREATE TRIGGER task60_fail_metadata BEFORE DELETE ON index_metadata
         WHEN OLD.id = 'kec'
         BEGIN SELECT RAISE(ABORT, 'task60 metadata cleanup failure'); END`,
      );
      await expect(
        contract.pruneSourcePaths("kec", expected, expected),
      ).rejects.toBeDefined();
      await expect(rawSourcePaths(dbPath, "kec")).resolves.toEqual(expected);
      await expect(metadataExists(dbPath, "kec")).resolves.toBe(true);
    } finally {
      await store.close();
    }
  });

  it("rolls back source deletion when SQLite cannot complete COMMIT", async () => {
    const { dbPath } = createTempDatabase("voltai-task60-store-");
    const store = await createStore(dbPath);
    const contract = await sourceContract(store, dbPath);
    if (contract === null) {
      await store.close();
      expect(
        contract,
        "missing Task 60 commit-failure rollback implementation",
      ).not.toBeNull();
      return;
    }
    const expected = ["manuals/active.pdf", "manuals/stale.pdf"];
    const reader = new DatabaseSync(dbPath);
    try {
      await seed(store, "kec", expected);
      await store.saveIndexMetadata("kec", testIndexMetadata);
      reader.exec("BEGIN");
      reader.prepare("SELECT id FROM kec_chunks ORDER BY id").all();

      await expect(
        contract.pruneSourcePaths("kec", expected, [expected[1]]),
      ).rejects.toBeDefined();
      reader.exec("ROLLBACK");

      await expect(rawSourcePaths(dbPath, "kec")).resolves.toEqual(expected);
      await expect(metadataExists(dbPath, "kec")).resolves.toBe(true);
    } finally {
      try {
        reader.exec("ROLLBACK");
      } catch {
        // The explicit rollback above already released the test-owned reader.
      }
      reader.close();
      await store.close();
    }
  });

  it("removes KEC metadata exactly when pruning leaves zero KEC chunks", async () => {
    const { dbPath } = createTempDatabase("voltai-task60-store-");
    const store = await createStore(dbPath);
    const contract = await sourceContract(store, dbPath);
    if (contract === null) {
      await store.close();
      return;
    }
    try {
      const expected = ["manuals/only.pdf"];
      await seed(store, "kec", expected);
      await store.saveIndexMetadata("kec", testIndexMetadata);
      await contract.pruneSourcePaths("kec", expected, expected);
      await expect(rawSourcePaths(dbPath, "kec")).resolves.toEqual([]);
      await expect(metadataExists(dbPath, "kec")).resolves.toBe(false);
    } finally {
      await store.close();
    }
  });
});
