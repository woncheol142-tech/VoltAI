import {
  buildMarkdownReport,
  createReviewReport,
  type ReviewPromptInput,
} from "@voltai/agent-review";
import {
  kecSearchResultToKnowledgeSearchResult,
  knowledgeSearchResultToKecSearchResult,
  type KecSearchResult,
} from "@voltai/mcp-kec";
import { describe, expect, it } from "vitest";

function createInput(result: KecSearchResult): ReviewPromptInput {
  return {
    projectPath: "/project",
    files: [
      {
        name: "spec.pdf",
        relativePath: "docs/spec.pdf",
        extension: ".pdf",
        size: 100,
        modifiedAt: "2026-07-11T00:00:00.000Z",
      },
    ],
    pdfs: [
      {
        relativePath: "docs/spec.pdf",
        pageCount: 1,
        text: "Cable sizing requirement.",
        pages: [{ page: 1, text: "Cable sizing requirement." }],
        truncated: false,
      },
    ],
    excels: [],
    kecResults: [result],
    itemReviews: [
      {
        name: "Cable",
        evidence: [
          {
            id: "pdf:docs/spec.pdf:p1:1",
            sourceType: "pdf",
            sourcePath: "docs/spec.pdf",
            page: 1,
            excerpt: "Cable sizing requirement.",
          },
        ],
        kecResults: [result],
        findings: [],
      },
    ],
    findings: [],
  };
}

describe("generic knowledge compatibility boundaries", () => {
  it("keeps search_kec JSON, ReviewReport, and Markdown byte-identical after round-trip", () => {
    const result: KecSearchResult = {
      clause: "KEC 232.5",
      page: 3,
      text: "Cable sizing requirement.",
      similarity: 0.92,
      sourcePath: "knowledge/kec.pdf",
    };
    const roundTrip = knowledgeSearchResultToKecSearchResult(
      kecSearchResultToKnowledgeSearchResult(result),
    );
    const beforeInput = createInput(result);
    const afterInput = createInput(roundTrip);

    expect(JSON.stringify({ results: [roundTrip] })).toBe(
      JSON.stringify({ results: [result] }),
    );
    expect(createReviewReport(afterInput)).toEqual(createReviewReport(beforeInput));
    expect(buildMarkdownReport(afterInput)).toBe(buildMarkdownReport(beforeInput));
  });

  it("connects Document-shaped provenance through chunk, embedding, search, citation, and KEC output", async () => {
    const {
      kecCitationToKnowledgeCitation,
      knowledgeCitationToKecCitation,
      toKecCitation,
    } = await import("@voltai/agent-review");
    const result: KecSearchResult = {
      clause: "KEC 232.5",
      page: 3,
      text: "Cable sizing requirement.",
      similarity: 0.92,
      sourcePath: "knowledge/kec.pdf",
    };
    const knowledgeResult = kecSearchResultToKnowledgeSearchResult(result);
    const kecResult = knowledgeSearchResultToKecSearchResult(knowledgeResult);
    const kecCitation = toKecCitation(kecResult);
    const knowledgeCitation = kecCitationToKnowledgeCitation(kecCitation);

    expect(knowledgeResult).toMatchObject({
      documentId: "kec:knowledge/kec.pdf",
      locator: { kind: "page", page: 3 },
      metadata: { clause: "KEC 232.5" },
    });
    expect(knowledgeCitationToKecCitation(knowledgeCitation)).toEqual(kecCitation);
  });
});
