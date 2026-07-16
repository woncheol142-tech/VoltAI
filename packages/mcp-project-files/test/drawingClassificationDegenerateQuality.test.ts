import { describe, expect, it } from "vitest";

import { analyzePrimitive } from "../src/drawingClassification/analyzePrimitive.js";
import { classifyDrawingPrimitives } from "../src/drawingClassification/classifyDrawingPrimitives.js";
import {
  makeClassificationDocument,
  makeClassificationPrimitive,
  pageCommands,
} from "./helpers/drawingClassificationFixture.js";

function classify(
  commands: Parameters<typeof makeClassificationPrimitive>[0]["commands"],
  closedSubpathCount: number,
) {
  const primitive = makeClassificationPrimitive({
    id: "quality-path",
    sourceOrder: 0,
    commands,
    closedSubpathCount,
  });
  const analysis = analyzePrimitive(primitive, 1_000, 1_000);
  const classification = classifyDrawingPrimitives(
    makeClassificationDocument([primitive]),
  ).classifications[0]!;
  return { primitive, analysis, classification };
}

describe("degenerate closed polygon quality regression", () => {
  it("keeps a two-edge explicit return path closed but classifies it as unknown", () => {
    const result = classify(
      [
        { command: "M", points: [[0, 0]] },
        { command: "L", points: [[10, 0]] },
        { command: "L", points: [[0, 0]] },
      ],
      0,
    );

    expect(result.analysis).toMatchObject({
      isClosed: true,
      closedSubpathCount: 0,
      meaningfulEdgeCount: 2,
    });
    expect(result.classification.kind).toBe("unknown");
    expect(result.classification.kind).not.toBe("closedPolygon");
    expect(result.classification.kind).not.toBe("rectangleCandidate");
  });

  it("keeps a two-edge Z return path out of closedPolygon", () => {
    const result = classify(
      [
        { command: "M", points: [[0, 0]] },
        { command: "L", points: [[10, 0]] },
        { command: "Z", points: [] },
      ],
      1,
    );

    expect(result.analysis).toMatchObject({
      isClosed: true,
      closedSubpathCount: 1,
      meaningfulEdgeCount: 2,
    });
    expect(result.classification.kind).toBe("unknown");
  });

  it("preserves a valid Z-closed triangle as closedPolygon", () => {
    const result = classify(
      pageCommands.polygon([
        [0, 0],
        [10, 0],
        [5, 10],
      ]),
      1,
    );

    expect(result.analysis.meaningfulEdgeCount).toBe(3);
    expect(result.classification.kind).toBe("closedPolygon");
  });

  it("preserves an explicitly closed triangle without changing Z metadata", () => {
    const result = classify(
      pageCommands.polygon(
        [
          [0, 0],
          [10, 0],
          [5, 10],
        ],
        "repeat",
      ),
      0,
    );

    expect(result.analysis).toMatchObject({
      isClosed: true,
      closedSubpathCount: 0,
      meaningfulEdgeCount: 3,
    });
    expect(result.classification.kind).toBe("closedPolygon");
  });

  it("preserves axis-aligned and rotated rectangle candidates", () => {
    const axis = makeClassificationPrimitive({
      id: "axis",
      sourceOrder: 0,
      commands: pageCommands.polygon([
        [100, 100],
        [400, 100],
        [400, 250],
        [100, 250],
      ]),
      closedSubpathCount: 1,
    });
    const rotated = makeClassificationPrimitive({
      id: "rotated",
      sourceOrder: 1,
      commands: pageCommands.polygon([
        [500, 100],
        [650, 250],
        [550, 350],
        [400, 200],
      ]),
      closedSubpathCount: 1,
    });

    expect(
      classifyDrawingPrimitives(makeClassificationDocument([axis, rotated]))
        .classifications.map(({ kind }) => kind),
    ).toEqual(["rectangleCandidate", "rectangleCandidate"]);
  });

  it("does not mutate a degenerate primitive or its commands", () => {
    const primitive = makeClassificationPrimitive({
      id: "immutable",
      sourceOrder: 0,
      commands: [
        { command: "M", points: [[0, 0]] },
        { command: "L", points: [[10, 0]] },
        { command: "L", points: [[0, 0]] },
      ],
    });
    const before = structuredClone(primitive);

    classifyDrawingPrimitives(makeClassificationDocument([primitive]));

    expect(primitive).toEqual(before);
  });
});
