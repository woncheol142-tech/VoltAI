import { describe, expect, it, vi } from "vitest";

import {
  reviewProject,
  type KecSearchResult,
  type ReviewLlm,
  type ReviewProjectPorts,
  type ReviewPromptInput,
} from "../src/index.js";
import { searchKec, type EmbeddingProvider, type VectorStore } from "@voltai/mcp-kec";

function rawResults(): KecSearchResult[] {
  return [
    {
      clause: "KEC 999.1",
      page: 1,
      text: "Unrelated auxiliary compliance record.",
      similarity: 0.95,
      sourcePath: "knowledge/distractor.pdf",
    },
    {
      clause: "KEC 232.5",
      page: 1,
      text: "Cable grounding and breaker requirement.",
      similarity: 0.4,
      sourcePath: "knowledge/kec-source.pdf",
    },
  ];
}

class CapturingReviewLlm implements ReviewLlm {
  input: ReviewPromptInput | undefined;

  async generateReview(input: ReviewPromptInput): Promise<string> {
    this.input = input;

    return "# review";
  }
}

function createPorts(llm: CapturingReviewLlm): ReviewProjectPorts {
  return {
    listProjectFiles: vi.fn().mockResolvedValue([
      {
        name: "spec.pdf",
        relativePath: "docs/spec.pdf",
        extension: ".pdf",
        size: 1,
        modifiedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        name: "schedule.xlsx",
        relativePath: "estimates/schedule.xlsx",
        extension: ".xlsx",
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
    readExcel: vi
      .fn()
      .mockResolvedValueOnce({
        relativePath: "estimates/schedule.xlsx",
        sheets: ["Summary"],
      })
      .mockResolvedValueOnce({
        relativePath: "estimates/schedule.xlsx",
        sheets: ["Summary"],
        sheetName: "Summary",
        rows: [["Item", "Description"], ["MCCB", "Main breaker load"]],
        totalRows: 2,
      }),
    searchKec: vi.fn().mockResolvedValue(rawResults()),
    llm,
  };
}

async function runReview(): Promise<ReviewPromptInput> {
  const llm = new CapturingReviewLlm();

  await reviewProject({ projectPath: "/project" }, createPorts(llm));

  if (!llm.input) {
    throw new Error("Review LLM did not receive an input");
  }

  return llm.input;
}

describe("reviewProject KEC citation selection", () => {
  it("keeps raw searchKec topK behavior unchanged", async () => {
    const embeddingProvider: EmbeddingProvider = {
      getMetadata: () => ({ provider: "test", model: "model" }),
      embed: async () => [1],
    };
    const raw = rawResults();
    const vectorStore = {
      getIndexMetadata: vi.fn().mockResolvedValue({
        embeddingProvider: "test",
        embeddingModel: "model",
        dimensions: 1,
        indexedAt: "2026-01-01T00:00:00.000Z",
      }),
      search: vi.fn().mockResolvedValue(raw),
    } as unknown as VectorStore;

    const results = await searchKec(
      { question: "Cable requirement", topK: 2 },
      { embeddingProvider, vectorStore },
    );

    expect(results).toEqual(raw);
    expect(vectorStore.search).toHaveBeenCalledWith("kec", [1], 2);
  });

  it("filters project-level citations before they reach the Review LLM", async () => {
    const input = await runReview();

    expect(input.kecResults.map((result) => result.clause)).toEqual(["KEC 232.5"]);
  });

  it("filters item-level citations before they reach the Review LLM", async () => {
    const input = await runReview();

    expect(input.itemReviews).not.toHaveLength(0);
    expect(
      input.itemReviews.every((item) =>
        item.kecResults.every((result) => result.clause !== "KEC 999.1"),
      ),
    ).toBe(true);
  });

  it("uses item evidence excerpts to retain a lower-scoring related result", async () => {
    const input = await runReview();
    const cable = input.itemReviews.find((item) => item.name === "케이블");

    expect(cable?.kecResults).toEqual([
      expect.objectContaining({ clause: "KEC 232.5", similarity: 0.4 }),
    ]);
  });
});
