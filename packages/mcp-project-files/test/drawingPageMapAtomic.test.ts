import { rmSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const observations = vi.hoisted(() => ({ destinationExistedAtRename: [] as boolean[] }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    renameSync(
      source: Parameters<typeof actual.renameSync>[0],
      destination: Parameters<typeof actual.renameSync>[1],
    ) {
      observations.destinationExistedAtRename.push(actual.existsSync(destination));
      actual.renameSync(source, destination);
    },
  };
});

import { createTempPdfProject } from "./helpers/pdfFixture.js";
import {
  createValidPageMapDocument,
  type DrawingPageMapFixtureDocument,
} from "./helpers/drawingPageMapFixture.js";

type WriteDrawingPageMap = (
  root: string,
  document: DrawingPageMapFixtureDocument,
  outputName: string,
) => string;

const writerModulePath = "../src/drawingPageMap/writeDrawingPageMap.js";
const roots: string[] = [];

async function loadWriter(): Promise<WriteDrawingPageMap> {
  const module = (await import(writerModulePath)) as { writeDrawingPageMap: WriteDrawingPageMap };
  return module.writeDrawingPageMap;
}

describe("DrawingPageMapDocument atomic persistence", () => {
  afterEach(() => {
    observations.destinationExistedAtRename.length = 0;
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("keeps the previous file in place until atomic replacement", async () => {
    const root = createTempPdfProject();
    roots.push(root);
    const writeDrawingPageMap = await loadWriter();
    const document = createValidPageMapDocument();

    const first = writeDrawingPageMap(root, document, "drawing-pages");
    const second = writeDrawingPageMap(root, document, "drawing-pages");

    expect(second).toBe(first);
    expect(observations.destinationExistedAtRename).toEqual([false, true]);
  });
});
