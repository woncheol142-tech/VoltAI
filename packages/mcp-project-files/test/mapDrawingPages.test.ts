import { existsSync, rmSync, symlinkSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createTempPdfProject } from "./helpers/pdfFixture.js";
import {
  writeDrawingPageMapProject,
  type DrawingPageMapFixtureDocument,
} from "./helpers/drawingPageMapFixture.js";

type MapDrawingPages = (
  projectRoot: string | undefined,
  input: unknown,
) => Promise<DrawingPageMapFixtureDocument>;

const toolModulePath = "../src/tools/mapDrawingPages.js";
const tempRoots: string[] = [];

async function loadMapDrawingPages(): Promise<MapDrawingPages> {
  const module = (await import(toolModulePath)) as { mapDrawingPages: MapDrawingPages };
  return module.mapDrawingPages;
}

function tempProject(): string {
  const root = createTempPdfProject();
  tempRoots.push(root);
  return root;
}

function standardInput(overrides: Record<string, unknown> = {}) {
  return {
    relativePath: "docs/drawings.pdf",
    indexPath: ".volt-ai/indexes/drawing-index.json",
    ...overrides,
  };
}

describe("mapDrawingPages tool orchestration", () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("maps a deterministic PDF fixture against a Task 40 schema v1 index", async () => {
    const root = tempProject();
    const fixture = writeDrawingPageMapProject(root);
    const mapDrawingPages = await loadMapDrawingPages();

    const result = await mapDrawingPages(root, standardInput());

    expect(result).toMatchObject({
      schemaVersion: 1,
      source: fixture.sourcePath,
      sourceSha256: fixture.sourceSha256,
      indexPath: fixture.indexPath,
      indexSourceSha256: fixture.sourceSha256,
      startPage: 2,
      endPage: 8,
      scannedPageCount: 7,
      indexedDrawingCount: 6,
      mappingCount: 5,
      unmatchedCount: 2,
      coverageRatio: 0.833333,
    });
    expect(result.mappings.map(({ drawingNo, drawingPage }) => [drawingNo, drawingPage])).toEqual([
      ["E-401", 2],
      ["E-154A", 3],
      ["MA-010", 4],
      ["E-401", 6],
      ["MF-020", 8],
    ]);
    expect(result.unmatchedDrawingNumbers).toEqual(["E-500", "E-501"]);
    expect(result.duplicatePageMatches).toEqual([{ drawingNo: "E-401", pages: [2, 6] }]);
  });

  it("defaults startPage to index.endPage + 1 and endPage to PDF pageCount", async () => {
    const root = tempProject();
    writeDrawingPageMapProject(root);
    const mapDrawingPages = await loadMapDrawingPages();

    const result = await mapDrawingPages(root, standardInput());

    expect(result).toMatchObject({ startPage: 2, endPage: 8, scannedPageCount: 7 });
  });

  it("accepts an explicit valid page range", async () => {
    const root = tempProject();
    writeDrawingPageMapProject(root);
    const mapDrawingPages = await loadMapDrawingPages();

    const result = await mapDrawingPages(root, standardInput({ startPage: 2, endPage: 4 }));

    expect(result).toMatchObject({ startPage: 2, endPage: 4, scannedPageCount: 3 });
    expect(result.mappings.map(({ drawingPage }) => drawingPage)).toEqual([2, 3, 4]);
  });

  it("does not save a page map when outputName is omitted", async () => {
    const root = tempProject();
    writeDrawingPageMapProject(root);
    const mapDrawingPages = await loadMapDrawingPages();

    const result = await mapDrawingPages(root, standardInput());

    expect(result.relativePageMapPath).toBeUndefined();
    expect(existsSync(join(root, ".volt-ai", "page-maps"))).toBe(false);
  });

  it("rejects a normalized source path mismatch before mapping", async () => {
    const root = tempProject();
    writeDrawingPageMapProject(root, { indexOverrides: { source: "docs/other.pdf" } });
    const mapDrawingPages = await loadMapDrawingPages();

    await expect(mapDrawingPages(root, standardInput())).rejects.toThrow(/source.*path.*mismatch/i);
  });

  it("rejects a source SHA-256 mismatch before mapping", async () => {
    const root = tempProject();
    writeDrawingPageMapProject(root, { indexOverrides: { sourceSha256: "b".repeat(64) } });
    const mapDrawingPages = await loadMapDrawingPages();

    await expect(mapDrawingPages(root, standardInput())).rejects.toThrow(/sha-?256|hash.*mismatch/i);
  });

  it.each([
    [{ startPage: 0 }, /startPage.*positive integer|startPage.*at least 1/i],
    [{ startPage: 2.5 }, /startPage.*integer/i],
    [{ endPage: 2.5 }, /endPage.*integer/i],
    [{ startPage: 5, endPage: 4 }, /endPage.*startPage/i],
    [{ startPage: 2, endPage: 9 }, /endPage.*between|page count|endPage.*8/i],
    [{ startPage: 9 }, /startPage.*page count|startPage.*8/i],
  ])("rejects invalid page range %#", async (range, message) => {
    const root = tempProject();
    writeDrawingPageMapProject(root);
    const mapDrawingPages = await loadMapDrawingPages();

    await expect(mapDrawingPages(root, standardInput(range))).rejects.toThrow(message);
  });

  it("rejects a computed default startPage above pageCount", async () => {
    const root = tempProject();
    writeDrawingPageMapProject(root, { indexOverrides: { endPage: 8 } });
    const mapDrawingPages = await loadMapDrawingPages();

    await expect(mapDrawingPages(root, standardInput())).rejects.toThrow(/startPage.*page count|no pages/i);
  });

  it("rejects an empty Task 40 index", async () => {
    const root = tempProject();
    writeDrawingPageMapProject(root, { indexOverrides: { drawings: [], drawingCount: 0 } });
    const mapDrawingPages = await loadMapDrawingPages();

    await expect(mapDrawingPages(root, standardInput())).rejects.toThrow(/empty index|index.*drawing/i);
  });

  it("rejects non-PDF, absolute, traversal, and hidden PDF paths", async () => {
    const root = tempProject();
    writeDrawingPageMapProject(root);
    const mapDrawingPages = await loadMapDrawingPages();
    const absolutePath = join(root, "docs", "drawings.pdf");
    expect(isAbsolute(absolutePath)).toBe(true);

    await expect(
      mapDrawingPages(root, standardInput({ relativePath: "docs/drawings.txt" })),
    ).rejects.toThrow(/only.*pdf/i);
    await expect(
      mapDrawingPages(root, standardInput({ relativePath: absolutePath })),
    ).rejects.toThrow(/relativePath.*relative/i);
    await expect(
      mapDrawingPages(root, standardInput({ relativePath: "../drawings.pdf" })),
    ).rejects.toThrow(/PROJECT_ROOT|stay within/i);
    await expect(
      mapDrawingPages(root, standardInput({ relativePath: ".hidden/drawings.pdf" })),
    ).rejects.toThrow(/hidden/i);
  });

  it("rejects a PDF source symlink", async () => {
    const root = tempProject();
    const outside = tempProject();
    writeDrawingPageMapProject(root);
    const outsideFixture = writeDrawingPageMapProject(outside);
    symlinkSync(join(outside, ...outsideFixture.sourcePath.split("/")), join(root, "linked.pdf"));
    const mapDrawingPages = await loadMapDrawingPages();

    await expect(
      mapDrawingPages(root, standardInput({ relativePath: "linked.pdf" })),
    ).rejects.toThrow(/PROJECT_ROOT|symbolic|symlink/i);
  });

  it.each([
    "/tmp/index.json",
    "../index.json",
    ".hidden/index.json",
    ".volt-ai/page-maps/index.json",
    ".volt-ai/indexes/nested/index.json",
  ])("rejects unsafe indexPath %s", async (indexPath) => {
    const root = tempProject();
    writeDrawingPageMapProject(root);
    const mapDrawingPages = await loadMapDrawingPages();

    await expect(mapDrawingPages(root, standardInput({ indexPath }))).rejects.toThrow(
      /indexPath|drawing index|indexes|nested|relative/i,
    );
  });

  it.each(["", ".hidden", "../map", "nested/map", "nested\\map"])(
    "rejects unsafe outputName %j",
    async (outputName) => {
      const root = tempProject();
      writeDrawingPageMapProject(root);
      const mapDrawingPages = await loadMapDrawingPages();

      await expect(mapDrawingPages(root, standardInput({ outputName }))).rejects.toThrow(
        /outputName/i,
      );
    },
  );
});
