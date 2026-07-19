import { describe, expect, it } from "vitest";

import { buildDrawingSpatialRelations } from "../src/drawingSpatial/buildDrawingSpatialRelations.js";
import {
  createDrawingSpatialFixture,
  makeSpatialClassificationDocument,
  makeSpatialLayout,
  makeSpatialPrimitiveDocument,
} from "./helpers/drawingSpatialFixture.js";

type Fixture = ReturnType<typeof createDrawingSpatialFixture>;

function corruptFixture(mutator: (fixture: Fixture) => void): Fixture {
  const fixture = createDrawingSpatialFixture();
  mutator(fixture);
  return fixture;
}

describe("drawing spatial cross-document contract", () => {
  it.each([
    ["source", (fixture: Fixture) => {
      fixture.classification.source = "other.pdf";
    }],
    ["source SHA", (fixture: Fixture) => {
      fixture.primitive.sourceSha256 = "f".repeat(64);
    }],
    ["page", (fixture: Fixture) => {
      fixture.layout.page += 1;
    }],
    ["page width", (fixture: Fixture) => {
      fixture.primitive.pageWidth += 1;
    }],
    ["page height", (fixture: Fixture) => {
      fixture.primitive.pageHeight += 1;
    }],
  ])("fails closed for cross-document %s mismatch", (_name, mutate) => {
    expect(() => buildDrawingSpatialRelations(corruptFixture(mutate))).toThrow(
      /source|sha|page|dimension|mismatch/i,
    );
  });

  it.each([
    [Number.NaN, 200],
    [200, Number.POSITIVE_INFINITY],
    [0, 200],
    [200, -1],
  ])("rejects invalid layout dimensions %s x %s", (width, height) => {
    const fixture = createDrawingSpatialFixture();
    fixture.layout.pageWidth = width;
    fixture.layout.pageHeight = height;

    expect(() => buildDrawingSpatialRelations(fixture)).toThrow(
      /dimension|finite|positive/i,
    );
  });

  it("rejects primitive count mismatches", () => {
    expect(() =>
      buildDrawingSpatialRelations(
        corruptFixture((fixture) => {
          fixture.primitive.primitiveCount += 1;
        }),
      )
    ).toThrow(/primitive.*count|count.*primitive/i);
  });

  it("rejects classification count mismatches", () => {
    expect(() =>
      buildDrawingSpatialRelations(
        corruptFixture((fixture) => {
          fixture.classification.classificationCount += 1;
        }),
      )
    ).toThrow(/classification.*count|count.*classification/i);
  });

  it("rejects classification-to-primitive ID mismatches", () => {
    expect(() =>
      buildDrawingSpatialRelations(
        corruptFixture((fixture) => {
          fixture.classification.classifications[0]!.primitiveId = "missing";
        }),
      )
    ).toThrow(/primitive.*id|classification.*mismatch/i);
  });

  it("rejects duplicate primitive IDs", () => {
    expect(() =>
      buildDrawingSpatialRelations(
        corruptFixture((fixture) => {
          fixture.primitive.primitives[1]!.id =
            fixture.primitive.primitives[0]!.id;
        }),
      )
    ).toThrow(/primitive.*duplicate|duplicate.*primitive/i);
  });

  it.each([
    ["duplicate", (fixture: Fixture) => {
      fixture.primitive.primitives[1]!.sourceOrder = 0;
    }],
    ["non-contiguous", (fixture: Fixture) => {
      fixture.primitive.primitives[1]!.sourceOrder = 99;
    }],
  ])("rejects %s primitive sourceOrder", (_name, mutate) => {
    expect(() => buildDrawingSpatialRelations(corruptFixture(mutate))).toThrow(
      /sourceOrder|source order/i,
    );
  });

  it("rejects duplicate item and line IDs", () => {
    expect(() =>
      buildDrawingSpatialRelations(
        corruptFixture((fixture) => {
          fixture.layout.items[1]!.id = fixture.layout.items[0]!.id;
        }),
      )
    ).toThrow(/item.*duplicate|duplicate.*item/i);
    expect(() =>
      buildDrawingSpatialRelations(
        corruptFixture((fixture) => {
          fixture.layout.lines[1]!.id = fixture.layout.lines[0]!.id;
        }),
      )
    ).toThrow(/line.*duplicate|duplicate.*line/i);
  });

  it("rejects line item references that do not exist", () => {
    expect(() =>
      buildDrawingSpatialRelations(
        corruptFixture((fixture) => {
          fixture.layout.lines[0]!.itemIds = ["missing-item"];
        }),
      )
    ).toThrow(/line.*item|item.*reference/i);
  });

  it.each([
    ["item", (fixture: Fixture) => {
      fixture.layout.items[0]!.pageBBox.x = Number.NaN;
    }],
    ["line", (fixture: Fixture) => {
      fixture.layout.lines[0]!.pageBBox.height = -1;
    }],
    ["primitive", (fixture: Fixture) => {
      fixture.primitive.primitives[0]!.pageBBox.width = Number.POSITIVE_INFINITY;
    }],
    ["classification", (fixture: Fixture) => {
      fixture.classification.classifications[0]!.geometry.pageBBox.height = -1;
    }],
  ])("rejects invalid %s pageBBox", (_name, mutate) => {
    expect(() => buildDrawingSpatialRelations(corruptFixture(mutate))).toThrow(
      /bbox|finite|non-negative/i,
    );
  });

  it("returns fixed zero-inclusive policy, statistics, and counts", () => {
    const result = buildDrawingSpatialRelations(createDrawingSpatialFixture());

    expect(result.policy).toEqual({
      geometryBasis: "page-bbox",
      cellSizePt: 8,
      touchEpsilonPt: 0.01,
      adjacentDistancePt: 2,
      nearestRadiusPt: 8,
      alignmentTolerancePt: 1,
      maxProximityPerTextEntity: 8,
    });
    expect(Object.keys(result.statistics.topology)).toEqual([
      "contains",
      "inside",
      "overlaps",
      "touches",
      "disjoint",
    ]);
    expect(Object.keys(result.statistics.relationTypes)).toEqual([
      "contains",
      "inside",
      "intersects",
      "touches",
      "overlaps",
      "nearest",
      "aligned",
      "adjacent",
    ]);
    expect(result.relationCount).toBe(result.relations.length);
    expect(result.statistics.relationCount).toBe(result.relations.length);
    expect(result.statistics.textEntityCount).toBe(
      result.textItemCount + result.textLineCount,
    );
    expect(result.statistics.candidatePairCount).toBeGreaterThanOrEqual(
      result.relationCount,
    );
    for (const topology of Object.keys(result.statistics.topology) as Array<
      keyof typeof result.statistics.topology
    >) {
      expect(result.statistics.topology[topology]).toBe(
        result.relations.filter(
          ({ geometry }) => geometry.topology === topology,
        ).length,
      );
    }
    for (const relationType of Object.keys(
      result.statistics.relationTypes,
    ) as Array<keyof typeof result.statistics.relationTypes>) {
      expect(result.statistics.relationTypes[relationType]).toBe(
        result.relations.filter(({ relationTypes }) =>
          relationTypes.includes(relationType)
        ).length,
      );
    }
  });

  it("returns normal empty-text, empty-primitive, and zero-relation documents", () => {
    const emptyText = createDrawingSpatialFixture();
    emptyText.layout = makeSpatialLayout();
    const emptyPrimitive = createDrawingSpatialFixture();
    emptyPrimitive.primitive = makeSpatialPrimitiveDocument([]);
    emptyPrimitive.classification = makeSpatialClassificationDocument([], []);

    expect(buildDrawingSpatialRelations(emptyText)).toMatchObject({
      textItemCount: 0,
      textLineCount: 0,
      relationCount: 0,
      relations: [],
      warnings: expect.arrayContaining(["EMPTY_TEXT_ENTITIES count=0"]),
    });
    expect(buildDrawingSpatialRelations(emptyPrimitive)).toMatchObject({
      primitiveCount: 0,
      relationCount: 0,
      relations: [],
      warnings: expect.arrayContaining(["EMPTY_PRIMITIVES count=0"]),
    });
  });

  it("preserves, deduplicates, and codepoint-sorts upstream summary warnings", () => {
    const fixture = createDrawingSpatialFixture();
    fixture.layout.warnings = ["Z_WARNING", "A_WARNING", "Z_WARNING"];
    fixture.primitive.warnings = ["P_WARNING", "A_WARNING"];
    fixture.classification.warnings = ["C_WARNING"];

    expect(buildDrawingSpatialRelations(fixture).warnings).toEqual([
      "A_WARNING",
      "C_WARNING",
      "P_WARNING",
      "Z_WARNING",
    ]);
  });
});
