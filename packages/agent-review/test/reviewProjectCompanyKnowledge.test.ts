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
    llm,
  };
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
});
