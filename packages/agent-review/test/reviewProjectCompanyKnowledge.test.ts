import type { CompanySearchResult } from "@voltai/knowledge-company";
import { describe, expect, it, vi } from "vitest";

import {
  reviewProject,
  type ReviewLlm,
  type ReviewProjectPorts,
  type ReviewPromptInput,
} from "../src/index.js";
import { companyResult, kecResult } from "./helpers/companyReviewFixtures.js";

class CapturingLlm implements ReviewLlm {
  input: ReviewPromptInput | undefined;

  async generateReview(input: ReviewPromptInput): Promise<string> {
    this.input = input;
    return "# review";
  }
}

function createPorts(
  llm: CapturingLlm,
  searchCompany?: (query: string) => Promise<CompanySearchResult[]>,
  companySearchProvider?: string,
): ReviewProjectPorts {
  return {
    listProjectFiles: vi.fn().mockResolvedValue([
      {
        name: "spec.pdf",
        relativePath: "docs/spec.pdf",
        extension: ".pdf",
        size: 1,
        modifiedAt: "2026-01-01T00:00:00.000Z",
      },
    ]),
    readPdf: vi.fn().mockResolvedValue({
      relativePath: "docs/spec.pdf",
      pageCount: 1,
      text: "Cable grounding design evidence.",
      pages: [{ page: 1, text: "Cable grounding design evidence." }],
      truncated: false,
    }),
    readExcel: vi.fn(),
    searchKec: vi.fn().mockResolvedValue([kecResult()]),
    ...(searchCompany ? { searchCompany: vi.fn(searchCompany) } : {}),
    ...(companySearchProvider === undefined ? {} : { companySearchProvider }),
    llm,
  };
}

function unsupportedCompanyResult(): CompanySearchResult {
  return companyResult({
    chunkId: "company-unrelated",
    sourcePath: "standards/procurement.pdf",
    standardId: "CS-PROC-900",
    title: "Procurement Archive Standard",
    section: null,
    text: "Purchasing archive retention requirements.",
    similarity: 0.99,
  });
}

describe("reviewProject Company Knowledge integration", () => {
  it("passes project-level and item-level Company results to the Review LLM", async () => {
    const llm = new CapturingLlm();
    const ports = createPorts(llm, async () => [companyResult()]);

    await reviewProject({ projectPath: "/project" }, ports);

    expect(llm.input?.companyResults).toEqual([companyResult()]);
    expect(llm.input?.itemReviews).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "케이블",
          companyResults: [companyResult()],
        }),
      ]),
    );
  });

  it("keeps the existing review flow when the Company port is absent", async () => {
    const llm = new CapturingLlm();

    await expect(reviewProject({ projectPath: "/project" }, createPorts(llm))).resolves.toBe(
      "# review",
    );
    expect(llm.input?.companyResults).toEqual([]);
  });

  it("continues to the Review LLM with a Company failure warning", async () => {
    const llm = new CapturingLlm();
    const ports = createPorts(llm, async () => {
      throw new Error("Bearer private-token");
    });

    await expect(reviewProject({ projectPath: "/project" }, ports)).resolves.toBe("# review");

    expect(llm.input?.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: "warning", message: expect.stringContaining("Company") }),
      ]),
    );
    expect(llm.input?.findings.map((finding) => finding.message).join("\n")).not.toContain(
      "private-token",
    );
  });

  it("filters unsupported Company results for the placeholder provider", async () => {
    const llm = new CapturingLlm();
    const supported = companyResult();
    const unsupported = unsupportedCompanyResult();
    const ports = createPorts(
      llm,
      async () => [unsupported, supported],
      "placeholder",
    );

    await reviewProject({ projectPath: "/project" }, ports);

    expect(llm.input?.companyResults).toEqual([supported]);
    expect(llm.input?.itemReviews).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "케이블",
          companyResults: [supported],
        }),
      ]),
    );
  });

  it("passes raw Company results through for a non-placeholder provider", async () => {
    const llm = new CapturingLlm();
    const raw = [unsupportedCompanyResult(), companyResult()];
    const ports = createPorts(llm, async () => raw, "ollama");

    await reviewProject({ projectPath: "/project" }, ports);

    expect(llm.input?.companyResults).toEqual(raw);
  });

  it("passes raw Company results through when the provider is absent", async () => {
    const llm = new CapturingLlm();
    const raw = [unsupportedCompanyResult(), companyResult()];
    const ports: ReviewProjectPorts = createPorts(llm, async () => raw);

    await reviewProject({ projectPath: "/project" }, ports);

    expect(llm.input?.companyResults).toEqual(raw);
  });
});
