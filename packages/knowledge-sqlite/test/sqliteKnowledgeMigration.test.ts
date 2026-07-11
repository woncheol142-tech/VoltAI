import { afterEach, describe, expect, it } from "vitest";

import {
  cleanupTempDatabases,
  createLegacyDatabase,
  createTempDatabase,
  DatabaseSync,
  testIndexMetadata,
  legacyKecCodecs,
} from "./helpers/knowledgeFixtures.js";

async function loadStore() {
  return import("../src/index.js");
}

describe("SqliteKnowledgeStore legacy migration", () => {
  afterEach(cleanupTempDatabases);

  it("proves ALTER TABLE and backfill can be rolled back in one SQLite transaction", () => {
    const database = new DatabaseSync(":memory:");
    database.exec("CREATE TABLE chunks (id TEXT PRIMARY KEY, value TEXT NOT NULL)");
    database.prepare("INSERT INTO chunks (id, value) VALUES (?, ?)").run("legacy", "before");

    database.exec("BEGIN IMMEDIATE");
    database.exec("ALTER TABLE chunks ADD COLUMN metadata_json TEXT");
    database.prepare("UPDATE chunks SET metadata_json = ?").run('{"kind":"test"}');
    database.exec("ROLLBACK");

    const columns = database.prepare("PRAGMA table_info(chunks)").all() as Array<{ name: string }>;
    const row = database.prepare("SELECT id, value FROM chunks").get();
    database.close();

    expect(columns.map((column) => column.name)).toEqual(["id", "value"]);
    expect(row).toEqual({ id: "legacy", value: "before" });
  });

  it("migrates a legacy KEC row and preserves all stored data and index metadata", async () => {
    const { dbPath } = createTempDatabase();
    createLegacyDatabase(dbPath);
    const { SqliteKnowledgeStore } = await loadStore();
    const store = new SqliteKnowledgeStore(dbPath);

    try {
      await expect(store.listChunks("kec", legacyKecCodecs)).resolves.toEqual([
        {
          chunkId: "legacy#page=3#chunk=2",
          documentId: "kec:knowledge/legacy.pdf",
          sourcePath: "knowledge/legacy.pdf",
          chunkIndex: 2,
          locator: { kind: "page", page: 3 },
          metadata: { clause: "KEC 232.5" },
          text: "Legacy cable requirement.",
        },
      ]);
      await expect(store.getIndexMetadata("kec")).resolves.toEqual(testIndexMetadata);
    } finally {
      await store.close();
    }

    const database = new DatabaseSync(dbPath);
    const row = database.prepare("SELECT * FROM kec_chunks").get() as Record<string, unknown>;
    database.close();

    expect(row.id).toBe("legacy#page=3#chunk=2");
    expect(row.chunk_index).toBe(2);
    expect(row.text).toBe("Legacy cable requirement.");
    expect(row.embedding).toBe("[1,0]");
    expect(JSON.parse(String(row.locator_json))).toEqual({ kind: "page", page: 3 });
    expect(JSON.parse(String(row.metadata_json))).toEqual({ clause: "KEC 232.5" });
  });

  it("makes legacy page nullable while preserving clause nullability", async () => {
    const { dbPath } = createTempDatabase();
    createLegacyDatabase(dbPath);
    const { SqliteKnowledgeStore } = await loadStore();
    const store = new SqliteKnowledgeStore(dbPath);
    await store.close();

    const database = new DatabaseSync(dbPath);
    const columns = database.prepare("PRAGMA table_info(kec_chunks)").all() as Array<{
      name: string;
      notnull: number;
    }>;
    database.close();

    expect(columns.find((column) => column.name === "page")?.notnull).toBe(0);
    expect(columns.find((column) => column.name === "clause")?.notnull).toBe(0);
  });

  it("is idempotent when migration runs more than once", async () => {
    const { dbPath } = createTempDatabase();
    createLegacyDatabase(dbPath);
    const { SqliteKnowledgeStore } = await loadStore();
    const first = new SqliteKnowledgeStore(dbPath);
    await first.close();

    const before = new DatabaseSync(dbPath);
    const beforeRows = before.prepare("SELECT * FROM kec_chunks").all();
    const beforeVersion = before.prepare("PRAGMA user_version").get();
    before.close();

    const second = new SqliteKnowledgeStore(dbPath);
    await second.close();

    const after = new DatabaseSync(dbPath);
    const afterRows = after.prepare("SELECT * FROM kec_chunks").all();
    const afterVersion = after.prepare("PRAGMA user_version").get();
    after.close();

    expect(afterRows).toEqual(beforeRows);
    expect(afterVersion).toEqual(beforeVersion);
  });

  it("preserves existing non-null generic fields during a compatibility rebuild", async () => {
    const { dbPath } = createTempDatabase();
    createLegacyDatabase(dbPath);
    const before = new DatabaseSync(dbPath);
    const locatorJson = JSON.stringify({ kind: "section", section: "Existing Section" });
    const metadataJson = JSON.stringify({ clause: "COMPANY 10", revision: "A" });
    before.exec(`
      ALTER TABLE kec_chunks ADD COLUMN document_id TEXT;
      ALTER TABLE kec_chunks ADD COLUMN locator_json TEXT;
      ALTER TABLE kec_chunks ADD COLUMN metadata_json TEXT;
    `);
    before
      .prepare(`
        UPDATE kec_chunks
        SET document_id = ?, locator_json = ?, metadata_json = ?
      `)
      .run("custom:existing-document", locatorJson, metadataJson);
    before.close();
    const { SqliteKnowledgeStore } = await loadStore();
    const store = new SqliteKnowledgeStore(dbPath);
    await store.close();

    const after = new DatabaseSync(dbPath);
    const row = after
      .prepare("SELECT document_id, locator_json, metadata_json FROM kec_chunks")
      .get();
    after.close();

    expect(row).toEqual({
      document_id: "custom:existing-document",
      locator_json: locatorJson,
      metadata_json: metadataJson,
    });
  });

  it("rolls back schema and data when migration rejects an invalid legacy page", async () => {
    const { dbPath } = createTempDatabase();
    createLegacyDatabase(dbPath, { page: -1 });
    const before = new DatabaseSync(dbPath);
    const beforeSchema = before
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'kec_chunks'")
      .get();
    const beforeRow = before.prepare("SELECT * FROM kec_chunks").get();
    before.close();
    const { SqliteKnowledgeStore } = await loadStore();

    expect(() => new SqliteKnowledgeStore(dbPath)).toThrow();

    const after = new DatabaseSync(dbPath);
    const afterSchema = after
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'kec_chunks'")
      .get();
    const afterRow = after.prepare("SELECT * FROM kec_chunks").get();
    const columns = after.prepare("PRAGMA table_info(kec_chunks)").all() as Array<{ name: string }>;
    after.close();

    expect(afterSchema).toEqual(beforeSchema);
    expect(afterRow).toEqual(beforeRow);
    expect(columns.map((column) => column.name)).not.toContain("metadata_json");
  });

  it("rejects a future schema version without modifying the database", async () => {
    const { dbPath } = createTempDatabase();
    createLegacyDatabase(dbPath, { userVersion: 999 });
    const { SqliteKnowledgeStore } = await loadStore();

    expect(() => new SqliteKnowledgeStore(dbPath)).toThrow(/version/i);

    const database = new DatabaseSync(dbPath);
    const version = database.prepare("PRAGMA user_version").get();
    const columns = database.prepare("PRAGMA table_info(kec_chunks)").all() as Array<{
      name: string;
    }>;
    database.close();

    expect(version).toEqual({ user_version: 999 });
    expect(columns.map((column) => column.name)).not.toContain("metadata_json");
  });
});
