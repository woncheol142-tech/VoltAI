import { describe, expect, it } from "vitest";

import { createSpatialHashGrid } from "../src/drawingSpatial/spatialHashGrid.js";
import {
  makeSpatialPrimitive,
  makeSpatialPrimitiveDocument,
} from "./helpers/drawingSpatialFixture.js";

function makePrimitive(
  id: string,
  sourceOrder: number,
  x: number,
  y: number,
  width = 1,
  height = 1,
) {
  return makeSpatialPrimitive({
    id,
    sourceOrder,
    pageBBox: { x, y, width, height },
  });
}

describe("8pt numeric spatial hash grid", () => {
  it("returns numeric primitive indexes from expanded query cells", () => {
    const primitives = [
      makePrimitive("first", 0, 0, 0),
      makePrimitive("second", 1, 20, 0),
    ];
    const grid = createSpatialHashGrid(primitives);

    expect(grid.query({ x: 9, y: 0, width: 1, height: 1 }, 8)).toEqual([0]);
    expect(grid.query({ x: 11, y: 0, width: 1, height: 1 }, 8)).toEqual([1]);
  });

  it("indexes zero-area and tiny primitives", () => {
    const grid = createSpatialHashGrid([
      makePrimitive("zero", 0, 4, 4, 0, 0),
      makePrimitive("tiny", 1, 4.1, 4.1, 0.1, 0.1),
    ]);

    expect(grid.query({ x: 4, y: 4, width: 0, height: 0 }, 0)).toEqual([
      0,
      1,
    ]);
  });

  it("supports negative off-page cell coordinates", () => {
    const grid = createSpatialHashGrid([
      makePrimitive("negative", 0, -20, -12, 2, 2),
    ]);

    expect(grid.query({ x: -20, y: -12, width: 1, height: 1 }, 0)).toEqual([
      0,
    ]);
  });

  it("includes exact cell-boundary geometry without losing candidates", () => {
    const grid = createSpatialHashGrid([
      makePrimitive("left", 0, 0, 0, 8, 8),
      makePrimitive("right", 1, 8, 0, 8, 8),
    ]);

    expect(grid.query({ x: 8, y: 0, width: 0, height: 8 }, 0)).toEqual([
      0,
      1,
    ]);
  });

  it("keeps exactly 64-cell primitives in regular buckets", () => {
    const grid = createSpatialHashGrid([
      makePrimitive("sixty-four", 0, 0, 0, 63.999, 63.999),
    ]);

    expect(grid.diagnostics).toMatchObject({
      overflowPrimitiveCount: 0,
      gridReferenceCount: 64,
    });
  });

  it("moves 65-or-more-cell primitives to the overflow list", () => {
    const grid = createSpatialHashGrid([
      makePrimitive("overflow", 0, 0, 0, 64.001, 63.999),
    ]);

    expect(grid.diagnostics.overflowPrimitiveCount).toBe(1);
    expect(grid.query({ x: 180, y: 180, width: 1, height: 1 }, 0)).toEqual([
      0,
    ]);
  });

  it("deduplicates candidates shared by multiple cells and overflow", () => {
    const grid = createSpatialHashGrid([
      makePrimitive("multi", 0, 0, 0, 15, 15),
      makePrimitive("overflow", 1, -100, -100, 400, 400),
    ]);

    expect(grid.query({ x: 0, y: 0, width: 16, height: 16 }, 8)).toEqual([
      0,
      1,
    ]);
  });

  it("does not mutate or reorder primitive inputs", () => {
    const primitives = [
      makePrimitive("later", 1, 20, 0),
      makePrimitive("first", 0, 0, 0),
    ];
    const before = structuredClone(primitives);
    Object.freeze(primitives);

    expect(() => createSpatialHashGrid(primitives)).not.toThrow();
    expect(primitives).toEqual(before);
  });

  it("is independent of bucket insertion order", () => {
    const primitives = [
      makePrimitive("two", 2, 16, 0),
      makePrimitive("zero", 0, 0, 0),
      makePrimitive("one", 1, 8, 0),
    ];
    const first = createSpatialHashGrid(primitives);
    const second = createSpatialHashGrid([...primitives].reverse());

    expect(
      first.query({ x: 0, y: 0, width: 24, height: 8 }, 0)
        .map((index) => primitives[index]!.id)
        .sort(),
    ).toEqual(
      second.query({ x: 0, y: 0, width: 24, height: 8 }, 0)
        .map((index) => [...primitives].reverse()[index]!.id)
        .sort(),
    );
  });

  it("fails closed for malformed primitive bboxes", () => {
    const primitive = makePrimitive("bad", 0, 0, 0);
    primitive.pageBBox.width = Number.NaN;

    expect(() => createSpatialHashGrid([primitive])).toThrow(/bbox|finite/i);
  });

  it("accepts an empty primitive document", () => {
    const document = makeSpatialPrimitiveDocument([]);
    const grid = createSpatialHashGrid(document.primitives);

    expect(grid.query({ x: 0, y: 0, width: 10, height: 10 }, 8)).toEqual([]);
    expect(grid.diagnostics).toEqual({
      gridBucketCount: 0,
      gridReferenceCount: 0,
      overflowPrimitiveCount: 0,
    });
  });
});

