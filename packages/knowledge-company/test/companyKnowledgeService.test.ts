import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cleanupTempStores,
  companyInput,
  companyPages,
  createTempStore,
  DeterministicCompanyEmbeddingProvider,
  kecFixtureCodecs,
  loadCompanyDomain,
  seedKecCollection,
} from "./helpers/companyFixtures.js";

describe("Company knowledge indexing and search", () => {
  afterEach(cleanupTempStores);

  it("indexes only into the company collection after every embedding succeeds", async () => {
    const { indexCompanyKnowledge } = await loadCompanyDomain();
    const events: string[] = [];
    const replaceSource = vi.fn(async (...args: unknown[]) => {
      events.push("replace");
      expect(args[0]).toBe("company");
      expect(events.filter((event) => event === "embedded")).toHaveLength(2);
    });
    const embeddingProvider = {
      getMetadata: () => ({ provider: "test", model: "ordered" }),
      embed: vi.fn(async () => {
        events.push("embedded");
        return [1, 0];
      }),
    };

    const result = await indexCompanyKnowledge(companyInput(), {
      readPdfPages: vi.fn(async () => companyPages()),
      embeddingProvider,
      vectorStore: { replaceSource },
    });

    expect(result).toMatchObject({
      sourcePath: "standards/electrical-standard.pdf",
      standardId: "CS-ELEC-001",
      indexedChunks: 2,
    });
    expect(replaceSource).toHaveBeenCalledOnce();
    expect(replaceSource.mock.calls[0][1]).toBe(
      "standards/electrical-standard.pdf",
    );
  });

  it("does not replace existing source data when one embedding fails", async () => {
    const { indexCompanyKnowledge } = await loadCompanyDomain();
    const replaceSource = vi.fn();
    let calls = 0;

    await expect(
      indexCompanyKnowledge(companyInput(), {
        readPdfPages: vi.fn(async () => companyPages()),
        embeddingProvider: {
          getMetadata: () => ({ provider: "test", model: "failing" }),
          embed: vi.fn(async () => {
            calls += 1;
            if (calls === 2) {
              throw new Error("deterministic embedding failure");
            }
            return [1, 0];
          }),
        },
        vectorStore: { replaceSource },
      }),
    ).rejects.toThrow("deterministic embedding failure");

    expect(replaceSource).not.toHaveBeenCalled();
  });

  it("normalizes optional metadata before persisting and does not mutate input", async () => {
    const { companyKnowledgeCodecs, indexCompanyKnowledge } =
      await loadCompanyDomain();
    const input = companyInput({
      revision: undefined,
      effectiveDate: undefined,
      department: undefined,
    });
    const snapshot = structuredClone(input);
    const replaceSource = vi.fn();

    await indexCompanyKnowledge(input, {
      readPdfPages: vi.fn(async () => [companyPages()[0]]),
      embeddingProvider: new DeterministicCompanyEmbeddingProvider(),
      vectorStore: { replaceSource },
    });

    const chunks = replaceSource.mock.calls[0][2] as Array<{
      metadata: Record<string, unknown>;
    }>;
    expect(chunks[0].metadata).toEqual({
      standardId: "CS-ELEC-001",
      title: "Electrical Design Standard",
      section: null,
      revision: null,
      effectiveDate: null,
      department: null,
    });
    expect(replaceSource.mock.calls[0][4]).toBe(companyKnowledgeCodecs);
    expect(input).toEqual(snapshot);
  });

  it("re-indexes one source atomically without retaining stale chunks", async () => {
    const { companyKnowledgeCodecs, indexCompanyKnowledge } =
      await loadCompanyDomain();
    const { store } = createTempStore();
    const embeddingProvider = new DeterministicCompanyEmbeddingProvider();
    let pages = companyPages();

    try {
      await indexCompanyKnowledge(companyInput(), {
        readPdfPages: vi.fn(async () => pages),
        embeddingProvider,
        vectorStore: store,
      });
      pages = [{ page: 1, text: "Updated grounding standard." }];
      await indexCompanyKnowledge(companyInput(), {
        readPdfPages: vi.fn(async () => pages),
        embeddingProvider,
        vectorStore: store,
      });

      await expect(
        store.listChunks("company", companyKnowledgeCodecs),
      ).resolves.toEqual([
        expect.objectContaining({
          chunkId: "company:standards/electrical-standard.pdf#page=1#chunk=0",
          text: "Updated grounding standard.",
        }),
      ]);
    } finally {
      await store.close();
    }
  });

  it("returns the real SQLite chunk id and the stable CompanySearchResult shape", async () => {
    const { indexCompanyKnowledge, searchCompanyKnowledge } =
      await loadCompanyDomain();
    const { store } = createTempStore();
    const embeddingProvider = new DeterministicCompanyEmbeddingProvider();

    try {
      await indexCompanyKnowledge(companyInput(), {
        readPdfPages: vi.fn(async () => companyPages()),
        embeddingProvider,
        vectorStore: store,
      });
      const [result] = await searchCompanyKnowledge(
        { query: "grounding", topK: 1 },
        { embeddingProvider, vectorStore: store },
      );

      expect(result).toEqual({
        chunkId: "company:standards/electrical-standard.pdf#page=1#chunk=0",
        sourcePath: "standards/electrical-standard.pdf",
        page: 1,
        standardId: "CS-ELEC-001",
        title: "Electrical Design Standard",
        section: null,
        text: "Grounding conductors shall follow the company grounding standard.",
        similarity: expect.any(Number),
      });
    } finally {
      await store.close();
    }
  });

  it("ranks related and distractor chunks deterministically without domain hard-coding", async () => {
    const { indexCompanyKnowledge, searchCompanyKnowledge } =
      await loadCompanyDomain();
    const { store } = createTempStore();
    const embeddingProvider = new DeterministicCompanyEmbeddingProvider();

    try {
      await indexCompanyKnowledge(companyInput(), {
        readPdfPages: vi.fn(async () => companyPages()),
        embeddingProvider,
        vectorStore: store,
      });

      const results = await searchCompanyKnowledge(
        { query: "grounding", topK: 2 },
        { embeddingProvider, vectorStore: store },
      );

      expect(results.map((result: { page: number }) => result.page)).toEqual([
        1, 2,
      ]);
      expect(results[0].similarity).toBeGreaterThan(results[1].similarity);
    } finally {
      await store.close();
    }
  });

  it("rejects provider, model, and dimension mismatches before searching", async () => {
    const { indexCompanyKnowledge, searchCompanyKnowledge } =
      await loadCompanyDomain();
    const { store } = createTempStore();
    const indexedProvider = new DeterministicCompanyEmbeddingProvider(
      "indexed",
      "model-a",
      3,
    );

    try {
      await indexCompanyKnowledge(companyInput(), {
        readPdfPages: vi.fn(async () => [companyPages()[0]]),
        embeddingProvider: indexedProvider,
        vectorStore: store,
      });

      for (const provider of [
        new DeterministicCompanyEmbeddingProvider("other", "model-a", 3),
        new DeterministicCompanyEmbeddingProvider("indexed", "model-b", 3),
        new DeterministicCompanyEmbeddingProvider("indexed", "model-a", 2),
      ]) {
        await expect(
          searchCompanyKnowledge(
            { query: "grounding" },
            { embeddingProvider: provider, vectorStore: store },
          ),
        ).rejects.toThrow("Company index embedding metadata mismatch");
      }
    } finally {
      await store.close();
    }
  });

  it("keeps KEC data unchanged while sharing the same SQLite database", async () => {
    const { indexCompanyKnowledge } = await loadCompanyDomain();
    const { store } = createTempStore();
    const embeddingProvider = new DeterministicCompanyEmbeddingProvider();

    try {
      await seedKecCollection(store);
      const before = await store.listChunks("kec", kecFixtureCodecs);

      await indexCompanyKnowledge(companyInput(), {
        readPdfPages: vi.fn(async () => companyPages()),
        embeddingProvider,
        vectorStore: store,
      });

      await expect(store.listChunks("kec", kecFixtureCodecs)).resolves.toEqual(
        before,
      );
      await expect(store.getIndexMetadata("company")).resolves.toMatchObject({
        embeddingProvider: "test",
        embeddingModel: "company-keywords",
        dimensions: 3,
      });
      await expect(store.getIndexMetadata("kec")).resolves.toBeNull();
    } finally {
      await store.close();
    }
  });
});
