import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { buildDrawingSpatialRelations } from "../src/drawingSpatial/buildDrawingSpatialRelations.js";
import {
  analyzeSpatialGeometry,
  isBeyondSpatialDistance,
} from "../src/drawingSpatial/geometry.js";
import type { PageBBox } from "../src/drawingPrimitive/types.js";
import {
  makeSpatialClassificationDocument,
  makeSpatialLayout,
  makeSpatialPrimitive,
  makeSpatialPrimitiveDocument,
  makeSpatialTextItem,
} from "./helpers/drawingSpatialFixture.js";

function buildFixture(options: {
  textBBox: PageBBox;
  primitiveBBoxes: PageBBox[];
}) {
  const item = makeSpatialTextItem({
    id: "item",
    sourceOrder: 0,
    pageBBox: options.textBBox,
  });
  const primitives = options.primitiveBBoxes.map((pageBBox, sourceOrder) =>
    makeSpatialPrimitive({
      id: `primitive-${sourceOrder}`,
      sourceOrder,
      pageBBox,
    })
  );
  return {
    layout: makeSpatialLayout({ items: [item] }),
    primitive: makeSpatialPrimitiveDocument(primitives),
    classification: makeSpatialClassificationDocument(
      primitives,
      primitives.map(() => "line"),
    ),
  };
}

function expectNearestGap(
  primitiveBBox: PageBBox,
  textBBox: PageBBox,
  expectedGap: number,
  axis: "horizontal" | "vertical",
): void {
  const analysis = analyzeSpatialGeometry(primitiveBBox, textBBox);
  const result = buildDrawingSpatialRelations(
    buildFixture({ textBBox, primitiveBBoxes: [primitiveBBox] }),
  );

  expect(isBeyondSpatialDistance(primitiveBBox, textBBox, 8)).toBe(false);
  expect(
    axis === "horizontal"
      ? analysis.rawHorizontalGapPt
      : analysis.rawVerticalGapPt,
  ).toBe(expectedGap);
  expect(analysis.rawDistancePt).toBe(expectedGap);
  expect(result.relations).toHaveLength(1);
  expect(result.relations[0]).toMatchObject({
    distancePt: expectedGap,
    rank: 1,
    relationTypes: expect.arrayContaining(["nearest"]),
  });
}

describe("drawing spatial Step 4C ULP-safe remediation", () => {
  it("keeps an exact 8pt X-axis gap at 2**56 as nearest", () => {
    const x = 2 ** 56;
    expectNearestGap(
      { x, y: 0, width: 8, height: 1 },
      { x: x + 16, y: 0, width: 0, height: 1 },
      8,
      "horizontal",
    );
  });

  it("keeps the reverse-direction 8pt X-axis gap as nearest", () => {
    const x = 2 ** 56;
    expectNearestGap(
      { x: x + 16, y: 0, width: 0, height: 1 },
      { x, y: 0, width: 8, height: 1 },
      8,
      "horizontal",
    );
  });

  it("keeps an exact 8pt Y-axis gap at 2**56 as nearest", () => {
    const y = 2 ** 56;
    expectNearestGap(
      { x: 0, y, width: 1, height: 8 },
      { x: 0, y: y + 16, width: 1, height: 0 },
      8,
      "vertical",
    );
  });

  it("keeps an exact 2pt ULP gap as adjacent and nearest", () => {
    const x = 2 ** 54;
    const primitiveBBox = { x, y: 0, width: 2, height: 1 };
    const textBBox = { x: x + 4, y: 0, width: 0, height: 1 };
    const result = buildDrawingSpatialRelations(
      buildFixture({ textBBox, primitiveBBoxes: [primitiveBBox] }),
    );

    expect(analyzeSpatialGeometry(primitiveBBox, textBBox).rawDistancePt).toBe(2);
    expect(result.relations[0]).toMatchObject({
      distancePt: 2,
      relationTypes: expect.arrayContaining(["nearest", "adjacent"]),
    });
  });

  it("does not mark a representable 3pt ULP gap as adjacent", () => {
    const x = 2 ** 54;
    const primitiveBBox = { x, y: 0, width: 1, height: 1 };
    const textBBox = { x: x + 4, y: 0, width: 0, height: 1 };
    const analysis = analyzeSpatialGeometry(primitiveBBox, textBBox);
    const result = buildDrawingSpatialRelations(
      buildFixture({ textBBox, primitiveBBoxes: [primitiveBBox] }),
    );

    expect(analysis.rawDistancePt).toBe(3);
    expect(result.relations[0]?.relationTypes).toContain("nearest");
    expect(result.relations[0]?.relationTypes).not.toContain("adjacent");
  });

  it("rejects a representable 12pt ULP gap beyond nearest radius", () => {
    const x = 2 ** 56;
    const primitiveBBox = { x, y: 0, width: 4, height: 1 };
    const textBBox = { x: x + 16, y: 0, width: 0, height: 1 };
    const analysis = analyzeSpatialGeometry(primitiveBBox, textBBox);
    const result = buildDrawingSpatialRelations(
      buildFixture({ textBBox, primitiveBBoxes: [primitiveBBox] }),
    );

    expect(analysis.rawDistancePt).toBe(12);
    expect(isBeyondSpatialDistance(primitiveBBox, textBBox, 8)).toBe(true);
    expect(result.relations).toEqual([]);
  });

  it("preserves ULP-scale containment and overlap topology", () => {
    const x = 2 ** 56;
    expect(
      analyzeSpatialGeometry(
        { x, y: 0, width: 16, height: 2 },
        { x: x + 16, y: 0, width: 0, height: 2 },
      ).topology,
    ).toBe("contains");
    expect(
      analyzeSpatialGeometry(
        { x, y: 0, width: 16, height: 2 },
        { x, y: 0, width: 8, height: 2 },
      ).topology,
    ).toBe("contains");
  });

  it("preserves a representable center delta for aligned selection", () => {
    const x = 2 ** 53;
    const primitiveBBox = { x, y: 0, width: 2, height: 0 };
    const textBBox = { x: x + 2, y: 3, width: 0, height: 0 };
    const analysis = analyzeSpatialGeometry(primitiveBBox, textBBox);
    const result = buildDrawingSpatialRelations(
      buildFixture({ textBBox, primitiveBBoxes: [primitiveBBox] }),
    );

    expect(analysis.rawCenterDeltaXPt).toBe(-1);
    expect(analysis.rawCenterDeltaYPt).toBe(-3);
    expect(result.relations[0]?.relationTypes).toContain("aligned");
  });

  it("keeps fast filtering, geometry analysis, and builder decisions consistent", () => {
    const x = 2 ** 56;
    const fixtures = [
      {
        primitive: { x, y: 0, width: 8, height: 1 },
        text: { x: x + 16, y: 0, width: 0, height: 1 },
        expectedBeyond: false,
      },
      {
        primitive: { x, y: 0, width: 4, height: 1 },
        text: { x: x + 16, y: 0, width: 0, height: 1 },
        expectedBeyond: true,
      },
    ];

    for (const fixture of fixtures) {
      const analysis = analyzeSpatialGeometry(fixture.primitive, fixture.text);
      const beyond = isBeyondSpatialDistance(fixture.primitive, fixture.text, 8);
      const result = buildDrawingSpatialRelations(
        buildFixture({
          textBBox: fixture.text,
          primitiveBBoxes: [fixture.primitive],
        }),
      );

      expect(beyond).toBe(fixture.expectedBeyond);
      expect(analysis.rawDistancePt > 8).toBe(fixture.expectedBeyond);
      expect(result.relations.length === 0).toBe(fixture.expectedBeyond);
    }
  });

  it("is deterministic and does not mutate shuffled ULP inputs", () => {
    const x = 2 ** 56;
    const fixture = buildFixture({
      textBBox: { x: x + 16, y: 0, width: 0, height: 1 },
      primitiveBBoxes: [
        { x, y: 0, width: 8, height: 1 },
        { x: x + 32, y: 0, width: 8, height: 1 },
      ],
    });
    const before = structuredClone(fixture);
    const shuffled = structuredClone(fixture);
    shuffled.primitive.primitives.reverse();
    shuffled.classification.classifications.reverse();

    const first = buildDrawingSpatialRelations(fixture);
    const second = buildDrawingSpatialRelations(shuffled);
    const firstJson = JSON.stringify(first);
    const secondJson = JSON.stringify(second);

    expect(second).toEqual(first);
    expect(createHash("sha256").update(secondJson).digest("hex")).toBe(
      createHash("sha256").update(firstJson).digest("hex"),
    );
    expect(fixture).toEqual(before);
  });
});
