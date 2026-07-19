import { describe, expect, it } from "vitest";

import type { DrawingPaintedPath } from "../src/drawingPrimitive/types.js";
import { createSpatialHashGrid } from "../src/drawingSpatial/spatialHashGrid.js";

const sharedCommands: DrawingPaintedPath["commands"] = [
  { command: "M", points: [{ x: 0, y: 0 }] },
  { command: "L", points: [{ x: 0.001, y: 0 }] },
];
const sharedStyle: DrawingPaintedPath["style"] = {
  strokeWidthUserSpace: 1,
  lineCap: 0,
  lineJoin: 0,
  miterLimit: 10,
  dashArray: [],
  dashPhase: 0,
  strokeColor: "#000000",
  fillColor: null,
  strokeAlpha: 1,
  fillAlpha: 1,
};

function syntheticPrimitive(sourceOrder: number): DrawingPaintedPath {
  const x = (sourceOrder % 1_000) * 0.5;
  const y = Math.floor(sourceOrder / 1_000) * 0.5;
  return {
    id: `synthetic-${sourceOrder}`,
    type: "path",
    paint: "stroke",
    fillRule: null,
    bbox: { x: x / 500, y: y / 50, width: 0.0002, height: 0 },
    pageBBox: { x, y, width: 0.1, height: 0 },
    commands: sharedCommands,
    subpathCount: 1,
    closedSubpathCount: 0,
    style: sharedStyle,
    sourceOrder,
    provenance: {
      operatorIndex: sourceOrder,
      pathOperatorCount: 1,
    },
  };
}

describe("drawing spatial structural performance", () => {
  it("indexes 100k primitives with linear diagnostics instead of all-pairs work", () => {
    const primitives = Array.from(
      { length: 100_000 },
      (_, sourceOrder) => syntheticPrimitive(sourceOrder),
    );
    const grid = createSpatialHashGrid(primitives);
    const candidates = grid.query(
      { x: 245, y: 20, width: 10, height: 5 },
      8,
    );

    expect(grid.diagnostics.gridReferenceCount).toBeLessThan(200_000);
    expect(grid.diagnostics.overflowPrimitiveCount).toBe(0);
    expect(candidates.length).toBeLessThan(100_000);
    expect(candidates.length).toBeGreaterThan(0);
  });

  it("does not deep-copy large primitive command or style payloads", () => {
    const primitives = Array.from(
      { length: 1_000 },
      (_, sourceOrder) => syntheticPrimitive(sourceOrder),
    );
    const commands = primitives.map(({ commands }) => commands);
    const styles = primitives.map(({ style }) => style);

    createSpatialHashGrid(primitives);

    expect(primitives.every((primitive, index) =>
      primitive.commands === commands[index]
    )).toBe(true);
    expect(primitives.every((primitive, index) =>
      primitive.style === styles[index]
    )).toBe(true);
  });
});

