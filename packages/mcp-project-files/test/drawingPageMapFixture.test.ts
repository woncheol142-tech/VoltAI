import { createHash } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { afterEach, describe, expect, it } from "vitest";

import { createTempPdfProject } from "./helpers/pdfFixture.js";
import {
  createDrawingPagesPdfFixture,
  writeDrawingPageMapProject,
} from "./helpers/drawingPageMapFixture.js";

const roots: string[] = [];

function textItems(content: { items: unknown[] }): string[] {
  return content.items
    .filter(
      (item): item is { str: string } =>
        typeof item === "object" && item !== null && "str" in item && typeof item.str === "string",
    )
    .map(({ str }) => str);
}

describe("drawing page-map PDF fixture", () => {
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("generates deterministic PDF bytes", () => {
    expect(createDrawingPagesPdfFixture()).toEqual(createDrawingPagesPdfFixture());
  });

  it("contains split title-block numbers, a body reference, and a 90-degree page", async () => {
    const loadingTask = getDocument({ data: createDrawingPagesPdfFixture() });
    const document = await loadingTask.promise;

    try {
      expect(document.numPages).toBe(8);
      const page2 = await document.getPage(2);
      const page8 = await document.getPage(8);
      try {
        const page2Text = textItems(await page2.getTextContent());
        const page8Text = textItems(await page8.getTextContent());
        expect(page2Text).toEqual(expect.arrayContaining(["E-", "401", "E-500"]));
        expect(page8.rotate).toBe(90);
        expect(page8Text).toEqual(expect.arrayContaining(["MF-", "020"]));
      } finally {
        page2.cleanup();
        page8.cleanup();
      }
    } finally {
      try {
        await document.cleanup();
      } finally {
        await loadingTask.destroy();
      }
    }
  });

  it("writes an index whose source SHA-256 matches the generated PDF", () => {
    const root = createTempPdfProject();
    roots.push(root);
    const fixture = writeDrawingPageMapProject(root);
    const sourceBytes = readFileSync(`${root}/${fixture.sourcePath}`);

    expect(fixture.index.schemaVersion).toBe(1);
    expect(fixture.index.sourceSha256).toBe(
      createHash("sha256").update(sourceBytes).digest("hex"),
    );
  });
});
