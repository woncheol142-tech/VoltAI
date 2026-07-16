import {
  mkdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createTempPdfProject } from "./helpers/pdfFixture.js";
import {
  createValidPageMapDocument,
  writePageMapFixture,
  type DrawingPageMapFixtureDocument,
} from "./helpers/drawingPageMapFixture.js";

type LoadDrawingPageMap = (
  projectRoot: string | undefined,
  pageMapPath: string,
) => DrawingPageMapFixtureDocument;

const loaderModulePath = "../src/drawingPageMap/loadDrawingPageMap.js";
const roots: string[] = [];

async function loadLoader(): Promise<LoadDrawingPageMap> {
  const module = (await import(loaderModulePath)) as {
    loadDrawingPageMap: LoadDrawingPageMap;
  };
  return module.loadDrawingPageMap;
}

function tempRoot(): string {
  const root = createTempPdfProject();
  roots.push(root);
  return root;
}

function writeRaw(root: string, value: unknown, path = ".volt-ai/page-maps/map.json"): string {
  const absolutePath = join(root, ...path.split("/"));
  mkdirSync(join(root, ".volt-ai", "page-maps"), { recursive: true });
  writeFileSync(
    absolutePath,
    typeof value === "string" ? value : `${JSON.stringify(value)}\n`,
    "utf8",
  );
  return absolutePath;
}

describe("drawing page-map strict loader", () => {
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("loads a valid strict schemaVersion 1 document", async () => {
    const root = tempRoot();
    const expected = createValidPageMapDocument();
    writePageMapFixture(root, expected);
    const loadDrawingPageMap = await loadLoader();

    expect(loadDrawingPageMap(root, ".volt-ai/page-maps/drawing-pages.json")).toEqual(expected);
  });

  it("rejects malformed JSON", async () => {
    const root = tempRoot();
    writeRaw(root, "{not-json");
    const loadDrawingPageMap = await loadLoader();

    expect(() => loadDrawingPageMap(root, ".volt-ai/page-maps/map.json")).toThrow(
      /malformed json|json/i,
    );
  });

  it.each([
    [{ schemaVersion: 2 }, /schemaVersion/i],
    [{ sourceSha256: "ABC" }, /sourceSha256|64.*hex/i],
    [{ indexSourceSha256: "g".repeat(64) }, /indexSourceSha256|64.*hex/i],
    [{ mappingCount: 99 }, /mappingCount/i],
    [{ unmatchedCount: 99 }, /unmatchedCount/i],
    [{ scannedPageCount: 99 }, /scannedPageCount|range/i],
    [{ coverageRatio: 0.123 }, /coverageRatio/i],
  ])("rejects inconsistent document field %#", async (override, message) => {
    const root = tempRoot();
    writeRaw(root, createValidPageMapDocument(override));
    const loadDrawingPageMap = await loadLoader();

    expect(() => loadDrawingPageMap(root, ".volt-ai/page-maps/map.json")).toThrow(message);
  });

  it.each([
    [{ drawingPage: 1 }, /drawingPage|range/i],
    [{ drawingPage: 2.5 }, /drawingPage.*integer/i],
    [{ confidence: -0.1 }, /confidence/i],
    [{ confidence: 1.1 }, /confidence/i],
    [{ matchMethod: "plain-text" }, /matchMethod/i],
    [{ drawingNo: "" }, /drawingNo/i],
  ])("rejects invalid mapping field %#", async (mappingOverride, message) => {
    const root = tempRoot();
    const document = createValidPageMapDocument();
    document.mappings[0] = { ...document.mappings[0]!, ...mappingOverride } as never;
    writeRaw(root, document);
    const loadDrawingPageMap = await loadLoader();

    expect(() => loadDrawingPageMap(root, ".volt-ai/page-maps/map.json")).toThrow(message);
  });

  it.each([
    [[{ drawingNo: "E-401", pages: [] }], /duplicate.*pages|pages/i],
    [[{ drawingNo: "E-401", pages: [3, 2] }], /duplicate.*pages|ascending|sorted/i],
    [[{ drawingNo: "E-401", pages: [2, 2] }], /duplicate.*pages|unique/i],
    [[{ drawingNo: "E-401", pages: [2.5, 3] }], /duplicate.*pages|integer/i],
  ])("rejects invalid duplicate page shape %#", async (duplicatePageMatches, message) => {
    const root = tempRoot();
    writeRaw(root, createValidPageMapDocument({ duplicatePageMatches }));
    const loadDrawingPageMap = await loadLoader();

    expect(() => loadDrawingPageMap(root, ".volt-ai/page-maps/map.json")).toThrow(message);
  });

  it("rejects unknown fields under the strict schema", async () => {
    const root = tempRoot();
    writeRaw(root, { ...createValidPageMapDocument(), generatedAt: new Date(0).toISOString() });
    const loadDrawingPageMap = await loadLoader();

    expect(() => loadDrawingPageMap(root, ".volt-ai/page-maps/map.json")).toThrow(
      /unsupported|unknown|generatedAt/i,
    );
  });

  it.each([
    "/tmp/map.json",
    "../map.json",
    ".hidden/map.json",
    ".volt-ai/page-maps/nested/map.json",
    ".volt-ai/indexes/map.json",
    ".volt-ai/page-maps/map.txt",
  ])("rejects unsafe pageMapPath %s", async (pageMapPath) => {
    const root = tempRoot();
    const loadDrawingPageMap = await loadLoader();

    expect(() => loadDrawingPageMap(root, pageMapPath)).toThrow(
      /page map|pageMapPath|relative|nested|json|page-maps/i,
    );
  });

  it("rejects a page map above the size limit", async () => {
    const root = tempRoot();
    writeRaw(root, "x".repeat(10 * 1024 * 1024 + 1));
    const loadDrawingPageMap = await loadLoader();

    expect(() => loadDrawingPageMap(root, ".volt-ai/page-maps/map.json")).toThrow(
      /10 MiB|size limit|too large/i,
    );
  });

  it("rejects a symlink in the page-map parent path", async () => {
    const root = tempRoot();
    const outside = tempRoot();
    mkdirSync(join(root, ".volt-ai"), { recursive: true });
    symlinkSync(outside, join(root, ".volt-ai", "page-maps"), "dir");
    writeRaw(outside, createValidPageMapDocument(), "map.json");
    const loadDrawingPageMap = await loadLoader();

    expect(() => loadDrawingPageMap(root, ".volt-ai/page-maps/map.json")).toThrow(
      /symbolic|symlink/i,
    );
  });

  it("rejects a final page-map symlink", async () => {
    const root = tempRoot();
    const outside = tempRoot();
    const target = writeRaw(root, createValidPageMapDocument());
    const outsideFile = writeRaw(outside, createValidPageMapDocument(), "outside.json");
    unlinkSync(target);
    symlinkSync(outsideFile, target);
    const loadDrawingPageMap = await loadLoader();

    expect(() => loadDrawingPageMap(root, ".volt-ai/page-maps/map.json")).toThrow(
      /symbolic|symlink/i,
    );
  });

  it("requires PROJECT_ROOT", async () => {
    const loadDrawingPageMap = await loadLoader();

    expect(() => loadDrawingPageMap(undefined, ".volt-ai/page-maps/map.json")).toThrow(
      /PROJECT_ROOT/i,
    );
  });
});
