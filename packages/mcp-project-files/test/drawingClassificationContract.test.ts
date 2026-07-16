import { describe, expect, it } from "vitest";

import { classifyDrawingPrimitives } from "../src/drawingClassification/classifyDrawingPrimitives.js";
import type { PrimitiveClassificationKind } from "../src/drawingClassification/types.js";
import {
  createDrawingClassificationFixture,
  makeClassificationDocument,
  makeClassificationPrimitive,
  pageCommands,
} from "./helpers/drawingClassificationFixture.js";

const primaryKinds: PrimitiveClassificationKind[] = [
  "zeroLength",
  "tiny",
  "compoundPath",
  "curve",
  "rectangleCandidate",
  "closedPolygon",
  "polyline",
  "line",
  "unknown",
];

describe("drawing classification derived-document contract", () => {
  it("preserves input identity metadata without adding unapproved page fields", () => {
    const input = createDrawingClassificationFixture();
    const result = classifyDrawingPrimitives(input);

    expect(result).toMatchObject({
      schemaVersion: 1,
      source: input.source,
      sourceSha256: input.sourceSha256,
      page: input.page,
      primitiveCount: input.primitives.length,
      classificationCount: input.primitives.length,
    });
    expect(result).not.toHaveProperty("pageCount");
    expect(result).not.toHaveProperty("pageWidth");
    expect(result).not.toHaveProperty("coordinateSystem");
  });

  it("copies bbox values without sharing references or recomputing geometry", () => {
    const input = createDrawingClassificationFixture();
    const before = structuredClone(input);
    const result = classifyDrawingPrimitives(input);

    for (const classification of result.classifications) {
      const source = input.primitives.find(
        ({ id }) => id === classification.primitiveId,
      )!;
      expect(classification.geometry.bbox).toEqual(source.bbox);
      expect(classification.geometry.pageBBox).toEqual(source.pageBBox);
      expect(classification.geometry.bbox).not.toBe(source.bbox);
      expect(classification.geometry.pageBBox).not.toBe(source.pageBBox);
    }
    result.classifications[0]!.geometry.bbox.x = 999;
    expect(input).toEqual(before);
  });

  it("works with a deeply frozen input and never mutates nested data", () => {
    const input = createDrawingClassificationFixture();
    const before = structuredClone(input);
    for (const primitive of input.primitives) {
      for (const command of primitive.commands) {
        for (const point of command.points) Object.freeze(point);
        Object.freeze(command.points);
        Object.freeze(command);
      }
      Object.freeze(primitive.commands);
      Object.freeze(primitive.bbox);
      Object.freeze(primitive.pageBBox);
      Object.freeze(primitive.style);
      Object.freeze(primitive);
    }
    Object.freeze(input.primitives);
    Object.freeze(input);

    expect(() => classifyDrawingPrimitives(input)).not.toThrow();
    expect(input).toEqual(before);
  });

  it("returns fixed zero-inclusive statistics matching classifications exactly", () => {
    const result = classifyDrawingPrimitives(createDrawingClassificationFixture());
    const kindTotal = primaryKinds.reduce(
      (total, kind) => total + result.statistics[kind],
      0,
    );

    expect(Object.keys(result.statistics)).toEqual([
      "zeroLength",
      "tiny",
      "compoundPath",
      "curve",
      "rectangleCandidate",
      "closedPolygon",
      "polyline",
      "line",
      "unknown",
      "duplicateGroupCount",
      "duplicateMemberCount",
    ]);
    expect(kindTotal).toBe(result.classificationCount);
    for (const kind of primaryKinds) {
      expect(result.statistics[kind]).toBe(
        result.classifications.filter((classification) => classification.kind === kind)
          .length,
      );
    }
    expect(result.statistics).toMatchObject({
      duplicateGroupCount: 1,
      duplicateMemberCount: 2,
    });
  });

  it("returns finite non-negative integer diagnostics with the singleton policy", () => {
    const result = classifyDrawingPrimitives(createDrawingClassificationFixture());

    for (const { diagnostics } of result.classifications) {
      for (const value of [
        diagnostics.commandCount,
        diagnostics.subpathCount,
        diagnostics.closedSubpathCount,
        diagnostics.lineSegmentCount,
        diagnostics.curveSegmentCount,
        diagnostics.meaningfulEdgeCount,
        diagnostics.duplicateCount,
      ]) {
        expect(Number.isFinite(value)).toBe(true);
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }
      if (diagnostics.duplicateGroupId === null) {
        expect(diagnostics.duplicateCount).toBe(1);
      } else {
        expect(diagnostics.duplicateCount).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("preserves, deduplicates, and codepoint-sorts summary warnings", () => {
    const input = createDrawingClassificationFixture();
    input.warnings = ["Z_WARNING", "A_WARNING", "Z_WARNING"];
    const result = classifyDrawingPrimitives(input);

    expect(result.warnings).toEqual([
      "A_WARNING",
      "UNKNOWN_CLASSIFICATION count=1 firstSourceOrder=12",
      "Z_WARNING",
    ]);
  });

  it("returns a normal zero-primitive result with fixed zero statistics", () => {
    const result = classifyDrawingPrimitives(
      makeClassificationDocument([], [
        "NO_PAINTED_PATHS: page contains no painted paths",
      ]),
    );

    expect(result).toEqual({
      schemaVersion: 1,
      source: "docs/classification.pdf",
      sourceSha256: "c".repeat(64),
      page: 69,
      primitiveCount: 0,
      classificationCount: 0,
      statistics: {
        zeroLength: 0,
        tiny: 0,
        compoundPath: 0,
        curve: 0,
        rectangleCandidate: 0,
        closedPolygon: 0,
        polyline: 0,
        line: 0,
        unknown: 0,
        duplicateGroupCount: 0,
        duplicateMemberCount: 0,
      },
      classifications: [],
      warnings: ["NO_PAINTED_PATHS: page contains no painted paths"],
    });
  });

  it.each([
    ["primitiveCount mismatch", (value: ReturnType<typeof createDrawingClassificationFixture>) => {
      value.primitiveCount += 1;
    }],
    ["duplicate primitive ID", (value: ReturnType<typeof createDrawingClassificationFixture>) => {
      value.primitives[1]!.id = value.primitives[0]!.id;
    }],
    ["duplicate sourceOrder", (value: ReturnType<typeof createDrawingClassificationFixture>) => {
      value.primitives[1]!.sourceOrder = value.primitives[0]!.sourceOrder;
    }],
    ["non-contiguous sourceOrder", (value: ReturnType<typeof createDrawingClassificationFixture>) => {
      value.primitives[1]!.sourceOrder = 99;
    }],
    ["non-finite geometry", (value: ReturnType<typeof createDrawingClassificationFixture>) => {
      value.primitives[0]!.pageBBox.width = Number.NaN;
    }],
    ["empty primitive ID", (value: ReturnType<typeof createDrawingClassificationFixture>) => {
      value.primitives[0]!.id = "";
    }],
    ["malformed command", (value: ReturnType<typeof createDrawingClassificationFixture>) => {
      (value.primitives[0]!.commands[0] as { command: string }).command = "X";
    }],
  ])("fails closed for corrupted input: %s", (_name, corrupt) => {
    const input = createDrawingClassificationFixture();
    corrupt(input);

    expect(() => classifyDrawingPrimitives(input)).toThrow(
      /primitive|sourceOrder|finite|corrupt|count|duplicate/i,
    );
  });

  it("is byte-deterministic and sourceOrder-authoritative", () => {
    const input = createDrawingClassificationFixture();
    const permuted = structuredClone(input);
    permuted.primitives.reverse();

    const first = classifyDrawingPrimitives(input);
    const second = classifyDrawingPrimitives(permuted);

    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("handles 10,000 primitives without pairwise fixture assumptions", () => {
    const primitives = Array.from({ length: 10_000 }, (_, sourceOrder) =>
      makeClassificationPrimitive({
        id: `large-${String(sourceOrder).padStart(5, "0")}`,
        sourceOrder,
        commands: pageCommands.line(
          [sourceOrder, sourceOrder % 100],
          [sourceOrder + 2, sourceOrder % 100],
        ),
      }),
    );
    const result = classifyDrawingPrimitives(makeClassificationDocument(primitives));

    expect(result.classificationCount).toBe(10_000);
    expect(result.classifications[9_999]?.primitiveId).toBe("large-09999");
    expect(result.statistics.line).toBe(10_000);
  });
});
