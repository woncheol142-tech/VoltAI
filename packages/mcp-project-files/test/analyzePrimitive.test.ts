import { describe, expect, it } from "vitest";

import { analyzePrimitive } from "../src/drawingClassification/analyzePrimitive.js";
import {
  createDrawingClassificationFixture,
  makeClassificationPrimitive,
  pageCommands,
} from "./helpers/drawingClassificationFixture.js";

function primitive(id: string) {
  const value = createDrawingClassificationFixture().primitives.find(
    (candidate) => candidate.id === id,
  );
  if (!value) throw new Error(`fixture primitive missing: ${id}`);
  return value;
}

describe("primitive structural analysis", () => {
  it("counts commands, subpaths, closures, line segments, curves, and edges", () => {
    expect(analyzePrimitive(primitive("compound-curve-polygon"))).toMatchObject({
      commandCount: 6,
      subpathCount: 2,
      closedSubpathCount: 1,
      lineSegmentCount: 2,
      curveSegmentCount: 1,
      meaningfulEdgeCount: 4,
    });
  });

  it("uses commands as source of truth and rejects metadata disagreement", () => {
    const value = structuredClone(primitive("line"));
    value.subpathCount = 2;

    expect(() => analyzePrimitive(value)).toThrow(/subpath|metadata|corrupt/i);
  });

  it("does not count coincident L commands as meaningful edges", () => {
    const value = makeClassificationPrimitive({
      id: "coincident",
      sourceOrder: 0,
      commands: [
        { command: "M", points: [[100, 100]] },
        { command: "L", points: [[100, 100]] },
        { command: "L", points: [[200, 100]] },
      ],
    });

    expect(analyzePrimitive(value)).toMatchObject({
      commandCount: 3,
      lineSegmentCount: 2,
      meaningfulEdgeCount: 1,
    });
  });

  it("recognizes Z and repeated-first-point closure without double-counting", () => {
    const zClosed = makeClassificationPrimitive({
      id: "z",
      sourceOrder: 0,
      commands: pageCommands.polygon([
        [100, 100],
        [200, 100],
        [150, 200],
      ]),
      closedSubpathCount: 1,
    });
    const repeated = makeClassificationPrimitive({
      id: "repeat",
      sourceOrder: 0,
      commands: pageCommands.polygon(
        [
          [100, 100],
          [200, 100],
          [150, 200],
        ],
        "repeat",
      ),
      closedSubpathCount: 0,
    });

    expect(analyzePrimitive(zClosed).meaningfulEdgeCount).toBe(3);
    expect(analyzePrimitive(repeated)).toMatchObject({
      closedSubpathCount: 0,
      meaningfulEdgeCount: 3,
      isClosed: true,
    });
  });

  it("does not mutate commands or their points", () => {
    const value = primitive("closed-curve");
    const before = structuredClone(value);
    Object.freeze(value.commands);

    analyzePrimitive(value);

    expect(value).toEqual(before);
  });
});
