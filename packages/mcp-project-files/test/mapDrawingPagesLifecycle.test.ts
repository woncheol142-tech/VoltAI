import { rmSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createTempPdfProject } from "./helpers/pdfFixture.js";
import {
  createDrawingPageTextFixture,
  writeDrawingPageMapProject,
} from "./helpers/drawingPageMapFixture.js";

const pdfMocks = vi.hoisted(() => ({ getDocument: vi.fn() }));

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({ getDocument: pdfMocks.getDocument }));

type MapDrawingPages = (
  root: string | undefined,
  input: unknown,
) => Promise<{ mappingCount: number; warnings: string[] }>;

const toolModulePath = "../src/tools/mapDrawingPages.js";
const roots: string[] = [];

async function loadMapDrawingPages(): Promise<MapDrawingPages> {
  const module = (await import(toolModulePath)) as { mapDrawingPages: MapDrawingPages };
  return module.mapDrawingPages;
}

function pageMock(pageNumber: number, rejectText = false) {
  const fixture = createDrawingPageTextFixture({
    page: pageNumber,
    drawingNo: pageNumber === 2 ? "E-401" : "MA-010",
    title: pageNumber === 2 ? "1단지 101동 지하2층 전력간선설비 평면도" : "기계 장비일람표-1",
  });
  const cleanup = vi.fn();
  return {
    cleanup,
    page: {
      rotate: fixture.rotation,
      view: [0, 0, fixture.width, fixture.height],
      getViewport: vi.fn(() => ({ width: fixture.width, height: fixture.height, rotation: fixture.rotation })),
      getTextContent: rejectText
        ? vi.fn(async () => {
            throw new Error(`page ${pageNumber} extraction failed`);
          })
        : vi.fn(async () => ({ items: fixture.items })),
      cleanup,
    },
  };
}

describe("mapDrawingPages PDF.js partial-failure lifecycle", () => {
  afterEach(() => {
    pdfMocks.getDocument.mockReset();
    vi.resetModules();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("continues after one page extraction failure and cleans every lifecycle object", async () => {
    const root = createTempPdfProject();
    roots.push(root);
    writeDrawingPageMapProject(root, { indexOverrides: { endPage: 1 } });
    const page2 = pageMock(2);
    const page3 = pageMock(3, true);
    const page4 = pageMock(4);
    const documentCleanup = vi.fn(async () => {});
    const destroy = vi.fn(async () => {});
    pdfMocks.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 4,
        getPage: vi.fn(async (pageNumber: number) =>
          pageNumber === 2 ? page2.page : pageNumber === 3 ? page3.page : page4.page,
        ),
        cleanup: documentCleanup,
      }),
      destroy,
    });
    const mapDrawingPages = await loadMapDrawingPages();

    const result = await mapDrawingPages(root, {
      relativePath: "docs/drawings.pdf",
      indexPath: ".volt-ai/indexes/drawing-index.json",
    });

    expect(result.mappingCount).toBe(2);
    expect(result.warnings.join("\n")).toMatch(/page 3.*extraction failed/i);
    expect(page2.cleanup).toHaveBeenCalledOnce();
    expect(page3.cleanup).toHaveBeenCalledOnce();
    expect(page4.cleanup).toHaveBeenCalledOnce();
    expect(documentCleanup).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("throws when all page extractions fail but still cleans resources", async () => {
    const root = createTempPdfProject();
    roots.push(root);
    writeDrawingPageMapProject(root, { indexOverrides: { endPage: 1 } });
    const pages = [pageMock(2, true), pageMock(3, true), pageMock(4, true)];
    const documentCleanup = vi.fn(async () => {});
    const destroy = vi.fn(async () => {});
    pdfMocks.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 4,
        getPage: vi.fn(async (pageNumber: number) => pages[pageNumber - 2]!.page),
        cleanup: documentCleanup,
      }),
      destroy,
    });
    const mapDrawingPages = await loadMapDrawingPages();

    await expect(
      mapDrawingPages(root, {
        relativePath: "docs/drawings.pdf",
        indexPath: ".volt-ai/indexes/drawing-index.json",
      }),
    ).rejects.toThrow(/all.*page|every.*page|no page.*processed/i);
    expect(pages.every(({ cleanup }) => cleanup.mock.calls.length === 1)).toBe(true);
    expect(documentCleanup).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
  });
});
