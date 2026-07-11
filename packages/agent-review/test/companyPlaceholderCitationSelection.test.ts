import type { CompanySearchResult } from "@voltai/knowledge-company";
import { describe, expect, it, vi } from "vitest";

import { createReviewKnowledgeQueryService } from "../src/index.js";
import { companyResult, kecResult } from "./helpers/companyReviewFixtures.js";

function relatedResult(overrides: Partial<CompanySearchResult> = {}): CompanySearchResult {
  return companyResult({
    chunkId: "company-related",
    text: "Cable grounding shall follow the company electrical standard.",
    similarity: 0.4,
    ...overrides,
  });
}

function distractorResult(overrides: Partial<CompanySearchResult> = {}): CompanySearchResult {
  return companyResult({
    chunkId: "company-distractor",
    sourcePath: "standards/procurement.pdf",
    standardId: "CS-PROC-900",
    title: "Procurement Archive Standard",
    section: null,
    text: "Purchasing archive retention requirements.",
    similarity: 0.99,
    ...overrides,
  });
}

async function loadSelector() {
  return import("../src/companyCitationSelection.js");
}

describe("Company placeholder citation selection", () => {
  it("removes a higher-scoring distractor without lexical support", async () => {
    const { selectCompanyResultsForPlaceholderReview } = await loadSelector();

    expect(
      selectCompanyResultsForPlaceholderReview({
        contextText: "Cable grounding design",
        results: [distractorResult(), relatedResult()],
      }),
    ).toEqual([relatedResult()]);
  });

  it("allows an empty selection when every result is unsupported", async () => {
    const { selectCompanyResultsForPlaceholderReview } = await loadSelector();

    expect(
      selectCompanyResultsForPlaceholderReview({
        contextText: "Cable grounding design",
        results: [distractorResult()],
      }),
    ).toEqual([]);
  });

  it("does not mutate raw results and returns deterministic ordering", async () => {
    const { selectCompanyResultsForPlaceholderReview } = await loadSelector();
    const raw = [
      relatedResult({ chunkId: "b", sourcePath: "standards/b.pdf", similarity: 0.7 }),
      relatedResult({ chunkId: "a", sourcePath: "standards/a.pdf", similarity: 0.7 }),
    ];
    const snapshot = structuredClone(raw);

    const first = selectCompanyResultsForPlaceholderReview({
      contextText: "Cable grounding design",
      results: raw,
    });
    const second = selectCompanyResultsForPlaceholderReview({
      contextText: "Cable grounding design",
      results: raw,
    });

    expect(first.map((result: CompanySearchResult) => result.chunkId)).toEqual(["a", "b"]);
    expect(second).toEqual(first);
    expect(raw).toEqual(snapshot);
  });

  it("filters project-level results only when the provider is placeholder", async () => {
    const raw = [distractorResult(), relatedResult()];
    const createService = (provider: string) =>
      createReviewKnowledgeQueryService({
        searchKec: vi.fn(async () => [kecResult()]),
        searchCompany: vi.fn(async () => raw),
        companySearchProvider: provider,
      } as never);

    const placeholder = await createService("placeholder").searchProject({
      context: "Cable grounding design",
    });
    const semantic = await createService("ollama").searchProject({
      context: "Cable grounding design",
    });

    expect(placeholder.companyResults).toEqual([relatedResult()]);
    expect(semantic.companyResults).toEqual(raw);
    expect(raw).toEqual([distractorResult(), relatedResult()]);
  });

  it("uses item name and evidence excerpt as placeholder selection context", async () => {
    const searchCompany = vi.fn(async () => [distractorResult(), relatedResult()]);
    const service = createReviewKnowledgeQueryService({
      searchKec: vi.fn(async () => [kecResult()]),
      searchCompany,
      companySearchProvider: "placeholder",
    } as never);

    const result = await service.searchItem({
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

    expect(searchCompany).toHaveBeenCalledWith(expect.stringContaining("케이블"));
    expect(searchCompany).toHaveBeenCalledWith(
      expect.stringContaining("Cable grounding design evidence."),
    );
    expect(result.companyResults).toEqual([relatedResult()]);
  });

  it("converts selector failures into Company fail-soft warnings", async () => {
    const malformed = relatedResult();
    Object.defineProperty(malformed, "text", {
      get: () => {
        throw new Error("raw secret payload");
      },
    });
    const service = createReviewKnowledgeQueryService({
      searchKec: vi.fn(async () => [kecResult()]),
      searchCompany: vi.fn(async () => [malformed]),
      companySearchProvider: "placeholder",
    } as never);

    const result = await service.searchProject({ context: "Cable grounding design" });

    expect(result.companyResults).toEqual([]);
    expect(result.warnings).toEqual([
      expect.objectContaining({ source: "company", scope: "project" }),
    ]);
    expect(result.warnings[0]?.message).not.toContain("secret");
  });
});
