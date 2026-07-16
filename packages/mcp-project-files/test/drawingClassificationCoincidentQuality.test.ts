import { describe, expect, it } from "vitest";

import { analyzePrimitive } from "../src/drawingClassification/analyzePrimitive.js";
import { classifyDrawingPrimitives } from "../src/drawingClassification/classifyDrawingPrimitives.js";
import {
  makeClassificationDocument,
  makeClassificationPrimitive,
} from "./helpers/drawingClassificationFixture.js";

type PageCommand = Parameters<
  typeof makeClassificationPrimitive
>[0]["commands"][number];

function classify(commands: PageCommand[]) {
  const primitive = makeClassificationPrimitive({
    id: "coincident-path",
    sourceOrder: 0,
    commands,
  });
  const analysis = analyzePrimitive(primitive, 1_000, 1_000);
  const classification = classifyDrawingPrimitives(
    makeClassificationDocument([primitive]),
  ).classifications[0]!;
  return { primitive, analysis, classification };
}

describe("coincident segment line classification quality regression", () => {
  it("classifies a coincident L before one meaningful L as line", () => {
    const result = classify([
      { command: "M", points: [[0, 0]] },
      { command: "L", points: [[0, 0]] },
      { command: "L", points: [[10, 0]] },
    ]);

    expect(result.analysis).toMatchObject({
      lineSegmentCount: 2,
      meaningfulEdgeCount: 1,
      isClosed: false,
    });
    expect(result.classification.kind).toBe("line");
  });

  it("classifies a coincident L after one meaningful L as line", () => {
    const result = classify([
      { command: "M", points: [[0, 0]] },
      { command: "L", points: [[10, 0]] },
      { command: "L", points: [[10, 0]] },
    ]);

    expect(result.analysis).toMatchObject({
      lineSegmentCount: 2,
      meaningfulEdgeCount: 1,
      isClosed: false,
    });
    expect(result.classification.kind).toBe("line");
  });

  it("ignores multiple coincident L commands around one meaningful edge", () => {
    const result = classify([
      { command: "M", points: [[0, 0]] },
      { command: "L", points: [[0, 0]] },
      { command: "L", points: [[0, 0]] },
      { command: "L", points: [[10, 0]] },
      { command: "L", points: [[10, 0]] },
    ]);

    expect(result.analysis).toMatchObject({
      lineSegmentCount: 4,
      meaningfulEdgeCount: 1,
      isClosed: false,
    });
    expect(result.classification.kind).toBe("line");
  });

  it("preserves a genuine two-segment polyline", () => {
    const result = classify([
      { command: "M", points: [[0, 0]] },
      { command: "L", points: [[10, 0]] },
      { command: "L", points: [[20, 0]] },
    ]);

    expect(result.analysis.meaningfulEdgeCount).toBe(2);
    expect(result.classification.kind).toBe("polyline");
  });

  it("ignores repeated coincident points around a polyline", () => {
    const result = classify([
      { command: "M", points: [[0, 0]] },
      { command: "L", points: [[0, 0]] },
      { command: "L", points: [[10, 0]] },
      { command: "L", points: [[10, 0]] },
      { command: "L", points: [[20, 0]] },
    ]);

    expect(result.analysis).toMatchObject({
      lineSegmentCount: 4,
      meaningfulEdgeCount: 2,
      isClosed: false,
    });
    expect(result.classification.kind).toBe("polyline");
  });

  it("keeps an all-coincident open path at zeroLength precedence", () => {
    const result = classify([
      { command: "M", points: [[0, 0]] },
      { command: "L", points: [[0, 0]] },
      { command: "L", points: [[0, 0]] },
    ]);

    expect(result.analysis).toMatchObject({
      meaningfulEdgeCount: 0,
      isClosed: true,
    });
    expect(result.classification.kind).toBe("zeroLength");
    expect(result.classification.kind).not.toBe("line");
  });

  it("keeps a closed two-edge return out of line, polyline, and polygon", () => {
    const result = classify([
      { command: "M", points: [[0, 0]] },
      { command: "L", points: [[0, 0]] },
      { command: "L", points: [[10, 0]] },
      { command: "L", points: [[0, 0]] },
    ]);

    expect(result.analysis).toMatchObject({
      isClosed: true,
      meaningfulEdgeCount: 2,
    });
    expect(result.classification.kind).toBe("unknown");
    expect(["line", "polyline", "closedPolygon"]).not.toContain(
      result.classification.kind,
    );
  });

  it("does not mutate a frozen primitive, commands, or points", () => {
    const primitive = makeClassificationPrimitive({
      id: "immutable-coincident-path",
      sourceOrder: 0,
      commands: [
        { command: "M", points: [[0, 0]] },
        { command: "L", points: [[0, 0]] },
        { command: "L", points: [[10, 0]] },
      ],
    });
    const before = structuredClone(primitive);
    for (const command of primitive.commands) {
      for (const point of command.points) Object.freeze(point);
      Object.freeze(command.points);
      Object.freeze(command);
    }
    Object.freeze(primitive.commands);
    Object.freeze(primitive);

    expect(() =>
      classifyDrawingPrimitives(makeClassificationDocument([primitive])),
    ).not.toThrow();
    expect(primitive).toEqual(before);
  });
});
