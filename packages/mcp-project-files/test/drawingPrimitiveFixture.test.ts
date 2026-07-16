import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";

import { createDrawingPrimitivePdfFixture } from "./helpers/drawingPrimitiveFixture.js";

async function withFixtureDocument<T>(
  callback: (
    document: Awaited<ReturnType<typeof getDocument>["promise"]>,
  ) => Promise<T>,
): Promise<T> {
  const loadingTask = getDocument({
    data: createDrawingPrimitivePdfFixture(),
    disableFontFace: true,
    useSystemFonts: true,
  });
  const document = await loadingTask.promise;
  try {
    return await callback(document);
  } finally {
    try {
      await document.cleanup();
    } finally {
      await loadingTask.destroy();
    }
  }
}

describe("drawing primitive PDF fixture", () => {
  it("contains ten deterministic pages with the approved rotations and CropBox", async () => {
    await withFixtureDocument(async (document) => {
      expect(document.numPages).toBe(10);
      for (const [pageNumber, rotation] of [
        [1, 0],
        [3, 90],
        [4, 180],
        [5, 270],
      ] as const) {
        const page = await document.getPage(pageNumber);
        try {
          expect(page.rotate).toBe(rotation);
        } finally {
          page.cleanup?.();
        }
      }

      const cropPage = await document.getPage(6);
      try {
        expect(cropPage.view).toEqual([50, 100, 450, 700]);
      } finally {
        cropPage.cleanup?.();
      }
    });
  });

  it("emits the PDF.js 6.1.200 compressed constructPath container shape", async () => {
    await withFixtureDocument(async (document) => {
      const page = await document.getPage(1);
      try {
        const operatorList = await page.getOperatorList();
        const index = operatorList.fnArray.findIndex((fn) => fn === OPS.constructPath);
        const args = operatorList.argsArray[index];

        expect(index).toBeGreaterThanOrEqual(0);
        expect(args).toHaveLength(3);
        expect(typeof args[0]).toBe("number");
        expect(args[1]).toHaveLength(1);
        expect(ArrayBuffer.isView(args[1][0])).toBe(true);
        expect(ArrayBuffer.isView(args[2])).toBe(true);
        expect(Array.from(args[2])).toHaveLength(4);
      } finally {
        page.cleanup?.();
      }
    });
  });

  it("contains every approved paint operation without numeric-literal coupling", async () => {
    await withFixtureDocument(async (document) => {
      const page = await document.getPage(1);
      try {
        const operatorList = await page.getOperatorList();
        const paints = operatorList.fnArray.flatMap((fn, index) =>
          fn === OPS.constructPath ? [operatorList.argsArray[index][0]] : [],
        );

        expect(paints).toEqual(
          expect.arrayContaining([
            OPS.stroke,
            OPS.fill,
            OPS.eoFill,
            OPS.fillStroke,
            OPS.eoFillStroke,
          ]),
        );
      } finally {
        page.cleanup?.();
      }
    });
  });

  it("contains state, nested transforms, alpha, hairline, and dash operators", async () => {
    await withFixtureDocument(async (document) => {
      const page = await document.getPage(2);
      try {
        const operatorList = await page.getOperatorList();

        expect(operatorList.fnArray).toEqual(
          expect.arrayContaining([
            OPS.setLineWidth,
            OPS.setLineCap,
            OPS.setLineJoin,
            OPS.setMiterLimit,
            OPS.setDash,
            OPS.setStrokeRGBColor,
            OPS.setFillRGBColor,
            OPS.setGState,
            OPS.save,
            OPS.restore,
            OPS.transform,
          ]),
        );
        expect(
          operatorList.fnArray.filter((fn) => fn === OPS.transform).length,
        ).toBeGreaterThanOrEqual(2);
      } finally {
        page.cleanup?.();
      }
    });
  });

  it("emits clip/eoclip followed by constructPath(endPath)", async () => {
    await withFixtureDocument(async (document) => {
      const page = await document.getPage(7);
      try {
        const operatorList = await page.getOperatorList();
        const sequences = operatorList.fnArray.flatMap((fn, index) => {
          if (fn !== OPS.clip && fn !== OPS.eoClip) return [];
          return [[fn, operatorList.fnArray[index + 1], operatorList.argsArray[index + 1]?.[0]]];
        });

        expect(sequences).toEqual([
          [OPS.clip, OPS.constructPath, OPS.endPath],
          [OPS.eoClip, OPS.constructPath, OPS.endPath],
        ]);
      } finally {
        page.cleanup?.();
      }
    });
  });

  it("flattens a Form XObject between begin/end wrapper operators", async () => {
    await withFixtureDocument(async (document) => {
      const page = await document.getPage(8);
      try {
        const operatorList = await page.getOperatorList();
        const begin = operatorList.fnArray.indexOf(OPS.paintFormXObjectBegin);
        const end = operatorList.fnArray.indexOf(OPS.paintFormXObjectEnd);
        const path = operatorList.fnArray.findIndex(
          (fn, index) => fn === OPS.constructPath && index > begin && index < end,
        );

        expect(begin).toBeGreaterThanOrEqual(0);
        expect(end).toBeGreaterThan(begin);
        expect(path).toBeGreaterThan(begin);
        expect(operatorList.argsArray[begin][0]).toHaveLength(6);
        expect(operatorList.argsArray[begin][1]).toHaveLength(4);
      } finally {
        page.cleanup?.();
      }
    });
  });

  it("has duplicate, zero-length, tiny, transparent paths and a zero-painted-path page", async () => {
    await withFixtureDocument(async (document) => {
      const edgePage = await document.getPage(9);
      const emptyPage = await document.getPage(10);
      try {
        const edgeOperators = await edgePage.getOperatorList();
        const emptyOperators = await emptyPage.getOperatorList();

        expect(edgeOperators.fnArray).toContain(OPS.setGState);
        expect(edgeOperators.fnArray).toContain(OPS.setLineWidth);
        expect(
          edgeOperators.fnArray.filter((fn) => fn === OPS.constructPath),
        ).toHaveLength(4);
        expect(emptyOperators.fnArray).not.toContain(OPS.constructPath);
      } finally {
        edgePage.cleanup?.();
        emptyPage.cleanup?.();
      }
    });
  });
});
