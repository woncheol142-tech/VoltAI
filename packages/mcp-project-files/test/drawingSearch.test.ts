import { describe, expect, it, vi } from "vitest";

import type { DrawingIndexDocument } from "../src/drawingIndex/types.js";
import { createDrawingSearchDocument } from "./helpers/drawingSearchFixture.js";

type DrawingSearchFilters = {
  category?: string;
  complex?: string;
  building?: string;
  floor?: string;
  drawingNo?: string;
};

type DrawingSearchOptions = {
  query: string;
  limit?: number;
  filters?: DrawingSearchFilters;
};

type DrawingSearchResult = {
  query: string;
  normalizedQuery: string;
  resultCount: number;
  totalCandidates: number;
  results: Array<{
    drawingNo: string;
    title: string;
    category: string;
    complex: string | null;
    building: string | null;
    floor: string | null;
    scaleA1: string | null;
    scaleA3: string | null;
    sourceListPage: number;
    confidence: number;
    score: number;
    matchedFields: string[];
    matchReasons: string[];
  }>;
  warnings: string[];
};

type SearchDrawingIndex = (
  document: DrawingIndexDocument,
  options: DrawingSearchOptions,
) => DrawingSearchResult;

const searchModulePath = "../src/drawingSearch/searchDrawingIndex.js";

async function loadSearch(): Promise<SearchDrawingIndex> {
  const module = (await import(searchModulePath)) as { searchDrawingIndex: SearchDrawingIndex };
  return module.searchDrawingIndex;
}

async function search(
  options: DrawingSearchOptions,
  document = createDrawingSearchDocument(),
): Promise<DrawingSearchResult> {
  return (await loadSearch())(document, options);
}

function drawingNumbers(result: DrawingSearchResult): string[] {
  return result.results.map((drawing) => drawing.drawingNo);
}

describe("drawing search exact and combined matching", () => {
  it.each(["E-401", "E401", "e 401", "e-401"])(
    "returns normalized drawing number %j as the exact top result",
    async (query) => {
      const result = await search({ query });

      expect(result.query).toBe(query);
      expect(result.normalizedQuery).toBe("E-401");
      expect(result.results[0]).toMatchObject({ drawingNo: "E-401", score: 1 });
      expect(result.results[0].matchedFields).toContain("drawingNo");
      expect(result.results[0].matchReasons).toContain(
        "drawing number exact match: E-401",
      );
    },
  );

  it("ranks an exact title above a title substring", async () => {
    const result = await search({ query: "분전함 시험도" });

    expect(drawingNumbers(result).slice(0, 2)).toEqual(["E-159", "E-160"]);
    expect(result.results[0].score).toBeGreaterThan(result.results[1].score);
  });

  it.each([
    ["전력간선", "E-401"],
    ["1단지", "E-401"],
    ["101동", "E-401"],
    ["지하2층", "E-401"],
  ])("matches field query %j", async (query, expectedDrawingNo) => {
    const result = await search({ query });

    expect(drawingNumbers(result)).toContain(expectedDrawingNo);
  });

  it.each([
    ["1단지 101동 전력간선", ["E-400", "E-401", "E-402"]],
    ["101동 지하2층", ["E-401"]],
    ["2단지 피뢰", ["E-501", "E-502"]],
    ["분전반 결선도", ["E-158"]],
    ["수변전 단선결선도", ["E-111", "E-112"]],
    ["옥탑층 전등", ["E-410"]],
    ["129㎡ 단위세대 전열", ["E-237"]],
  ] as const)("matches every semantic unit in %j", async (query, expected) => {
    const result = await search({ query, limit: 100 });

    expect(drawingNumbers(result)).toEqual(expect.arrayContaining([...expected]));
    expect(result.results.every((drawing) => drawing.score > 0)).toBe(true);
  });

  it("uses structural metadata instead of title substring for an exact floor", async () => {
    const result = await search({ query: "1단지 101동 1층", limit: 100 });

    expect(drawingNumbers(result)).toContain("E-402");
    expect(drawingNumbers(result)).not.toContain("E-400");
    expect(drawingNumbers(result)).not.toContain("E-401");
  });

  it("allows generalized 지하층 only for basement floor metadata", async () => {
    const result = await search({ query: "101동 지하층 전력간선", limit: 100 });

    expect(drawingNumbers(result)).toEqual(expect.arrayContaining(["E-400", "E-401"]));
    expect(drawingNumbers(result)).not.toContain("E-402");
    expect(result.results[0].matchReasons.join("\n")).toMatch(
      /floor generalized match: 지하층 → 지하[12]층/,
    );
  });

  it("ranks complete metadata matches above title-only structural text", async () => {
    const result = await search({ query: "1단지 101동 전력간선", limit: 100 });
    const metadataMatch = result.results.findIndex((drawing) => drawing.drawingNo === "E-401");
    const titleOnly = result.results.findIndex((drawing) => drawing.drawingNo === "E-399");

    expect(metadataMatch).toBeGreaterThanOrEqual(0);
    expect(titleOnly).toBeGreaterThan(metadataMatch);
    expect(result.results[metadataMatch].score).toBeGreaterThan(result.results[titleOnly].score);
  });
});

describe("drawing search synonyms", () => {
  it.each([
    ["101동 간선", "E-401"],
    ["분전함 결선도", "E-158"],
    ["수전 단선결선도", "E-111"],
    ["결선", "E-158"],
    ["결선도", "E-158"],
    ["피뢰접지", "E-502"],
  ])("supports query-side synonym %j", async (query, expectedDrawingNo) => {
    const result = await search({ query, limit: 100 });

    expect(drawingNumbers(result)).toContain(expectedDrawingNo);
  });

  it("matches both 옥탑층 and 옥탑지붕층 for 옥탑", async () => {
    const result = await search({ query: "옥탑 전등", limit: 100 });

    expect(drawingNumbers(result)).toEqual(expect.arrayContaining(["E-410", "E-411"]));
  });

  it("ranks a direct term above its synonym alternative", async () => {
    const result = await search({ query: "분전함", limit: 100 });

    expect(result.results[0].drawingNo).toBe("E-159");
    expect(result.results.find((drawing) => drawing.drawingNo === "E-158")?.score).toBeLessThan(
      result.results[0].score,
    );
  });

  it("reports synonym use without mutating the original query", async () => {
    const result = await search({ query: "101동 간선", limit: 100 });
    const drawing = result.results.find((candidate) => candidate.drawingNo === "E-401");

    expect(drawing?.matchReasons).toContain(
      "category synonym match: 간선 → 전력간선",
    );
  });
});

describe("drawing search ranking and diagnostics", () => {
  it("does not allow extraction confidence to displace an exact drawing number", async () => {
    const result = await search({ query: "E-401", limit: 100 });

    expect(result.results[0]).toMatchObject({ drawingNo: "E-401", confidence: 0.76, score: 1 });
  });

  it("uses confidence only after relevance tie-breaks", async () => {
    const document = createDrawingSearchDocument();
    const first = document.drawings.find((drawing) => drawing.drawingNo === "E-699")!;
    const second = document.drawings.find((drawing) => drawing.drawingNo === "E-700")!;
    first.confidence = 0.8;
    second.confidence = 1;

    const result = await search({ query: "2단지 옥외 전등", limit: 100 }, document);

    expect(drawingNumbers(result).slice(0, 2)).toEqual(["E-700", "E-699"]);
  });

  it("uses natural drawing-number order for otherwise tied records", async () => {
    const document = createDrawingSearchDocument();
    const tied = document.drawings.filter((drawing) => ["E-699", "E-700"].includes(drawing.drawingNo));
    for (const drawing of tied) {
      drawing.confidence = 1;
      drawing.building = null;
      drawing.title = "2단지 옥외 전등설비 평면도";
    }

    const result = await search({ query: "2단지 옥외 전등", limit: 100 }, document);

    expect(drawingNumbers(result).slice(0, 2)).toEqual(["E-699", "E-700"]);
  });

  it("does not depend on index record order", async () => {
    const document = createDrawingSearchDocument();
    const reversed = { ...document, drawings: [...document.drawings].reverse() };
    const searchDrawingIndex = await loadSearch();

    expect(searchDrawingIndex(reversed, { query: "전등", limit: 100 })).toEqual(
      searchDrawingIndex(document, { query: "전등", limit: 100 }),
    );
  });

  it("does not use localeCompare for deterministic tie-breaks", async () => {
    const searchDrawingIndex = await loadSearch();
    const localeCompare = vi
      .spyOn(String.prototype, "localeCompare")
      .mockImplementation(() => {
        throw new Error("locale-dependent comparison was used");
      });

    let result: DrawingSearchResult;
    try {
      result = searchDrawingIndex(createDrawingSearchDocument(), {
        query: "전등",
        limit: 100,
      });
    } finally {
      localeCompare.mockRestore();
    }

    expect(result.results.length).toBeGreaterThan(1);
  });

  it("returns bounded scores rounded to at most four decimal places", async () => {
    const result = await search({ query: "1단지 101동 전력간선", limit: 100 });

    for (const drawing of result.results) {
      expect(drawing.score).toBeGreaterThanOrEqual(0);
      expect(drawing.score).toBeLessThanOrEqual(1);
      expect(Number((drawing.score * 10_000).toFixed(8))).toBe(
        Math.round(drawing.score * 10_000),
      );
    }
  });

  it("deduplicates and deterministically orders matched fields and reasons", async () => {
    const result = await search({ query: "1단지 101동 전력간선", limit: 100 });
    const drawing = result.results.find((candidate) => candidate.drawingNo === "E-401")!;
    const fieldOrder = ["drawingNo", "title", "category", "complex", "building", "floor"];

    expect(new Set(drawing.matchedFields).size).toBe(drawing.matchedFields.length);
    expect(drawing.matchedFields).toEqual(
      [...drawing.matchedFields].sort(
        (left, right) => fieldOrder.indexOf(left) - fieldOrder.indexOf(right),
      ),
    );
    expect(new Set(drawing.matchReasons).size).toBe(drawing.matchReasons.length);
    expect(drawing.matchReasons).toContain("complex exact match: 1단지");
    expect(drawing.matchReasons).toContain("building exact match: 101동");
  });
});

describe("drawing search filters, limits, and safety", () => {
  it.each([
    [{ category: "피뢰" }, ["E-501", "E-502"]],
    [{ complex: "2 단지" }, ["E-501", "E-502"]],
    [{ building: "201 동" }, ["E-501", "E-502"]],
    [{ floor: "1 층" }, ["E-501"]],
    [{ drawingNo: "e 502" }, ["E-502"]],
  ] as const)("applies normalized hard filter %#", async (filters, expected) => {
    const result = await search({ query: "피뢰", filters, limit: 100 });

    expect(drawingNumbers(result)).toEqual([...expected]);
  });

  it("requires both query and filters to match", async () => {
    const result = await search({
      query: "피뢰 접지",
      filters: { complex: "2단지", floor: "2층" },
    });

    expect(drawingNumbers(result)).toEqual(["E-502"]);
  });

  it("does not match null metadata against a non-null filter", async () => {
    const result = await search({ query: "분전반", filters: { building: "101동" } });

    expect(result.results).toEqual([]);
  });

  it("rejects an invalid category filter", async () => {
    await expect(search({ query: "전등", filters: { category: "invalid" } })).rejects.toThrow(
      /category/i,
    );
  });

  it.each([0, -1, 101, 1.5])("rejects invalid limit %s", async (limit) => {
    await expect(search({ query: "전등", limit })).rejects.toThrow(/limit/i);
  });

  it("uses default limit 20 and reports truncation deterministically", async () => {
    const result = await search({ query: "전등" });

    expect(result.resultCount).toBe(20);
    expect(result.results).toHaveLength(20);
    expect(result.totalCandidates).toBe(29);
    expect(result.warnings).toEqual([
      "drawing index contains 2 indexing warnings",
      "results truncated: showing 20 of 29 matches",
    ]);
  });

  it("returns a normal zero-result response without OR fallback or typo correction", async () => {
    const result = await search({ query: "전력간산" });

    expect(result).toMatchObject({ resultCount: 0, totalCandidates: 0, results: [] });
    expect(result.warnings).toEqual([
      "drawing index contains 2 indexing warnings",
      "lexical search did not find a match",
    ]);
  });

  it.each(["존재하지 않는 E-9999", "E-9999"])(
    "does not broaden zero-result drawing query %j",
    async (query) => {
      const result = await search({ query });

      expect(result.results).toEqual([]);
      expect(result.totalCandidates).toBe(0);
    },
  );

  it("does not mutate the source document, records, options, or record order", async () => {
    const document = createDrawingSearchDocument();
    const options: DrawingSearchOptions = {
      query: "1단지 101동 전력간선",
      filters: { category: "전력간선" },
      limit: 10,
    };
    const documentSnapshot = structuredClone(document);
    const optionsSnapshot = structuredClone(options);

    await search(options, document);

    expect(document).toEqual(documentSnapshot);
    expect(options).toEqual(optionsSnapshot);
  });

  it("keeps the 10,000-record search core synchronous without a wall-clock assertion", async () => {
    const searchDrawingIndex = await loadSearch();
    const template = createDrawingSearchDocument().drawings[0];
    const drawings = Array.from({ length: 10_000 }, (_, index) => ({
      ...template,
      drawingNo: `X-${String(index).padStart(4, "0")}`,
      title: `대규모 전등설비 평면도 ${index}`,
      category: "전등" as const,
      confidence: 1,
    }));
    const document = createDrawingSearchDocument({ drawings, drawingCount: drawings.length });

    const result = searchDrawingIndex(document, { query: "전등" });

    expect(result).not.toBeInstanceOf(Promise);
    expect(result.resultCount).toBe(20);
    expect(result.totalCandidates).toBe(10_000);
  });
});
