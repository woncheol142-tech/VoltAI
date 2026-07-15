import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";

import {
  createDrawingListPdfFixture,
  createTwoPageDrawingListTextFixture,
} from "./helpers/drawingListFixture.js";

describe("drawing-list PDF fixture", () => {
  it("contains two coordinate-bearing pages with two table blocks", () => {
    const pages = createTwoPageDrawingListTextFixture();

    expect(pages).toHaveLength(2);
    expect(pages[0].items.filter((item) => item.str === "도면번호")).toHaveLength(2);
    expect(pages[0].items.some((item) => item.transform[5] > 700)).toBe(true);
    expect(pages[0].items.some((item) => item.transform[5] < 500)).toBe(true);
  });

  it("round-trips Unicode text and intentionally mixed stream order through PDF.js", async () => {
    const loadingTask = getDocument({
      data: createDrawingListPdfFixture(),
      disableFontFace: true,
      useSystemFonts: true,
    });

    try {
      const document = await loadingTask.promise;
      const page = await document.getPage(1);

      try {
        const content = await page.getTextContent();
        const textItems = content.items.filter(
          (item): item is (typeof content.items)[number] & { str: string } =>
            "str" in item && typeof item.str === "string",
        );
        const text = textItems.map((item) => item.str).join(" ");
        const firstDrawingToken = textItems.findIndex((item) => item.str === "E-");
        const firstTitleToken = textItems.findIndex((item) => item.str.includes("도면목록표"));

        expect(document.numPages).toBe(2);
        expect(text).toContain("도면번호");
        expect(text).toContain("도면목록표");
        expect(text).toContain("NONE");
        expect(firstTitleToken).toBeLessThan(firstDrawingToken);
        expect(textItems.every((item) => item.transform.length === 6)).toBe(true);
      } finally {
        page.cleanup();
      }
    } finally {
      await loadingTask.destroy();
    }
  });
});
