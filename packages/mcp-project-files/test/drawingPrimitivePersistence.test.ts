import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { DrawingPrimitiveDocument } from "../src/drawingPrimitive/types.js";
import { writeDrawingPrimitives } from "../src/drawingPrimitive/writeDrawingPrimitives.js";
import { createTempPdfProject } from "./helpers/pdfFixture.js";

const roots: string[] = [];

function tempRoot(): string {
  const root = createTempPdfProject();
  roots.push(root);
  return root;
}

function document(
  overrides: Partial<DrawingPrimitiveDocument> = {},
): DrawingPrimitiveDocument {
  return {
    schemaVersion: 1,
    source: "docs/electrical.pdf",
    sourceSha256: "a".repeat(64),
    page: 69,
    pageCount: 100,
    pageWidth: 595,
    pageHeight: 842,
    rotation: 0,
    cropBox: { x: 0, y: 0, width: 595, height: 842 },
    coordinateSystem: "normalized-top-left",
    primitiveCount: 1,
    primitives: [
      {
        id: "primitive-000001",
        type: "path",
        paint: "stroke",
        fillRule: null,
        bbox: { x: 0.1, y: 0.2, width: 0.3, height: 0 },
        pageBBox: { x: 59.5, y: 168.4, width: 178.5, height: 0 },
        commands: [
          { command: "M", points: [{ x: 0.1, y: 0.2 }] },
          { command: "L", points: [{ x: 0.4, y: 0.2 }] },
        ],
        subpathCount: 1,
        closedSubpathCount: 0,
        style: {
          strokeWidthUserSpace: 1,
          lineCap: 0,
          lineJoin: 0,
          miterLimit: 10,
          dashArray: [],
          dashPhase: 0,
          strokeColor: "#000000",
          fillColor: "#000000",
          strokeAlpha: 1,
          fillAlpha: 1,
        },
        sourceOrder: 0,
        provenance: { operatorIndex: 17, pathOperatorCount: 2 },
      },
    ],
    warnings: [],
    ...overrides,
  };
}

describe("DrawingPrimitiveDocument deterministic persistence", () => {
  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("writes schema v1 to the deterministic PROJECT_ROOT-relative POSIX path", () => {
    const root = tempRoot();
    const value = document();
    const sourceHash = createHash("sha256")
      .update("docs/electrical.pdf", "utf8")
      .digest("hex")
      .slice(0, 12);

    const relativePath = writeDrawingPrimitives(root, value, "electrical-primitives");
    const stored = JSON.parse(
      readFileSync(join(root, relativePath), "utf8"),
    ) as DrawingPrimitiveDocument;

    expect(relativePath).toBe(
      `.volt-ai/primitives/electrical-primitives-${sourceHash}-page-069.json`,
    );
    expect(relativePath).not.toContain("\\");
    expect(stored).toEqual(value);
    expect(stored).not.toHaveProperty("relativePrimitivePath");
  });

  it("produces identical compact UTF-8 bytes with a trailing LF", () => {
    const root = tempRoot();
    const value = document({ warnings: ["도면 경로 보존"] });

    const firstPath = writeDrawingPrimitives(root, value, "도면 primitive");
    const firstBytes = readFileSync(join(root, firstPath));
    const secondPath = writeDrawingPrimitives(
      root,
      structuredClone(value),
      "도면 primitive",
    );
    const secondBytes = readFileSync(join(root, secondPath));
    const text = firstBytes.toString("utf8");

    expect(secondPath).toBe(firstPath);
    expect(secondBytes.equals(firstBytes)).toBe(true);
    expect(firstBytes.at(-1)).toBe(0x0a);
    expect(text).toContain("도면 경로 보존");
    expect(text).not.toContain("\n  ");
    expect(text).toBe(`${JSON.stringify(value)}\n`);
  });

  it("uses source-path hash to prevent same-basename collisions", () => {
    const root = tempRoot();
    const first = writeDrawingPrimitives(
      root,
      document({ source: "building-a/electrical.pdf" }),
      "primitives",
    );
    const second = writeDrawingPrimitives(
      root,
      document({ source: "building-b/electrical.pdf" }),
      "primitives",
    );

    expect(second).not.toBe(first);
    expect(existsSync(join(root, first))).toBe(true);
    expect(existsSync(join(root, second))).toBe(true);
  });

  it("normalizes NFKC-equivalent output names deterministically", () => {
    const root = tempRoot();
    expect(writeDrawingPrimitives(root, document(), "ＰＡＴＨ")).toBe(
      writeDrawingPrimitives(root, document(), "PATH"),
    );
  });

  it.each([
    ["", /outputName/i],
    ["   ", /outputName/i],
    [".hidden", /hidden|outputName/i],
    ["../escape", /separator|outputName|path/i],
    ["nested/name", /separator|outputName/i],
    ["nested\\name", /separator|outputName/i],
  ])("rejects unsafe outputName %j", (outputName, message) => {
    expect(() =>
      writeDrawingPrimitives(tempRoot(), document(), outputName),
    ).toThrow(message);
  });

  it("rejects a symbolic link in the output directory chain", () => {
    const root = tempRoot();
    const outside = tempRoot();
    symlinkSync(outside, join(root, ".volt-ai"));

    expect(() =>
      writeDrawingPrimitives(root, document(), "primitives"),
    ).toThrow(/symbolic/i);
  });

  it("rejects an existing symbolic-link target", () => {
    const root = tempRoot();
    const target = writeDrawingPrimitives(root, document(), "primitives");
    const absolute = join(root, target);
    const outside = join(root, "outside.json");
    writeFileSync(outside, "{}\n");
    rmSync(absolute);
    symlinkSync(outside, absolute);

    expect(() =>
      writeDrawingPrimitives(root, document(), "primitives"),
    ).toThrow(/symbolic/i);
  });

  it("rejects an existing directory or non-regular target", () => {
    const root = tempRoot();
    const target = writeDrawingPrimitives(root, document(), "primitives");
    const absolute = join(root, target);
    rmSync(absolute);
    mkdirSync(absolute);

    expect(() =>
      writeDrawingPrimitives(root, document(), "primitives"),
    ).toThrow(/regular|file/i);
  });

  it("cleans temporary files after deterministic overwrite", () => {
    const root = tempRoot();
    const target = writeDrawingPrimitives(root, document(), "primitives");
    writeDrawingPrimitives(
      root,
      document({ warnings: ["updated"] }),
      "primitives",
    );

    expect(readFileSync(join(root, target), "utf8")).toContain("updated");
    expect(
      readdirSync(dirname(join(root, target))).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
  });

  it("stores a zero-primitive page without adding excluded analysis fields", () => {
    const root = tempRoot();
    const target = writeDrawingPrimitives(
      root,
      document({
        primitiveCount: 0,
        primitives: [],
        warnings: ["NO_PAINTED_PATHS: page contains no painted paths"],
      }),
      "empty-primitives",
    );
    const stored = JSON.parse(
      readFileSync(join(root, target), "utf8"),
    ) as Record<string, unknown>;

    expect(stored).toMatchObject({ primitiveCount: 0, primitives: [] });
    expect(stored).not.toHaveProperty("symbols");
    expect(stored).not.toHaveProperty("connections");
    expect(stored).not.toHaveProperty("classifications");
  });

  it("stores a compact output larger than 10 MiB without truncation", () => {
    const root = tempRoot();
    const repeated = Array.from({ length: 24_000 }, (_, index) => ({
      ...document().primitives[0]!,
      id: `primitive-${String(index + 1).padStart(6, "0")}`,
      sourceOrder: index,
      provenance: { operatorIndex: index, pathOperatorCount: 2 },
    }));
    const value = document({
      primitiveCount: repeated.length,
      primitives: repeated,
    });
    const target = writeDrawingPrimitives(root, value, "large-primitives");

    expect(lstatSync(join(root, target)).size).toBeGreaterThan(10 * 1024 * 1024);
    expect(
      JSON.parse(readFileSync(join(root, target), "utf8")).primitiveCount,
    ).toBe(24_000);
  });
});
