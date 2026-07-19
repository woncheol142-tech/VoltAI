import { mkdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createTempPdfProject, writeProjectFile } from "./helpers/pdfFixture.js";

const roots: string[] = [];

async function spatialExtractor() {
  const module = await import("../src/tools/extractDrawingSpatialRelations.js");
  return module.extractDrawingSpatialRelations;
}

describe("extractDrawingSpatialRelations input and source security", () => {
  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    [{ relativePath: "docs/spatial.pdf" }, /page.*required|required.*page/i],
    [
      { relativePath: "docs/spatial.pdf", page: 1.5 },
      /page.*integer|integer.*page/i,
    ],
    [
      { relativePath: "docs/spatial.pdf", page: 0 },
      /page.*positive|positive.*page/i,
    ],
    [
      { relativePath: "docs/spatial.pdf", page: 1, outputName: 1 },
      /outputName.*string|string.*outputName/i,
    ],
    [
      { relativePath: "docs/spatial.pdf", page: 1, unsupported: true },
      /unsupported/i,
    ],
  ])("rejects invalid typed input %#", async (input, message) => {
    const extract = await spatialExtractor();
    await expect(extract(createTempPdfProject(), input)).rejects.toThrow(
      message,
    );
  });

  it.each([
    ["/tmp/absolute.pdf", /relative|absolute|path/i],
    ["../escape.pdf", /traversal|outside|relative|path/i],
    [".hidden/spatial.pdf", /hidden|path/i],
    ["docs/not-pdf.txt", /pdf/i],
  ])("preserves source path security for %j", async (relativePath, message) => {
    const root = createTempPdfProject();
    roots.push(root);
    writeProjectFile(root, "docs/not-pdf.txt", "not a pdf");
    const extract = await spatialExtractor();

    await expect(extract(root, { relativePath, page: 1 })).rejects.toThrow(
      message,
    );
  });

  it("rejects a PDF source symlink", async () => {
    const root = createTempPdfProject();
    const outside = createTempPdfProject();
    roots.push(root, outside);
    writeProjectFile(outside, "outside.pdf", "%PDF-1.4\n%%EOF\n");
    mkdirSync(join(root, "docs"), { recursive: true });
    symlinkSync(join(outside, "outside.pdf"), join(root, "docs", "linked.pdf"));
    const extract = await spatialExtractor();

    await expect(
      extract(root, { relativePath: "docs/linked.pdf", page: 1 }),
    ).rejects.toThrow(/symbolic|symlink|outside/i);
  });
});

