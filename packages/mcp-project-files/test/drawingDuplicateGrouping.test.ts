import { describe, expect, it } from "vitest";

import { classifyDrawingPrimitives } from "../src/drawingClassification/classifyDrawingPrimitives.js";
import {
  createDrawingClassificationFixture,
  makeClassificationDocument,
  makeClassificationPrimitive,
  pageCommands,
} from "./helpers/drawingClassificationFixture.js";

describe("geometry duplicate grouping", () => {
  it("groups exact command geometry despite paint and style differences", () => {
    const result = classifyDrawingPrimitives(createDrawingClassificationFixture());
    const members = result.classifications.filter(
      ({ primitiveId }) => primitiveId === "line" || primitiveId === "line-duplicate",
    );

    expect(members).toHaveLength(2);
    expect(members.map(({ kind }) => kind)).toEqual(["line", "line"]);
    expect(members.map(({ diagnostics }) => diagnostics.duplicateGroupId)).toEqual([
      "duplicate-000001",
      "duplicate-000001",
    ]);
    expect(members.map(({ diagnostics }) => diagnostics.duplicateCount)).toEqual([
      2, 2,
    ]);
  });

  it("uses null and count 1 for singleton geometry", () => {
    const result = classifyDrawingPrimitives(createDrawingClassificationFixture());
    const singleton = result.classifications.find(
      ({ primitiveId }) => primitiveId === "polyline",
    );

    expect(singleton?.diagnostics).toMatchObject({
      duplicateGroupId: null,
      duplicateCount: 1,
    });
  });

  it("does not group same bbox with different commands or reversed paths", () => {
    const forward = makeClassificationPrimitive({
      id: "forward",
      sourceOrder: 0,
      commands: pageCommands.line([100, 100], [300, 100]),
    });
    const midpoint = makeClassificationPrimitive({
      id: "midpoint",
      sourceOrder: 1,
      commands: [
        { command: "M", points: [[100, 100]] },
        { command: "L", points: [[200, 100]] },
        { command: "L", points: [[300, 100]] },
      ],
    });
    const reversed = makeClassificationPrimitive({
      id: "reversed",
      sourceOrder: 2,
      commands: pageCommands.line([300, 100], [100, 100]),
    });

    expect(
      classifyDrawingPrimitives(
        makeClassificationDocument([forward, midpoint, reversed]),
      ).classifications.map(({ diagnostics }) => diagnostics.duplicateGroupId),
    ).toEqual([null, null, null]);
  });

  it("does not group equal points with a different opcode sequence", () => {
    const line = makeClassificationPrimitive({
      id: "line",
      sourceOrder: 0,
      commands: pageCommands.line([100, 100], [300, 100]),
    });
    const curve = makeClassificationPrimitive({
      id: "curve",
      sourceOrder: 1,
      commands: [
        { command: "M", points: [[100, 100]] },
        { command: "Q", points: [[200, 100], [300, 100]] },
      ],
    });

    expect(
      classifyDrawingPrimitives(makeClassificationDocument([line, curve]))
        .classifications.map(({ diagnostics }) => diagnostics.duplicateGroupId),
    ).toEqual([null, null]);
  });

  it("preserves duplicate grouping for tiny and compound primary kinds", () => {
    const tinyA = makeClassificationPrimitive({
      id: "tiny-a",
      sourceOrder: 0,
      commands: pageCommands.line([100, 100], [100.5, 100]),
      pageBBox: { x: 100, y: 100, width: 0.5, height: 0 },
    });
    const tinyB = { ...structuredClone(tinyA), id: "tiny-b", sourceOrder: 1 };
    const compoundA = makeClassificationPrimitive({
      id: "compound-a",
      sourceOrder: 2,
      commands: [
        ...pageCommands.line([200, 100], [300, 100]),
        ...pageCommands.line([200, 120], [300, 120]),
      ],
      subpathCount: 2,
    });
    const compoundB = {
      ...structuredClone(compoundA),
      id: "compound-b",
      sourceOrder: 3,
    };
    const result = classifyDrawingPrimitives(
      makeClassificationDocument([tinyA, tinyB, compoundA, compoundB]),
    );

    expect(
      result.classifications.map(({ kind, diagnostics }) => ({
        kind,
        group: diagnostics.duplicateGroupId,
      })),
    ).toEqual([
      { kind: "tiny", group: "duplicate-000001" },
      { kind: "tiny", group: "duplicate-000001" },
      { kind: "compoundPath", group: "duplicate-000002" },
      { kind: "compoundPath", group: "duplicate-000002" },
    ]);
  });

  it("assigns group IDs by authoritative sourceOrder after input permutation", () => {
    const original = createDrawingClassificationFixture();
    const permuted = {
      ...structuredClone(original),
      primitives: [...structuredClone(original.primitives)].reverse(),
    };
    const first = classifyDrawingPrimitives(original);
    const second = classifyDrawingPrimitives(permuted);

    expect(second).toEqual(first);
    expect(second.classifications.map(({ primitiveId }) => primitiveId)).toEqual(
      original.primitives.map(({ id }) => id),
    );
  });

  it("preserves every duplicate member without deleting primitives", () => {
    const base = makeClassificationPrimitive({
      id: "copy-0",
      sourceOrder: 0,
      commands: pageCommands.line([100, 100], [300, 100]),
    });
    const copies = Array.from({ length: 5 }, (_, sourceOrder) => ({
      ...structuredClone(base),
      id: `copy-${sourceOrder}`,
      sourceOrder,
    }));
    const result = classifyDrawingPrimitives(makeClassificationDocument(copies));

    expect(result.primitiveCount).toBe(5);
    expect(result.classificationCount).toBe(5);
    expect(result.classifications).toHaveLength(5);
    expect(result.classifications.every((item) => item.diagnostics.duplicateCount === 5))
      .toBe(true);
  });
});
