import { describe, expect, it } from "vitest";

import {
  createPrimitiveGeometry,
  multiplyMatrices,
  transformPoint,
} from "../src/drawingPrimitive/geometry.js";

type RawCommand =
  | { command: "M" | "L"; points: [{ x: number; y: number }] }
  | {
      command: "C";
      points: [
        { x: number; y: number },
        { x: number; y: number },
        { x: number; y: number },
      ];
    }
  | {
      command: "Q";
      points: [{ x: number; y: number }, { x: number; y: number }];
    }
  | { command: "Z"; points: [] };

const identity = [1, 0, 0, 1, 0, 0] as const;

function line(
  start = { x: 10, y: 20 },
  end = { x: 110, y: 20 },
): RawCommand[] {
  return [
    { command: "M", points: [start] },
    { command: "L", points: [end] },
  ];
}

describe("drawing primitive matrix and coordinate geometry", () => {
  it("multiplies CTM in current × new matrix order", () => {
    expect(
      multiplyMatrices(
        [1, 0, 0, 1, 10, 20],
        [2, 0, 0, 3, 0, 0],
      ),
    ).toEqual([2, 0, 0, 3, 10, 20]);
    expect(
      transformPoint(
        multiplyMatrices(
          [1, 0, 0, 1, 10, 20],
          [2, 0, 0, 3, 0, 0],
        ),
        { x: 1, y: 1 },
      ),
    ).toEqual({ x: 12, y: 23 });
  });

  it.each([
    ["translation", [1, 0, 0, 1, 10, 20], { x: 1, y: 2 }, { x: 11, y: 22 }],
    ["nonuniform scale", [2, 0, 0, 3, 0, 0], { x: 4, y: 5 }, { x: 8, y: 15 }],
    ["rotation", [0, 1, -1, 0, 0, 0], { x: 2, y: 3 }, { x: -3, y: 2 }],
    ["reflection", [-1, 0, 0, 1, 10, 0], { x: 3, y: 2 }, { x: 7, y: 2 }],
  ] as const)("applies %s", (_name, matrix, point, expected) => {
    expect(transformPoint(matrix, point)).toEqual(expected);
  });

  it("supports nested translate, rotate, and scale composition", () => {
    const matrix = multiplyMatrices(
      multiplyMatrices([1, 0, 0, 1, 100, 50], [0, 1, -1, 0, 0, 0]),
      [2, 0, 0, 3, 0, 0],
    );

    expect(transformPoint(matrix, { x: 10, y: 20 })).toEqual({ x: 40, y: 70 });
  });

  it.each([
    ["0", [1, 0, 0, -1, 0, 800], { x: 100, y: 700 }, { x: 100, y: 100 }],
    ["90", [0, 1, 1, 0, 0, 0], { x: 100, y: 200 }, { x: 200, y: 100 }],
    ["180", [-1, 0, 0, 1, 600, 0], { x: 100, y: 200 }, { x: 500, y: 200 }],
    ["270", [0, -1, -1, 0, 800, 600], { x: 100, y: 200 }, { x: 600, y: 500 }],
  ] as const)("uses the page %s visual viewport transform", (_name, matrix, point, expected) => {
    expect(transformPoint(matrix, point)).toEqual(expected);
  });

  it("applies a non-zero CropBox viewport without clamping", () => {
    const geometry = createPrimitiveGeometry(
      line({ x: 40, y: 650 }, { x: 100, y: 650 }),
      [1, 0, 0, -1, -50, 700],
      400,
      600,
    );

    expect(geometry.pageBBox).toEqual({ x: -10, y: 50, width: 60, height: 0 });
    expect(geometry.bbox).toEqual({ x: -0.025, y: 0.083333, width: 0.15, height: 0 });
    expect(geometry.commands[0]?.points[0]?.x).toBe(-0.025);
  });

  it("preserves fully and partially off-page geometry", () => {
    const partial = createPrimitiveGeometry(
      line({ x: -20, y: 10 }, { x: 20, y: 10 }),
      identity,
      100,
      100,
    );
    const outside = createPrimitiveGeometry(
      line({ x: 120, y: 150 }, { x: 180, y: 150 }),
      identity,
      100,
      100,
    );

    expect(partial.pageBBox).toEqual({ x: -20, y: 10, width: 40, height: 0 });
    expect(partial.bbox.x).toBe(-0.2);
    expect(outside.bbox).toEqual({ x: 1.2, y: 1.5, width: 0.6, height: 0 });
  });

  it("publishes normalized command points rounded to six decimals", () => {
    const geometry = createPrimitiveGeometry(
      line({ x: 1, y: 2 }, { x: 100, y: 200 }),
      [1 / 3, 0, 0, 1 / 7, 0, 0],
      100,
      100,
    );

    expect(geometry.commands).toEqual([
      { command: "M", points: [{ x: 0.003333, y: 0.002857 }] },
      { command: "L", points: [{ x: 0.333333, y: 0.285714 }] },
    ]);
  });

  it("uses exact cubic extrema rather than control-point min/max", () => {
    const geometry = createPrimitiveGeometry(
      [
        { command: "M", points: [{ x: 0, y: 0 }] },
        {
          command: "C",
          points: [
            { x: 0, y: 100 },
            { x: 100, y: 100 },
            { x: 100, y: 0 },
          ],
        },
      ],
      identity,
      200,
      200,
    );

    expect(geometry.pageBBox).toEqual({ x: 0, y: 0, width: 100, height: 75 });
  });

  it("uses exact quadratic extrema rather than control-point min/max", () => {
    const geometry = createPrimitiveGeometry(
      [
        { command: "M", points: [{ x: 0, y: 0 }] },
        {
          command: "Q",
          points: [{ x: 50, y: 100 }, { x: 100, y: 0 }],
        },
      ],
      identity,
      200,
      200,
    );

    expect(geometry.pageBBox).toEqual({ x: 0, y: 0, width: 100, height: 50 });
  });

  it.each([
    {
      name: "degenerate cubic",
      commands: [
        { command: "M", points: [{ x: 10, y: 20 }] },
        {
          command: "C",
          points: [
            { x: 10, y: 20 },
            { x: 10, y: 20 },
            { x: 10, y: 20 },
          ],
        },
      ],
      expected: { x: 10, y: 20, width: 0, height: 0 },
    },
    {
      name: "reflected quadratic",
      commands: [
        { command: "M", points: [{ x: 0, y: 0 }] },
        {
          command: "Q",
          points: [{ x: 50, y: 100 }, { x: 100, y: 0 }],
        },
      ],
      expected: { x: -100, y: 0, width: 100, height: 50 },
      matrix: [-1, 0, 0, 1, 0, 0],
    },
  ])("handles $name curve geometry", ({ commands, expected, matrix = identity }) => {
    expect(
      createPrimitiveGeometry(commands as RawCommand[], matrix, 200, 200).pageBBox,
    ).toEqual(expected);
  });

  it("unions multiple subpaths and closed segments", () => {
    const geometry = createPrimitiveGeometry(
      [
        ...line({ x: 10, y: 20 }, { x: 50, y: 20 }),
        { command: "Z", points: [] },
        ...line({ x: 100, y: 120 }, { x: 150, y: 160 }),
      ],
      identity,
      200,
      200,
    );

    expect(geometry.pageBBox).toEqual({ x: 10, y: 20, width: 140, height: 140 });
  });

  it.each([
    [Number.NaN, 0, 0, 1, 0, 0],
    [1, 0, 0, 1, Number.POSITIVE_INFINITY, 0],
  ])("rejects non-finite matrix geometry", (...matrix) => {
    expect(() =>
      createPrimitiveGeometry(line(), matrix as unknown as number[], 600, 800),
    ).toThrow(/finite|transform|matrix/i);
  });

  it("canonicalizes negative zero in all public geometry numbers", () => {
    const geometry = createPrimitiveGeometry(
      line({ x: -0, y: -0 }, { x: 10, y: -0 }),
      identity,
      100,
      100,
    );
    const numbers = [
      ...Object.values(geometry.pageBBox),
      ...Object.values(geometry.bbox),
      ...geometry.commands.flatMap(({ points }) =>
        points.flatMap(({ x, y }) => [x, y]),
      ),
    ];

    expect(numbers.some((value) => Object.is(value, -0))).toBe(false);
    expect(numbers.every(Number.isFinite)).toBe(true);
  });

  it("keeps raw commands and matrices immutable", () => {
    const commands = line();
    const matrix = [...identity];
    const beforeCommands = structuredClone(commands);
    const beforeMatrix = [...matrix];

    createPrimitiveGeometry(commands, matrix, 600, 800);

    expect(commands).toEqual(beforeCommands);
    expect(matrix).toEqual(beforeMatrix);
  });

  it("keeps normalized and page bboxes reconstructable", () => {
    const geometry = createPrimitiveGeometry(line(), identity, 600, 800);

    expect(geometry.bbox.x * 600).toBeCloseTo(geometry.pageBBox.x, 3);
    expect(geometry.bbox.y * 800).toBeCloseTo(geometry.pageBBox.y, 3);
    expect(geometry.bbox.width * 600).toBeCloseTo(geometry.pageBBox.width, 3);
    expect(geometry.bbox.height * 800).toBeCloseTo(geometry.pageBBox.height, 3);
  });
});
