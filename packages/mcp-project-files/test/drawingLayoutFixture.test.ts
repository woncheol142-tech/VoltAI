import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";

import { createDrawingLayoutPdfFixture } from "./helpers/drawingLayoutFixture.js";

describe("drawing layout PDF fixture", () => {
  it("contains deterministic pages for every approved geometry case", async () => {
    const loadingTask = getDocument({
      data: createDrawingLayoutPdfFixture(),
      disableFontFace: true,
      useSystemFonts: true,
    });
    const document = await loadingTask.promise;

    try {
      expect(document.numPages).toBe(8);

      const expectedRotations = [0, 90, 180, 270];
      for (const [index, expectedRotation] of expectedRotations.entries()) {
        const page = await document.getPage(index + 1);
        try {
          expect(page.rotate).toBe(expectedRotation);
        } finally {
          page.cleanup?.();
        }
      }
    } finally {
      try {
        await document.cleanup();
      } finally {
        await loadingTask.destroy();
      }
    }
  });

  it("extracts Korean text and preserves intentionally shuffled stream order", async () => {
    const loadingTask = getDocument({ data: createDrawingLayoutPdfFixture() });
    const document = await loadingTask.promise;

    try {
      const page = await document.getPage(1);
      try {
        const content = await page.getTextContent();
        const texts = content.items
          .filter((item): item is typeof item & { str: string } => "str" in item)
          .map(({ str }) => str);

        expect(texts.join("").replace(/\s+/gu, " ")).toContain("한글 English 380V");
        expect(texts.indexOf("154A")).toBeLessThan(texts.indexOf("E-"));
        expect(texts.indexOf("225AF")).toBeLessThan(texts.indexOf("MCCB"));
      } finally {
        page.cleanup?.();
      }
    } finally {
      try {
        await document.cleanup();
      } finally {
        await loadingTask.destroy();
      }
    }
  });

  it("contains a non-zero CropBox, arbitrary text rotations, and a vector-only page", async () => {
    const loadingTask = getDocument({ data: createDrawingLayoutPdfFixture() });
    const document = await loadingTask.promise;

    try {
      const cropPage = await document.getPage(5);
      const anglePage = await document.getPage(6);
      const emptyPage = await document.getPage(8);

      try {
        expect(cropPage.view).toEqual([50, 100, 450, 700]);

        const angleContent = await anglePage.getTextContent();
        const angleItems = angleContent.items.filter(
          (item): item is typeof item & { str: string; transform: number[] } =>
            "str" in item && "transform" in item,
        );
        const angles = angleItems.map(({ transform }) => {
          const degrees = (Math.atan2(transform[1], transform[0]) * 180) / Math.PI;
          return ((degrees % 360) + 360) % 360;
        });

        expect(angles).toEqual(
          expect.arrayContaining([
            expect.closeTo(15, 3),
            expect.closeTo(33.5, 3),
            expect.closeTo(359, 3),
            expect.closeTo(1, 3),
            expect.closeTo(3, 3),
          ]),
        );
        expect((await emptyPage.getTextContent()).items).toHaveLength(0);
        expect((await emptyPage.getOperatorList()).fnArray.length).toBeGreaterThan(0);
      } finally {
        cropPage.cleanup?.();
        anglePage.cleanup?.();
        emptyPage.cleanup?.();
      }
    } finally {
      try {
        await document.cleanup();
      } finally {
        await loadingTask.destroy();
      }
    }
  });
});
