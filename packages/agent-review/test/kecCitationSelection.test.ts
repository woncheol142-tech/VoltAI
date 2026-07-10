import { describe, expect, it } from "vitest";

import type { KecSearchResult } from "../src/ports.js";
import {
  getKecCitationSelectionDiagnostics,
  selectKecResultsForReview,
} from "../src/kecCitationSelection.js";

function result(
  overrides: Partial<KecSearchResult> = {},
): KecSearchResult {
  return {
    clause: "KEC 232.5",
    page: 1,
    text: "Cable grounding and breaker requirement.",
    similarity: 0.7,
    sourcePath: "knowledge/kec-source.pdf",
    ...overrides,
  };
}

describe("selectKecResultsForReview", () => {
  it("keeps a lexically supported citation while removing a higher-scoring distractor", () => {
    const related = result({ similarity: 0.4 });
    const distractor = result({
      clause: "KEC 999.1",
      sourcePath: "knowledge/distractor.pdf",
      text: "Unrelated auxiliary compliance record.",
      similarity: 0.95,
    });

    const selected = selectKecResultsForReview({
      contextText: "Cable route and grounding design evidence",
      results: [distractor, related],
    });

    expect(selected).toEqual([related]);
  });

  it("removes the KEC 999.1 distractor without removing KEC 232.5", () => {
    const selected = selectKecResultsForReview({
      contextText: "Cable sizing design",
      results: [
        result(),
        result({
          clause: "KEC 999.1",
          sourcePath: "knowledge/distractor.pdf",
          text: "Unrelated auxiliary compliance record.",
          similarity: 0.8,
        }),
      ],
    });

    expect(selected.map((candidate) => candidate.clause)).toEqual(["KEC 232.5"]);
  });

  it("keeps a single supported result to preserve recall", () => {
    const related = result({ similarity: 0.1 });

    expect(
      selectKecResultsForReview({
        contextText: "Cable design evidence",
        results: [related],
      }),
    ).toEqual([related]);
  });

  it("applies the relative threshold only among supported results", () => {
    const strongest = result({ similarity: 1, sourcePath: "knowledge/a.pdf" });
    const retained = result({ similarity: 0.5, sourcePath: "knowledge/b.pdf" });
    const filtered = result({ similarity: 0.49, sourcePath: "knowledge/c.pdf" });

    const selected = selectKecResultsForReview({
      contextText: "Cable requirement",
      results: [filtered, retained, strongest],
    });

    expect(selected).toEqual([strongest, retained]);
  });

  it("returns an empty selection when no lexical or clause evidence exists", () => {
    expect(
      selectKecResultsForReview({
        contextText: "Voltage drop calculation",
        results: [
          result({
            clause: "KEC 999.1",
            text: "Unrelated auxiliary compliance record.",
          }),
        ],
      }),
    ).toEqual([]);
  });

  it("returns an empty selection when all supported similarities are non-positive", () => {
    expect(
      selectKecResultsForReview({
        contextText: "Cable requirement",
        results: [result({ similarity: 0 }), result({ similarity: -0.2, page: 2 })],
      }),
    ).toEqual([]);
  });

  it("keeps supported ties in deterministic order", () => {
    const sourceB = result({ sourcePath: "knowledge/b.pdf", similarity: 0.7 });
    const sourceA = result({ sourcePath: "knowledge/a.pdf", similarity: 0.7 });

    const selected = selectKecResultsForReview({
      contextText: "Cable requirement",
      results: [sourceB, sourceA],
    });

    expect(selected).toEqual([sourceA, sourceB]);
  });

  it("uses an explicit clause query as auxiliary selection evidence", () => {
    const clauseMatch = result({ text: "Conductor sizing guidance.", similarity: 0.2 });
    const otherClause = result({
      clause: "KEC 999.1",
      sourcePath: "knowledge/distractor.pdf",
      text: "Unrelated auxiliary compliance record.",
      similarity: 0.9,
    });

    const selected = selectKecResultsForReview({
      contextText: "Check KEC 232.5",
      results: [otherClause, clauseMatch],
    });

    expect(selected).toEqual([clauseMatch]);
  });

  it("does not mutate raw search result arrays or objects", () => {
    const rawResults = [
      result(),
      result({
        clause: "KEC 999.1",
        sourcePath: "knowledge/distractor.pdf",
        text: "Unrelated auxiliary compliance record.",
      }),
    ];
    const before = structuredClone(rawResults);

    void selectKecResultsForReview({
      contextText: "Cable requirement",
      results: rawResults,
    });

    expect(rawResults).toEqual(before);
  });

  it("reports support, overlap, relative score, and clause diagnostics internally", () => {
    const diagnostics = getKecCitationSelectionDiagnostics({
      contextText: "Cable route and KEC 232.5",
      results: [result({ similarity: 0.4 })],
    });

    expect(diagnostics).toEqual([
      expect.objectContaining({
        supported: true,
        overlapCount: 1,
        relativeScore: 1,
        clauseMatched: true,
      }),
    ]);
  });
});
