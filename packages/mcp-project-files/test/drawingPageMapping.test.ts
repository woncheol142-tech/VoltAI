import { describe, expect, it } from "vitest";

import type { DrawingIndexDocument } from "../src/drawingIndex/types.js";
import {
  createDrawingPageMapIndex,
  type DrawingPageMapFixtureDocument,
} from "./helpers/drawingPageMapFixture.js";

type Mapping = DrawingPageMapFixtureDocument["mappings"][number];
type PageScanResult =
  | { page: number; status: "processed"; mapping: Mapping | null; warnings: string[] }
  | { page: number; status: "failed"; message: string };

type BuildDrawingPageMap = (input: {
  index: DrawingIndexDocument;
  indexPath: string;
  source: string;
  sourceSha256: string;
  startPage: number;
  endPage: number;
  pageResults: readonly PageScanResult[];
}) => DrawingPageMapFixtureDocument;

const mappingModulePath = "../src/drawingPageMap/buildDrawingPageMap.js";

async function loadBuilder(): Promise<BuildDrawingPageMap> {
  const module = (await import(mappingModulePath)) as {
    buildDrawingPageMap: BuildDrawingPageMap;
  };
  return module.buildDrawingPageMap;
}

function mapping(drawingNo: string, drawingPage: number, confidence = 0.95): Mapping {
  return {
    drawingNo,
    drawingPage,
    detectedTitle: null,
    confidence,
    matchMethod: "title-block-coordinate",
  };
}

function processed(page: number, pageMapping: Mapping | null, warnings: string[] = []): PageScanResult {
  return { page, status: "processed", mapping: pageMapping, warnings };
}

function input(
  index: DrawingIndexDocument,
  pageResults: PageScanResult[],
  startPage = 2,
  endPage = 4,
) {
  return {
    index,
    indexPath: ".volt-ai/indexes/drawing-index.json",
    source: index.source,
    sourceSha256: index.sourceSha256,
    startPage,
    endPage,
    pageResults,
  };
}

describe("drawing page-map aggregation and coverage", () => {
  it("builds deterministic one-to-one mappings without confusing sourceListPage", async () => {
    const buildDrawingPageMap = await loadBuilder();
    const index = createDrawingPageMapIndex();
    const result = buildDrawingPageMap(
      input(index, [processed(2, mapping("E-401", 2)), processed(3, mapping("E-154A", 3)), processed(4, null)]),
    );

    expect(result.mappings.map(({ drawingNo, drawingPage }) => ({ drawingNo, drawingPage }))).toEqual([
      { drawingNo: "E-401", drawingPage: 2 },
      { drawingNo: "E-154A", drawingPage: 3 },
    ]);
    expect(result.mappings[0]?.drawingPage).not.toBe(index.drawings[0]?.sourceListPage);
  });

  it("preserves every page for a duplicated drawing number", async () => {
    const buildDrawingPageMap = await loadBuilder();
    const index = createDrawingPageMapIndex();
    const result = buildDrawingPageMap(
      input(index, [processed(2, mapping("E-401", 2)), processed(3, mapping("E-401", 3)), processed(4, null)]),
    );

    expect(result.mappings.filter(({ drawingNo }) => drawingNo === "E-401")).toHaveLength(2);
    expect(result.duplicatePageMatches).toEqual([{ drawingNo: "E-401", pages: [2, 3] }]);
    expect(result.warnings.join("\n")).toMatch(/E-401.*2.*3|duplicate.*E-401/i);
  });

  it("removes a duplicated mapped number from unmatched only once", async () => {
    const buildDrawingPageMap = await loadBuilder();
    const index = createDrawingPageMapIndex();
    const result = buildDrawingPageMap(
      input(index, [processed(2, mapping("E-401", 2)), processed(3, mapping("E-401", 3)), processed(4, null)]),
    );

    expect(result.unmatchedDrawingNumbers).not.toContain("E-401");
    expect(new Set(result.unmatchedDrawingNumbers).size).toBe(result.unmatchedDrawingNumbers.length);
  });

  it("sorts unmatched drawing numbers naturally without localeCompare behavior", async () => {
    const buildDrawingPageMap = await loadBuilder();
    const source = createDrawingPageMapIndex();
    const drawings = [
      { ...source.drawings[0]!, drawingNo: "E-10" },
      { ...source.drawings[0]!, drawingNo: "MA-010" },
      { ...source.drawings[0]!, drawingNo: "E-2" },
      { ...source.drawings[0]!, drawingNo: "E-154A" },
    ];
    const index = createDrawingPageMapIndex({ drawings, drawingCount: drawings.length });
    const result = buildDrawingPageMap(input(index, [processed(2, null)], 2, 2));

    expect(result.unmatchedDrawingNumbers).toEqual(["E-2", "E-10", "E-154A", "MA-010"]);
  });

  it("computes count and coverage fields from the contract", async () => {
    const buildDrawingPageMap = await loadBuilder();
    const index = createDrawingPageMapIndex();
    const result = buildDrawingPageMap(
      input(index, [processed(2, mapping("E-401", 2)), processed(3, mapping("E-154A", 3)), processed(4, null)]),
    );

    expect(result).toMatchObject({
      scannedPageCount: 3,
      indexedDrawingCount: 6,
      mappingCount: 2,
      unmatchedCount: 4,
      coverageRatio: 0.333333,
    });
    expect(result.coverageRatio).toBeGreaterThanOrEqual(0);
    expect(result.coverageRatio).toBeLessThanOrEqual(1);
  });

  it("uses mappings.length for coverage even when a drawing has duplicate pages", async () => {
    const buildDrawingPageMap = await loadBuilder();
    const index = createDrawingPageMapIndex();
    const result = buildDrawingPageMap(
      input(index, [processed(2, mapping("E-401", 2)), processed(3, mapping("E-401", 3)), processed(4, null)]),
    );

    expect(result.mappingCount).toBe(2);
    expect(result.coverageRatio).toBe(0.333333);
  });

  it("returns a successful deterministic zero-map result after successful scans", async () => {
    const buildDrawingPageMap = await loadBuilder();
    const index = createDrawingPageMapIndex();
    const result = buildDrawingPageMap(
      input(index, [processed(2, null), processed(3, null), processed(4, null)]),
    );

    expect(result).toMatchObject({ mappingCount: 0, coverageRatio: 0, mappings: [] });
    expect(result.unmatchedCount).toBe(index.drawings.length);
    expect(result.warnings.join("\n")).toMatch(/no drawing page mapping|zero|0 mapping/i);
  });

  it("continues after a partial page extraction failure with provenance", async () => {
    const buildDrawingPageMap = await loadBuilder();
    const index = createDrawingPageMapIndex();
    const result = buildDrawingPageMap(
      input(index, [
        processed(2, mapping("E-401", 2)),
        { page: 3, status: "failed", message: "text extraction failed" },
        processed(4, mapping("MA-010", 4)),
      ]),
    );

    expect(result.mappings.map(({ drawingNo }) => drawingNo)).toEqual(["E-401", "MA-010"]);
    expect(result.warnings.join("\n")).toMatch(/page 3.*text extraction failed/i);
  });

  it("throws when every page extraction failed", async () => {
    const buildDrawingPageMap = await loadBuilder();
    const index = createDrawingPageMapIndex();

    expect(() =>
      buildDrawingPageMap(
        input(index, [
          { page: 2, status: "failed", message: "broken page" },
          { page: 3, status: "failed", message: "broken page" },
          { page: 4, status: "failed", message: "broken page" },
        ]),
      ),
    ).toThrow(/all.*page|every.*page|no page.*processed/i);
  });

  it("throws for an empty Task 40 drawing index", async () => {
    const buildDrawingPageMap = await loadBuilder();
    const index = createDrawingPageMapIndex({ drawings: [], drawingCount: 0 });

    expect(() => buildDrawingPageMap(input(index, [processed(2, null)], 2, 2))).toThrow(
      /index.*drawing|empty index/i,
    );
  });

  it("sorts mappings, duplicate summaries, and warnings deterministically", async () => {
    const buildDrawingPageMap = await loadBuilder();
    const index = createDrawingPageMapIndex();
    const result = buildDrawingPageMap(
      input(index, [
        processed(4, mapping("MA-010", 4), ["page 4 MA-010 title mismatch"]),
        processed(2, mapping("E-401", 2), ["page 2 E-401 title mismatch"]),
        processed(3, mapping("E-401", 3)),
      ]),
    );

    expect(result.mappings.map(({ drawingPage, drawingNo }) => `${drawingPage}:${drawingNo}`)).toEqual([
      "2:E-401",
      "3:E-401",
      "4:MA-010",
    ]);
    expect(result.warnings).toEqual([...result.warnings].sort());
    expect(result.duplicatePageMatches).toEqual([{ drawingNo: "E-401", pages: [2, 3] }]);
  });

  it("is deterministic and does not mutate scan results or the index", async () => {
    const buildDrawingPageMap = await loadBuilder();
    const index = createDrawingPageMapIndex();
    const pageResults = [processed(2, mapping("E-401", 2)), processed(3, null), processed(4, null)];
    const beforeIndex = structuredClone(index);
    const beforePages = structuredClone(pageResults);

    const first = buildDrawingPageMap(input(index, pageResults));
    const second = buildDrawingPageMap(input(index, pageResults));

    expect(second).toEqual(first);
    expect(index).toEqual(beforeIndex);
    expect(pageResults).toEqual(beforePages);
  });
});
