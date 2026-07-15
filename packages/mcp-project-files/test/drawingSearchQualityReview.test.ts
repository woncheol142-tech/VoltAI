import { describe, expect, it } from "vitest";

import { normalizeDrawingQuery } from "../src/drawingSearch/normalizeDrawingQuery.js";
import { searchDrawingIndex } from "../src/drawingSearch/searchDrawingIndex.js";
import { createSearchDrawingsTool } from "../src/tools/searchDrawings.js";
import {
  createDrawingSearchDocument,
  createDrawingSearchRecords,
} from "./helpers/drawingSearchFixture.js";

describe("drawing search quality review regressions", () => {
  it("describes the saved-index lexical and no-typo-correction boundary", () => {
    const description = createSearchDrawingsTool().description;

    expect(description).toMatch(/saved|schema v1/i);
    expect(description).toMatch(/deterministic lexical/i);
    expect(description).toMatch(/no typo correction/i);
  });

  it("deduplicates repeated semantic units before scoring", () => {
    expect(normalizeDrawingQuery("전등 전등")).toEqual({
      normalizedQuery: "전등",
      units: [{ canonical: "전등", alternatives: ["전등"], kind: "category" }],
    });
  });

  it("treats a Task 40 range floor as one structural unit", () => {
    const normalized = normalizeDrawingQuery("기준(3~10)층");

    expect(normalized).toEqual({
      normalizedQuery: "기준(3~10)층",
      units: [
        {
          canonical: "기준(3~10)층",
          alternatives: ["기준(3~10)층"],
          kind: "floor",
        },
      ],
    });
  });

  it("does not satisfy a 101동 unit from the suffix of 1101동", () => {
    const template = createDrawingSearchRecords()[0];
    const document = createDrawingSearchDocument({
      drawings: [
        {
          ...template,
          drawingNo: "E-901",
          title: "1101동 전등설비 평면도",
          category: "전등",
          building: null,
        },
      ],
    });

    expect(searchDrawingIndex(document, { query: "101동 전등" }).results).toEqual([]);
  });

  it("fully orders zero-padded drawing numbers independently of input order", () => {
    const template = createDrawingSearchRecords()[0];
    const drawings = [
      {
        ...template,
        drawingNo: "E-099",
        title: "동일 전등설비 평면도",
        category: "전등" as const,
        scaleA1: "1/100",
      },
      {
        ...template,
        drawingNo: "E-99",
        title: "동일 전등설비 평면도",
        category: "전등" as const,
        scaleA1: "1/50",
      },
    ];
    const forward = createDrawingSearchDocument({ drawings });
    const reverse = createDrawingSearchDocument({ drawings: [...drawings].reverse() });

    expect(searchDrawingIndex(reverse, { query: "전등" })).toEqual(
      searchDrawingIndex(forward, { query: "전등" }),
    );
  });
});
