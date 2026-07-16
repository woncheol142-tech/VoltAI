import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { DrawingIndexDocument } from "../src/drawingIndex/types.js";
import { buildDrawingPageMap } from "../src/drawingPageMap/buildDrawingPageMap.js";
import { loadDrawingPageMap } from "../src/drawingPageMap/loadDrawingPageMap.js";
import { parseDrawingPage } from "../src/drawingPageMap/parseDrawingPage.js";
import { createTempPdfProject } from "./helpers/pdfFixture.js";
import {
  createDrawingPageMapIndex,
  createDrawingPageTextFixture,
  createValidPageMapDocument,
} from "./helpers/drawingPageMapFixture.js";

const roots: string[] = [];

function tempRoot(): string {
  const root = createTempPdfProject();
  roots.push(root);
  return root;
}

function writePageMap(root: string, value: unknown): string {
  const path = join(root, ".volt-ai", "page-maps", "map.json");
  mkdirSync(join(root, ".volt-ai", "page-maps"), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value)}\n`, "utf8");
  return ".volt-ai/page-maps/map.json";
}

function builderInput(index: DrawingIndexDocument, drawingPage: number) {
  return {
    index,
    indexPath: ".volt-ai/indexes/drawing-index.json",
    source: index.source,
    sourceSha256: index.sourceSha256,
    startPage: 2,
    endPage: 4,
    pageResults: [
      {
        page: 2,
        status: "processed" as const,
        mapping: {
          drawingNo: "E-401",
          drawingPage,
          detectedTitle: null,
          confidence: 0.9,
          matchMethod: "title-block-coordinate" as const,
        },
        warnings: [],
      },
    ],
  };
}

describe("Task 42 page-map quality review regressions", () => {
  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a mapping above the declared endPage", () => {
    const root = tempRoot();
    const document = createValidPageMapDocument();
    document.mappings[0] = { ...document.mappings[0]!, drawingPage: document.endPage + 1 };

    expect(() => loadDrawingPageMap(root, writePageMap(root, document))).toThrow(
      /drawingPage|page-map range/i,
    );
  });

  it("rejects duplicate pages outside the declared page range", () => {
    const root = tempRoot();
    const document = createValidPageMapDocument({
      duplicatePageMatches: [{ drawingNo: "E-401", pages: [2, 9] }],
    });

    expect(() => loadDrawingPageMap(root, writePageMap(root, document))).toThrow(
      /duplicate.*pages|page-map range/i,
    );
  });

  it("requires a duplicate summary to contain at least two pages", () => {
    const root = tempRoot();
    const document = createValidPageMapDocument({
      duplicatePageMatches: [{ drawingNo: "E-401", pages: [2] }],
    });

    expect(() => loadDrawingPageMap(root, writePageMap(root, document))).toThrow(
      /duplicate.*pages|at least two/i,
    );
  });

  it("does not build a document containing a mapping outside the scanned range", () => {
    const index = createDrawingPageMapIndex();

    expect(() => buildDrawingPageMap(builderInput(index, 5))).toThrow(
      /mapping.*page|scanned range/i,
    );
  });

  it("requires a mapping page to match its page scan result", () => {
    const index = createDrawingPageMapIndex();

    expect(() => buildDrawingPageMap(builderInput(index, 3))).toThrow(
      /mapping.*page|scan result/i,
    );
  });

  it("normalizes coordinates relative to a non-zero PDF page-box origin", () => {
    const page = createDrawingPageTextFixture({ drawingNo: "E-401" });
    const originX = 100;
    const originY = 200;
    const shifted = {
      ...page,
      originX,
      originY,
      items: page.items.map((item) => ({
        ...item,
        transform: [
          item.transform[0],
          item.transform[1],
          item.transform[2],
          item.transform[3],
          item.transform[4] + originX,
          item.transform[5] + originY,
        ] as const,
      })),
    };

    expect(parseDrawingPage(shifted, createDrawingPageMapIndex().drawings).mapping?.drawingNo).toBe(
      "E-401",
    );
  });

  it("preserves word boundaries represented by NUL separators in detected titles", () => {
    const result = parseDrawingPage(
      createDrawingPageTextFixture({
        drawingNo: "E-401",
        title: "1단지\u0000옥외\u0000전력간선 배치도",
      }),
      createDrawingPageMapIndex().drawings,
    );

    expect(result.mapping?.detectedTitle).toBe("1단지 옥외 전력간선 배치도");
  });

  it("warns and lowers confidence for a subtle but meaningful title mismatch", () => {
    const template = createDrawingPageMapIndex().drawings[0]!;
    const indexedDrawing = {
      ...template,
      drawingNo: "E-121",
      title: "2단지 전기실 배전반 및 외함 상세도",
    };
    const matching = parseDrawingPage(
      createDrawingPageTextFixture({
        drawingNo: "E-121",
        title: indexedDrawing.title,
      }),
      [indexedDrawing],
    );
    const mismatch = parseDrawingPage(
      createDrawingPageTextFixture({
        drawingNo: "E-121",
        title: "1단지 전기실 배전반 및 외함 상세도",
      }),
      [indexedDrawing],
    );

    expect(mismatch.mapping?.drawingNo).toBe("E-121");
    expect(mismatch.mapping!.confidence).toBeLessThan(matching.mapping!.confidence);
    expect(mismatch.warnings.join("\n")).toMatch(/page 2.*E-121.*title|title.*E-121/i);
  });
});
