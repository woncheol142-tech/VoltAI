import { describe, expect, it } from "vitest";

import { createSpatialHashGrid } from "../src/drawingSpatial/spatialHashGrid.js";
import {
  makeSpatialPrimitive,
  makeSpatialTextItem,
} from "./helpers/drawingSpatialFixture.js";

function edgeDistance(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
): number {
  const horizontal = Math.max(
    left.x - (right.x + right.width),
    right.x - (left.x + left.width),
    0,
  );
  const vertical = Math.max(
    left.y - (right.y + right.height),
    right.y - (left.y + left.height),
    0,
  );
  return Math.hypot(horizontal, vertical);
}

function pseudoRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

describe("spatial hash broad-phase oracle", () => {
  it("matches brute force for every candidate within the 8pt radius", () => {
    const random = pseudoRandom(43_003);
    const primitives = Array.from({ length: 250 }, (_, sourceOrder) =>
      makeSpatialPrimitive({
        id: `primitive-${sourceOrder}`,
        sourceOrder,
        pageBBox: {
          x: random() * 180 - 20,
          y: random() * 180 - 20,
          width: random() * 20,
          height: random() * 20,
        },
      })
    );
    const items = Array.from({ length: 40 }, (_, sourceOrder) =>
      makeSpatialTextItem({
        id: `item-${sourceOrder}`,
        sourceOrder,
        pageBBox: {
          x: random() * 160,
          y: random() * 160,
          width: 2 + random() * 12,
          height: 2 + random() * 12,
        },
      })
    );
    const grid = createSpatialHashGrid(primitives);

    for (const item of items) {
      const expected = primitives
        .map((primitive, index) => ({ primitive, index }))
        .filter(
          ({ primitive }) =>
            edgeDistance(item.pageBBox, primitive.pageBBox) <= 8,
        )
        .map(({ index }) => index)
        .sort((left, right) => left - right);
      const actual = grid
        .query(item.pageBBox, 8)
        .filter(
          (index) =>
            edgeDistance(item.pageBBox, primitives[index]!.pageBBox) <= 8,
        )
        .sort((left, right) => left - right);

      expect(actual).toEqual(expected);
    }
  });

  it("never returns an index outside the primitive array", () => {
    const primitives = [
      makeSpatialPrimitive({
        id: "only",
        sourceOrder: 0,
        pageBBox: { x: 0, y: 0, width: 10, height: 10 },
      }),
    ];

    expect(
      createSpatialHashGrid(primitives)
        .query({ x: -100, y: -100, width: 300, height: 300 }, 8)
        .every((index) => index >= 0 && index < primitives.length),
    ).toBe(true);
  });
});

