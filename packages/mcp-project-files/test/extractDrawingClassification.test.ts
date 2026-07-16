import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DrawingPrimitiveClassificationDocument } from "../src/drawingClassification/types.js";
import { createTempPdfProject, writeProjectFile } from "./helpers/pdfFixture.js";
import {
  createDrawingPrimitivePdfFixture,
  writeDrawingPrimitiveFixture,
} from "./helpers/drawingPrimitiveFixture.js";

type ExtractDrawingClassification = (
  projectRoot: string | undefined,
  input: unknown,
) => Promise<DrawingPrimitiveClassificationDocument>;

const modulePath = "../src/tools/extractDrawingClassification.js";
const roots: string[] = [];

async function loadExtractor(): Promise<ExtractDrawingClassification> {
  const module = (await import(modulePath)) as {
    extractDrawingClassification: ExtractDrawingClassification;
  };
  return module.extractDrawingClassification;
}

function tempRoot(): string {
  const root = createTempPdfProject();
  roots.push(root);
  return root;
}

describe("extract_drawing_classification tool", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("derives one classification per extracted primitive", async () => {
    const root = tempRoot();
    const bytes = createDrawingPrimitivePdfFixture();
    writeDrawingPrimitiveFixture(root);
    const result = await (await loadExtractor())(root, {
      relativePath: "docs/drawing-primitives.pdf",
      page: 9,
    });

    expect(result).toMatchObject({
      schemaVersion: 1,
      source: "docs/drawing-primitives.pdf",
      sourceSha256: createHash("sha256").update(bytes).digest("hex"),
      page: 9,
      primitiveCount: 4,
      classificationCount: 4,
    });
    expect(result.classifications).toHaveLength(4);
    expect(result.classifications.map(({ kind }) => kind)).toEqual([
      "zeroLength",
      "tiny",
      "line",
      "line",
    ]);
    expect(result.statistics).toMatchObject({
      zeroLength: 1,
      tiny: 1,
      line: 2,
      duplicateGroupCount: 1,
      duplicateMemberCount: 2,
    });
  });

  it("does not save primitive or classification artifacts without outputName", async () => {
    const root = tempRoot();
    writeDrawingPrimitiveFixture(root);

    await (await loadExtractor())(root, {
      relativePath: "docs/drawing-primitives.pdf",
      page: 1,
    });

    expect(existsSync(join(root, ".volt-ai", "primitives"))).toBe(false);
    expect(existsSync(join(root, ".volt-ai", "classifications"))).toBe(false);
  });

  it("saves only the classification document when outputName is present", async () => {
    const root = tempRoot();
    writeDrawingPrimitiveFixture(root);
    const result = await (await loadExtractor())(root, {
      relativePath: "docs/drawing-primitives.pdf",
      page: 1,
      outputName: "page classification",
    });
    const directory = join(root, ".volt-ai", "classifications");
    const files = (await import("node:fs")).readdirSync(directory);

    expect(files).toHaveLength(1);
    expect(existsSync(join(root, ".volt-ai", "primitives"))).toBe(false);
    expect(
      JSON.parse(readFileSync(join(directory, files[0]!), "utf8")),
    ).toEqual(result);
    expect(result).not.toHaveProperty("relativeClassificationPath");
  });

  it("returns a normal empty classification for a zero-primitive page", async () => {
    const root = tempRoot();
    writeDrawingPrimitiveFixture(root);
    const result = await (await loadExtractor())(root, {
      relativePath: "docs/drawing-primitives.pdf",
      page: 10,
      outputName: "empty",
    });

    expect(result).toMatchObject({
      primitiveCount: 0,
      classificationCount: 0,
      classifications: [],
      warnings: ["NO_PAINTED_PATHS: page contains no painted paths"],
    });
    expect(Object.values(result.statistics).every((count) => count === 0)).toBe(
      true,
    );
  });

  it.each([
    [{ relativePath: "docs/drawing-primitives.pdf" }, /page.*required|page/i],
    [{ relativePath: "docs/drawing-primitives.pdf", page: 0 }, /positive|page/i],
    [{ relativePath: "docs/drawing-primitives.pdf", page: 1.5 }, /integer/i],
    [{ relativePath: "docs/drawing-primitives.pdf", page: 11 }, /between.*1.*10/i],
    [{ relativePath: "../drawing-primitives.pdf", page: 1 }, /PROJECT_ROOT|within/i],
    [{ relativePath: ".hidden/drawing.pdf", page: 1 }, /hidden/i],
    [{ relativePath: "docs/drawing.txt", page: 1 }, /pdf/i],
  ])("preserves primitive extractor validation for %#", async (input, message) => {
    const root = tempRoot();
    writeDrawingPrimitiveFixture(root);
    writeProjectFile(root, "docs/drawing.txt", "not pdf");

    await expect((await loadExtractor())(root, input)).rejects.toThrow(message);
  });

  it("writes no application logs to stdout", async () => {
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
