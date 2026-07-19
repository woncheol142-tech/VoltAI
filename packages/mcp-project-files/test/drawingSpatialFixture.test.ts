import { describe, expect, it } from "vitest";

import {
  createDrawingSpatialFixture,
  SPATIAL_PAGE_HEIGHT,
  SPATIAL_PAGE_WIDTH,
} from "./helpers/drawingSpatialFixture.js";

describe("drawing spatial fixture", () => {
  it("is deterministic without importing the spatial implementation", () => {
    expect(createDrawingSpatialFixture()).toEqual(createDrawingSpatialFixture());
  });

  it("keeps all cross-document provenance and counts aligned", () => {
    const { layout, primitive, classification } = createDrawingSpatialFixture();

    expect([layout.source, primitive.source, classification.source]).toEqual([
      layout.source,
      layout.source,
      layout.source,
    ]);
    expect([
      layout.sourceSha256,
      primitive.sourceSha256,
      classification.sourceSha256,
    ]).toEqual([
      layout.sourceSha256,
      layout.sourceSha256,
      layout.sourceSha256,
    ]);
    expect(layout).toMatchObject({
      pageWidth: SPATIAL_PAGE_WIDTH,
      pageHeight: SPATIAL_PAGE_HEIGHT,
      itemCount: layout.items.length,
      lineCount: layout.lines.length,
    });
    expect(primitive.primitiveCount).toBe(primitive.primitives.length);
    expect(classification.primitiveCount).toBe(primitive.primitiveCount);
    expect(classification.classificationCount).toBe(
      classification.classifications.length,
    );
  });

  it("contains item, line, topology, proximity, zero-area, and off-page cases", () => {
    const { layout, primitive, classification } = createDrawingSpatialFixture();

    expect(layout.items.map(({ id }) => id)).toEqual(
      expect.arrayContaining([
        "item-inside",
        "item-contains",
        "item-overlap",
        "item-edge-touch",
        "item-corner-touch",
        "item-proximity",
        "item-equal",
        "item-zero-area",
        "item-off-page",
        "item-duplicate-geometry-a",
        "item-duplicate-geometry-b",
      ]),
    );
    expect(layout.lines.map(({ id }) => id)).toEqual([
      "line-inside",
      "line-proximity",
      "line-zero-area",
    ]);
    expect(primitive.primitives.map(({ id }) => id)).toEqual(
      expect.arrayContaining([
        "primitive-container",
        "primitive-inside",
        "primitive-overlap",
        "primitive-edge-touch",
        "primitive-corner-touch",
        "primitive-adjacent",
        "primitive-nearest",
        "primitive-nearest-excluded",
        "primitive-equal",
        "primitive-zero-area",
        "primitive-off-page",
        "primitive-duplicate-geometry-a",
        "primitive-duplicate-geometry-b",
        "primitive-large-overflow",
      ]),
    );
    expect([
      ...new Set(classification.classifications.map(({ kind }) => kind)),
    ].sort()).toEqual([
      "compoundPath",
      "curve",
      "line",
      "polyline",
      "rectangleCandidate",
      "tiny",
      "zeroLength",
    ]);
  });

  it("uses unique IDs and contiguous primitive sourceOrder", () => {
    const { layout, primitive, classification } = createDrawingSpatialFixture();

    expect(new Set(layout.items.map(({ id }) => id)).size).toBe(
      layout.items.length,
    );
    expect(new Set(layout.lines.map(({ id }) => id)).size).toBe(
      layout.lines.length,
    );
    expect(new Set(primitive.primitives.map(({ id }) => id)).size).toBe(
      primitive.primitives.length,
    );
    expect(primitive.primitives.map(({ sourceOrder }) => sourceOrder)).toEqual(
      Array.from(
        { length: primitive.primitives.length },
        (_, sourceOrder) => sourceOrder,
      ),
    );
    expect(classification.classifications.map(({ primitiveId }) => primitiveId))
      .toEqual(primitive.primitives.map(({ id }) => id));
  });
});
