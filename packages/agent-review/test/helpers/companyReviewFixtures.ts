import type { CompanySearchResult } from "@voltai/knowledge-company";

import type { KecSearchResult, ReviewPromptInput } from "../../src/index.js";

export function companyResult(overrides: Partial<CompanySearchResult> = {}): CompanySearchResult {
  return {
    chunkId: "company-row-1",
    sourcePath: "standards/electrical-standard.pdf",
    page: 2,
    standardId: "CS-ELEC-001",
    title: "Electrical Design Standard",
    section: "Grounding",
    text: "Cable grounding shall follow the company standard.",
    similarity: 0.9,
    ...overrides,
  };
}

export function kecResult(overrides: Partial<KecSearchResult> = {}): KecSearchResult {
  return {
    clause: "KEC 232.5",
    page: 1,
    text: "Cable grounding requirement.",
    similarity: 0.8,
    sourcePath: "knowledge/kec.pdf",
    ...overrides,
  };
}

export function reviewPromptInput(
  overrides: Partial<ReviewPromptInput> = {},
): ReviewPromptInput {
  return {
    projectPath: "/project",
    files: [
      {
        name: "spec.pdf",
        relativePath: "docs/spec.pdf",
        extension: ".pdf",
        size: 1,
        modifiedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    pdfs: [
      {
        relativePath: "docs/spec.pdf",
        pageCount: 1,
        text: "Cable grounding design evidence.",
        pages: [{ page: 1, text: "Cable grounding design evidence." }],
        truncated: false,
      },
    ],
    excels: [],
    kecResults: [kecResult()],
    itemReviews: [
      {
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
        kecResults: [kecResult()],
        findings: [],
      },
    ],
    findings: [],
    ...overrides,
  };
}
