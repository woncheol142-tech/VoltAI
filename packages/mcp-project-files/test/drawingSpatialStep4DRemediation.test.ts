import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { buildDrawingSpatialRelations } from "../src/drawingSpatial/buildDrawingSpatialRelations.js";
import { analyzeSpatialGeometry } from "../src/drawingSpatial/geometry.js";
import { createDrawingSpatialFixture } from "./helpers/drawingSpatialFixture.js";

describe("drawing spatial Step 4D intersection-area compatibility remediation", () => {
  it("uses the stable final area when axis compatibility error is amplified", () => {
    const x = 2 ** 40;
    const box = {
      x,
      y: 0,
      width: 0.0003,
      height: 1_000_000_000,
    };

    const result = analyzeSpatialGeometry(box, box);

    expect(result.topology).toBe("overlaps");
    expect(result.rawIntersectionAreaPt2).toBeCloseTo(300_000, 9);
    expect(result.intersectionAreaPt2).toBe(300_000);
  });

  it("keeps ordinary legacy and stable area bytes identical", () => {
    const result = analyzeSpatialGeometry(
      { x: 8, y: 5, width: 10, height: 10 },
      { x: 0, y: 0, width: 10, height: 10 },
    );

    expect(JSON.stringify(result)).toBe(
      '{"basis":"page-bbox","topology":"overlaps","relationTypes":["intersects","overlaps"],"distancePt":0,"rawHorizontalGapPt":0,"rawVerticalGapPt":0,"rawDistancePt":0,"rawCenterDeltaXPt":8,"rawCenterDeltaYPt":5,"rawIntersectionAreaPt2":10,"horizontalGapPt":0,"verticalGapPt":0,"centerDeltaXPt":8,"centerDeltaYPt":5,"intersectionAreaPt2":10}',
    );
  });

  it("preserves fractional small-area public rounding", () => {
    const x = 2 ** 40;
    const result = analyzeSpatialGeometry(
      { x, y: 0, width: 0.0012, height: 0.5 },
      { x, y: 0, width: 0.0012, height: 0.5 },
    );

    expect(result.rawIntersectionAreaPt2).toBe(0.0006);
    expect(result.intersectionAreaPt2).toBe(0.001);
  });

  it("does not change ULP-safe topology decisions", () => {
    const x = 2 ** 56;

    expect(
      analyzeSpatialGeometry(
        { x, y: 0, width: 16, height: 2 },
        { x: x + 16, y: 0, width: 0, height: 2 },
      ),
    ).toMatchObject({
      topology: "contains",
      horizontalGapPt: 0,
      verticalGapPt: 0,
      distancePt: 0,
    });
  });

  it("keeps the deterministic page compatibility fixture byte-identical", () => {
    const json = JSON.stringify(
      buildDrawingSpatialRelations(createDrawingSpatialFixture()),
    );

    expect(json).toHaveLength(8_906);
    expect(createHash("sha256").update(json).digest("hex")).toBe(
      "2b66fe6f4741044b1166bbef306442bcff8d234193c4681793f0c23402a7b6dd",
    );
  });
});
