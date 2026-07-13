import { rmSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createTempPdfProject, writeProjectFile } from "./helpers/pdfFixture.js";

const pdfMocks = vi.hoisted(() => ({
  getDocument: vi.fn(),
}));

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  getDocument: pdfMocks.getDocument,
}));

import { readPdf } from "../src/tools/readPdf.js";

const tempRoots: string[] = [];

describe("readPdf UTF-16 maxChars contract", () => {
  afterEach(() => {
    pdfMocks.getDocument.mockReset();
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("measures maxChars and charCount with JavaScript UTF-16 string length", async () => {
    const root = createTempPdfProject();
    tempRoots.push(root);
    writeProjectFile(root, "docs/emoji.pdf", "%PDF-1.4\n%%EOF\n");
    const document = {
      numPages: 1,
      getPage: vi.fn(async () => ({
        getTextContent: vi.fn(async () => ({ items: [{ str: "A😀B" }] })),
      })),
      cleanup: vi.fn(async () => {}),
    };
    const loadingTask = {
      promise: Promise.resolve(document),
      destroy: vi.fn(async () => {}),
    };
    pdfMocks.getDocument.mockReturnValue(loadingTask);

    const result = await readPdf(root, {
      relativePath: "docs/emoji.pdf",
      maxChars: 3,
    });

    expect("A😀".length).toBe(3);
    expect(result).toMatchObject({
      text: "A😀",
      pages: [{ page: 1, text: "A😀", charCount: 3 }],
      truncated: true,
    });
    expect(result.text.length).toBe(3);
    expect(result.text).toBe(result.pages.map((page) => page.text).join("\n"));
    expect(result.pages[0]?.charCount).toBe(result.pages[0]?.text.length);
  });
});
