import { existsSync } from "node:fs";

import { reviewProject, type ReviewReport } from "@voltai/agent-review";
import { companyKnowledgeCodecs } from "@voltai/knowledge-company";
import { SqliteVectorStore } from "@voltai/mcp-kec";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createLocalReviewPorts } from "../../src/ports/localReviewPorts.js";
import { SqliteKnowledgeStore } from "../../../knowledge-sqlite/src/index.js";
import { prepareDeterministicKecStore } from "./helpers/kecFixture.js";
import {
  createCapturingMockReviewLlm,
  createReviewFixture,
  withE2eEnvironment,
  type ReviewFixture,
} from "./helpers/reviewFixture.js";

async function seedCompanyKnowledge(
  dbPath: string,
  embedding: ReviewFixture["embeddingProvider"],
): Promise<void> {
  const store = new SqliteKnowledgeStore(dbPath);

  try {
    await store.replaceSource(
      "company",
      "standards/electrical-standard.pdf",
      [
        {
          chunkId: "company-standard-page-1",
          documentId: "company:standards/electrical-standard.pdf",
          sourcePath: "standards/electrical-standard.pdf",
          chunkIndex: 0,
          locator: { kind: "page", page: 1 },
          metadata: {
            standardId: "CS-ELEC-001",
            title: "Electrical Design Standard",
            section: "Grounding",
            revision: null,
            effectiveDate: null,
            department: null,
          },
          text: "Cable grounding shall follow the company electrical design standard.",
          embedding: await embedding.embed("Cable grounding shall follow the company electrical design standard."),
        },
      ],
      {
        embeddingProvider: embedding.getMetadata().provider,
        embeddingModel: embedding.getMetadata().model,
        dimensions: 4,
        indexedAt: "2026-01-01T00:00:00.000Z",
      },
      companyKnowledgeCodecs,
    );
  } finally {
    await store.close();
  }
}

describe("review project Company Knowledge E2E", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("connects deterministic Company search results to the typed report and conditional Markdown section", async () => {
    const fixture = await createReviewFixture();
    const companyDbPath = fixture.kecDbPath;
    const fetchSpy = vi.fn(async () => {
      throw new Error("Company E2E must not make network requests");
    });
    vi.stubGlobal("fetch", fetchSpy);

    try {
      await withE2eEnvironment(fixture, async () => {
        await prepareDeterministicKecStore(fixture);
        await seedCompanyKnowledge(companyDbPath, fixture.embeddingProvider);

        const llm = createCapturingMockReviewLlm();
        const ports = createLocalReviewPorts(fixture.projectRoot, {
          embeddingProvider: fixture.embeddingProvider,
          vectorStoreFactory: () => new SqliteVectorStore(fixture.kecDbPath),
          companyEmbeddingProvider: fixture.embeddingProvider,
          companyVectorStoreFactory: () => new SqliteKnowledgeStore(companyDbPath),
          llm,
        });
        const markdown = await reviewProject({ projectPath: fixture.projectRoot }, ports);

        const report = llm.report as ReviewReport | undefined;
        expect(report?.companyCitations).toEqual([
          expect.objectContaining({
            id: "company:company-standard-page-1",
            sourceType: "company",
            standardId: "CS-ELEC-001",
            sourcePath: "standards/electrical-standard.pdf",
            page: 1,
          }),
        ]);
        expect(
          report?.itemReviews.some((item) => item.companyCitations.length > 0),
        ).toBe(true);
        expect(markdown).toContain("# 관련 KEC 조항");
        expect(markdown).toContain("# 관련 사내 표준");
        expect(markdown).toContain("CS-ELEC-001");
        expect(fetchSpy).not.toHaveBeenCalled();
      });
    } finally {
      await fixture.cleanup();
    }

    expect(existsSync(fixture.projectRoot)).toBe(false);
  });
});
