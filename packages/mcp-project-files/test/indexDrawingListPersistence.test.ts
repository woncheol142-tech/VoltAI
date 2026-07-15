import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createDrawingListPdfFixture,
  writeDrawingListFixture,
} from "./helpers/drawingListFixture.js";
import { createTempPdfProject } from "./helpers/pdfFixture.js";

type IndexDrawingListResult = {
  schemaVersion: 1;
  source: string;
  sourceSha256: string;
  startPage: number;
  endPage: number;
  drawingCount: number;
  drawings: unknown[];
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

function absoluteIndexPath(root: string, relativePath: string): string {
  return join(root, ...relativePath.split("/"));
}

function listAllFiles(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }

  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = join(root, entry.name);
    return entry.isDirectory() ? listAllFiles(absolutePath) : [absolutePath];
  });
}

describe("indexDrawingList persistence", () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("writes schemaVersion 1 and a deterministic source SHA-256", async () => {
    const root = createTempProject();
    const fixture = createDrawingListPdfFixture();
    writeDrawingListFixture(root);
    const indexDrawingList = await loadIndexDrawingList();

    const result = await indexDrawingList(root, {
      relativePath: "docs/drawing-list.pdf",
      startPage: 1,
      endPage: 2,
      outputName: "drawing-index",
    });
    const stored = JSON.parse(
      readFileSync(absoluteIndexPath(root, result.relativeIndexPath!), "utf8"),
    ) as IndexDrawingListResult;

    expect(result.schemaVersion).toBe(1);
    expect(result.sourceSha256).toBe(createHash("sha256").update(fixture).digest("hex"));
    expect(stored).toMatchObject({
      schemaVersion: 1,
      source: "docs/drawing-list.pdf",
      sourceSha256: result.sourceSha256,
      startPage: 1,
      endPage: 2,
      drawingCount: result.drawingCount,
    });
  });

  it("uses a deterministic PROJECT_ROOT-relative POSIX path", async () => {
    const root = createTempProject();
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

    expect(first.relativeIndexPath).toMatch(
      /^\.volt-ai\/indexes\/drawing-index-[a-f0-9]{12}-p001-p002\.json$/,
    );
    expect(second.relativeIndexPath).toBe(first.relativeIndexPath);
    expect(first.relativeIndexPath).not.toContain("\\");
    expect(statSync(absoluteIndexPath(root, first.relativeIndexPath!)).isFile()).toBe(true);
  });

  it("produces identical JSON bytes for the same source even when mtime changes", async () => {
    const root = createTempProject();
    const sourcePath = join(root, "docs", "drawing-list.pdf");
    writeDrawingListFixture(root);
    const indexDrawingList = await loadIndexDrawingList();
    const input = {
      relativePath: "docs/drawing-list.pdf",
      startPage: 1,
      endPage: 2,
      outputName: "drawing-index",
    };

    const first = await indexDrawingList(root, input);
    const firstBytes = readFileSync(absoluteIndexPath(root, first.relativeIndexPath!));
    utimesSync(sourcePath, new Date(1_700_000_000_000), new Date(1_700_000_000_000));
    const second = await indexDrawingList(root, input);
    const secondBytes = readFileSync(absoluteIndexPath(root, second.relativeIndexPath!));

    expect(secondBytes).toEqual(firstBytes);
  });

  it("uses the source path hash to avoid normalized file-name collisions", async () => {
    const root = createTempProject();
    writeDrawingListFixture(root, "alpha/drawing list.pdf");
    writeDrawingListFixture(root, "beta/drawing list.pdf");
    const indexDrawingList = await loadIndexDrawingList();
    const common = { startPage: 1, endPage: 2, outputName: "shared" };

    const first = await indexDrawingList(root, {
      relativePath: "alpha/drawing list.pdf",
      ...common,
    });
    const second = await indexDrawingList(root, {
      relativePath: "beta/drawing list.pdf",
      ...common,
    });

    expect(first.relativeIndexPath).not.toBe(second.relativeIndexPath);
    expect(existsSync(absoluteIndexPath(root, first.relativeIndexPath!))).toBe(true);
    expect(existsSync(absoluteIndexPath(root, second.relativeIndexPath!))).toBe(true);
  });

  it("leaves no temporary file after successful overwrite", async () => {
    const root = createTempProject();
    writeDrawingListFixture(root);
    const indexDrawingList = await loadIndexDrawingList();
    const input = {
      relativePath: "docs/drawing-list.pdf",
      startPage: 1,
      endPage: 2,
      outputName: "drawing-index",
    };

    await indexDrawingList(root, input);
    await indexDrawingList(root, input);

    const files = listAllFiles(join(root, ".volt-ai", "indexes"));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.json$/);
  });

  it.each(["", ".hidden", "../index", "nested/index", "nested\\index"])(
    "rejects unsafe outputName %j",
    async (outputName) => {
      const root = createTempProject();
      writeDrawingListFixture(root);
      const indexDrawingList = await loadIndexDrawingList();

      await expect(
        indexDrawingList(root, {
          relativePath: "docs/drawing-list.pdf",
          startPage: 1,
          endPage: 2,
          outputName,
        }),
      ).rejects.toThrow(/outputName/i);
    },
  );

  it("rejects a symlink in the output directory path", async () => {
    const root = createTempProject();
    const outside = createTempProject();
    writeDrawingListFixture(root);
    symlinkSync(outside, join(root, ".volt-ai"), "dir");
    const indexDrawingList = await loadIndexDrawingList();

    await expect(
      indexDrawingList(root, {
        relativePath: "docs/drawing-list.pdf",
        startPage: 1,
        endPage: 2,
        outputName: "drawing-index",
      }),
    ).rejects.toThrow(/symbolic link|symlink/i);

    expect(readdirSync(outside)).toEqual([]);
  });

  it("rejects an existing target symlink", async () => {
    const root = createTempProject();
    const outside = createTempProject();
    writeDrawingListFixture(root);
    const indexDrawingList = await loadIndexDrawingList();
    const input = {
      relativePath: "docs/drawing-list.pdf",
      startPage: 1,
      endPage: 2,
      outputName: "drawing-index",
    };
    const first = await indexDrawingList(root, input);
    const target = absoluteIndexPath(root, first.relativeIndexPath!);
    const outsideFile = join(outside, "outside.json");
    writeFileSync(outsideFile, "outside");
    unlinkSync(target);
    symlinkSync(outsideFile, target);

    await expect(indexDrawingList(root, input)).rejects.toThrow(/symbolic link|symlink/i);
    expect(readFileSync(outsideFile, "utf8")).toBe("outside");
  });
});
