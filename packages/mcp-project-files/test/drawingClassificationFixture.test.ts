import { describe, expect, it } from "vitest";

import {
  createDrawingClassificationFixture,
  makeClassificationDocument,
} from "./helpers/drawingClassificationFixture.js";

describe("drawing classification fixture", () => {
  it("self-validates deterministic source order, IDs, and geometry", () => {
    const first = createDrawingClassificationFixture();
    const second = createDrawingClassificationFixture();

    expect(second).toEqual(first);
    expect(first.primitiveCount).toBe(17);
    expect(first.primitives.map(({ sourceOrder }) => sourceOrder)).toEqual(
      Array.from({ length: 17 }, (_, index) => index),
    );
    expect(new Set(first.primitives.map(({ id }) => id)).size).toBe(17);
    expect(
      first.primitives.flatMap(({ commands }) =>
        commands.flatMap(({ points }) =>
          points.flatMap(({ x, y }) => [x, y]),
        ),
      ).every(Number.isFinite),
    ).toBe(true);
  });

  it("contains every structural fixture without importing classification code", () => {
    const ids = createDrawingClassificationFixture().primitives.map(({ id }) => id);

    expect(ids).toEqual(
      expect.arrayContaining([
        "line",
        "polyline",
        "axis-rectangle",
        "rotated-rectangle",
        "trapezoid",
        "triangle",
        "open-curve",
        "closed-curve",
        "compound-lines",
        "compound-curve-polygon",
        "tiny-line",
        "zero-length",
        "unknown-closed-segment",
        "line-duplicate",
        "parallelogram",
        "bow-tie",
        "concave-polygon",
      ]),
    );
  });

  it("supports a deterministic zero-primitive document", () => {
    const document = makeClassificationDocument([], [
      "NO_PAINTED_PATHS: page contains no painted paths",
    ]);

    expect(document).toMatchObject({
      primitiveCount: 0,
      primitives: [],
      warnings: ["NO_PAINTED_PATHS: page contains no painted paths"],
    });
  });
});
