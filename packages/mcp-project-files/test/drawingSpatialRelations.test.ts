import { describe, expect, it } from "vitest";

import { buildDrawingSpatialRelations } from "../src/drawingSpatial/buildDrawingSpatialRelations.js";
import type { SpatialRelation } from "../src/drawingSpatial/types.js";
import {
  createDrawingSpatialFixture,
  makeSpatialClassificationDocument,
  makeSpatialLayout,
  makeSpatialPrimitive,
  makeSpatialPrimitiveDocument,
  makeSpatialTextItem,
  makeSpatialTextLine,
} from "./helpers/drawingSpatialFixture.js";

function oneItemOnePrimitive(options: {
  text: { x: number; y: number; width: number; height: number };
  primitive: { x: number; y: number; width: number; height: number };
}) {
  const item = makeSpatialTextItem({
    id: "item",
    sourceOrder: 0,
    pageBBox: options.text,
  });
  const primitive = makeSpatialPrimitive({
    id: "primitive",
    sourceOrder: 0,
    pageBBox: options.primitive,
  });
  return {
    layout: makeSpatialLayout({ items: [item] }),
    primitive: makeSpatialPrimitiveDocument([primitive]),
    classification: makeSpatialClassificationDocument(
      [primitive],
      ["rectangleCandidate"],
    ),
  };
}

function relationFor(
  document: ReturnType<typeof buildDrawingSpatialRelations>,
  textEntityId: string,
  primitiveId: string,
): SpatialRelation | undefined {
  return document.relations.find(
    (relation) =>
      relation.textEntityId === textEntityId &&
      relation.primitiveId === primitiveId,
  );
}

describe("drawing spatial relation rules", () => {
  it.each([
    [
      "contains",
      { x: 5, y: 5, width: 2, height: 2 },
      { x: 0, y: 0, width: 10, height: 10 },
      ["contains", "intersects"],
    ],
    [
      "inside",
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 5, y: 5, width: 2, height: 2 },
      ["inside", "intersects"],
    ],
    [
      "overlaps",
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 8, y: 0, width: 10, height: 10 },
      ["intersects", "overlaps"],
    ],
    [
      "touches",
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 10, y: 4, width: 2, height: 2 },
      ["touches"],
    ],
  ] as const)(
    "stores one row for positive topology %s",
    (topology, text, primitiveBBox, relationTypes) => {
      const result = buildDrawingSpatialRelations(
        oneItemOnePrimitive({ text, primitive: primitiveBBox }),
      );

      expect(result.relations).toHaveLength(1);
      expect(result.relations[0]).toMatchObject({
        textEntityType: "item",
        textEntityId: "item",
        primitiveId: "primitive",
        primitiveKind: "rectangleCandidate",
        primitiveSourceOrder: 0,
        relationTypes,
        distancePt: 0,
        rank: null,
        geometry: {
          basis: "page-bbox",
          topology,
        },
      });
    },
  );

  it("stores equal bboxes as one overlaps row", () => {
    const result = buildDrawingSpatialRelations(
      oneItemOnePrimitive({
        text: { x: 1, y: 2, width: 3, height: 4 },
        primitive: { x: 1, y: 2, width: 3, height: 4 },
      }),
    );

    expect(result.relations).toHaveLength(1);
    expect(result.relations[0]).toMatchObject({
      relationTypes: ["intersects", "overlaps"],
      geometry: { topology: "overlaps" },
    });
  });

  it("keeps item and line relations as independent rows", () => {
    const item = makeSpatialTextItem({
      id: "item",
      sourceOrder: 0,
      pageBBox: { x: 2, y: 2, width: 2, height: 2 },
    });
    const line = makeSpatialTextLine({
      id: "line",
      itemIds: ["item"],
      sourceOrders: [0],
      pageBBox: { x: 1, y: 1, width: 4, height: 4 },
    });
    const primitive = makeSpatialPrimitive({
      id: "primitive",
      sourceOrder: 0,
      pageBBox: { x: 0, y: 0, width: 10, height: 10 },
    });
    const result = buildDrawingSpatialRelations({
      layout: makeSpatialLayout({ items: [item], lines: [line] }),
      primitive: makeSpatialPrimitiveDocument([primitive]),
      classification: makeSpatialClassificationDocument(
        [primitive],
        ["rectangleCandidate"],
      ),
    });

    expect(
      result.relations.map(({ textEntityType, textEntityId }) => [
        textEntityType,
        textEntityId,
      ]),
    ).toEqual([
      ["item", "item"],
      ["line", "line"],
    ]);
  });

  it("stores bounded disjoint proximity without storing all disjoint pairs", () => {
    const near = buildDrawingSpatialRelations(
      oneItemOnePrimitive({
        text: { x: 0, y: 0, width: 10, height: 10 },
        primitive: { x: 11.999, y: 4, width: 1, height: 1 },
      }),
    );
    const far = buildDrawingSpatialRelations(
      oneItemOnePrimitive({
        text: { x: 0, y: 0, width: 10, height: 10 },
        primitive: { x: 18.001, y: 2, width: 1, height: 1 },
      }),
    );

    expect(near.relations).toHaveLength(1);
    expect(near.relations[0]).toMatchObject({
      relationTypes: ["nearest", "aligned", "adjacent"],
      distancePt: 1.999,
      rank: 1,
      geometry: { topology: "disjoint" },
    });
    expect(far.relations).toEqual([]);
  });

  it("fixes adjacent at <=2pt and nearest at <=8pt", () => {
    const primitiveData = [
      ["adjacent-in", 11.999],
      ["adjacent-out", 12.001],
      ["nearest-in", 17.999],
      ["nearest-out", 18.001],
    ] as const;
    const primitives = primitiveData.map(([id, x], sourceOrder) =>
      makeSpatialPrimitive({
        id,
        sourceOrder,
        pageBBox: { x, y: 4, width: 1, height: 1 },
      })
    );
    const result = buildDrawingSpatialRelations({
      layout: makeSpatialLayout({
        items: [
          makeSpatialTextItem({
            id: "item",
            sourceOrder: 0,
            pageBBox: { x: 0, y: 0, width: 10, height: 10 },
          }),
        ],
      }),
      primitive: makeSpatialPrimitiveDocument(primitives),
      classification: makeSpatialClassificationDocument(
        primitives,
        primitives.map(() => "line"),
      ),
    });

    expect(relationFor(result, "item", "adjacent-in")?.relationTypes).toContain(
      "adjacent",
    );
    expect(
      relationFor(result, "item", "adjacent-out")?.relationTypes,
    ).not.toContain("adjacent");
    expect(relationFor(result, "item", "nearest-in")?.relationTypes).toContain(
      "nearest",
    );
    expect(relationFor(result, "item", "nearest-out")).toBeUndefined();
  });

  it("fixes X/Y alignment at an absolute 1pt center delta", () => {
    const primitives = [
      makeSpatialPrimitive({
        id: "aligned-x",
        sourceOrder: 0,
        pageBBox: { x: 4, y: 15, width: 4, height: 2 },
      }),
      makeSpatialPrimitive({
        id: "aligned-y",
        sourceOrder: 1,
        pageBBox: { x: 15, y: 4, width: 2, height: 4 },
      }),
      makeSpatialPrimitive({
        id: "not-aligned",
        sourceOrder: 2,
        pageBBox: { x: 12.001, y: 12.001, width: 2, height: 2 },
      }),
    ];
    const result = buildDrawingSpatialRelations({
      layout: makeSpatialLayout({
        items: [
          makeSpatialTextItem({
            id: "item",
            sourceOrder: 0,
            pageBBox: { x: 0, y: 0, width: 10, height: 10 },
          }),
        ],
      }),
      primitive: makeSpatialPrimitiveDocument(primitives),
      classification: makeSpatialClassificationDocument(
        primitives,
        primitives.map(() => "line"),
      ),
    });

    expect(relationFor(result, "item", "aligned-x")?.relationTypes).toContain(
      "aligned",
    );
    expect(relationFor(result, "item", "aligned-y")?.relationTypes).toContain(
      "aligned",
    );
    expect(
      relationFor(result, "item", "not-aligned")?.relationTypes,
    ).not.toContain("aligned");
  });

  it("ranks disjoint candidates by rounded distance, sourceOrder, then ID", () => {
    const primitives = [
      makeSpatialPrimitive({
        id: "z-source-first",
        sourceOrder: 0,
        pageBBox: { x: 14.0004, y: 0, width: 1, height: 1 },
      }),
      makeSpatialPrimitive({
        id: "a-source-second",
        sourceOrder: 1,
        pageBBox: { x: 14.0001, y: 0, width: 1, height: 1 },
      }),
    ];
    const result = buildDrawingSpatialRelations({
      layout: makeSpatialLayout({
        items: [
          makeSpatialTextItem({
            id: "item",
            sourceOrder: 0,
            pageBBox: { x: 0, y: 0, width: 10, height: 2 },
          }),
        ],
      }),
      primitive: makeSpatialPrimitiveDocument(primitives),
      classification: makeSpatialClassificationDocument(
        primitives,
        ["line", "line"],
      ),
    });

    expect(
      result.relations.map(({ primitiveId, distancePt, rank }) => ({
        primitiveId,
        distancePt,
        rank,
      })),
    ).toEqual([
      { primitiveId: "z-source-first", distancePt: 4, rank: 1 },
      { primitiveId: "a-source-second", distancePt: 4, rank: 2 },
    ]);
  });

  it("caps proximity at eight and emits one summary warning", () => {
    const primitives = Array.from({ length: 10 }, (_, sourceOrder) =>
      makeSpatialPrimitive({
        id: `near-${String(sourceOrder).padStart(2, "0")}`,
        sourceOrder,
        pageBBox: {
          x: 11 + sourceOrder * 0.1,
          y: 4,
          width: 0.1,
          height: 0.1,
        },
      })
    );
    const result = buildDrawingSpatialRelations({
      layout: makeSpatialLayout({
        items: [
          makeSpatialTextItem({
            id: "item",
            sourceOrder: 0,
            pageBBox: { x: 0, y: 0, width: 10, height: 10 },
          }),
        ],
      }),
      primitive: makeSpatialPrimitiveDocument(primitives),
      classification: makeSpatialClassificationDocument(
        primitives,
        primitives.map(() => "tiny"),
      ),
    });

    expect(result.relations).toHaveLength(8);
    expect(result.relations.map(({ rank }) => rank)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    expect(result.statistics.proximityTruncatedEntityCount).toBe(1);
    expect(result.warnings).toContain(
      "PROXIMITY_TRUNCATED count=1 firstTextEntity=item:item",
    );
  });

  it("joins primitive kind and source order without copying commands", () => {
    const fixture = createDrawingSpatialFixture();
    const result = buildDrawingSpatialRelations(fixture);
    const relation = relationFor(
      result,
      "item-inside",
      "primitive-container",
    );

    expect(relation).toMatchObject({
      primitiveKind: "rectangleCandidate",
      primitiveSourceOrder: 0,
    });
    expect(relation).not.toHaveProperty("commands");
    expect(result).not.toHaveProperty("primitives");
    expect(result).not.toHaveProperty("classifications");
  });

  it("keeps duplicate-geometry primitives as distinct relation candidates", () => {
    const text = makeSpatialTextItem({
      id: "duplicate-target",
      sourceOrder: 0,
      pageBBox: { x: 140, y: 30, width: 4, height: 4 },
    });
    const fixture = createDrawingSpatialFixture();
    fixture.layout = makeSpatialLayout({ items: [text] });
    const result = buildDrawingSpatialRelations(fixture);

    expect(
      result.relations
        .filter(({ textEntityId }) => textEntityId === "duplicate-target")
        .map(({ primitiveId }) => primitiveId),
    ).toEqual([
      "primitive-duplicate-geometry-a",
      "primitive-duplicate-geometry-b",
    ]);
  });

  it("returns a normal zero-relation document", () => {
    const result = buildDrawingSpatialRelations(
      oneItemOnePrimitive({
        text: { x: 0, y: 0, width: 1, height: 1 },
        primitive: { x: 100, y: 100, width: 1, height: 1 },
      }),
    );

    expect(result).toMatchObject({
      relationCount: 0,
      relations: [],
      statistics: {
        textEntityCount: 1,
        relationCount: 0,
      },
    });
  });
});
