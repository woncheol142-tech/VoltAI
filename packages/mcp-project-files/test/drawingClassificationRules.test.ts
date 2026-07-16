import { describe, expect, it } from "vitest";

import { classifyDrawingPrimitives } from "../src/drawingClassification/classifyDrawingPrimitives.js";
import type { PrimitiveClassificationKind } from "../src/drawingClassification/types.js";
import {
  createDrawingClassificationFixture,
  makeClassificationDocument,
  makeClassificationPrimitive,
  pageCommands,
} from "./helpers/drawingClassificationFixture.js";

function kindById(): Map<string, PrimitiveClassificationKind> {
  const result = classifyDrawingPrimitives(createDrawingClassificationFixture());
  return new Map(
    result.classifications.map(({ primitiveId, kind }) => [primitiveId, kind]),
  );
}

describe("fixed primitive classification rules", () => {
  it("classifies the deterministic fixture with exactly one primary kind", () => {
    expect(Object.fromEntries(kindById())).toMatchObject({
      line: "line",
      polyline: "polyline",
      "axis-rectangle": "rectangleCandidate",
      "rotated-rectangle": "rectangleCandidate",
      trapezoid: "closedPolygon",
      triangle: "closedPolygon",
      "open-curve": "curve",
      "closed-curve": "curve",
      "compound-lines": "compoundPath",
      "compound-curve-polygon": "compoundPath",
      "tiny-line": "tiny",
      "zero-length": "zeroLength",
      "unknown-closed-segment": "unknown",
      "line-duplicate": "line",
      parallelogram: "closedPolygon",
      "bow-tie": "closedPolygon",
      "concave-polygon": "closedPolygon",
    });
  });

  it("fixes zeroLength exact-zero semantics and highest precedence", () => {
    const base = makeClassificationPrimitive({
      id: "zero",
      sourceOrder: 0,
      commands: [
        { command: "M", points: [[100, 100]] },
        { command: "Q", points: [[100, 100], [100, 100]] },
        { command: "M", points: [[100, 100]] },
        { command: "L", points: [[100, 100]] },
      ],
      subpathCount: 2,
      pageBBox: { x: 100, y: 100, width: 0, height: 0 },
    });
    const vertical = {
      ...structuredClone(base),
      id: "vertical",
      pageBBox: { x: 100, y: 100, width: 0, height: 2 },
      bbox: { x: 0.1, y: 0.1, width: 0, height: 0.002 },
    };
    const horizontal = {
      ...structuredClone(base),
      id: "horizontal",
      pageBBox: { x: 100, y: 100, width: 2, height: 0 },
      bbox: { x: 0.1, y: 0.1, width: 0.002, height: 0 },
    };

    expect(
      classifyDrawingPrimitives(makeClassificationDocument([base]))
        .classifications[0]?.kind,
    ).toBe("zeroLength");
    expect(
      classifyDrawingPrimitives(makeClassificationDocument([vertical]))
        .classifications[0]?.kind,
    ).not.toBe("zeroLength");
    expect(
      classifyDrawingPrimitives(makeClassificationDocument([horizontal]))
        .classifications[0]?.kind,
    ).not.toBe("zeroLength");
  });

  it.each([
    [0.999, "tiny"],
    [1, "line"],
    [1.001, "line"],
  ] as const)("fixes the tiny boundary at %s pt", (width, expected) => {
    const value = makeClassificationPrimitive({
      id: `width-${width}`,
      sourceOrder: 0,
      commands: pageCommands.line([100, 100], [100 + width, 100]),
      pageBBox: { x: 100, y: 100, width, height: 0 },
    });

    expect(
      classifyDrawingPrimitives(makeClassificationDocument([value]))
        .classifications[0]?.kind,
    ).toBe(expected);
  });

  it("gives tiny precedence over rectangle and compound structures", () => {
    const rectangle = makeClassificationPrimitive({
      id: "tiny-rectangle",
      sourceOrder: 0,
      commands: pageCommands.polygon([
        [100, 100],
        [100.9, 100],
        [100.9, 100.8],
        [100, 100.8],
      ]),
      closedSubpathCount: 1,
      pageBBox: { x: 100, y: 100, width: 0.9, height: 0.8 },
    });
    const compound = makeClassificationPrimitive({
      id: "tiny-compound",
      sourceOrder: 1,
      commands: [
        ...pageCommands.line([100, 100], [100.8, 100]),
        ...pageCommands.line([100, 100.2], [100.8, 100.2]),
      ],
      subpathCount: 2,
      pageBBox: { x: 100, y: 100, width: 0.8, height: 0.2 },
    });

    expect(
      classifyDrawingPrimitives(makeClassificationDocument([rectangle, compound]))
        .classifications.map(({ kind }) => kind),
    ).toEqual(["tiny", "tiny"]);
  });

  it("keeps compound above curve and rectangle while retaining diagnostics", () => {
    const result = classifyDrawingPrimitives(createDrawingClassificationFixture());
    const compound = result.classifications.find(
      ({ primitiveId }) => primitiveId === "compound-curve-polygon",
    );

    expect(compound).toMatchObject({
      kind: "compoundPath",
      confidence: 1,
      diagnostics: {
        subpathCount: 2,
        closedSubpathCount: 1,
        curveSegmentCount: 1,
      },
    });
  });

  it("classifies any Q/C single subpath as curve without geometric simplification", () => {
    const collinear = makeClassificationPrimitive({
      id: "collinear-curve",
      sourceOrder: 0,
      commands: [
        { command: "M", points: [[100, 100]] },
        { command: "C", points: [[150, 100], [200, 100], [250, 100]] },
      ],
    });

    expect(
      classifyDrawingPrimitives(makeClassificationDocument([collinear]))
        .classifications[0],
    ).toMatchObject({ kind: "curve", confidence: 1 });
  });

  it("treats an explicit repeated start point as structural closure without Z", () => {
    const value = makeClassificationPrimitive({
      id: "repeated-start-open",
      sourceOrder: 0,
      commands: [
        { command: "M", points: [[100, 100]] },
        { command: "L", points: [[200, 100]] },
        { command: "L", points: [[150, 200]] },
        { command: "L", points: [[100, 100]] },
      ],
      closedSubpathCount: 0,
    });

    expect(
      classifyDrawingPrimitives(makeClassificationDocument([value]))
        .classifications[0]?.kind,
    ).toBe("closedPolygon");
  });

  it("uses confidence 1 for matched structural rules and 0 for unknown", () => {
    const result = classifyDrawingPrimitives(createDrawingClassificationFixture());
    const unknown = result.classifications.find(({ kind }) => kind === "unknown");

    expect(
      result.classifications
        .filter(({ kind }) => kind !== "unknown")
        .every(({ confidence }) => confidence === 1),
    ).toBe(true);
    expect(unknown?.confidence).toBe(0);
  });
});
