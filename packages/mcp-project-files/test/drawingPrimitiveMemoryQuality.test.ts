import { rmSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createTempPdfProject, writeProjectFile } from "./helpers/pdfFixture.js";

const observations = vi.hoisted(() => ({
  source: Buffer.allocUnsafeSlow(32),
  pdfData: undefined as Uint8Array | undefined,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: vi.fn(() => observations.source),
  };
});

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("pdfjs-dist/legacy/build/pdf.mjs")
  >();
  return {
    ...actual,
    getDocument(options: { data: Uint8Array }) {
      observations.pdfData = options.data;
      return {
        promise: Promise.resolve({
          numPages: 1,
          getPage: async () => ({
            rotate: 0,
            view: [0, 0, 600, 800],
            getViewport: () => ({
              width: 600,
              height: 800,
              transform: [1, 0, 0, -1, 0, 800],
            }),
            getOperatorList: async () => ({ fnArray: [], argsArray: [] }),
            cleanup: vi.fn(),
          }),
          cleanup: vi.fn(async () => {}),
        }),
        destroy: vi.fn(async () => {}),
      };
    },
  };
});

describe("drawing primitive memory quality", () => {
  const roots: string[] = [];

  afterEach(() => {
    observations.pdfData = undefined;
    vi.resetModules();
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("passes a zero-copy Uint8Array view of the PDF Buffer to PDF.js", async () => {
    observations.source.fill(0);
    observations.source.write("%PDF-1.7", 3, "ascii");
    const root = createTempPdfProject();
    roots.push(root);
    writeProjectFile(root, "docs/primitives.pdf", "%PDF-1.7\n%%EOF\n");
    const { extractDrawingPrimitives } = await import(
      "../src/tools/extractDrawingPrimitives.js"
    );

    await extractDrawingPrimitives(root, {
      relativePath: "docs/primitives.pdf",
      page: 1,
    });

    expect(observations.pdfData?.buffer).toBe(observations.source.buffer);
    expect(observations.pdfData?.byteOffset).toBe(observations.source.byteOffset);
    expect(observations.pdfData?.byteLength).toBe(observations.source.byteLength);
  });
});
