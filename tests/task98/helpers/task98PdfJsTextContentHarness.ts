import { getDocument } from "../../../packages/mcp-kec/node_modules/pdfjs-dist/legacy/build/pdf.mjs";
import { vi } from "vitest";

import { deterministicKoreanPdfBytes } from "../../../packages/mcp-kec/test/fixtures/requirementExtractionContracts.js";

export type Task98PdfJsTextContent = Readonly<{
  items: readonly unknown[];
  styles: Readonly<Record<string, unknown>>;
}>;

export type Task98PdfJsTextContentHarness = {
  pages: Task98PdfJsTextContent[];
  textContentCalls: number[];
};

export async function installTask98PdfJsTextContentHarness(
  harness: Task98PdfJsTextContentHarness,
): Promise<() => void> {
  const loadingTask = getDocument({
    data: deterministicKoreanPdfBytes("Task98 R1 prototype discovery"),
    disableFontFace: true,
    useSystemFonts: true,
  });
  const document = await loadingTask.promise;
  const page = await document.getPage(1);
  const prototype = Object.getPrototypeOf(page) as {
    getTextContent: () => Promise<unknown>;
  };
  await document.cleanup();
  await loadingTask.destroy();

  const spy = vi
    .spyOn(prototype, "getTextContent")
    .mockImplementation(async function (this: { pageNumber: number }) {
      harness.textContentCalls.push(this.pageNumber);
      return harness.pages[this.pageNumber - 1];
    });
  return () => spy.mockRestore();
}
