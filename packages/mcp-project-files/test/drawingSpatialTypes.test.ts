import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, expectTypeOf, it } from "vitest";

import type { PrimitiveClassificationKind } from "../src/drawingClassification/types.js";
import type {
  DrawingSpatialRelationDocument,
  SpatialRelation,
  SpatialRelationType,
  SpatialTopology,
} from "../src/drawingSpatial/types.js";

const testFile = fileURLToPath(import.meta.url);
const packageRoot = join(dirname(testFile), "..");
const workspaceRoot = join(packageRoot, "..", "..");
const typescriptCli = join(
  workspaceRoot,
  "node_modules",
  "typescript",
  "bin",
  "tsc",
);

describe("drawing spatial public type contract", () => {
  it("compiles the public schema-v1 contract", () => {
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
      )
    ).not.toThrow();
  });

  it("provides a runtime-resolvable spatial type module", async () => {
    await expect(import("../src/drawingSpatial/types.js")).resolves.toBeTypeOf(
      "object",
    );
  });

  it("fixes the schema-v1 relation and document shapes", () => {
    const relation: SpatialRelation = {
      id: "relation-1234567890abcdef",
      textEntityType: "item",
      textEntityId: "item-1",
      primitiveId: "primitive-1",
      primitiveKind: "rectangleCandidate",
      primitiveSourceOrder: 0,
      relationTypes: ["contains", "intersects"],
      distancePt: 0,
      rank: null,
      geometry: {
        basis: "page-bbox",
        topology: "contains",
        horizontalGapPt: 0,
        verticalGapPt: 0,
        centerDeltaXPt: 1,
        centerDeltaYPt: 2,
        intersectionAreaPt2: 10,
      },
    };
    const document = {
      schemaVersion: 1,
      source: "docs/spatial.pdf",
      sourceSha256: "a".repeat(64),
      page: 15,
      pageWidth: 200,
      pageHeight: 200,
      textItemCount: 1,
      textLineCount: 0,
      primitiveCount: 1,
      relationCount: 1,
      policy: {
        geometryBasis: "page-bbox",
        cellSizePt: 8,
        touchEpsilonPt: 0.01,
        adjacentDistancePt: 2,
        nearestRadiusPt: 8,
        alignmentTolerancePt: 1,
        maxProximityPerTextEntity: 8,
      },
      statistics: {
        textEntityCount: 1,
        candidatePairCount: 1,
        relationCount: 1,
        topology: {
          contains: 1,
          inside: 0,
          overlaps: 0,
          touches: 0,
          disjoint: 0,
        },
        relationTypes: {
          contains: 1,
          inside: 0,
          intersects: 1,
          touches: 0,
          overlaps: 0,
          nearest: 0,
          aligned: 0,
          adjacent: 0,
        },
        proximityTruncatedEntityCount: 0,
        gridBucketCount: 1,
        gridReferenceCount: 1,
        overflowPrimitiveCount: 0,
      },
      relations: [relation],
      warnings: [],
    } satisfies DrawingSpatialRelationDocument;

    expect(document.relations).toEqual([relation]);
    expectTypeOf(relation.primitiveKind).toEqualTypeOf<
      PrimitiveClassificationKind
    >();
  });

  it("keeps topology and relation tags as closed unions", () => {
    expectTypeOf<SpatialTopology>().toEqualTypeOf<
      "contains" | "inside" | "overlaps" | "touches" | "disjoint"
    >();
    expectTypeOf<SpatialRelationType>().toEqualTypeOf<
      | "contains"
      | "inside"
      | "intersects"
      | "touches"
      | "overlaps"
      | "nearest"
      | "aligned"
      | "adjacent"
    >();
  });

  it("does not copy semantic text or primitive commands into relations", () => {
    expectTypeOf<SpatialRelation>().not.toHaveProperty("text");
    expectTypeOf<SpatialRelation>().not.toHaveProperty("commands");
    expectTypeOf<DrawingSpatialRelationDocument>().not.toHaveProperty(
      "primitives",
    );
    expectTypeOf<DrawingSpatialRelationDocument>().not.toHaveProperty(
      "classifications",
    );
    expectTypeOf<DrawingSpatialRelationDocument>().not.toHaveProperty(
      "relativeSpatialPath",
    );
  });
});
