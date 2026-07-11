import { afterEach, describe, expect, it } from "vitest";

import {
  cleanupTempDatabases,
  createChunk,
  createTempDatabase,
  DatabaseSync,
  testCodecs,
  testIndexMetadata,
} from "./helpers/knowledgeFixtures.js";

async function createStore(dbPath: string) {
  const { SqliteKnowledgeStore } = await import("../src/index.js");

  return new SqliteKnowledgeStore(dbPath);
}

async function captureError(operation: Promise<unknown>): Promise<Error & Record<string, unknown>> {
  try {
    await operation;
  } catch (error) {
    return error as Error & Record<string, unknown>;
  }

  throw new Error("Expected operation to fail");
}

describe("SqliteKnowledgeStore codec failure policy", () => {
  afterEach(cleanupTempDatabases);

  for (const [column, field] of [
    ["metadata_json", "metadata"],
    ["locator_json", "locator"],
  ] as const) {
    it(`fails fast for corrupted ${field} JSON without exposing raw data`, async () => {
      const { dbPath } = createTempDatabase();
      const store = await createStore(dbPath);
      const chunk = createChunk({ kind: "page", page: 1 });
      await store.upsert("company", [chunk], testCodecs);
      const secret = `TOP-SECRET-${field.toUpperCase()}`;
      const database = new DatabaseSync(dbPath);
      database.prepare(`UPDATE kec_chunks SET ${column} = ? WHERE id = ?`).run(`{${secret}`, chunk.chunkId);
      database.close();

      const error = await captureError(store.search("company", [1, 0], 5, testCodecs));
      await store.close();

      expect(error).toMatchObject({
        collection: "company",
        chunkId: chunk.chunkId,
        field,
      });
      expect(error.message).not.toContain(secret);
      expect(error.message).not.toContain("Company grounding standard.");
      expect(error.message).not.toContain("[1,0]");
    });
  }

  it("fails fast when metadata JSON is valid but its semantic codec rejects it", async () => {
    const { dbPath } = createTempDatabase();
    const store = await createStore(dbPath);
    const chunk = createChunk({ kind: "page", page: 1 });
    await store.upsert("company", [chunk], testCodecs);
    const database = new DatabaseSync(dbPath);
    database
      .prepare("UPDATE kec_chunks SET metadata_json = ? WHERE id = ?")
      .run('{"kind":42,"clause":null}', chunk.chunkId);
    database.close();

    const error = await captureError(store.search("company", [1, 0], 5, testCodecs));
    await store.close();

    expect(error).toMatchObject({ field: "metadata", chunkId: chunk.chunkId });
  });

  it("fails fast when locator JSON is valid but its semantic codec rejects it", async () => {
    const { dbPath } = createTempDatabase();
    const store = await createStore(dbPath);
    const chunk = createChunk({ kind: "page", page: 1 });
    await store.upsert("company", [chunk], testCodecs);
    const database = new DatabaseSync(dbPath);
    database
      .prepare("UPDATE kec_chunks SET locator_json = ? WHERE id = ?")
      .run('{"kind":"page","page":0}', chunk.chunkId);
    database.close();

    const error = await captureError(store.search("company", [1, 0], 5, testCodecs));
    await store.close();

    expect(error).toMatchObject({ field: "locator", chunkId: chunk.chunkId });
  });

  it("does not delete existing source data when encode fails before replaceSource", async () => {
    const { dbPath } = createTempDatabase();
    const store = await createStore(dbPath);
    const original = createChunk({ kind: "page", page: 1 });
    await store.upsert("company", [original], testCodecs);
    const rejectingCodecs = {
      ...testCodecs,
      metadata: {
        ...testCodecs.metadata,
        encode: () => {
          throw new Error("metadata encode rejected");
        },
      },
    };

    await expect(
      store.replaceSource(
        "company",
        original.sourcePath,
        [createChunk({ kind: "page", page: 2 }, { chunkId: "replacement" })],
        testIndexMetadata,
        rejectingCodecs,
      ),
    ).rejects.toThrow("metadata encode rejected");
    await expect(store.listChunks("company", testCodecs)).resolves.toEqual([
      expect.objectContaining({ chunkId: original.chunkId }),
    ]);
    await store.close();
  });
});
