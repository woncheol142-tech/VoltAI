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
  createDrawingPrimitivePdfFixture,
  writeDrawingPrimitiveFixture,
} from "./helpers/drawingPrimitiveFixture.js";

type PrimitiveResult = {
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
  primitiveCount: number;
  primitives: Array<{
    id: string;
    type: "path";
    sourceOrder: number;
    bbox: Record<string, number>;
    pageBBox: Record<string, number>;
    commands: Array<{
      points: Array<{ x: number; y: number }>;
    }>;
    provenance: { operatorIndex: number };
  }>;
  warnings: string[];
  relativePrimitivePath?: string;
};

type ExtractDrawingPrimitives = (
  projectRoot: string | undefined,
  input: unknown,
) => Promise<PrimitiveResult>;

const modulePath = "../src/tools/extractDrawingPrimitives.js";
const roots: string[] = [];

async function loadExtractor(): Promise<ExtractDrawingPrimitives> {
  const module = (await import(modulePath)) as {
    extractDrawingPrimitives: ExtractDrawingPrimitives;
  };
  return module.extractDrawingPrimitives;
}

function tempRoot(): string {
  const root = createTempPdfProject();
  roots.push(root);
  return root;
}

describe("extract_drawing_primitives tool", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("extracts deterministic painted paths and fixed page metadata", async () => {
    const root = tempRoot();
    const bytes = createDrawingPrimitivePdfFixture();
    writeDrawingPrimitiveFixture(root);
    const extract = await loadExtractor();

    const first = await extract(root, {
      relativePath: "docs/drawing-primitives.pdf",
      page: 1,
    });
    const second = await extract(root, {
      relativePath: "docs/drawing-primitives.pdf",
      page: 1,
    });

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      schemaVersion: 1,
      source: "docs/drawing-primitives.pdf",
      sourceSha256: createHash("sha256").update(bytes).digest("hex"),
      page: 1,
      pageCount: 10,
      pageWidth: 600,
      pageHeight: 800,
      rotation: 0,
      cropBox: { x: 0, y: 0, width: 600, height: 800 },
      coordinateSystem: "normalized-top-left",
    });
    expect(first.primitiveCount).toBe(first.primitives.length);
    expect(first.primitiveCount).toBeGreaterThan(0);
  });

  it.each([
    [3, 90],
    [4, 180],
    [5, 270],
  ])("preserves page %s rotation metadata and finite visual geometry", async (page, rotation) => {
    const root = tempRoot();
    writeDrawingPrimitiveFixture(root);
    const result = await (await loadExtractor())(root, {
      relativePath: "docs/drawing-primitives.pdf",
      page,
    });

    expect(result.rotation).toBe(rotation);
    expect(result.primitives.length).toBeGreaterThan(0);
    const geometryValues = result.primitives.flatMap(
      ({ bbox, pageBBox, commands }) => [
        ...Object.values(bbox),
        ...Object.values(pageBBox),
        ...commands.flatMap(({ points }) =>
          points.flatMap(({ x, y }) => [x, y]),
        ),
      ],
    );

    expect(geometryValues.every(Number.isFinite)).toBe(true);
  });

  it("preserves the non-zero CropBox and off-page paths", async () => {
    const root = tempRoot();
    writeDrawingPrimitiveFixture(root);
    const result = await (await loadExtractor())(root, {
      relativePath: "docs/drawing-primitives.pdf",
      page: 6,
    });

    expect(result.cropBox).toEqual({ x: 50, y: 100, width: 400, height: 600 });
    expect(
      result.primitives.some((primitive) =>
        Object.values(primitive.bbox).some((value) => value < 0 || value > 1),
      ),
    ).toBe(true);
  });

  it("excludes clipping paths while keeping subsequent painted paths", async () => {
    const root = tempRoot();
    writeDrawingPrimitiveFixture(root);
    const result = await (await loadExtractor())(root, {
      relativePath: "docs/drawing-primitives.pdf",
      page: 7,
    });

    expect(result.primitiveCount).toBe(2);
    expect(result.warnings.every((warning) => !warning.includes("CLIP"))).toBe(true);
  });

  it("returns a normal zero-primitive page with the exact warning", async () => {
    const root = tempRoot();
    writeDrawingPrimitiveFixture(root);
    const result = await (await loadExtractor())(root, {
      relativePath: "docs/drawing-primitives.pdf",
      page: 10,
    });

    expect(result).toMatchObject({
      primitiveCount: 0,
      primitives: [],
      warnings: ["NO_PAINTED_PATHS: page contains no painted paths"],
    });
  });

  it.each([
    [{ relativePath: "docs/drawing-primitives.pdf" }, /page.*required|page/i],
    [{ relativePath: "docs/drawing-primitives.pdf", page: 0 }, /positive|page/i],
    [{ relativePath: "docs/drawing-primitives.pdf", page: 1.5 }, /integer/i],
    [{ relativePath: "docs/drawing-primitives.pdf", page: 11 }, /between.*1.*10|1.*10/i],
  ])("rejects invalid page input %#", async (input, message) => {
    const root = tempRoot();
    writeDrawingPrimitiveFixture(root);

    await expect((await loadExtractor())(root, input)).rejects.toThrow(message);
  });

  it.each([
    ["/tmp/spec.pdf", /relative/i],
    ["../spec.pdf", /PROJECT_ROOT|within/i],
    [".hidden/spec.pdf", /hidden/i],
    ["docs/spec.txt", /pdf/i],
  ])("rejects unsafe or unsupported path %s", async (relativePath, message) => {
    const root = tempRoot();
    writeProjectFile(root, "docs/spec.txt", "not PDF");

    await expect(
      (await loadExtractor())(root, { relativePath, page: 1 }),
    ).rejects.toThrow(message);
  });

  it("rejects a source symlink escaping PROJECT_ROOT", async () => {
    const root = tempRoot();
    const outside = tempRoot();
    writeDrawingPrimitiveFixture(outside, "outside.pdf");
    mkdirSync(join(root, "docs"), { recursive: true });
    symlinkSync(join(outside, "outside.pdf"), join(root, "docs", "linked.pdf"));

    await expect(
      (await loadExtractor())(root, {
        relativePath: "docs/linked.pdf",
        page: 1,
      }),
    ).rejects.toThrow(/PROJECT_ROOT|within|symbolic/i);
  });

  it("does not save when outputName is absent", async () => {
    const root = tempRoot();
    writeDrawingPrimitiveFixture(root);
    const result = await (await loadExtractor())(root, {
      relativePath: "docs/drawing-primitives.pdf",
      page: 1,
    });

    expect(result).not.toHaveProperty("relativePrimitivePath");
    expect(existsSync(join(root, ".volt-ai", "primitives"))).toBe(false);
  });

  it("rejects damaged PDFs and operator-list extraction failures", async () => {
    const root = tempRoot();
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(join(root, "docs", "damaged.pdf"), "%PDF damaged");

    await expect(
      (await loadExtractor())(root, {
        relativePath: "docs/damaged.pdf",
        page: 1,
      }),
    ).rejects.toThrow();
  });

  it("does not write application logs to stdout", async () => {
    const root = tempRoot();
    writeDrawingPrimitiveFixture(root);
    const writeSpy = vi.spyOn(process.stdout, "write");

    await (await loadExtractor())(root, {
      relativePath: "docs/drawing-primitives.pdf",
      page: 1,
    });

    expect(writeSpy).not.toHaveBeenCalled();
  });
});
