import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cleanupTempStores,
  createTempStore,
  DeterministicMaterialEmbeddingProvider,
  materialInput,
  materialSheet,
} from "./helpers/materialFixtures.js";

function sheetFixture(sheetName: string, itemCode: string, name: string) {
  const sheet = materialSheet();
  sheet.sheetName = sheetName;
  sheet.rows = [sheet.rows[0], { ...sheet.rows[1], values: [...sheet.rows[1].values] }];
  sheet.rows[1].values[0] = itemCode;
  sheet.rows[1].values[1] = name;
  return sheet;
}

describe("Material multi-sheet source preservation", () => {
  afterEach(cleanupTempStores);

  it("keeps Sheet1 and Sheet2 when the same workbook is indexed separately", async () => {
    const { indexMaterialKnowledge, materialKnowledgeCodecs } =
      await import("../src/index.js");
    const { store } = createTempStore();
    const embeddingProvider = new DeterministicMaterialEmbeddingProvider();

    try {
      for (const [sheetName, itemCode, name] of [
        ["Sheet1", "CB-001", "Cable A"],
        ["Sheet2", "PN-001", "Panel B"],
      ] as const) {
        await indexMaterialKnowledge(materialInput({ sheetName }), {
          readMaterialSheet: async () => sheetFixture(sheetName, itemCode, name),
          embeddingProvider,
          vectorStore: store,
        });
      }

      const chunks = await store.listChunks("materials", materialKnowledgeCodecs);
      expect(chunks.map((chunk) => chunk.locator.table).sort()).toEqual(["Sheet1", "Sheet2"]);
    } finally {
      await store.close();
    }
  });

  it("re-indexes Sheet1 without deleting Sheet2 and removes only stale Sheet1 rows", async () => {
    const { indexMaterialKnowledge, materialKnowledgeCodecs } =
      await import("../src/index.js");
    const { store } = createTempStore();
    const embeddingProvider = new DeterministicMaterialEmbeddingProvider();

    try {
      await indexMaterialKnowledge(materialInput({ sheetName: "Sheet1" }), {
        readMaterialSheet: async () => sheetFixture("Sheet1", "OLD-1", "Old Cable"),
        embeddingProvider,
        vectorStore: store,
      });
      await indexMaterialKnowledge(materialInput({ sheetName: "Sheet2" }), {
        readMaterialSheet: async () => sheetFixture("Sheet2", "PN-1", "Panel B"),
        embeddingProvider,
        vectorStore: store,
      });
      await indexMaterialKnowledge(materialInput({ sheetName: "Sheet1" }), {
        readMaterialSheet: async () => sheetFixture("Sheet1", "NEW-1", "New Cable"),
        embeddingProvider,
        vectorStore: store,
      });

      const chunks = await store.listChunks("materials", materialKnowledgeCodecs);
      expect(chunks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            locator: expect.objectContaining({ table: "Sheet1" }),
            text: expect.stringContaining("NEW-1"),
          }),
          expect.objectContaining({
            locator: expect.objectContaining({ table: "Sheet2" }),
            text: expect.stringContaining("PN-1"),
          }),
        ]),
      );
      expect(chunks.some((chunk) => chunk.text.includes("OLD-1"))).toBe(false);
    } finally {
      await store.close();
    }
  });

  it("re-indexes Sheet2 without deleting Sheet1", async () => {
    const { indexMaterialKnowledge, materialKnowledgeCodecs } =
      await import("../src/index.js");
    const { store } = createTempStore();
    const embeddingProvider = new DeterministicMaterialEmbeddingProvider();

    try {
      await indexMaterialKnowledge(materialInput({ sheetName: "Sheet1" }), {
        readMaterialSheet: async () => sheetFixture("Sheet1", "CB-1", "Cable A"),
        embeddingProvider,
        vectorStore: store,
      });
      await indexMaterialKnowledge(materialInput({ sheetName: "Sheet2" }), {
        readMaterialSheet: async () => sheetFixture("Sheet2", "OLD-2", "Old Panel"),
        embeddingProvider,
        vectorStore: store,
      });
      await indexMaterialKnowledge(materialInput({ sheetName: "Sheet2" }), {
        readMaterialSheet: async () => sheetFixture("Sheet2", "NEW-2", "New Panel"),
        embeddingProvider,
        vectorStore: store,
      });

      const chunks = await store.listChunks("materials", materialKnowledgeCodecs);
      expect(chunks.map((chunk) => chunk.locator.table).sort()).toEqual(["Sheet1", "Sheet2"]);
      expect(chunks.some((chunk) => chunk.text.includes("CB-1"))).toBe(true);
      expect(chunks.some((chunk) => chunk.text.includes("OLD-2"))).toBe(false);
    } finally {
      await store.close();
    }
  });

  it("uses a sheet-scoped replacement identity without changing the public result", async () => {
    const { indexMaterialKnowledge } = await import("../src/index.js");
    const replaceSource = vi.fn();

    const result = await indexMaterialKnowledge(materialInput({ sheetName: "Sheet1" }), {
      readMaterialSheet: async () => sheetFixture("Sheet1", "CB-1", "Cable A"),
      embeddingProvider: new DeterministicMaterialEmbeddingProvider(),
      vectorStore: { replaceSource },
    });

    expect(replaceSource.mock.calls[0]?.[1]).not.toBe("catalogs/electrical-materials.xlsx");
    expect(replaceSource.mock.calls[0]?.[1]).toContain("Sheet1");
    expect(result.sourcePath).toBe("catalogs/electrical-materials.xlsx");
  });

  it("returns the original workbook sourcePath from searches across both sheets", async () => {
    const { indexMaterialKnowledge, searchMaterialKnowledge } =
      await import("../src/index.js");
    const { store } = createTempStore();
    const embeddingProvider = new DeterministicMaterialEmbeddingProvider();

    try {
      await indexMaterialKnowledge(materialInput({ sheetName: "Sheet1" }), {
        readMaterialSheet: async () => sheetFixture("Sheet1", "CB-1", "Cable A"),
        embeddingProvider,
        vectorStore: store,
      });
      await indexMaterialKnowledge(materialInput({ sheetName: "Sheet2" }), {
        readMaterialSheet: async () => sheetFixture("Sheet2", "PN-1", "Panel B"),
        embeddingProvider,
        vectorStore: store,
      });

      const results = await searchMaterialKnowledge(
        { query: "catalog", topK: 10 },
        { embeddingProvider, vectorStore: store },
      );
      expect(results.map((result) => result.sheetName).sort()).toEqual(["Sheet1", "Sheet2"]);
      expect(
        results.every((result) => result.sourcePath === "catalogs/electrical-materials.xlsx"),
      ).toBe(true);
    } finally {
      await store.close();
    }
  });

  it("cleans legacy unscoped rows only after the scoped replacement succeeds", async () => {
    const { indexMaterialKnowledge } = await import("../src/index.js");
    const events: string[] = [];
    const deleteBySourcePath = vi.fn(async () => {
      events.push("cleanup");
    });
    const replaceSource = vi.fn(async () => {
      events.push("replace");
    });

    await indexMaterialKnowledge(materialInput({ sheetName: "Sheet1" }), {
      readMaterialSheet: async () => sheetFixture("Sheet1", "CB-1", "Cable A"),
      embeddingProvider: new DeterministicMaterialEmbeddingProvider(),
      vectorStore: { replaceSource, deleteBySourcePath } as never,
    });

    expect(events).toEqual(["replace", "cleanup"]);

    events.length = 0;
    replaceSource.mockRejectedValueOnce(new Error("scoped write failed"));
    await expect(
      indexMaterialKnowledge(materialInput({ sheetName: "Sheet2" }), {
        readMaterialSheet: async () => sheetFixture("Sheet2", "PN-1", "Panel B"),
        embeddingProvider: new DeterministicMaterialEmbeddingProvider(),
        vectorStore: { replaceSource, deleteBySourcePath } as never,
      }),
    ).rejects.toThrow("scoped write failed");
    expect(deleteBySourcePath).toHaveBeenCalledTimes(1);
  });

  it("keeps deterministic chunk ids when one sheet is re-indexed", async () => {
    const { indexMaterialKnowledge, materialKnowledgeCodecs } =
      await import("../src/index.js");
    const { store } = createTempStore();
    const embeddingProvider = new DeterministicMaterialEmbeddingProvider();

    try {
      const indexSheet = () =>
        indexMaterialKnowledge(materialInput({ sheetName: "Sheet1" }), {
          readMaterialSheet: async () => sheetFixture("Sheet1", "CB-1", "Cable A"),
          embeddingProvider,
          vectorStore: store,
        });
      await indexSheet();
      const first = await store.listChunks("materials", materialKnowledgeCodecs);
      await indexSheet();
      const second = await store.listChunks("materials", materialKnowledgeCodecs);

      expect(second.map((chunk) => chunk.chunkId)).toEqual(first.map((chunk) => chunk.chunkId));
    } finally {
      await store.close();
    }
  });
});
