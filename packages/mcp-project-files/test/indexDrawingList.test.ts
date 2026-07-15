import { existsSync, rmSync, symlinkSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createTempPdfProject, writeProjectFile } from "./helpers/pdfFixture.js";
import { writeDrawingListFixture } from "./helpers/drawingListFixture.js";

type IndexDrawingListResult = {
  schemaVersion: 1;
  source: string;
  sourceSha256: string;
  startPage: number;
  endPage: number;
  drawingCount: number;
  drawings: Array<{
    drawingNo: string;
    title: string;
    sourceListPage: number;
  }>;
  warnings: string[];
  relativeIndexPath?: string;
};

type IndexDrawingList = (
  projectRoot: string | undefined,
  input: unknown,
) => Promise<IndexDrawingListResult>;

const toolModulePath = "../src/tools/indexDrawingList.js";
const tempRoots: string[] = [];

async function loadIndexDrawingList(): Promise<IndexDrawingList> {
  const module = (await import(toolModulePath)) as { indexDrawingList: IndexDrawingList };
  return module.indexDrawingList;
}

function createTempProject(): string {
  const root = createTempPdfProject();
  tempRoots.push(root);
  return root;
}

describe("indexDrawingList", () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("indexes a deterministic two-page coordinate fixture", async () => {
    const root = createTempProject();
    writeDrawingListFixture(root);
    const indexDrawingList = await loadIndexDrawingList();

    const result = await indexDrawingList(root, {
      relativePath: "docs/drawing-list.pdf",
      startPage: 1,
      endPage: 2,
    });

    expect(result).toMatchObject({
      schemaVersion: 1,
      source: "docs/drawing-list.pdf",
      startPage: 1,
      endPage: 2,
      drawingCount: 6,
    });
    expect(result.drawings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          drawingNo: "E-154A",
          title: "1단지 101동 지하2층 전력간선설비 평면도",
          sourceListPage: 1,
        }),
        expect.objectContaining({ drawingNo: "E-454P", sourceListPage: 2 }),
        expect.objectContaining({ drawingNo: "MF-020", sourceListPage: 2 }),
      ]),
    );
    expect(result.warnings.join("\n")).toMatch(/duplicate.*E-001|E-001.*중복/i);
  });

  it("does not persist an index when outputName is omitted", async () => {
    const root = createTempProject();
    writeDrawingListFixture(root);
    const indexDrawingList = await loadIndexDrawingList();

    const result = await indexDrawingList(root, {
      relativePath: "docs/drawing-list.pdf",
      startPage: 1,
      endPage: 2,
    });

    expect(result.relativeIndexPath).toBeUndefined();
    expect(existsSync(join(root, ".volt-ai", "indexes"))).toBe(false);
  });

  it.each([
    [{ relativePath: "docs/drawing-list.pdf", startPage: 0, endPage: 1 }, /startPage.*positive integer/i],
    [{ relativePath: "docs/drawing-list.pdf", startPage: 1.5, endPage: 2 }, /startPage.*positive integer/i],
    [{ relativePath: "docs/drawing-list.pdf", startPage: 2, endPage: 1 }, /endPage.*startPage/i],
    [{ relativePath: "docs/drawing-list.pdf", startPage: 1, endPage: 1.5 }, /endPage.*integer/i],
  ])("rejects invalid page range %#", async (input, message) => {
    const root = createTempProject();
    writeDrawingListFixture(root);
    const indexDrawingList = await loadIndexDrawingList();

    await expect(indexDrawingList(root, input)).rejects.toThrow(message);
  });

  it("rejects endPage above the PDF page count", async () => {
    const root = createTempProject();
    writeDrawingListFixture(root);
    const indexDrawingList = await loadIndexDrawingList();

    await expect(
      indexDrawingList(root, {
        relativePath: "docs/drawing-list.pdf",
        startPage: 1,
        endPage: 3,
      }),
    ).rejects.toThrow(/endPage.*between 1 and 2/i);
  });

  it("rejects non-PDF, absolute, traversal, and hidden source paths", async () => {
    const root = createTempProject();
    writeProjectFile(root, "docs/list.txt", "not a PDF");
    writeDrawingListFixture(root, ".hidden/list.pdf");
    const indexDrawingList = await loadIndexDrawingList();
    const absolutePath = join(root, "docs/drawing-list.pdf");
    expect(isAbsolute(absolutePath)).toBe(true);

    await expect(
      indexDrawingList(root, { relativePath: "docs/list.txt", startPage: 1, endPage: 1 }),
    ).rejects.toThrow("Only .pdf files are supported");
    await expect(
      indexDrawingList(root, { relativePath: absolutePath, startPage: 1, endPage: 1 }),
    ).rejects.toThrow("relativePath must be relative");
    await expect(
      indexDrawingList(root, { relativePath: "../secret.pdf", startPage: 1, endPage: 1 }),
    ).rejects.toThrow("relativePath must stay within PROJECT_ROOT");
    await expect(
      indexDrawingList(root, { relativePath: ".hidden/list.pdf", startPage: 1, endPage: 1 }),
    ).rejects.toThrow("relativePath cannot include hidden folders or node_modules");
  });

  it("rejects a source symlink that resolves outside PROJECT_ROOT", async () => {
    const root = createTempProject();
    const outside = createTempProject();
    writeDrawingListFixture(outside, "outside.pdf");
    symlinkSync(join(outside, "outside.pdf"), join(root, "linked.pdf"));
    const indexDrawingList = await loadIndexDrawingList();

    await expect(
      indexDrawingList(root, { relativePath: "linked.pdf", startPage: 1, endPage: 2 }),
    ).rejects.toThrow("relativePath must stay within PROJECT_ROOT");
  });
});
