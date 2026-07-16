import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import { createTempPdfProject } from "./helpers/pdfFixture.js";
import {
  createDrawingSearchDocument,
  writeDrawingSearchIndex,
} from "./helpers/drawingSearchFixture.js";
import {
  createValidPageMapDocument,
  roundFixtureCoverage,
  writePageMapFixture,
  type DrawingPageMapFixtureDocument,
} from "./helpers/drawingPageMapFixture.js";

type SearchMatch = {
  drawingNo: string;
  score: number;
  matchedFields: string[];
  matchReasons: string[];
  drawingPage?: number | null;
  pageMatchConfidence?: number | null;
  pageMatchMethod?: string | null;
};

type SearchResult = {
  query: string;
  normalizedQuery: string;
  resultCount: number;
  totalCandidates: number;
  results: SearchMatch[];
  warnings: string[];
};

type SearchDrawings = (projectRoot: string | undefined, input: unknown) => Promise<SearchResult>;

const searchToolModulePath = "../src/tools/searchDrawings.js";
const roots: string[] = [];

async function loadSearchDrawings(): Promise<SearchDrawings> {
  const module = (await import(searchToolModulePath)) as { searchDrawings: SearchDrawings };
  return module.searchDrawings;
}

function tempRoot(): string {
  const root = createTempPdfProject();
  roots.push(root);
  return root;
}

function pageMapForIndex(
  mappings: DrawingPageMapFixtureDocument["mappings"],
  overrides: Partial<DrawingPageMapFixtureDocument> = {},
): DrawingPageMapFixtureDocument {
  const index = createDrawingSearchDocument();
  const endPage = Math.max(8, ...mappings.map(({ drawingPage }) => drawingPage));
  const mapped = new Set(mappings.map(({ drawingNo }) => drawingNo));
  const unmatchedDrawingNumbers = index.drawings
    .map(({ drawingNo }) => drawingNo)
    .filter((drawingNo) => !mapped.has(drawingNo));
  return createValidPageMapDocument({
    source: index.source,
    sourceSha256: index.sourceSha256,
    indexPath: ".volt-ai/indexes/drawing-index.json",
    indexSourceSha256: index.sourceSha256,
    startPage: 2,
    endPage,
    scannedPageCount: endPage - 1,
    indexedDrawingCount: index.drawings.length,
    mappings,
    mappingCount: mappings.length,
    unmatchedDrawingNumbers,
    unmatchedCount: unmatchedDrawingNumbers.length,
    coverageRatio: roundFixtureCoverage(mappings.length / index.drawings.length),
    ...overrides,
  });
}

function mapping(page = 42) {
  return {
    drawingNo: "E-401",
    drawingPage: page,
    detectedTitle: "1단지 101동 지하2층 전력간선설비 평면도",
    confidence: 0.99,
    matchMethod: "title-block-coordinate" as const,
  };
}

describe("search_drawings optional page-map integration", () => {
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("keeps the Task 41 result byte-equivalent when pageMapPath is omitted", async () => {
    const root = tempRoot();
    writeDrawingSearchIndex(root);
    const searchDrawings = await loadSearchDrawings();
    const input = {
      indexPath: ".volt-ai/indexes/drawing-index.json",
      query: "1단지 101동 지하2층 전력간선",
    };

    const first = await searchDrawings(root, input);
    const second = await searchDrawings(root, structuredClone(input));

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(second.results.every((result) => !("drawingPage" in result))).toBe(true);
  });

  it("adds page metadata to a uniquely mapped E-401 result", async () => {
    const root = tempRoot();
    writeDrawingSearchIndex(root);
    writePageMapFixture(root, pageMapForIndex([mapping()]));
    const searchDrawings = await loadSearchDrawings();

    const result = await searchDrawings(root, {
      indexPath: ".volt-ai/indexes/drawing-index.json",
      pageMapPath: ".volt-ai/page-maps/drawing-pages.json",
      query: "E401",
    });

    expect(result.results[0]).toMatchObject({
      drawingNo: "E-401",
      drawingPage: 42,
      pageMatchConfidence: 0.99,
      pageMatchMethod: "title-block-coordinate",
    });
  });

  it("returns explicit null page metadata for an unmapped search result", async () => {
    const root = tempRoot();
    writeDrawingSearchIndex(root);
    writePageMapFixture(root, pageMapForIndex([mapping()]));
    const searchDrawings = await loadSearchDrawings();

    const result = await searchDrawings(root, {
      indexPath: ".volt-ai/indexes/drawing-index.json",
      pageMapPath: ".volt-ai/page-maps/drawing-pages.json",
      query: "E501",
    });

    expect(result.results[0]).toMatchObject({
      drawingNo: "E-501",
      drawingPage: null,
      pageMatchConfidence: null,
      pageMatchMethod: null,
    });
  });

  it("does not choose an arbitrary page for a duplicate mapping", async () => {
    const root = tempRoot();
    writeDrawingSearchIndex(root);
    const document = pageMapForIndex([mapping(42), mapping(43)], {
      duplicatePageMatches: [{ drawingNo: "E-401", pages: [42, 43] }],
    });
    writePageMapFixture(root, document);
    const searchDrawings = await loadSearchDrawings();

    const result = await searchDrawings(root, {
      indexPath: ".volt-ai/indexes/drawing-index.json",
      pageMapPath: ".volt-ai/page-maps/drawing-pages.json",
      query: "E401",
    });

    expect(result.results[0]).toMatchObject({
      drawingPage: null,
      pageMatchConfidence: null,
      pageMatchMethod: null,
    });
    expect(result.warnings.join("\n")).toMatch(/E-401.*multiple|duplicate.*E-401/i);
  });

  it("rejects page-map and current index source hash mismatch", async () => {
    const root = tempRoot();
    writeDrawingSearchIndex(root);
    writePageMapFixture(root, pageMapForIndex([mapping()], { indexSourceSha256: "b".repeat(64) }));
    const searchDrawings = await loadSearchDrawings();

    await expect(
      searchDrawings(root, {
        indexPath: ".volt-ai/indexes/drawing-index.json",
        pageMapPath: ".volt-ai/page-maps/drawing-pages.json",
        query: "E401",
      }),
    ).rejects.toThrow(/hash|sha-?256.*mismatch/i);
  });

  it("rejects page-map and current indexPath mismatch", async () => {
    const root = tempRoot();
    writeDrawingSearchIndex(root);
    writePageMapFixture(
      root,
      pageMapForIndex([mapping()], { indexPath: ".volt-ai/indexes/other.json" }),
    );
    const searchDrawings = await loadSearchDrawings();

    await expect(
      searchDrawings(root, {
        indexPath: ".volt-ai/indexes/drawing-index.json",
        pageMapPath: ".volt-ai/page-maps/drawing-pages.json",
        query: "E401",
      }),
    ).rejects.toThrow(/indexPath.*mismatch|index path.*mismatch/i);
  });

  it("rejects page-map source mismatch", async () => {
    const root = tempRoot();
    writeDrawingSearchIndex(root);
    writePageMapFixture(root, pageMapForIndex([mapping()], { source: "docs/other.pdf" }));
    const searchDrawings = await loadSearchDrawings();

    await expect(
      searchDrawings(root, {
        indexPath: ".volt-ai/indexes/drawing-index.json",
        pageMapPath: ".volt-ai/page-maps/drawing-pages.json",
        query: "E401",
      }),
    ).rejects.toThrow(/source.*mismatch/i);
  });

  it("preserves ranking and Task 41 diagnostics when page metadata is added", async () => {
    const root = tempRoot();
    writeDrawingSearchIndex(root);
    writePageMapFixture(root, pageMapForIndex([mapping()]));
    const searchDrawings = await loadSearchDrawings();
    const common = {
      indexPath: ".volt-ai/indexes/drawing-index.json",
      query: "1단지 101동 전력간선",
      limit: 10,
    };

    const legacy = await searchDrawings(root, common);
    const enriched = await searchDrawings(root, {
      ...common,
      pageMapPath: ".volt-ai/page-maps/drawing-pages.json",
    });

    expect(enriched.results.map(({ drawingNo }) => drawingNo)).toEqual(
      legacy.results.map(({ drawingNo }) => drawingNo),
    );
    expect(enriched.results.map(({ score }) => score)).toEqual(legacy.results.map(({ score }) => score));
    expect(enriched.results.map(({ matchedFields }) => matchedFields)).toEqual(
      legacy.results.map(({ matchedFields }) => matchedFields),
    );
    expect(enriched.results.map(({ matchReasons }) => matchReasons)).toEqual(
      legacy.results.map(({ matchReasons }) => matchReasons),
    );
  });

  it("does not copy every stored page-map warning into search output", async () => {
    const root = tempRoot();
    writeDrawingSearchIndex(root);
    writePageMapFixture(
      root,
      pageMapForIndex([mapping()], { warnings: ["page 999 noisy extraction detail"] }),
    );
    const searchDrawings = await loadSearchDrawings();

    const result = await searchDrawings(root, {
      indexPath: ".volt-ai/indexes/drawing-index.json",
      pageMapPath: ".volt-ai/page-maps/drawing-pages.json",
      query: "E401",
    });

    expect(result.warnings).not.toContain("page 999 noisy extraction detail");
  });

  it("returns a normal zero-search result with a valid page map", async () => {
    const root = tempRoot();
    writeDrawingSearchIndex(root);
    writePageMapFixture(root, pageMapForIndex([mapping()]));
    const searchDrawings = await loadSearchDrawings();

    const result = await searchDrawings(root, {
      indexPath: ".volt-ai/indexes/drawing-index.json",
      pageMapPath: ".volt-ai/page-maps/drawing-pages.json",
      query: "E-9999",
    });

    expect(result).toMatchObject({ resultCount: 0, totalCandidates: 0, results: [] });
  });
});
