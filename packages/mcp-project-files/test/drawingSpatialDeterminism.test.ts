import { describe, expect, it } from "vitest";

import { buildDrawingSpatialRelations } from "../src/drawingSpatial/buildDrawingSpatialRelations.js";
import {
  createDrawingSpatialFixture,
  makeSpatialLayout,
} from "./helpers/drawingSpatialFixture.js";

function deepFreeze(value: unknown): void {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  Object.freeze(value);
}

describe("drawing spatial determinism and immutability", () => {
  it("returns byte-identical output for shuffled source arrays", () => {
    const firstInput = createDrawingSpatialFixture();
    const shuffled = structuredClone(firstInput);
    shuffled.layout.items.reverse();
    shuffled.layout.lines.reverse();
    shuffled.primitive.primitives.reverse();
    shuffled.classification.classifications.reverse();

    const first = buildDrawingSpatialRelations(firstInput);
    const second = buildDrawingSpatialRelations(shuffled);

    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("orders items before lines and uses canonical source order", () => {
    const fixture = createDrawingSpatialFixture();
    const result = buildDrawingSpatialRelations(fixture);
    const entityKeys = result.relations.map(
      ({ textEntityType, textEntityId }) =>
        `${textEntityType}:${textEntityId}`,
    );
    const firstLine = entityKeys.findIndex((key) => key.startsWith("line:"));
    const lastItem = entityKeys.findLastIndex((key) => key.startsWith("item:"));

    expect(firstLine).toBeGreaterThan(lastItem);
    expect(
      result.relations
        .filter(({ textEntityType }) => textEntityType === "item")
        .map(({ textEntityId }) => textEntityId),
    ).toEqual(
      [...result.relations]
        .filter(({ textEntityType }) => textEntityType === "item")
        .map(({ textEntityId }) => textEntityId),
    );
  });

  it("uses stable unique relation IDs independent of relation tags", () => {
    const first = buildDrawingSpatialRelations(createDrawingSpatialFixture());
    const second = buildDrawingSpatialRelations(createDrawingSpatialFixture());

    expect(second.relations.map(({ id }) => id)).toEqual(
      first.relations.map(({ id }) => id),
    );
    expect(new Set(first.relations.map(({ id }) => id)).size).toBe(
      first.relationCount,
    );
    expect(first.relations.every(({ id }) => /^[a-f0-9]{24}$/u.test(id))).toBe(
      true,
    );
  });

  it("does not mutate deeply frozen layout, primitive, or classification input", () => {
    const fixture = createDrawingSpatialFixture();
    const before = structuredClone(fixture);
    deepFreeze(fixture);

    expect(() => buildDrawingSpatialRelations(fixture)).not.toThrow();
    expect(fixture).toEqual(before);
  });

  it("does not sort source itemIds, commands, diagnostics, or warning arrays", () => {
    const fixture = createDrawingSpatialFixture();
    fixture.layout.lines[0]!.itemIds = ["item-inside"];
    fixture.layout.warnings = ["Z", "A"];
    fixture.primitive.warnings = ["P2", "P1"];
    fixture.classification.warnings = ["C2", "C1"];
    const before = structuredClone(fixture);

    buildDrawingSpatialRelations(fixture);

    expect(fixture).toEqual(before);
  });

  it("orders lines by minimum referenced item sourceOrder then ID", () => {
    const fixture = createDrawingSpatialFixture();
    const [first, second] = fixture.layout.lines;
    fixture.layout = makeSpatialLayout({
      items: fixture.layout.items,
      lines: [
        {
          ...structuredClone(first!),
          id: "z-line",
          itemIds: ["item-proximity"],
          sourceOrders: [5],
        },
        {
          ...structuredClone(second!),
          id: "a-line",
          itemIds: ["item-inside"],
          sourceOrders: [0],
        },
      ],
    });

    const result = buildDrawingSpatialRelations(fixture);
    const lineIds = [
      ...new Set(
        result.relations
          .filter(({ textEntityType }) => textEntityType === "line")
          .map(({ textEntityId }) => textEntityId),
      ),
    ];

    expect(lineIds[0]).toBe("a-line");
  });
});

