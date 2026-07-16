import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createTempPdfProject } from "./helpers/pdfFixture.js";
import {
  createValidPageMapDocument,
  type DrawingPageMapFixtureDocument,
} from "./helpers/drawingPageMapFixture.js";

type WriteDrawingPageMap = (
  projectRoot: string,
  document: DrawingPageMapFixtureDocument,
  outputName: string,
) => string;

const writerModulePath = "../src/drawingPageMap/writeDrawingPageMap.js";
const tempRoots: string[] = [];

async function loadWriter(): Promise<WriteDrawingPageMap> {
  const module = (await import(writerModulePath)) as { writeDrawingPageMap: WriteDrawingPageMap };
  return module.writeDrawingPageMap;
}

function tempProject(): string {
  const root = createTempPdfProject();
  tempRoots.push(root);
  return root;
}

function absolutePath(root: string, relativePath: string): string {
  return join(root, ...relativePath.split("/"));
}

function listFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

describe("DrawingPageMapDocument persistence", () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("writes only the schema v1 storage contract and both source hashes", async () => {
    const root = tempProject();
    const writeDrawingPageMap = await loadWriter();
    const document = createValidPageMapDocument();

    const relativePath = writeDrawingPageMap(root, document, "drawing-pages");
    const stored = JSON.parse(readFileSync(absolutePath(root, relativePath), "utf8")) as Record<
      string,
      unknown
    >;

    expect(stored).toMatchObject({
      schemaVersion: 1,
      sourceSha256: document.sourceSha256,
      indexSourceSha256: document.indexSourceSha256,
      mappingCount: document.mappings.length,
    });
    expect(stored).not.toHaveProperty("relativePageMapPath");
    expect(stored).not.toHaveProperty("mtime");
  });

  it("uses a deterministic source-hashed PROJECT_ROOT-relative POSIX path", async () => {
    const root = tempProject();
    const writeDrawingPageMap = await loadWriter();
    const document = createValidPageMapDocument();

    const first = writeDrawingPageMap(root, document, "drawing-pages");
    const second = writeDrawingPageMap(root, document, "drawing-pages");

    expect(first).toMatch(
      /^\.volt-ai\/page-maps\/drawing-pages-[a-f0-9]{12}-p002-p008\.json$/,
    );
    expect(second).toBe(first);
    expect(first).not.toContain("\\");
    expect(statSync(absolutePath(root, first)).isFile()).toBe(true);
  });

  it("writes identical UTF-8 JSON bytes for identical input", async () => {
    const root = tempProject();
    const writeDrawingPageMap = await loadWriter();
    const document = createValidPageMapDocument();

    const firstPath = writeDrawingPageMap(root, document, "drawing-pages");
    const first = readFileSync(absolutePath(root, firstPath));
    const secondPath = writeDrawingPageMap(root, structuredClone(document), "drawing-pages");
    const second = readFileSync(absolutePath(root, secondPath));

    expect(second).toEqual(first);
    expect(first.at(-1)).toBe(0x0a);
  });

  it("uses source path hashing to avoid normalized basename collisions", async () => {
    const root = tempProject();
    const writeDrawingPageMap = await loadWriter();
    const first = createValidPageMapDocument({ source: "alpha/drawings.pdf" });
    const second = createValidPageMapDocument({ source: "beta/drawings.pdf" });

    const firstPath = writeDrawingPageMap(root, first, "shared");
    const secondPath = writeDrawingPageMap(root, second, "shared");

    expect(secondPath).not.toBe(firstPath);
    expect(existsSync(absolutePath(root, firstPath))).toBe(true);
    expect(existsSync(absolutePath(root, secondPath))).toBe(true);
  });

  it("leaves no temporary file after repeated successful overwrite", async () => {
    const root = tempProject();
    const writeDrawingPageMap = await loadWriter();
    const document = createValidPageMapDocument();

    writeDrawingPageMap(root, document, "drawing-pages");
    writeDrawingPageMap(root, document, "drawing-pages");

    const files = listFiles(join(root, ".volt-ai", "page-maps"));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.json$/);
  });

  it.each(["", ".hidden", "../map", "nested/map", "nested\\map"])(
    "rejects unsafe outputName %j",
    async (outputName) => {
      const root = tempProject();
      const writeDrawingPageMap = await loadWriter();

      expect(() => writeDrawingPageMap(root, createValidPageMapDocument(), outputName)).toThrow(
        /outputName/i,
      );
    },
  );

  it("rejects a symlink in the output directory chain", async () => {
    const root = tempProject();
    const outside = tempProject();
    symlinkSync(outside, join(root, ".volt-ai"), "dir");
    const writeDrawingPageMap = await loadWriter();

    expect(() => writeDrawingPageMap(root, createValidPageMapDocument(), "drawing-pages")).toThrow(
      /symbolic|symlink/i,
    );
    expect(readdirSync(outside)).toEqual([]);
  });

  it("rejects an existing final target symlink without changing its target", async () => {
    const root = tempProject();
    const outside = tempProject();
    const writeDrawingPageMap = await loadWriter();
    const document = createValidPageMapDocument();
    const relativePath = writeDrawingPageMap(root, document, "drawing-pages");
    const target = absolutePath(root, relativePath);
    const outsideFile = join(outside, "outside.json");
    writeFileSync(outsideFile, "outside", "utf8");
    unlinkSync(target);
    symlinkSync(outsideFile, target);

    expect(() => writeDrawingPageMap(root, document, "drawing-pages")).toThrow(
      /symbolic|symlink/i,
    );
    expect(readFileSync(outsideFile, "utf8")).toBe("outside");
  });

  it("rejects an existing target that is not a regular file", async () => {
    const root = tempProject();
    const writeDrawingPageMap = await loadWriter();
    const document = createValidPageMapDocument();
    const relativePath = writeDrawingPageMap(root, document, "drawing-pages");
    const target = absolutePath(root, relativePath);
    rmSync(target);
    mkdirSync(target);

    expect(() => writeDrawingPageMap(root, document, "drawing-pages")).toThrow(/regular file|file/i);
  });
});
