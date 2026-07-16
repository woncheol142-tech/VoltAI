import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createTempPdfProject, writeProjectFile } from "./helpers/pdfFixture.js";
import {
  createDrawingLayoutPdfFixture,
  writeDrawingLayoutFixture,
} from "./helpers/drawingLayoutFixture.js";

type LayoutResult = {
  schemaVersion: 1;
  source: string;
  sourceSha256: string;
  page: number;
  pageCount: number;
  pageWidth: number;
  pageHeight: number;
  rotation: number;
  cropBox: { x: number; y: number; width: number; height: number };
  coordinateSystem: "normalized-top-left";
  itemCount: number;
  lineCount: number;
  items: Array<{
    id: string;
    normalizedText: string;
    bbox: { x: number; y: number; width: number; height: number };
    pageBBox: { x: number; y: number; width: number; height: number };
  }>;
  lines: Array<{ id: string; text: string; itemIds: string[] }>;
  warnings: string[];
  relativeLayoutPath?: string;
};

type ExtractDrawingLayout = (
  projectRoot: string | undefined,
  input: unknown,
) => Promise<LayoutResult>;

const modulePath = "../src/tools/extractDrawingLayout.js";
const roots: string[] = [];

async function loadExtractor(): Promise<ExtractDrawingLayout> {
  const module = (await import(modulePath)) as {
    extractDrawingLayout: ExtractDrawingLayout;
  };
  return module.extractDrawingLayout;
}

function tempRoot(): string {
  const root = createTempPdfProject();
  roots.push(root);
  return root;
}

describe("extract_drawing_layout tool", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("extracts a deterministic item and line layout from page 1", async () => {
    const root = tempRoot();
    const bytes = createDrawingLayoutPdfFixture();
    writeDrawingLayoutFixture(root);
    const extractDrawingLayout = await loadExtractor();

    const first = await extractDrawingLayout(root, {
      relativePath: "docs/drawing-layout.pdf",
      page: 1,
    });
    const second = await extractDrawingLayout(root, {
      relativePath: "docs/drawing-layout.pdf",
      page: 1,
    });

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      schemaVersion: 1,
      source: "docs/drawing-layout.pdf",
      sourceSha256: createHash("sha256").update(bytes).digest("hex"),
      page: 1,
      pageCount: 8,
      pageWidth: 600,
      pageHeight: 800,
      rotation: 0,
      cropBox: { x: 0, y: 0, width: 600, height: 800 },
      coordinateSystem: "normalized-top-left",
    });
    expect(first.itemCount).toBe(first.items.length);
    expect(first.lineCount).toBe(first.lines.length);
    expect(first.items.some(({ normalizedText }) => normalizedText === "한글")).toBe(true);
    expect(first.lines.some(({ text }) => text === "한글 English 380V")).toBe(true);
    expect(first.lines.some(({ text }) => text === "E-154A")).toBe(true);
    expect(first.lines.some(({ text }) => text === "MCCB 225AF")).toBe(true);
  });

  it("does not expose excluded Task 43B+ placeholders", async () => {
    const root = tempRoot();
    writeDrawingLayoutFixture(root);
    const extractDrawingLayout = await loadExtractor();
    const result = await extractDrawingLayout(root, {
      relativePath: "docs/drawing-layout.pdf",
      page: 1,
    });

    expect(result).not.toHaveProperty("blocks");
    expect(result).not.toHaveProperty("regions");
    expect(result).not.toHaveProperty("primitives");
    expect(result).not.toHaveProperty("symbols");
    expect(result).not.toHaveProperty("connections");
    expect(result).not.toHaveProperty("tables");
  });

  it.each([
    [{ relativePath: "docs/drawing-layout.pdf" }, /page.*required|page/i],
    [{ relativePath: "docs/drawing-layout.pdf", page: 0 }, /page.*positive|between/i],
    [{ relativePath: "docs/drawing-layout.pdf", page: 1.5 }, /page.*integer/i],
    [{ relativePath: "docs/drawing-layout.pdf", page: 9 }, /page.*1.*8|between/i],
  ])("rejects invalid page input %#", async (input, message) => {
    const root = tempRoot();
    writeDrawingLayoutFixture(root);
    const extractDrawingLayout = await loadExtractor();

    await expect(extractDrawingLayout(root, input)).rejects.toThrow(message);
  });

  it.each([
    ["/tmp/spec.pdf", /relative/i],
    ["../spec.pdf", /PROJECT_ROOT|within/i],
    [".hidden/spec.pdf", /hidden/i],
    ["docs/spec.txt", /pdf/i],
  ])("rejects unsafe or unsupported path %s", async (relativePath, message) => {
    const root = tempRoot();
    writeProjectFile(root, "docs/spec.txt", "not a PDF");
    const extractDrawingLayout = await loadExtractor();

    await expect(extractDrawingLayout(root, { relativePath, page: 1 })).rejects.toThrow(message);
  });

  it("rejects a source symlink that resolves outside PROJECT_ROOT", async () => {
    const root = tempRoot();
    const outside = tempRoot();
    writeDrawingLayoutFixture(outside, "outside.pdf");
    mkdirSync(join(root, "docs"), { recursive: true });
    symlinkSync(join(outside, "outside.pdf"), join(root, "docs", "linked.pdf"));
    const extractDrawingLayout = await loadExtractor();

    await expect(
      extractDrawingLayout(root, { relativePath: "docs/linked.pdf", page: 1 }),
    ).rejects.toThrow(/PROJECT_ROOT|within|symbolic/i);
  });

  it("returns a normal zero-item layout for a vector-only page", async () => {
    const root = tempRoot();
    writeDrawingLayoutFixture(root);
    const extractDrawingLayout = await loadExtractor();
    const result = await extractDrawingLayout(root, {
      relativePath: "docs/drawing-layout.pdf",
      page: 8,
    });

    expect(result).toMatchObject({
      page: 8,
      itemCount: 0,
      lineCount: 0,
      items: [],
      lines: [],
      warnings: ["NO_TEXT_ITEMS: page contains no valid text items"],
    });
  });

  it("extracts a sparse valid-text page without inventing invalid-item warnings", async () => {
    const root = tempRoot();
    writeDrawingLayoutFixture(root);
    const extractDrawingLayout = await loadExtractor();
    const result = await extractDrawingLayout(root, {
      relativePath: "docs/drawing-layout.pdf",
      page: 7,
    });

    expect(result.items.map(({ normalizedText }) => normalizedText)).toContain("VALID");
    expect(result.warnings).not.toContain(
      "EMPTY_TEXT sourceOrder=1: normalized text is empty",
    );
  });

  it("does not write to stdout during extraction", async () => {
    const root = tempRoot();
    writeDrawingLayoutFixture(root);
    const writeSpy = vi.spyOn(process.stdout, "write");
    const extractDrawingLayout = await loadExtractor();

    await extractDrawingLayout(root, {
      relativePath: "docs/drawing-layout.pdf",
      page: 1,
    });

    expect(writeSpy).not.toHaveBeenCalled();
  });

  it("returns pageBBox values compatible with render_pdf_page scale pixels", async () => {
    const root = tempRoot();
    writeDrawingLayoutFixture(root);
    const extractDrawingLayout = await loadExtractor();
    const result = await extractDrawingLayout(root, {
      relativePath: "docs/drawing-layout.pdf",
      page: 1,
    });
    const item = result.items.find(({ normalizedText }) => normalizedText === "E-");

    expect(item).toBeDefined();
    const scale = 2;
    expect(item!.pageBBox.x * scale).toBeCloseTo(item!.bbox.x * result.pageWidth * scale, 3);
    expect(item!.pageBBox.y * scale).toBeCloseTo(item!.bbox.y * result.pageHeight * scale, 3);
  });

  it("does not save a file when outputName is omitted", async () => {
    const root = tempRoot();
    writeDrawingLayoutFixture(root);
    const extractDrawingLayout = await loadExtractor();
    const result = await extractDrawingLayout(root, {
      relativePath: "docs/drawing-layout.pdf",
      page: 1,
    });

    expect(result).not.toHaveProperty("relativeLayoutPath");
    expect(existsSync(join(root, ".volt-ai", "layouts"))).toBe(false);
  });

  it("rejects a damaged PDF before returning a partial layout", async () => {
    const root = tempRoot();
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(join(root, "docs", "damaged.pdf"), Buffer.from("%PDF damaged"));
    const extractDrawingLayout = await loadExtractor();

    await expect(
      extractDrawingLayout(root, { relativePath: "docs/damaged.pdf", page: 1 }),
    ).rejects.toThrow();
  });
});
