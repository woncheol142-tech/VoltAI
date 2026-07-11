import { describe, expect, it, vi } from "vitest";

import {
  createReviewKnowledgeQueryService,
  type ReviewKnowledgeQueryService,
} from "../src/reviewKnowledgeQueries.js";
import { companyResult, kecResult } from "./helpers/companyReviewFixtures.js";

function createService(overrides: {
  searchKec?: (query: string) => Promise<ReturnType<typeof kecResult>[]>;
  searchCompany?: (query: string) => Promise<ReturnType<typeof companyResult>[]>;
} = {}): {
  service: ReviewKnowledgeQueryService;
  searchKec: ReturnType<typeof vi.fn>;
  searchCompany: ReturnType<typeof vi.fn>;
} {
  const searchKec = vi.fn(overrides.searchKec ?? (async () => [kecResult()]));
  const searchCompany = vi.fn(overrides.searchCompany ?? (async () => [companyResult()]));

  return {
    service: createReviewKnowledgeQueryService({ searchKec, searchCompany }),
    searchKec,
    searchCompany,
  };
}

describe("ReviewKnowledgeQueryService", () => {
  it("queries KEC and Company independently for project context", async () => {
    const { service, searchKec, searchCompany } = createService();

    const result = await service.searchProject({ context: "Cable grounding design" });

    expect(searchKec).toHaveBeenCalledWith("Cable grounding design");
    expect(searchCompany).toHaveBeenCalledWith("Cable grounding design");
    expect(result.kecResults).toEqual([kecResult()]);
    expect(result.companyResults).toEqual([companyResult()]);
    expect(result.warnings).toEqual([]);
  });

  it("uses the item name and evidence excerpt for Company item queries", async () => {
    const { service, searchKec, searchCompany } = createService();

    await service.searchItem({
      name: "케이블",
      evidence: [
        {
          id: "pdf:docs/spec.pdf:p1:1",
          sourceType: "pdf",
          sourcePath: "docs/spec.pdf",
          page: 1,
          excerpt: "Cable grounding design evidence.",
        },
      ],
    });

    expect(searchKec).toHaveBeenCalledWith("케이블 KEC 기준");
    expect(searchCompany).toHaveBeenCalledWith(
      expect.stringContaining("케이블"),
    );
    expect(searchCompany).toHaveBeenCalledWith(
      expect.stringContaining("Cable grounding design evidence."),
    );
  });

  it("does not call Company search when the optional port is absent", async () => {
    const searchKec = vi.fn(async () => [kecResult()]);
    const service = createReviewKnowledgeQueryService({ searchKec });

    const result = await service.searchProject({ context: "Cable grounding design" });

    expect(searchKec).toHaveBeenCalledTimes(1);
    expect(result.companyResults).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("treats empty Company results as a successful optional search", async () => {
    const { service } = createService({ searchCompany: async () => [] });

    await expect(service.searchProject({ context: "Cable grounding design" })).resolves.toMatchObject({
      companyResults: [],
      warnings: [],
    });
  });

  it("returns a secret-safe structured warning when Company project search fails", async () => {
    const { service } = createService({
      searchCompany: async () => {
        throw new Error("Bearer private-token request payload");
      },
    });

    const result = await service.searchProject({ context: "Cable grounding design" });

    expect(result.companyResults).toEqual([]);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        severity: "warning",
        source: "company",
        scope: "project",
      }),
    ]);
    expect(result.warnings[0]?.message).not.toContain("private-token");
    expect(result.warnings[0]?.message).not.toContain("payload");
  });

  it("returns an item-scoped warning when Company search fails", async () => {
    const evidence = [
      {
        id: "pdf:docs/spec.pdf:p1:1",
        sourceType: "pdf" as const,
        sourcePath: "docs/spec.pdf",
        page: 1,
        excerpt: "Cable grounding design evidence.",
      },
    ];
    const { service } = createService({
      searchCompany: async () => {
        throw new Error("unavailable");
      },
      searchKec: async () => [kecResult()],
    });

    const output = await service.searchItem({ name: "케이블", evidence });

    expect(output.warnings).toEqual([
      expect.objectContaining({ source: "company", scope: "item" }),
    ]);
    expect(evidence[0]?.excerpt).toBe("Cable grounding design evidence.");
  });

  it("does not mutate raw KEC or Company result inputs", async () => {
    const rawKecResults = [kecResult()];
    const rawCompanyResults = [companyResult()];
    const { service } = createService({
      searchKec: async () => rawKecResults,
      searchCompany: async () => rawCompanyResults,
    });

    await service.searchProject({ context: "Cable grounding design" });

    expect(rawKecResults).toEqual([kecResult()]);
    expect(rawCompanyResults).toEqual([companyResult()]);
  });

  it("constructs deterministic Company item queries", async () => {
    const { service } = createService();
    const input = {
      name: "케이블",
      evidence: [
        {
          id: "pdf:docs/spec.pdf:p1:1",
          sourceType: "pdf" as const,
          sourcePath: "docs/spec.pdf",
          page: 1,
          excerpt: "Cable grounding design evidence.",
        },
      ],
    };

    const first = await service.searchItem(input);
    const second = await service.searchItem(input);

    expect(first).toEqual(second);
  });
});
