import { describe, expect, it } from "vitest";

import type { DrawingIndexRecord } from "../src/drawingIndex/types.js";
import {
  createDrawingPageMapIndex,
  createDrawingPageTextFixture,
  type DrawingPageFixtureTextPage,
} from "./helpers/drawingPageMapFixture.js";

type DrawingPageMapping = {
  drawingNo: string;
  drawingPage: number;
  detectedTitle: string | null;
  confidence: number;
  matchMethod: "title-block-coordinate";
  rawText?: string;
};

type DrawingPageParseResult = {
  page: number;
  mapping: DrawingPageMapping | null;
  warnings: string[];
};

type ParseDrawingPage = (
  page: DrawingPageFixtureTextPage,
  drawings: readonly DrawingIndexRecord[],
) => DrawingPageParseResult;

const parserModulePath = "../src/drawingPageMap/parseDrawingPage.js";

async function loadParser(): Promise<ParseDrawingPage> {
  const module = (await import(parserModulePath)) as { parseDrawingPage: ParseDrawingPage };
  return module.parseDrawingPage;
}

function indexedDrawings(): DrawingIndexRecord[] {
  return createDrawingPageMapIndex().drawings;
}

describe("drawing page title-block parser", () => {
  it.each([
    ["E-401", "1단지 101동 지하2층 전력간선설비 평면도"],
    ["E-154A", "1단지 MCC 결선도-19"],
    ["MA-010", "기계 장비일람표-1"],
    ["MF-020", "소방기계 장비일람표"],
  ])("maps canonical drawing number %s from the title block", async (drawingNo, title) => {
    const parseDrawingPage = await loadParser();
    const result = parseDrawingPage(
      createDrawingPageTextFixture({ drawingNo, title }),
      indexedDrawings(),
    );

    expect(result.mapping).toMatchObject({
      drawingNo,
      drawingPage: 2,
      matchMethod: "title-block-coordinate",
    });
    expect(result.mapping?.confidence).toBeGreaterThanOrEqual(0.8);
    expect(result.mapping?.confidence).toBeLessThanOrEqual(1);
  });

  it("reassembles a split prefix and number without using content-stream order", async () => {
    const parseDrawingPage = await loadParser();
    const page = createDrawingPageTextFixture({
      drawingNo: "E-401",
      splitNumber: true,
      streamOrder: "number-last",
    });

    expect(parseDrawingPage(page, indexedDrawings()).mapping?.drawingNo).toBe("E-401");
  });

  it("normalizes NFKC, NUL, and whitespace before matching", async () => {
    const parseDrawingPage = await loadParser();
    const page = createDrawingPageTextFixture({
      drawingNo: "E-401",
      fullWidthNumber: true,
      includeNul: true,
      title: "  1단지  101동\u0000 지하2층 전력간선설비 평면도  ",
    });
    const result = parseDrawingPage(page, indexedDrawings());

    expect(result.mapping).toMatchObject({
      drawingNo: "E-401",
      detectedTitle: "1단지 101동 지하2층 전력간선설비 평면도",
    });
  });

  it.each(["number-first", "number-last", "shuffled"] as const)(
    "returns the same mapping for %s stream order",
    async (streamOrder) => {
      const parseDrawingPage = await loadParser();
      const result = parseDrawingPage(
        createDrawingPageTextFixture({ drawingNo: "E-401", streamOrder }),
        indexedDrawings(),
      );

      expect(result.mapping).toMatchObject({ drawingNo: "E-401", drawingPage: 2 });
    },
  );

  it("extracts and normalizes the title-block title", async () => {
    const parseDrawingPage = await loadParser();
    const result = parseDrawingPage(
      createDrawingPageTextFixture({
        drawingNo: "E-401",
        title: "1단지 101동 지하2층 전력간선설비 평면도",
      }),
      indexedDrawings(),
    );

    expect(result.mapping?.detectedTitle).toBe("1단지 101동 지하2층 전력간선설비 평면도");
  });

  it("keeps an exact drawing-number mapping when the title is absent", async () => {
    const parseDrawingPage = await loadParser();
    const result = parseDrawingPage(
      createDrawingPageTextFixture({ drawingNo: "E-154A", title: null }),
      indexedDrawings(),
    );

    expect(result.mapping).toMatchObject({ drawingNo: "E-154A", detectedTitle: null });
    expect(result.mapping?.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("keeps an exact drawing-number mapping but warns and lowers confidence on title mismatch", async () => {
    const parseDrawingPage = await loadParser();
    const matching = parseDrawingPage(
      createDrawingPageTextFixture({ drawingNo: "MA-010", title: "기계 장비일람표-1" }),
      indexedDrawings(),
    );
    const mismatch = parseDrawingPage(
      createDrawingPageTextFixture({ drawingNo: "MA-010", title: "전혀 다른 도면 제목" }),
      indexedDrawings(),
    );

    expect(mismatch.mapping?.drawingNo).toBe("MA-010");
    expect(mismatch.mapping!.confidence).toBeLessThan(matching.mapping!.confidence);
    expect(mismatch.warnings.join("\n")).toMatch(/page 2.*MA-010.*title|title.*MA-010/i);
  });

  it("prefers the title-block number over an indexed body reference", async () => {
    const parseDrawingPage = await loadParser();
    const result = parseDrawingPage(
      createDrawingPageTextFixture({ drawingNo: "E-401", bodyDrawingNos: ["E-500"] }),
      indexedDrawings(),
    );

    expect(result.mapping?.drawingNo).toBe("E-401");
  });

  it("does not map a body-only drawing-number reference", async () => {
    const parseDrawingPage = await loadParser();
    const page = createDrawingPageTextFixture({ drawingNo: "E-401" });
    page.items = page.items.filter((item) => item.transform[4] > page.width * 0.3);
    const result = parseDrawingPage(page, indexedDrawings());

    expect(result.mapping).toBeNull();
  });

  it("does not map a title-block number absent from the Task 40 index", async () => {
    const parseDrawingPage = await loadParser();
    const result = parseDrawingPage(
      createDrawingPageTextFixture({ drawingNo: "E-999" }),
      indexedDrawings(),
    );

    expect(result.mapping).toBeNull();
    expect(result.warnings.join("\n")).toMatch(/page 2.*E-999.*index|index.*E-999/i);
  });

  it("returns no mapping and no per-page noise for a page with no candidate", async () => {
    const parseDrawingPage = await loadParser();
    const result = parseDrawingPage(
      { page: 9, width: 595, height: 842, rotation: 0, items: [] },
      indexedDrawings(),
    );

    expect(result).toEqual({ page: 9, mapping: null, warnings: [] });
  });

  it("selects a clear winner when only one title-block candidate agrees with the title", async () => {
    const parseDrawingPage = await loadParser();
    const result = parseDrawingPage(
      createDrawingPageTextFixture({
        drawingNo: "E-401",
        title: "1단지 101동 지하2층 전력간선설비 평면도",
        secondaryDrawingNo: "E-500",
        secondaryTitle: null,
      }),
      indexedDrawings(),
    );

    expect(result.mapping?.drawingNo).toBe("E-401");
  });

  it("excludes ambiguous same-page indexed candidates instead of guessing", async () => {
    const parseDrawingPage = await loadParser();
    const result = parseDrawingPage(
      createDrawingPageTextFixture({
        drawingNo: "E-500",
        title: null,
        secondaryDrawingNo: "E-501",
        secondaryTitle: null,
      }),
      indexedDrawings(),
    );

    expect(result.mapping).toBeNull();
    expect(result.warnings.join("\n")).toMatch(/page 2.*ambiguous|ambiguous.*page 2/i);
  });

  it("normalizes coordinates for a larger page size", async () => {
    const parseDrawingPage = await loadParser();
    const result = parseDrawingPage(
      createDrawingPageTextFixture({ width: 1190, height: 1684, drawingNo: "E-401" }),
      indexedDrawings(),
    );

    expect(result.mapping?.drawingNo).toBe("E-401");
  });

  it("accounts for a page with 90-degree rotation", async () => {
    const parseDrawingPage = await loadParser();
    const result = parseDrawingPage(
      createDrawingPageTextFixture({
        width: 842,
        height: 595,
        rotation: 90,
        drawingNo: "MF-020",
        title: "소방기계 장비일람표",
      }),
      indexedDrawings(),
    );

    expect(result.mapping?.drawingNo).toBe("MF-020");
  });

  it("does not mutate page items or indexed drawings", async () => {
    const parseDrawingPage = await loadParser();
    const page = createDrawingPageTextFixture({ drawingNo: "E-401" });
    const drawings = indexedDrawings();
    const beforePage = structuredClone(page);
    const beforeDrawings = structuredClone(drawings);

    parseDrawingPage(page, drawings);

    expect(page).toEqual(beforePage);
    expect(drawings).toEqual(beforeDrawings);
  });
});
