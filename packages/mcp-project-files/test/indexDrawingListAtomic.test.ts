import { rmSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const fsObservations = vi.hoisted(() => ({
  destinationExistedAtRename: [] as boolean[],
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();

  return {
    ...actual,
    renameSync(
      source: Parameters<typeof actual.renameSync>[0],
      destination: Parameters<typeof actual.renameSync>[1],
    ) {
      fsObservations.destinationExistedAtRename.push(actual.existsSync(destination));
      actual.renameSync(source, destination);
    },
  };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const syncFs = await import("node:fs");

  return {
    ...actual,
    async rename(
      source: Parameters<typeof actual.rename>[0],
      destination: Parameters<typeof actual.rename>[1],
    ) {
      fsObservations.destinationExistedAtRename.push(syncFs.existsSync(destination));
      await actual.rename(source, destination);
    },
  };
});

import { writeDrawingListFixture } from "./helpers/drawingListFixture.js";
import { createTempPdfProject } from "./helpers/pdfFixture.js";

type IndexDrawingList = (
  projectRoot: string | undefined,
  input: unknown,
) => Promise<{ relativeIndexPath?: string }>;

const toolModulePath = "../src/tools/indexDrawingList.js";
const tempRoots: string[] = [];

async function loadIndexDrawingList(): Promise<IndexDrawingList> {
  const module = (await import(toolModulePath)) as { indexDrawingList: IndexDrawingList };
  return module.indexDrawingList;
}

describe("indexDrawingList atomic persistence", () => {
  afterEach(() => {
    fsObservations.destinationExistedAtRename.length = 0;
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps the previous index in place until atomic replacement", async () => {
    const root = createTempPdfProject();
    tempRoots.push(root);
    writeDrawingListFixture(root);
    const indexDrawingList = await loadIndexDrawingList();
    const input = {
      relativePath: "docs/drawing-list.pdf",
      startPage: 1,
      endPage: 2,
      outputName: "drawing-index",
    };

    const first = await indexDrawingList(root, input);
    const second = await indexDrawingList(root, input);

    expect(second.relativeIndexPath).toBe(first.relativeIndexPath);
    expect(fsObservations.destinationExistedAtRename).toEqual([false, true]);
  });
});
