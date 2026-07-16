import { rmSync } from "node:fs";

import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { afterEach, describe, expect, it } from "vitest";

import { decodeOperatorList } from "../src/drawingPrimitive/decodeOperatorList.js";
import { createGraphicsStateMachine } from "../src/drawingPrimitive/graphicsState.js";
import { extractDrawingPrimitives } from "../src/tools/extractDrawingPrimitives.js";
import {
  primitivePageContext,
  writeDrawingPrimitiveFixture,
} from "./helpers/drawingPrimitiveFixture.js";
import { createTempPdfProject } from "./helpers/pdfFixture.js";

function construct(path: readonly number[]) {
  return [
    OPS.stroke,
    [new Float32Array(path)],
    new Float32Array([0, 0, 100, 100]),
  ];
}

function formOperatorList(
  matrix: unknown,
  bbox: unknown,
  path: readonly number[] = [0, 1, 2, 1, 3, 4],
) {
  return {
    fnArray: [
      OPS.paintFormXObjectBegin,
      OPS.constructPath,
      OPS.paintFormXObjectEnd,
    ],
    argsArray: [[matrix, bbox], construct(path), []],
  };
}

describe("drawing primitive Form XObject critical regressions", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("extracts the actual PDF.js 6.1.200 Form fixture end to end", async () => {
    const root = createTempPdfProject();
    roots.push(root);
    writeDrawingPrimitiveFixture(root);

    await expect(
      extractDrawingPrimitives(root, {
        relativePath: "docs/drawing-primitives.pdf",
        page: 8,
      }),
    ).resolves.toMatchObject({
      primitiveCount: 2,
      warnings: [],
    });
  });

  it("accepts Float32Array matrix and bbox without mutating them", () => {
    const matrix = new Float32Array([2, 0, 0, 3, 10, 20]);
    const bbox = new Float32Array([0, 0, 100, 100]);
    const matrixBefore = [...matrix];
    const bboxBefore = [...bbox];

    const result = decodeOperatorList(
      formOperatorList(matrix, bbox),
      primitivePageContext(),
    );
    expect([...matrix]).toEqual(matrixBefore);
    expect([...bbox]).toEqual(bboxBefore);
    matrix[0] = 99;
    bbox[0] = 99;

    expect(result.primitives[0]?.pageBBox).toEqual({
      x: 12,
      y: 768,
      width: 4,
      height: 6,
    });
    expect(matrixBefore).toEqual([2, 0, 0, 3, 10, 20]);
    expect(bboxBefore).toEqual([0, 0, 100, 100]);
    expect(result.warnings).toEqual([]);
  });

  it("uses identity for a null Form matrix and preserves begin/end pairing", () => {
    const result = decodeOperatorList(
      formOperatorList(null, new Float64Array([0, 0, 100, 100])),
      primitivePageContext(),
    );

    expect(result.primitives[0]?.pageBBox).toEqual({
      x: 1,
      y: 796,
      width: 2,
      height: 2,
    });
    expect(result.warnings).toEqual([]);
  });

  it("allows a null Form bbox and skips only clip marking", () => {
    const machine = createGraphicsStateMachine();

    machine.apply(
      OPS.paintFormXObjectBegin,
      [new Float64Array([1, 0, 0, 1, 5, 6]), null],
      1,
    );

    expect(machine.snapshot()).toMatchObject({
      ctm: [1, 0, 0, 1, 5, 6],
      hasClip: false,
    });
    machine.apply(OPS.paintFormXObjectEnd, [], 2);
    machine.finish();
  });

  it("warns and falls back to identity for a malformed non-null matrix", () => {
    const result = decodeOperatorList(
      formOperatorList(
        new Float32Array([1, 0, 0]),
        new Float32Array([0, 0, 100, 100]),
      ),
      primitivePageContext(),
    );

    expect(result.primitives[0]?.pageBBox).toEqual({
      x: 1,
      y: 796,
      width: 2,
      height: 2,
    });
    expect(result.warnings).toEqual([
      "INVALID_GRAPHICS_STATE count=1 firstOperator=0",
    ]);
  });

  it("warns and skips only clipping for a malformed non-null bbox", () => {
    const result = decodeOperatorList(
      formOperatorList(
        new Float32Array([1, 0, 0, 1, 5, 6]),
        new Float32Array([0, 0, Number.NaN, 100]),
      ),
      primitivePageContext(),
    );

    expect(result.primitives[0]?.pageBBox).toEqual({
      x: 6,
      y: 790,
      width: 2,
      height: 2,
    });
    expect(result.warnings).toEqual([
      "INVALID_GRAPHICS_STATE count=1 firstOperator=0",
    ]);
  });

  it("restores nested Form matrices and the outer state exactly", () => {
    const machine = createGraphicsStateMachine();
    const outerMatrix = new Float64Array([1, 0, 0, 1, 10, 0]);
    const innerMatrix = {
      0: 2,
      1: 0,
      2: 0,
      3: 2,
      4: 0,
      5: 5,
      length: 6,
    };

    machine.apply(
      OPS.paintFormXObjectBegin,
      [outerMatrix, new Float32Array([0, 0, 100, 100])],
      1,
    );
    machine.apply(OPS.paintFormXObjectBegin, [innerMatrix, null], 2);
    outerMatrix[4] = 999;
    innerMatrix[4] = 999;

    expect(machine.snapshot().ctm).toEqual([2, 0, 0, 2, 10, 5]);
    machine.apply(OPS.paintFormXObjectEnd, [], 3);
    expect(machine.snapshot().ctm).toEqual([1, 0, 0, 1, 10, 0]);
    machine.apply(OPS.paintFormXObjectEnd, [], 4);
    expect(machine.snapshot().ctm).toEqual([1, 0, 0, 1, 0, 0]);
    machine.finish();
  });

  it("keeps Form End without Begin as a hard error", () => {
    const machine = createGraphicsStateMachine();

    expect(() =>
      machine.apply(OPS.paintFormXObjectEnd, [], 1),
    ).toThrow(/form.*underflow|underflow.*form/i);
  });

  it("treats an unmatched save restore as a warning and continues decoding", () => {
    const result = decodeOperatorList(
      {
        fnArray: [OPS.restore, OPS.constructPath],
        argsArray: [[], construct([0, 10, 20, 1, 20, 20])],
      },
      primitivePageContext(),
    );

    expect(result.primitives).toHaveLength(1);
    expect(result.warnings).toEqual([
      "STATE_STACK_UNDERFLOW count=1 firstOperator=0",
    ]);
  });
});
