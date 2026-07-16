import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type {
  DrawingPaintedPath,
  DrawingPathCommand,
  DrawingPrimitiveDocument,
} from "../src/drawingPrimitive/types.js";

const testFile = fileURLToPath(import.meta.url);
const packageRoot = join(dirname(testFile), "..");
const workspaceRoot = join(packageRoot, "..", "..");
const typescriptCli = join(workspaceRoot, "node_modules", "typescript", "bin", "tsc");

const commands = [
  { command: "M", points: [{ x: -0.1, y: 0.2 }] },
  { command: "L", points: [{ x: 1.1, y: 0.2 }] },
  {
    command: "C",
    points: [
      { x: 0.2, y: 0.3 },
      { x: 0.4, y: 0.5 },
      { x: 0.6, y: 0.7 },
    ],
  },
  {
    command: "Q",
    points: [{ x: 0.3, y: 0.4 }, { x: 0.5, y: 0.6 }],
  },
  { command: "Z", points: [] },
] satisfies DrawingPathCommand[];

const primitive = {
  id: "primitive-000001",
  type: "path",
  paint: "fill-stroke",
  fillRule: "evenodd",
  bbox: { x: -0.1, y: 0.2, width: 1.2, height: 0.5 },
  pageBBox: { x: -60, y: 160, width: 720, height: 400 },
  commands,
  subpathCount: 1,
  closedSubpathCount: 1,
  style: {
    strokeWidthUserSpace: 0,
    lineCap: 1,
    lineJoin: 2,
    miterLimit: 10,
    dashArray: [4, 2],
    dashPhase: 1,
    strokeColor: "#000000",
    fillColor: [0.2, 0.3, 0.4],
    strokeAlpha: 0,
    fillAlpha: 1,
  },
  sourceOrder: 0,
  provenance: { operatorIndex: 17, pathOperatorCount: 5 },
} satisfies DrawingPaintedPath;

const document = {
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
  primitives: [primitive],
  warnings: [],
} satisfies DrawingPrimitiveDocument;

describe("drawing primitive public type contract", () => {
  it("compiles the public schema v1 contract", () => {
    expect(() =>
      execFileSync(
        process.execPath,
        [
          typescriptCli,
          "--noEmit",
          "--strict",
          "--target",
          "ES2022",
          "--module",
          "NodeNext",
          "--moduleResolution",
          "NodeNext",
          "--skipLibCheck",
          testFile,
        ],
        { cwd: workspaceRoot, stdio: "pipe" },
      ),
    ).not.toThrow();
  });

  it("supports exactly M/L/C/Q/Z normalized commands", () => {
    expect(commands.map(({ command }) => command)).toEqual(["M", "L", "C", "Q", "Z"]);
    expect(commands[0]?.points[0]?.x).toBeLessThan(0);
    expect(commands[1]?.points[0]?.x).toBeGreaterThan(1);
  });

  it("keeps painted-path style and provenance fields typed", () => {
    expect(primitive).toMatchObject({
      type: "path",
      paint: "fill-stroke",
      fillRule: "evenodd",
      sourceOrder: 0,
      provenance: { operatorIndex: 17, pathOperatorCount: 5 },
    });
  });

  it("keeps schema v1 document metadata and optional persistence path", () => {
    const persisted: DrawingPrimitiveDocument = {
      ...document,
      relativePrimitivePath: ".volt-ai/primitives/electrical-page-069.json",
    };

    expect(persisted).toMatchObject({
      schemaVersion: 1,
      coordinateSystem: "normalized-top-left",
      primitiveCount: 1,
    });
  });
});
