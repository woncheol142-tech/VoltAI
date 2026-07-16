import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";

import {
  decodeCompressedPath,
  decodeOperatorList,
} from "../src/drawingPrimitive/decodeOperatorList.js";
import { primitivePageContext } from "./helpers/drawingPrimitiveFixture.js";

function construct(
  paint: number,
  path: readonly number[],
  minMax: readonly number[] = [0, 0, 100, 100],
) {
  return [
    paint,
    [new Float32Array(path)],
    new Float32Array(minMax),
  ];
}

function operatorList(
  entries: Array<[number, unknown]>,
): { fnArray: number[]; argsArray: unknown[] } {
  return {
    fnArray: entries.map(([operator]) => operator),
    argsArray: entries.map(([, args]) => args),
  };
}

describe("PDF.js compressed drawing path decoding", () => {
  it.each([
    {
      name: "M",
      path: [0, 10, 20],
      expected: [{ command: "M", points: [{ x: 10, y: 20 }] }],
    },
    {
      name: "L",
      path: [0, 10, 20, 1, 30, 40],
      expected: [
        { command: "M", points: [{ x: 10, y: 20 }] },
        { command: "L", points: [{ x: 30, y: 40 }] },
      ],
    },
    {
      name: "C",
      path: [0, 0, 0, 2, 10, 20, 30, 40, 50, 60],
      expected: [
        { command: "M", points: [{ x: 0, y: 0 }] },
        {
          command: "C",
          points: [
            { x: 10, y: 20 },
            { x: 30, y: 40 },
            { x: 50, y: 60 },
          ],
        },
      ],
    },
    {
      name: "Q",
      path: [0, 0, 0, 3, 10, 20, 30, 40],
      expected: [
        { command: "M", points: [{ x: 0, y: 0 }] },
        {
          command: "Q",
          points: [{ x: 10, y: 20 }, { x: 30, y: 40 }],
        },
      ],
    },
    {
      name: "Z",
      path: [0, 0, 0, 1, 10, 0, 4],
      expected: [
        { command: "M", points: [{ x: 0, y: 0 }] },
        { command: "L", points: [{ x: 10, y: 0 }] },
        { command: "Z", points: [] },
      ],
    },
  ])("decodes $name commands", ({ path, expected }) => {
    expect(decodeCompressedPath(new Float32Array(path))).toMatchObject({
      commands: expected,
      pathOperatorCount: expected.length,
    });
  });

  it("counts multiple and closed subpaths independently", () => {
    const decoded = decodeCompressedPath(
      new Float32Array([
        0, 0, 0,
        1, 10, 0,
        4,
        0, 20, 20,
        1, 30, 20,
      ]),
    );

    expect(decoded).toMatchObject({
      subpathCount: 2,
      closedSubpathCount: 1,
      pathOperatorCount: 5,
    });
  });

  it("does not count repeated Z commands as multiple closed subpaths", () => {
    const decoded = decodeCompressedPath(
      new Float32Array([0, 0, 0, 1, 10, 0, 4, 4]),
    );

    expect(decoded.closedSubpathCount).toBe(1);
    expect(decoded.commands.filter(({ command }) => command === "Z")).toHaveLength(2);
  });

  it.each([
    ["unknown opcode", [0, 0, 0, 99]],
    ["truncated M", [0, 10]],
    ["truncated L", [0, 0, 0, 1, 20]],
    ["truncated C", [0, 0, 0, 2, 1, 2, 3, 4]],
    ["truncated Q", [0, 0, 0, 3, 1, 2]],
    ["M missing", [1, 10, 20]],
    ["empty path", []],
    ["non-finite path", [0, Number.NaN, 0]],
  ])("rejects %s", (_name, path) => {
    expect(() => decodeCompressedPath(new Float32Array(path))).toThrow(
      /path|opcode|coordinate|move|finite|empty/i,
    );
  });

  it("does not mutate the typed path buffer", () => {
    const path = new Float32Array([0, 0, 0, 1, 10, 20]);
    const before = new Float32Array(path);

    decodeCompressedPath(path);

    expect(path).toEqual(before);
  });
});

describe("drawing primitive operator-list decoding", () => {
  it.each([
    [OPS.stroke, "stroke", null],
    [OPS.fill, "fill", "nonzero"],
    [OPS.eoFill, "fill", "evenodd"],
    [OPS.fillStroke, "fill-stroke", "nonzero"],
    [OPS.eoFillStroke, "fill-stroke", "evenodd"],
  ] as const)("maps paint operator %s", (paint, expectedPaint, fillRule) => {
    const result = decodeOperatorList(
      operatorList([
        [OPS.constructPath, construct(paint, [0, 10, 20, 1, 110, 20])],
      ]),
      primitivePageContext(),
    );

    expect(result.primitives).toHaveLength(1);
    expect(result.primitives[0]).toMatchObject({
      id: "primitive-000001",
      type: "path",
      paint: expectedPaint,
      fillRule,
      sourceOrder: 0,
      provenance: { operatorIndex: 0, pathOperatorCount: 2 },
    });
  });

  it("validates constructPath root, path container, typed buffer, and minMax shapes", () => {
    const malformed = [
      null,
      [OPS.stroke],
      [OPS.stroke, []],
      [OPS.stroke, [[0, 0, 0]], new Float32Array([0, 0, 1, 1])],
      [OPS.stroke, [new Float32Array([0, 0, 0])], new Float32Array([0, 0, 1])],
      [OPS.stroke, [new Float32Array([0, 0, 0])], new Float32Array([0, 0, Number.NaN, 1])],
    ];
    const result = decodeOperatorList(
      operatorList(malformed.map((args) => [OPS.constructPath, args])),
      primitivePageContext(),
    );

    expect(result.primitives).toEqual([]);
    expect(result.warnings).toEqual([
      "MALFORMED_PATH count=6 firstOperator=0",
      "NO_PAINTED_PATHS: page contains no painted paths",
    ]);
  });

  it("excludes endPath and consumes clip/eoclip without clipping later geometry", () => {
    const result = decodeOperatorList(
      operatorList([
        [OPS.clip, null],
        [OPS.constructPath, construct(OPS.endPath, [0, 0, 0, 1, 50, 0])],
        [OPS.eoClip, null],
        [OPS.constructPath, construct(OPS.endPath, [0, 0, 0, 1, 20, 0])],
        [OPS.constructPath, construct(OPS.stroke, [0, -20, 10, 1, 120, 10])],
      ]),
      primitivePageContext({ pageWidth: 100, pageHeight: 100 }),
    );

    expect(result.primitives).toHaveLength(1);
    expect(result.primitives[0]?.pageBBox).toEqual({
      x: -20,
      y: 90,
      width: 140,
      height: 0,
    });
    expect(result.warnings).toContain("OFF_PAGE_PATH count=1 firstOperator=4");
  });

  it("snapshots the complete current style even for fill-only paths", () => {
    const result = decodeOperatorList(
      operatorList([
        [OPS.setLineWidth, [0]],
        [OPS.setLineCap, [2]],
        [OPS.setLineJoin, [1]],
        [OPS.setMiterLimit, [7]],
        [OPS.setDash, [[4, 2], 1]],
        [OPS.setStrokeRGBColor, ["#112233"]],
        [OPS.setFillRGBColor, ["#abcdef"]],
        [OPS.setGState, [[["CA", 0], ["ca", 0.25]]]],
        [OPS.constructPath, construct(OPS.fill, [0, 10, 10, 1, 20, 10])],
      ]),
      primitivePageContext(),
    );

    expect(result.primitives[0]?.style).toEqual({
      strokeWidthUserSpace: 0,
      lineCap: 2,
      lineJoin: 1,
      miterLimit: 7,
      dashArray: [4, 2],
      dashPhase: 1,
      strokeColor: "#112233",
      fillColor: "#abcdef",
      strokeAlpha: 0,
      fillAlpha: 0.25,
    });
  });

  it("preserves transparent, duplicate, zero-length, tiny, and off-page paths", () => {
    const duplicate = construct(OPS.stroke, [0, 10, 10, 1, 50, 10]);
    const result = decodeOperatorList(
      operatorList([
        [OPS.setGState, [[["CA", 0]]]],
        [OPS.constructPath, duplicate],
        [OPS.constructPath, duplicate],
        [OPS.constructPath, construct(OPS.stroke, [0, 20, 20, 1, 20, 20])],
        [OPS.constructPath, construct(OPS.stroke, [0, 30, 30, 1, 30.5, 30])],
        [OPS.constructPath, construct(OPS.stroke, [0, 120, 130, 1, 140, 130])],
      ]),
      primitivePageContext({ pageWidth: 100, pageHeight: 100 }),
    );

    expect(result.primitives).toHaveLength(5);
    expect(result.primitives[0]?.commands).toEqual(result.primitives[1]?.commands);
    expect(result.primitives.every(({ style }) => style.strokeAlpha === 0)).toBe(true);
    expect(result.warnings).toEqual([
      "OFF_PAGE_PATH count=1 firstOperator=5",
      "TINY_PATH count=1 firstOperator=4",
      "ZERO_LENGTH_PATH count=1 firstOperator=3",
    ]);
  });

  it("summarizes malformed paths and continues with valid painted paths", () => {
    const result = decodeOperatorList(
      operatorList([
        [OPS.constructPath, construct(OPS.stroke, [1, 10, 10])],
        [OPS.constructPath, construct(OPS.stroke, [0, 10, 10, 1, 20, 10])],
        [OPS.constructPath, construct(OPS.stroke, [0, 0])],
      ]),
      primitivePageContext(),
    );

    expect(result.primitives).toHaveLength(1);
    expect(result.primitives[0]?.provenance.operatorIndex).toBe(1);
    expect(result.warnings).toEqual([
      "MALFORMED_PATH count=2 firstOperator=0",
    ]);
  });

  it("returns a normal zero-primitive result when every path is malformed", () => {
    const result = decodeOperatorList(
      operatorList([
        [OPS.constructPath, construct(OPS.stroke, [])],
        [OPS.constructPath, construct(OPS.stroke, [1, 10, 10])],
      ]),
      primitivePageContext(),
    );

    expect(result).toEqual({
      primitives: [],
      warnings: [
        "MALFORMED_PATH count=2 firstOperator=0",
        "NO_PAINTED_PATHS: page contains no painted paths",
      ],
    });
  });

  it("ignores known text, dependency, image, and annotation operators", () => {
    const result = decodeOperatorList(
      operatorList([
        [OPS.dependency, ["font"]],
        [OPS.beginText, null],
        [OPS.showText, [["text"]]],
        [OPS.endText, null],
        [OPS.paintImageXObject, ["image"]],
        [OPS.beginAnnotation, null],
        [OPS.endAnnotation, null],
      ]),
      primitivePageContext(),
    );

    expect(result).toEqual({
      primitives: [],
      warnings: ["NO_PAINTED_PATHS: page contains no painted paths"],
    });
  });

  it("summarizes unknown operators instead of producing per-instance warnings", () => {
    const result = decodeOperatorList(
      operatorList([
        [999, ["secret"]],
        [999, ["secret"]],
        [998, null],
      ]),
      primitivePageContext(),
    );

    expect(result.warnings).toEqual([
      "NO_PAINTED_PATHS: page contains no painted paths",
      "UNSUPPORTED_OPERATOR count=3 firstOperator=0",
    ]);
  });

  it("preserves paint order, continuous sourceOrder, IDs, and operator provenance", () => {
    const result = decodeOperatorList(
      operatorList([
        [OPS.setLineWidth, [2]],
        [OPS.constructPath, construct(OPS.stroke, [0, 30, 30, 1, 40, 30])],
        [OPS.save, null],
        [OPS.constructPath, construct(OPS.fill, [0, 10, 10, 1, 20, 10])],
        [OPS.restore, null],
        [OPS.constructPath, construct(OPS.stroke, [0, 50, 50, 1, 60, 50])],
      ]),
      primitivePageContext(),
    );

    expect(
      result.primitives.map(({ id, sourceOrder, provenance }) => ({
        id,
        sourceOrder,
        operatorIndex: provenance.operatorIndex,
      })),
    ).toEqual([
      { id: "primitive-000001", sourceOrder: 0, operatorIndex: 1 },
      { id: "primitive-000002", sourceOrder: 1, operatorIndex: 3 },
      { id: "primitive-000003", sourceOrder: 2, operatorIndex: 5 },
    ]);
  });

  it("is deterministic, locale-independent, and does not mutate operator arrays", () => {
    const list = operatorList([
      [OPS.constructPath, construct(OPS.stroke, [0, 30, 30, 1, 40, 30])],
      [OPS.constructPath, construct(OPS.fill, [0, 10, 10, 1, 20, 10])],
    ]);
    const beforeFns = [...list.fnArray];
    const beforeArgs = structuredClone(list.argsArray);

    const first = decodeOperatorList(list, primitivePageContext());
    const second = decodeOperatorList(list, primitivePageContext());

    expect(second).toEqual(first);
    expect(list.fnArray).toEqual(beforeFns);
    expect(list.argsArray).toEqual(beforeArgs);
  });

  it("maintains primitive invariants and finite public numbers", () => {
    const result = decodeOperatorList(
      operatorList([
        [OPS.constructPath, construct(OPS.stroke, [0, 10, 20, 1, 110, 20])],
        [OPS.constructPath, construct(OPS.fill, [0, 50, 50, 1, 60, 50, 4])],
      ]),
      primitivePageContext(),
    );
    const numbers = result.primitives.flatMap((primitive) => [
      ...Object.values(primitive.pageBBox),
      ...Object.values(primitive.bbox),
      ...primitive.commands.flatMap(({ points }) =>
        points.flatMap(({ x, y }) => [x, y]),
      ),
      ...Object.values(primitive.style).flatMap((value) =>
        typeof value === "number"
          ? [value]
          : Array.isArray(value)
            ? value.filter((item): item is number => typeof item === "number")
            : [],
      ),
    ]);

    expect(new Set(result.primitives.map(({ id }) => id)).size).toBe(
      result.primitives.length,
    );
    expect(result.primitives.every(({ commands }) => commands.length > 0)).toBe(true);
    expect(
      result.primitives.every(({ commands }) =>
        commands.some(({ command }) => command === "M"),
      ),
    ).toBe(true);
    expect(numbers.every(Number.isFinite)).toBe(true);
  });
});
