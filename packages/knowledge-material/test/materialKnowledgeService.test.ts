import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cleanupTempStores,
  createTempStore,
  DeterministicMaterialEmbeddingProvider,
  legacyCollectionCodecs,
  loadMaterialDomain,
  materialInput,
  materialSheet,
  seedLegacyCollection,
} from "./helpers/materialFixtures.js";

describe("Material knowledge indexing and search", () => {
  afterEach(cleanupTempStores);

  it("uses only the materials collection after every row embedding succeeds", async () => {
    const { indexMaterialKnowledge } = await loadMaterialDomain();
    const events: string[] = [];
    const replaceSource = vi.fn(async (...args: unknown[]) => {
      events.push("replace");
      expect(args[0]).toBe("materials");
      expect(events.filter((event) => event === "embedded")).toHaveLength(2);
    });
    const embeddingProvider = {
      getMetadata: () => ({ provider: "test", model: "ordered" }),
      embed: vi.fn(async () => {
        events.push("embedded");
        return [1, 0];
      }),
    };

    const result = await indexMaterialKnowledge(materialInput(), {
      readMaterialSheet: vi.fn(async () => materialSheet()),
      embeddingProvider,
      vectorStore: { replaceSource },
    });

    expect(result).toMatchObject({
      sourcePath: "catalogs/electrical-materials.xlsx",
      catalogId: "CAT-ELEC-001",
      sheetName: "Catalog",
      indexedRows: 2,
    });
    expect(replaceSource).toHaveBeenCalledOnce();
  });

  it("does not replace a source when row mapping or embedding fails", async () => {
    const { indexMaterialKnowledge } = await loadMaterialDomain();
    const replaceSource = vi.fn();
    const invalidSheet = materialSheet();
    invalidSheet.rows[1].values[1] = null;

    await expect(
      indexMaterialKnowledge(materialInput(), {
        readMaterialSheet: vi.fn(async () => invalidSheet),
        embeddingProvider: new DeterministicMaterialEmbeddingProvider(),
        vectorStore: { replaceSource },
      }),
    ).rejects.toThrow();
    expect(replaceSource).not.toHaveBeenCalled();

    await expect(
      indexMaterialKnowledge(materialInput(), {
        readMaterialSheet: vi.fn(async () => materialSheet()),
        embeddingProvider: {
          getMetadata: () => ({ provider: "test", model: "failing" }),
          embed: vi.fn(async () => {
            throw new Error("deterministic embedding failure");
          }),
        },
        vectorStore: { replaceSource },
      }),
    ).rejects.toThrow("deterministic embedding failure");
    expect(replaceSource).not.toHaveBeenCalled();
  });

  it("re-indexes one catalog source without retaining stale rows", async () => {
    const { indexMaterialKnowledge, materialKnowledgeCodecs } =
      await loadMaterialDomain();
    const { store } = createTempStore();
    const embeddingProvider = new DeterministicMaterialEmbeddingProvider();
    let sheet = materialSheet();

    try {
      await indexMaterialKnowledge(materialInput(), {
        readMaterialSheet: vi.fn(async () => sheet),
        embeddingProvider,
        vectorStore: store,
      });
      sheet = materialSheet();
      sheet.rows = sheet.rows.slice(0, 2);
      sheet.rows[1].values[1] = "Updated XLPE Cable";
      await indexMaterialKnowledge(materialInput(), {
        readMaterialSheet: vi.fn(async () => sheet),
        embeddingProvider,
        vectorStore: store,
      });

      await expect(
        store.listChunks("materials", materialKnowledgeCodecs),
      ).resolves.toEqual([
        expect.objectContaining({
          chunkId:
            "materials:catalogs/electrical-materials.xlsx#sheet=Catalog#row=2",
          text: expect.stringContaining("Updated XLPE Cable"),
        }),
      ]);
    } finally {
      await store.close();
    }
  });

  it("returns real SQLite ids and a curated MaterialSearchResult", async () => {
    const { indexMaterialKnowledge, searchMaterialKnowledge } =
      await loadMaterialDomain();
    const { store } = createTempStore();
    const embeddingProvider = new DeterministicMaterialEmbeddingProvider();

    try {
      await indexMaterialKnowledge(materialInput(), {
        readMaterialSheet: vi.fn(async () => materialSheet()),
        embeddingProvider,
        vectorStore: store,
      });
      const [result] = await searchMaterialKnowledge(
        { query: "cable", topK: 1 },
        { embeddingProvider, vectorStore: store },
      );

      expect(result).toEqual({
        chunkId:
          "materials:catalogs/electrical-materials.xlsx#sheet=Catalog#row=2",
        sourcePath: "catalogs/electrical-materials.xlsx",
        sheetName: "Catalog",
        rowIndex: 2,
        catalogId: "CAT-ELEC-001",
        itemCode: "CB-001",
        name: "XLPE Cable",
        manufacturer: "Volt Electric",
        model: "X-100",
        category: "Cable",
        specification: "0.6/1kV 4C 25sq",
        unit: "m",
        unitPrice: 12000,
        currency: "KRW",
        text: expect.stringContaining("itemCode: CB-001"),
        similarity: expect.any(Number),
      });
    } finally {
      await store.close();
    }
  });

  it("retrieves related rows ahead of deterministic distractors", async () => {
    const { indexMaterialKnowledge, searchMaterialKnowledge } =
      await loadMaterialDomain();
    const { store } = createTempStore();
    const embeddingProvider = new DeterministicMaterialEmbeddingProvider();

    try {
      await indexMaterialKnowledge(materialInput(), {
        readMaterialSheet: vi.fn(async () => materialSheet()),
        embeddingProvider,
        vectorStore: store,
      });
      const results = await searchMaterialKnowledge(
        { query: "cable", topK: 2 },
        { embeddingProvider, vectorStore: store },
      );

      expect(
        results.map((result: { rowIndex: number }) => result.rowIndex),
      ).toEqual([2, 4]);
      expect(results[0].similarity).toBeGreaterThan(results[1].similarity);
    } finally {
      await store.close();
    }
  });

  it("rejects provider, model, and dimension mismatches before search", async () => {
    const { indexMaterialKnowledge, searchMaterialKnowledge } =
      await loadMaterialDomain();
    const { store } = createTempStore();
    const indexed = new DeterministicMaterialEmbeddingProvider(
      "indexed",
      "model-a",
      3,
    );

    try {
      await indexMaterialKnowledge(materialInput(), {
        readMaterialSheet: vi.fn(async () => materialSheet()),
        embeddingProvider: indexed,
        vectorStore: store,
      });

      for (const provider of [
        new DeterministicMaterialEmbeddingProvider("other", "model-a", 3),
        new DeterministicMaterialEmbeddingProvider("indexed", "model-b", 3),
        new DeterministicMaterialEmbeddingProvider("indexed", "model-a", 2),
      ]) {
        await expect(
          searchMaterialKnowledge(
            { query: "cable" },
            { embeddingProvider: provider, vectorStore: store },
          ),
        ).rejects.toThrow("Material index embedding metadata mismatch");
      }
    } finally {
      await store.close();
    }
  });

  it("leaves KEC and Company collections unchanged for the same sourcePath", async () => {
    const { indexMaterialKnowledge } = await loadMaterialDomain();
    const { store } = createTempStore();

    try {
      await seedLegacyCollection(store, "kec");
      await seedLegacyCollection(store, "company");
      const beforeKec = await store.listChunks("kec", legacyCollectionCodecs);
      const beforeCompany = await store.listChunks(
        "company",
        legacyCollectionCodecs,
      );

      await indexMaterialKnowledge(materialInput(), {
        readMaterialSheet: vi.fn(async () => materialSheet()),
        embeddingProvider: new DeterministicMaterialEmbeddingProvider(),
        vectorStore: store,
      });

      await expect(
        store.listChunks("kec", legacyCollectionCodecs),
      ).resolves.toEqual(beforeKec);
      await expect(
        store.listChunks("company", legacyCollectionCodecs),
      ).resolves.toEqual(beforeCompany);
    } finally {
      await store.close();
    }
  });
});
