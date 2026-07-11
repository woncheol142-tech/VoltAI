import { describe, expect, it, vi } from "vitest";

import { createSearchCompanyTool } from "../src/tools/searchCompany.js";

describe("search_company raw placeholder contract", () => {
  it("returns raw Company search results without Review-only lexical filtering", async () => {
    const close = vi.fn();
    const tool = createSearchCompanyTool({
      environment: {
        PROJECT_ROOT: "/project",
        COMPANY_EMBED_PROVIDER: "placeholder",
      },
      embeddingProvider: {
        getMetadata: () => ({ provider: "placeholder", model: "company-local-placeholder" }),
        embed: vi.fn(async () => [0, 1, 1]),
      },
      createVectorStore: () => ({
        getIndexMetadata: vi.fn(async () => ({
          embeddingProvider: "placeholder",
          embeddingModel: "company-local-placeholder",
          dimensions: 3,
          indexedAt: "2026-01-01T00:00:00.000Z",
        })),
        search: vi.fn(async () => [
          {
            chunkId: "company-distractor",
            documentId: "company:standards/procurement.pdf",
            sourcePath: "standards/procurement.pdf",
            locator: { kind: "page" as const, page: 4 },
            metadata: {
              standardId: "CS-PROC-900",
              title: "Procurement Archive Standard",
              section: null,
              revision: null,
              effectiveDate: null,
              department: null,
            },
            text: "Purchasing archive retention requirements.",
            similarity: 0.99,
          },
        ]),
        close,
      }),
    });

    const output = await tool.handler({ query: "Cable grounding design", topK: 5 });

    expect(output.results).toEqual([
      expect.objectContaining({
        chunkId: "company-distractor",
        standardId: "CS-PROC-900",
        similarity: 0.99,
      }),
    ]);
    expect(close).toHaveBeenCalledOnce();
  });
});
