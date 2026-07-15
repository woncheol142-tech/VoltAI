import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { DrawingIndexDocument } from "../src/drawingIndex/types.js";
import {
  createDrawingSearchDocument,
  writeDrawingSearchIndex,
} from "./helpers/drawingSearchFixture.js";

type LoadDrawingIndex = (
  projectRoot: string | undefined,
  indexPath: string,
) => DrawingIndexDocument;

const loaderModulePath = "../src/drawingSearch/loadDrawingIndex.js";
const tempRoots: string[] = [];

async function loadLoader(): Promise<LoadDrawingIndex> {
  const module = (await import(loaderModulePath)) as { loadDrawingIndex: LoadDrawingIndex };
  return module.loadDrawingIndex;
}

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "voltai-drawing-loader-"));
  tempRoots.push(root);
  return root;
}

function writeRaw(root: string, value: unknown, path = ".volt-ai/indexes/index.json"): string {
  const absolutePath = join(root, ...path.split("/"));
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(
    absolutePath,
    typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
  return absolutePath;
}

describe("drawing index loader", () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("loads a valid schemaVersion 1 document deterministically", async () => {
    const root = tempRoot();
    const document = createDrawingSearchDocument();
    writeDrawingSearchIndex(root, document);
    const loadDrawingIndex = await loadLoader();

    const first = loadDrawingIndex(root, ".volt-ai/indexes/drawing-index.json");
    const second = loadDrawingIndex(root, ".volt-ai/indexes/drawing-index.json");

    expect(first).toEqual(document);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
  });

  it("rejects malformed JSON", async () => {
    const root = tempRoot();
    writeRaw(root, "{not-json");
    const loadDrawingIndex = await loadLoader();

    expect(() => loadDrawingIndex(root, ".volt-ai/indexes/index.json")).toThrow(
      /malformed|JSON/i,
    );
  });

  it.each([
    ["schemaVersion", { schemaVersion: 2 }, /schemaVersion/i],
    ["source", { source: "" }, /source/i],
    ["sourceSha256", { sourceSha256: "ABC" }, /sourceSha256/i],
    ["startPage", { startPage: 0 }, /startPage/i],
    ["endPage", { endPage: 1 }, /endPage/i],
  ])("rejects invalid top-level field %s", async (_name, changes, message) => {
    const root = tempRoot();
    writeRaw(root, { ...createDrawingSearchDocument(), ...changes });
    const loadDrawingIndex = await loadLoader();

    expect(() => loadDrawingIndex(root, ".volt-ai/indexes/index.json")).toThrow(message);
  });

  it("rejects a missing required top-level field", async () => {
    const root = tempRoot();
    const { source, ...document } = createDrawingSearchDocument();
    expect(source).toBeTruthy();
    writeRaw(root, document);
    const loadDrawingIndex = await loadLoader();

    expect(() => loadDrawingIndex(root, ".volt-ai/indexes/index.json")).toThrow(/source/i);
  });

  it("rejects drawingCount that differs from drawings.length", async () => {
    const root = tempRoot();
    const document = createDrawingSearchDocument();
    writeRaw(root, { ...document, drawingCount: document.drawingCount + 1 });
    const loadDrawingIndex = await loadLoader();

    expect(() => loadDrawingIndex(root, ".volt-ai/indexes/index.json")).toThrow(
      /drawingCount|drawings/i,
    );
  });

  it.each([
    ["drawingNo", ""],
    ["title", ""],
    ["category", "invalid"],
    ["confidence", 1.1],
    ["sourceListPage", 0],
    ["scaleA1", 100],
  ])("rejects invalid drawing field %s", async (field, value) => {
    const root = tempRoot();
    const document = createDrawingSearchDocument();
    const drawings = document.drawings.map((drawing, index) =>
      index === 0 ? { ...drawing, [field]: value } : drawing,
    );
    writeRaw(root, { ...document, drawings });
    const loadDrawingIndex = await loadLoader();

    expect(() => loadDrawingIndex(root, ".volt-ai/indexes/index.json")).toThrow(
      new RegExp(field, "i"),
    );
  });

  it("rejects non-string warnings", async () => {
    const root = tempRoot();
    writeRaw(root, { ...createDrawingSearchDocument(), warnings: ["valid", 42] });
    const loadDrawingIndex = await loadLoader();

    expect(() => loadDrawingIndex(root, ".volt-ai/indexes/index.json")).toThrow(/warnings/i);
  });

  it("rejects unknown top-level fields", async () => {
    const root = tempRoot();
    writeRaw(root, { ...createDrawingSearchDocument(), unexpected: true });
    const loadDrawingIndex = await loadLoader();

    expect(() => loadDrawingIndex(root, ".volt-ai/indexes/index.json")).toThrow(
      /unexpected|unknown/i,
    );
  });

  it("rejects unknown record fields", async () => {
    const root = tempRoot();
    const document = createDrawingSearchDocument();
    writeRaw(root, {
      ...document,
      drawings: document.drawings.map((drawing, index) =>
        index === 0 ? { ...drawing, unexpected: true } : drawing,
      ),
    });
    const loadDrawingIndex = await loadLoader();

    expect(() => loadDrawingIndex(root, ".volt-ai/indexes/index.json")).toThrow(
      /unexpected|unknown/i,
    );
  });

  it("rejects an index larger than 10 MiB", async () => {
    const root = tempRoot();
    const absolutePath = join(root, ".volt-ai", "indexes", "large.json");
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, Buffer.alloc(10 * 1024 * 1024 + 1, 0x20));
    const loadDrawingIndex = await loadLoader();

    expect(() => loadDrawingIndex(root, ".volt-ai/indexes/large.json")).toThrow(
      /10 MiB|too large|size/i,
    );
  });

  it.each([
    ["absolute", (root: string) => join(root, ".volt-ai", "indexes", "index.json")],
    ["traversal", () => ".volt-ai/indexes/../secret.json"],
    ["outside", () => "indexes/index.json"],
    ["hidden nested", () => ".volt-ai/indexes/.hidden.json"],
    ["nested directory", () => ".volt-ai/indexes/nested/index.json"],
    ["non-json", () => ".volt-ai/indexes/index.txt"],
  ])("rejects unsafe %s index path", async (_name, pathFor) => {
    const root = tempRoot();
    writeDrawingSearchIndex(root);
    const loadDrawingIndex = await loadLoader();

    expect(() => loadDrawingIndex(root, pathFor(root))).toThrow(
      /indexPath|relative|\.volt-ai|JSON|nested|hidden/i,
    );
  });

  it("rejects a .volt-ai parent symlink", async () => {
    const root = tempRoot();
    const outside = tempRoot();
    writeDrawingSearchIndex(outside);
    symlinkSync(join(outside, ".volt-ai"), join(root, ".volt-ai"), "dir");
    const loadDrawingIndex = await loadLoader();

    expect(() => loadDrawingIndex(root, ".volt-ai/indexes/drawing-index.json")).toThrow(
      /symbolic link|symlink/i,
    );
  });

  it("rejects an indexes parent symlink", async () => {
    const root = tempRoot();
    const outside = tempRoot();
    writeDrawingSearchIndex(outside);
    mkdirSync(join(root, ".volt-ai"));
    symlinkSync(join(outside, ".volt-ai", "indexes"), join(root, ".volt-ai", "indexes"), "dir");
    const loadDrawingIndex = await loadLoader();

    expect(() => loadDrawingIndex(root, ".volt-ai/indexes/drawing-index.json")).toThrow(
      /symbolic link|symlink/i,
    );
  });

  it("rejects a final index file symlink", async () => {
    const root = tempRoot();
    const outside = tempRoot();
    const outsideIndex = writeDrawingSearchIndex(outside);
    mkdirSync(join(root, ".volt-ai", "indexes"), { recursive: true });
    symlinkSync(outsideIndex, join(root, ".volt-ai", "indexes", "drawing-index.json"));
    const loadDrawingIndex = await loadLoader();

    expect(() => loadDrawingIndex(root, ".volt-ai/indexes/drawing-index.json")).toThrow(
      /symbolic link|symlink/i,
    );
  });

  it("requires PROJECT_ROOT", async () => {
    const loadDrawingIndex = await loadLoader();

    expect(() => loadDrawingIndex(undefined, ".volt-ai/indexes/index.json")).toThrow(
      /PROJECT_ROOT/i,
    );
  });
});
