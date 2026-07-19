import { describe, expect, it } from "vitest";

import { analyzeSpatialGeometry } from "../src/drawingSpatial/geometry.js";

const box = (x: number, y: number, width: number, height: number) => ({
  x,
  y,
  width,
  height,
});

describe("page-space AABB spatial geometry", () => {
  it("classifies primitive containment and derives intersects", () => {
    expect(analyzeSpatialGeometry(box(0, 0, 20, 20), box(5, 5, 4, 3)))
      .toMatchObject({
        topology: "contains",
        relationTypes: ["contains", "intersects"],
        distancePt: 0,
        intersectionAreaPt2: 12,
      });
  });

  it("classifies a primitive inside a text entity", () => {
    expect(analyzeSpatialGeometry(box(5, 5, 2, 2), box(0, 0, 20, 20)))
      .toMatchObject({
        topology: "inside",
        relationTypes: ["inside", "intersects"],
        distancePt: 0,
        intersectionAreaPt2: 4,
      });
  });

  it("classifies positive-area partial overlap", () => {
    expect(analyzeSpatialGeometry(box(8, 5, 10, 10), box(0, 0, 10, 10)))
      .toMatchObject({
        topology: "overlaps",
        relationTypes: ["intersects", "overlaps"],
        distancePt: 0,
        intersectionAreaPt2: 10,
      });
  });

  it("gives equal bboxes the overlaps policy instead of dual containment", () => {
    expect(analyzeSpatialGeometry(box(1, 2, 3, 4), box(1, 2, 3, 4)))
      .toMatchObject({
        topology: "overlaps",
        relationTypes: ["intersects", "overlaps"],
      });
  });

  it.each([
    ["edge", box(10, 2, 4, 4)],
    ["corner", box(10, 10, 4, 4)],
  ])("treats %s contact as touches without intersects", (_name, primitive) => {
    expect(analyzeSpatialGeometry(primitive, box(0, 0, 10, 10))).toMatchObject({
      topology: "touches",
      relationTypes: ["touches"],
      distancePt: 0,
      intersectionAreaPt2: 0,
    });
  });

  it("applies the 0.01pt touch epsilon at the boundary", () => {
    expect(analyzeSpatialGeometry(box(10.009, 0, 2, 2), box(0, 0, 10, 2)))
      .toMatchObject({ topology: "touches", distancePt: 0 });
    expect(analyzeSpatialGeometry(box(10.011, 0, 2, 2), box(0, 0, 10, 2)))
      .toMatchObject({ topology: "disjoint", distancePt: 0.011 });
  });

  it("computes edge-to-edge gaps and Euclidean distance", () => {
    expect(analyzeSpatialGeometry(box(13, 14, 2, 2), box(0, 0, 10, 10)))
      .toMatchObject({
        topology: "disjoint",
        horizontalGapPt: 3,
        verticalGapPt: 4,
        distancePt: 5,
      });
  });

  it("uses zero gap on an axis whose projections overlap", () => {
    expect(analyzeSpatialGeometry(box(13, 4, 2, 2), box(0, 0, 10, 10)))
      .toMatchObject({
        horizontalGapPt: 3,
        verticalGapPt: 0,
        distancePt: 3,
      });
  });

  it("defines center delta as primitive center minus text center", () => {
    expect(analyzeSpatialGeometry(box(10, 20, 4, 6), box(2, 4, 2, 2)))
      .toMatchObject({
        centerDeltaXPt: 9,
        centerDeltaYPt: 18,
      });
  });

  it("rounds point metrics and area to three decimals and canonicalizes -0", () => {
    const result = analyzeSpatialGeometry(
      box(10.12349, 10, 1.23456, 1.23456),
      box(0, 10, 10.00001, 1.11111),
    );

    for (const value of [
      result.distancePt,
      result.horizontalGapPt,
      result.verticalGapPt,
      result.centerDeltaXPt,
      result.centerDeltaYPt,
      result.intersectionAreaPt2,
    ]) {
      expect(Number.isFinite(value)).toBe(true);
      expect(Object.is(value, -0)).toBe(false);
      expect(String(value).split(".")[1]?.length ?? 0).toBeLessThanOrEqual(3);
    }
  });

  it("retains off-page coordinates without clamping", () => {
    expect(analyzeSpatialGeometry(box(-20, -10, 5, 5), box(-18, -9, 1, 1)))
      .toMatchObject({ topology: "contains" });
  });

  it("handles identical zero-area bboxes with the equal-bbox policy", () => {
    expect(analyzeSpatialGeometry(box(5, 5, 0, 0), box(5, 5, 0, 0)))
      .toMatchObject({
        topology: "overlaps",
        relationTypes: ["intersects", "overlaps"],
        distancePt: 0,
        intersectionAreaPt2: 0,
      });
  });

  it("treats a point inside a positive-area text bbox as inside", () => {
    expect(analyzeSpatialGeometry(box(5, 5, 0, 0), box(0, 0, 10, 10)))
      .toMatchObject({
        topology: "inside",
        relationTypes: ["inside", "intersects"],
        distancePt: 0,
      });
  });

  it.each([
    [box(Number.NaN, 0, 1, 1), box(0, 0, 1, 1)],
    [box(0, 0, Number.POSITIVE_INFINITY, 1), box(0, 0, 1, 1)],
    [box(0, 0, -1, 1), box(0, 0, 1, 1)],
  ])("fails closed for invalid bbox input", (primitive, text) => {
    expect(() => analyzeSpatialGeometry(primitive, text)).toThrow(
      /bbox|finite|non-negative/i,
    );
  });
});

