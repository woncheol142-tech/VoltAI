import { readFileSync } from "node:fs";

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

function hasTextString(item: unknown): item is { str: string } {
  return (
    typeof item === "object" &&
    item !== null &&
    "str" in item &&
    typeof item.str === "string"
  );
}

export type PdfPageText = {
  page: number;
  text: string;
};

export async function readPdfPages(absolutePath: string): Promise<PdfPageText[]> {
  const data = new Uint8Array(readFileSync(absolutePath));
  const loadingTask = getDocument({
    data,
    disableFontFace: true,
    useSystemFonts: true,
  });
  const document = await loadingTask.promise;
  const pages: PdfPageText[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => (hasTextString(item) ? item.str : ""))
        .filter((itemText) => itemText.length > 0)
        .join(" ")
        .trim();

      pages.push({ page: pageNumber, text });
    }
  } finally {
    await document.cleanup();
    await loadingTask.destroy();
  }

  return pages;
}
