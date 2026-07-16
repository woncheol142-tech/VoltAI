import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";

import {
  createPrimitiveGeometry,
} from "../src/drawingPrimitive/geometry.js";
import {
  decodeOperatorList,
} from "../src/drawingPrimitive/decodeOperatorList.js";
import { primitivePageContext } from "./helpers/drawingPrimitiveFixture.js";

function construct(path: readonly number[]) {
  return [
    OPS.stroke,
    [new Float32Array(path)],
    new Float32Array([0, 0, 100, 100]),
  ];
}

describe("drawing primitive Step 4 quality regressions", () => {
  it("does not downgrade page transform corruption to MALFORMED_PATH", () => {
    expect(() =>
      decodeOperatorList(
        {
          fnArray: [OPS.constructPath],
          argsArray: [construct([0, 10, 20, 1, 110, 20])],
        },
        primitivePageContext({
          viewportTransform: [Number.NaN, 0, 0, -1, 0, 800],
        }),
      ),
    ).toThrow(/finite|matrix|transform/i);
  });

  it("uses the supplied finite viewport transform without silently rewriting it", () => {
    const result = decodeOperatorList(
      {
        fnArray: [OPS.constructPath],
        argsArray: [construct([0, 10, 20, 1, 20, 20])],
      },
      {
        pageWidth: 100,
        pageHeight: 100,
        rotation: 0,
        cropBox: { x: 0, y: 0, width: 600, height: 800 },
        viewportTransform: [1, 0, 0, -1, 7, 88],
      },
    );

    expect(result.primitives[0]?.pageBBox).toEqual({
      x: 17,
      y: 68,
      width: 10,
      height: 0,
    });
  });

  it("computes a large single-path bbox without argument-list overflow", () => {
    const commands = [
      { command: "M" as const, points: [{ x: 0, y: 0 }] },
      ...Array.from({ length: 70_000 }, (_, index) => ({
        command: "L" as const,
        points: [{ x: (index + 1) % 1000, y: Math.floor((index + 1) / 1000) }],
      })),
    ];

    expect(
      createPrimitiveGeometry(commands, [1, 0, 0, 1, 0, 0], 1000, 1000)
        .pageBBox,
    ).toEqual({ x: 0, y: 0, width: 999, height: 70 });
  });

  it("keeps mutable style snapshots independent between primitives", () => {
    const result = decodeOperatorList(
      {
        fnArray: [
          OPS.setDash,
          OPS.setStrokeColor,
          OPS.constructPath,
          OPS.constructPath,
        ],
        argsArray: [
          [[4, 2], 1],
          [[0.2, 0.3, 0.4]],
          construct([0, 10, 20, 1, 110, 20]),
          construct([0, 20, 30, 1, 120, 30]),
        ],
      },
      primitivePageContext(),
    );

    result.primitives[0]?.style.dashArray?.push(99);
    const firstColor = result.primitives[0]?.style.strokeColor;
    if (Array.isArray(firstColor)) firstColor.push(99);

    expect(result.primitives[1]?.style).toMatchObject({
      dashArray: [4, 2],
      strokeColor: [0.2, 0.3, 0.4],
    });
  });
});
