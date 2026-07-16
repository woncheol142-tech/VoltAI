import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createTempPdfProject } from "./helpers/pdfFixture.js";
import { createDrawingClassificationFixture } from "./helpers/drawingClassificationFixture.js";

const primitiveMocks = vi.hoisted(() => ({
  extract: vi.fn(),
}));

vi.mock("../src/tools/extractDrawingPrimitives.js", () => ({
  extractDrawingPrimitives: primitiveMocks.extract,
}));

const roots: string[] = [];

describe("extractDrawingClassification composition and lifecycle", () => {
  afterEach(() => {
    primitiveMocks.extract.mockReset();
    vi.resetModules();
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reuses extractDrawingPrimitives without requesting a primitive artifact", async () => {
    const root = createTempPdfProject();
    roots.push(root);
    const primitiveDocument = createDrawingClassificationFixture();
    const before = structuredClone(primitiveDocument);
    primitiveMocks.extract.mockResolvedValue(primitiveDocument);
    const { extractDrawingClassification } = await import(
      "../src/tools/extractDrawingClassification.js"
    );

    await expect(
      extractDrawingClassification(root, {
        relativePath: "docs/classification.pdf",
        page: 69,
        outputName: "classification",
      }),
    ).resolves.toMatchObject({ classificationCount: 17 });

    expect(primitiveMocks.extract).toHaveBeenCalledWith(root, {
      relativePath: "docs/classification.pdf",
      page: 69,
    });
    expect(primitiveDocument).toEqual(before);
    expect(existsSync(join(root, ".volt-ai", "primitives"))).toBe(false);
  });

  it("propagates extraction failure without attempting persistence", async () => {
    const root = createTempPdfProject();
    roots.push(root);
    primitiveMocks.extract.mockRejectedValue(new Error("operator failed"));
    const { extractDrawingClassification } = await import(
      "../src/tools/extractDrawingClassification.js"
    );

    await expect(
      extractDrawingClassification(root, {
        relativePath: "docs/classification.pdf",
        page: 69,
        outputName: "classification",
      }),
    ).rejects.toThrow("operator failed");
    expect(existsSync(join(root, ".volt-ai"))).toBe(false);
  });
});
