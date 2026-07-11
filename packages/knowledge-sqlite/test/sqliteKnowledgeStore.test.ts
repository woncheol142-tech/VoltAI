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

describe("SqliteKnowledgeStore generic persistence", () => {
  afterEach(cleanupTempDatabases);

  for (const [name, locator] of [
    ["PageLocator", { kind: "page", page: 3 }],
    ["SectionLocator", { kind: "section", section: "Grounding", page: 3 }],
    ["TableLocator", { kind: "table", table: "Load Schedule", rowIndex: 12 }],
    ["ParagraphLocator", { kind: "paragraph", paragraphIndex: 4, page: 3 }],
  ] as const) {
    it(`round-trips a ${name} chunk`, async () => {
      const { dbPath } = createTempDatabase();
      const store = await createStore(dbPath);
      const chunk = createChunk(locator);

      try {
        await store.upsert("company", [chunk], testCodecs);

        await expect(store.listChunks("company", testCodecs)).resolves.toEqual([
          {
            chunkId: chunk.chunkId,
            documentId: chunk.documentId,
            sourcePath: chunk.sourcePath,
            chunkIndex: chunk.chunkIndex,
            locator: chunk.locator,
            metadata: chunk.metadata,
            text: chunk.text,
          },
        ]);
      } finally {
        await store.close();
      }
    });
  }

  it("leaves legacy page and clause null for generic non-KEC rows", async () => {
    const { dbPath } = createTempDatabase();
    const store = await createStore(dbPath);

    await store.upsert(
      "company",
      [createChunk({ kind: "section", section: "Grounding" })],
      testCodecs,
    );
    await store.close();

    const database = new DatabaseSync(dbPath);
    const row = database.prepare("SELECT page, clause FROM kec_chunks").get() as {
      page: number | null;
      clause: string | null;
    };
    database.close();

    expect(row).toEqual({ page: null, clause: null });
  });

  it("returns the actual SQLite row id as KnowledgeSearchResult.chunkId", async () => {
    const { dbPath } = createTempDatabase();
    const store = await createStore(dbPath);
    const chunk = createChunk(
      { kind: "page", page: 1 },
      { chunkId: "actual-db-chunk-id" },
    );

    try {
      await store.upsert("company", [chunk], testCodecs);
      const [result] = await store.search("company", [1, 0], 5, testCodecs);

      expect(result.chunkId).toBe("actual-db-chunk-id");
      expect(result.chunkId).not.toMatch(/^kec:.*:[0-9a-f]{8}$/);
    } finally {
      await store.close();
    }
  });

  it("isolates chunks by collection", async () => {
    const { dbPath } = createTempDatabase();
    const store = await createStore(dbPath);
    const company = createChunk({ kind: "page", page: 1 }, { text: "Company standard" });
    const materials = createChunk(
      { kind: "table", table: "Catalog", rowIndex: 2 },
      { text: "Material catalog" },
    );

    try {
      await store.upsert("company", [company], testCodecs);
      await store.upsert("materials", [materials], testCodecs);

      await expect(store.listChunks("company", testCodecs)).resolves.toEqual([
        expect.objectContaining({ text: "Company standard" }),
      ]);
      await expect(store.listChunks("materials", testCodecs)).resolves.toEqual([
        expect.objectContaining({ text: "Material catalog" }),
      ]);
    } finally {
      await store.close();
    }
  });

  it("deletes only the requested sourcePath", async () => {
    const { dbPath } = createTempDatabase();
    const store = await createStore(dbPath);
    const first = createChunk({ kind: "page", page: 1 });
    const second = createChunk(
      { kind: "page", page: 2 },
      {
        chunkId: "company:standards/other.pdf#chunk=0",
        documentId: "company:standards/other.pdf",
        sourcePath: "standards/other.pdf",
      },
    );

    try {
      await store.upsert("company", [first, second], testCodecs);
      await store.deleteBySourcePath("company", first.sourcePath);

      await expect(store.listChunks("company", testCodecs)).resolves.toEqual([
        expect.objectContaining({ sourcePath: second.sourcePath }),
      ]);
    } finally {
      await store.close();
    }
  });

  it("uses metadata and locator codecs on both write and read", async () => {
    const { dbPath } = createTempDatabase();
    const store = await createStore(dbPath);
    let metadataEncodeCalls = 0;
    let metadataDecodeCalls = 0;
    let locatorEncodeCalls = 0;
    let locatorDecodeCalls = 0;
    const codecs = {
      metadata: {
        encode: (value: Parameters<typeof testCodecs.metadata.encode>[0]) => {
          metadataEncodeCalls += 1;
          return testCodecs.metadata.encode(value);
        },
        decode: (value: unknown) => {
          metadataDecodeCalls += 1;
          return testCodecs.metadata.decode(value);
        },
      },
      locator: {
        encode: (value: Parameters<typeof testCodecs.locator.encode>[0]) => {
          locatorEncodeCalls += 1;
          return testCodecs.locator.encode(value);
        },
        decode: (value: unknown) => {
          locatorDecodeCalls += 1;
          return testCodecs.locator.decode(value);
        },
      },
    };

    try {
      await store.upsert("company", [createChunk({ kind: "page", page: 1 })], codecs);
      await store.listChunks("company", codecs);

      expect(metadataEncodeCalls).toBe(1);
      expect(locatorEncodeCalls).toBe(1);
      expect(metadataDecodeCalls).toBe(1);
      expect(locatorDecodeCalls).toBe(1);
    } finally {
      await store.close();
    }
  });

  it("does not mutate generic chunk inputs", async () => {
    const { dbPath } = createTempDatabase();
    const store = await createStore(dbPath);
    const chunk = createChunk({ kind: "page", page: 1 });
    const snapshot = structuredClone(chunk);

    try {
      await store.upsert("company", [chunk], testCodecs);

      expect(chunk).toEqual(snapshot);
    } finally {
      await store.close();
    }
  });

  it("rolls back generic replaceSource when index metadata saving fails", async () => {
    const { dbPath } = createTempDatabase();
    const store = await createStore(dbPath);
    const original = createChunk({ kind: "page", page: 1 });
    const replacement = createChunk(
      { kind: "page", page: 2 },
      { chunkId: "replacement", text: "Replacement" },
    );

    try {
      await store.upsert("company", [original], testCodecs);
      await expect(
        store.replaceSource(
          "company",
          original.sourcePath,
          [replacement],
          { ...testIndexMetadata, dimensions: -1 },
          testCodecs,
        ),
      ).rejects.toThrow();
      await expect(store.listChunks("company", testCodecs)).resolves.toEqual([
        expect.objectContaining({ chunkId: original.chunkId, text: original.text }),
      ]);
      await expect(store.getIndexMetadata("company")).resolves.toBeNull();
    } finally {
      await store.close();
    }
  });

  it("exposes an idempotent close lifecycle", async () => {
    const { dbPath } = createTempDatabase();
    const store = await createStore(dbPath);

    await expect(store.close()).resolves.toBeUndefined();
    await expect(store.close()).resolves.toBeUndefined();
  });
});
