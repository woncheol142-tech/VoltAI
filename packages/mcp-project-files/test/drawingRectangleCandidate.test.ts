import { describe, expect, it } from "vitest";

import { classifyDrawingPrimitives } from "../src/drawingClassification/classifyDrawingPrimitives.js";
import {
  makeClassificationDocument,
  makeClassificationPrimitive,
  pageCommands,
} from "./helpers/drawingClassificationFixture.js";

function classify(
  points: readonly (readonly [number, number])[],
  closure: "Z" | "repeat" = "Z",
) {
  const primitive = makeClassificationPrimitive({
    id: "shape",
    sourceOrder: 0,
    commands: pageCommands.polygon(points, closure),
    closedSubpathCount: closure === "Z" ? 1 : 0,
  });
  return classifyDrawingPrimitives(makeClassificationDocument([primitive]))
    .classifications[0]!;
}

describe("rectangleCandidate geometry", () => {
  it.each([
    [
      "axis aligned",
      [
        [100, 100],
        [400, 100],
        [400, 250],
        [100, 250],
      ],
    ],
    [
      "rotated",
      [
        [500, 100],
        [650, 250],
        [550, 350],
        [400, 200],
      ],
    ],
    [
      "reflected and reversed",
      [
        [400, 250],
        [100, 250],
        [100, 100],
        [400, 100],
      ],
    ],
    [
      "arbitrary start corner",
      [
        [400, 250],
        [100, 250],
        [100, 100],
        [400, 100],
      ],
    ],
  ] as const)("accepts %s four-edge rectangles", (_name, points) => {
    expect(classify(points).kind).toBe("rectangleCandidate");
  });

  it("accepts repeated-first-point closure without a duplicate fifth edge", () => {
    expect(
      classify(
        [
          [100, 100],
          [400, 100],
          [400, 250],
          [100, 250],
        ],
        "repeat",
      ),
    ).toMatchObject({
      kind: "rectangleCandidate",
      diagnostics: { meaningfulEdgeCount: 4 },
    });
  });

  it.each([
    [
      "parallelogram",
      [
        [100, 100],
        [400, 100],
        [450, 250],
        [150, 250],
      ],
    ],
    [
      "trapezoid",
      [
        [100, 100],
        [400, 100],
        [350, 250],
        [150, 250],
      ],
    ],
    [
      "rhombus",
      [
        [250, 100],
        [400, 200],
        [250, 300],
        [100, 200],
      ],
    ],
    [
      "kite",
      [
        [250, 100],
        [400, 230],
        [250, 300],
        [150, 230],
      ],
    ],
    [
      "bow tie",
      [
        [100, 100],
        [400, 250],
        [100, 250],
        [400, 100],
      ],
    ],
    [
      "outside angular tolerance",
      [
        [100, 100],
        [400, 100],
        [405, 250],
        [100, 250],
      ],
    ],
  ] as const)("rejects %s false positives", (_name, points) => {
    expect(classify(points).kind).toBe("closedPolygon");
  });

  it("rejects five meaningful edges and a tiny extra edge", () => {
    const five = classify([
      [100, 100],
      [400, 100],
      [400, 250],
      [250, 260],
      [100, 250],
    ]);
    const extra = classify([
      [100, 100],
      [400, 100],
      [400, 250],
      [399.99, 250.01],
      [100, 250],
    ]);

    expect(five.kind).toBe("closedPolygon");
    expect(extra.kind).not.toBe("rectangleCandidate");
  });

  it("rejects a rounded rectangle and a compound rectangle", () => {
    const rounded = makeClassificationPrimitive({
      id: "rounded",
      sourceOrder: 0,
      commands: [
        { command: "M", points: [[110, 100]] },
        { command: "L", points: [[390, 100]] },
        { command: "Q", points: [[400, 100], [400, 110]] },
        { command: "L", points: [[400, 240]] },
        { command: "Q", points: [[400, 250], [390, 250]] },
        { command: "L", points: [[110, 250]] },
        { command: "Q", points: [[100, 250], [100, 240]] },
        { command: "L", points: [[100, 110]] },
        { command: "Q", points: [[100, 100], [110, 100]] },
        { command: "Z", points: [] },
      ],
      closedSubpathCount: 1,
    });
    const compound = makeClassificationPrimitive({
      id: "compound",
      sourceOrder: 1,
      commands: [
        ...pageCommands.polygon([
          [100, 100],
          [400, 100],
          [400, 250],
          [100, 250],
        ]),
        ...pageCommands.line([500, 100], [600, 100]),
      ],
      subpathCount: 2,
      closedSubpathCount: 1,
    });

    expect(
      classifyDrawingPrimitives(makeClassificationDocument([rounded, compound]))
        .classifications.map(({ kind }) => kind),
    ).toEqual(["curve", "compoundPath"]);
  });

  it("uses page-space dimensions instead of distorted normalized angles", () => {
    const primitive = makeClassificationPrimitive({
      id: "wide-page-rectangle",
      sourceOrder: 0,
      commands: pageCommands.polygon([
        [100, 100],
        [300, 300],
        [200, 400],
        [0, 200],
      ]),
      closedSubpathCount: 1,
    });
    const document = makeClassificationDocument([primitive]);
    document.pageWidth = 2_000;
    document.pageHeight = 1_000;
    primitive.commands = [
      { command: "M", points: [{ x: 0.05, y: 0.1 }] },
      { command: "L", points: [{ x: 0.15, y: 0.3 }] },
      { command: "L", points: [{ x: 0.1, y: 0.4 }] },
      { command: "L", points: [{ x: 0, y: 0.2 }] },
      { command: "Z", points: [] },
    ];

    expect(classifyDrawingPrimitives(document).classifications[0]?.kind).toBe(
      "rectangleCandidate",
    );
  });

  it("rejects a nearly zero-area four-edge form", () => {
    expect(
      classify([
        [100, 100],
        [500, 100],
        [500, 100.001],
        [100, 100.001],
      ]).kind,
    ).not.toBe("rectangleCandidate");
  });
});
