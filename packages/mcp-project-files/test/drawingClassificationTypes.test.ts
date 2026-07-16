import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type {
  DrawingPrimitiveClassificationDocument,
  PrimitiveClassification,
  PrimitiveClassificationDiagnostics,
  PrimitiveClassificationKind,
  PrimitiveClassificationStatistics,
} from "../src/drawingClassification/types.js";

const testFile = fileURLToPath(import.meta.url);
const packageRoot = join(dirname(testFile), "..");
const workspaceRoot = join(packageRoot, "..", "..");
const typescriptCli = join(workspaceRoot, "node_modules", "typescript", "bin", "tsc");

const kinds = [
  "zeroLength",
  "tiny",
  "compoundPath",
  "curve",
  "rectangleCandidate",
  "closedPolygon",
  "polyline",
  "line",
  "unknown",
] as const satisfies readonly PrimitiveClassificationKind[];

const diagnostics = {
  commandCount: 2,
  subpathCount: 1,
  closedSubpathCount: 0,
  lineSegmentCount: 1,
  curveSegmentCount: 0,
  meaningfulEdgeCount: 1,
  duplicateGroupId: null,
  duplicateCount: 1,
} satisfies PrimitiveClassificationDiagnostics;

const classification = {
  primitiveId: "primitive-000001",
  kind: "line",
  confidence: 1,
  diagnostics,
  geometry: {
    bbox: { x: 0.1, y: 0.2, width: 0.3, height: 0 },
    pageBBox: { x: 100, y: 200, width: 300, height: 0 },
  },
} satisfies PrimitiveClassification;

const statistics = {
  zeroLength: 0,
  tiny: 0,
  compoundPath: 0,
  curve: 0,
  rectangleCandidate: 0,
  closedPolygon: 0,
  polyline: 0,
  line: 1,
  unknown: 0,
  duplicateGroupCount: 0,
  duplicateMemberCount: 0,
} satisfies PrimitiveClassificationStatistics;

const document = {
  schemaVersion: 1,
  source: "docs/electrical.pdf",
  sourceSha256: "a".repeat(64),
  page: 69,
  primitiveCount: 1,
  classificationCount: 1,
  statistics,
  classifications: [classification],
  warnings: [],
} satisfies DrawingPrimitiveClassificationDocument;

describe("drawing classification public type contract", () => {
  it("compiles the schema v1 contract", () => {
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

  it("fixes the primary kind order and one-classification schema", () => {
    expect(kinds).toEqual([
      "zeroLength",
      "tiny",
      "compoundPath",
      "curve",
      "rectangleCandidate",
      "closedPolygon",
      "polyline",
      "line",
      "unknown",
    ]);
    expect(document.classificationCount).toBe(document.classifications.length);
  });

  it("does not add unapproved page metadata or persistence fields", () => {
    expect(document).not.toHaveProperty("pageCount");
    expect(document).not.toHaveProperty("pageWidth");
    expect(document).not.toHaveProperty("pageHeight");
    expect(document).not.toHaveProperty("relativeClassificationPath");
  });
});
