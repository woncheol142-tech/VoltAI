import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";

import { createGraphicsStateMachine } from "../src/drawingPrimitive/graphicsState.js";

describe("drawing primitive graphics state", () => {
  it("starts with the approved PDF graphics defaults", () => {
    expect(createGraphicsStateMachine().snapshot()).toEqual({
      ctm: [1, 0, 0, 1, 0, 0],
      strokeWidthUserSpace: 1,
      lineCap: 0,
      lineJoin: 0,
      miterLimit: 10,
      dashArray: [],
      dashPhase: 0,
      strokeColor: "#000000",
      fillColor: "#000000",
      strokeAlpha: 1,
      fillAlpha: 1,
      hasClip: false,
    });
  });

  it.each([
    [OPS.setLineWidth, [0], "strokeWidthUserSpace", 0],
    [OPS.setLineWidth, [2.5], "strokeWidthUserSpace", 2.5],
    [OPS.setLineCap, [2], "lineCap", 2],
    [OPS.setLineJoin, [1], "lineJoin", 1],
    [OPS.setMiterLimit, [7], "miterLimit", 7],
  ])("applies graphics operator %s", (operator, args, field, expected) => {
    const machine = createGraphicsStateMachine();
    machine.apply(operator, args, 3);

    expect(machine.snapshot()).toHaveProperty(field, expected);
  });

  it("copies dash arrays and preserves phase", () => {
    const machine = createGraphicsStateMachine();
    const dash = [4, 1];

    machine.apply(OPS.setDash, [dash, 2], 4);
    dash[0] = 99;

    expect(machine.snapshot()).toMatchObject({
      dashArray: [4, 1],
      dashPhase: 2,
    });
  });

  it("preserves CSS colors and copies finite numeric color arrays", () => {
    const machine = createGraphicsStateMachine();
    const numeric = [0.2, 0.3, 0.4];

    machine.apply(OPS.setStrokeRGBColor, ["#123456"], 1);
    machine.apply(OPS.setFillColor, numeric, 2);
    numeric[0] = 9;

    expect(machine.snapshot()).toMatchObject({
      strokeColor: "#123456",
      fillColor: [0.2, 0.3, 0.4],
    });
  });

  it("extracts stroke and fill alpha from PDF.js setGState entries", () => {
    const machine = createGraphicsStateMachine();

    machine.apply(OPS.setGState, [[["CA", 0], ["ca", 0.25]]], 7);

    expect(machine.snapshot()).toMatchObject({
      strokeAlpha: 0,
      fillAlpha: 0.25,
    });
  });

  it("summarizes unsupported GState keys without rejecting supported keys", () => {
    const machine = createGraphicsStateMachine();

    machine.apply(OPS.setGState, [[["CA", 0.5], ["SMask", { id: "mask" }]]], 17);

    expect(machine.snapshot().strokeAlpha).toBe(0.5);
    expect(machine.warnings).toEqual([
      "UNSUPPORTED_GRAPHICS_STATE count=1 firstOperator=17",
    ]);
  });

  it("keeps the previous state after malformed width, dash, color, or alpha", () => {
    const machine = createGraphicsStateMachine();
    machine.apply(OPS.setLineWidth, [2], 1);
    machine.apply(OPS.setDash, [[3, 1], 2], 2);
    machine.apply(OPS.setStrokeRGBColor, ["#123456"], 3);
    machine.apply(OPS.setGState, [[["CA", 0.5]]], 4);
    const before = machine.snapshot();

    machine.apply(OPS.setLineWidth, [-1], 10);
    machine.apply(OPS.setDash, [[0, 0], 0], 11);
    machine.apply(OPS.setStrokeRGBColor, [{ secret: true }], 12);
    machine.apply(OPS.setGState, [[["CA", Number.NaN]]], 13);

    expect(machine.snapshot()).toEqual(before);
    expect(machine.warnings).toEqual([
      "INVALID_GRAPHICS_STATE count=4 firstOperator=10",
    ]);
  });

  it("multiplies transforms in CTM = CTM × matrix order", () => {
    const machine = createGraphicsStateMachine();

    machine.apply(OPS.transform, [1, 0, 0, 1, 10, 20], 1);
    machine.apply(OPS.transform, [2, 0, 0, 3, 0, 0], 2);

    expect(machine.snapshot().ctm).toEqual([2, 0, 0, 3, 10, 20]);
  });

  it("restores nested state and CTM exactly", () => {
    const machine = createGraphicsStateMachine();
    machine.apply(OPS.setLineWidth, [2], 1);
    machine.apply(OPS.save, null, 2);
    machine.apply(OPS.transform, [2, 0, 0, 2, 10, 20], 3);
    machine.apply(OPS.setLineWidth, [7], 4);
    machine.apply(OPS.save, null, 5);
    machine.apply(OPS.setFillRGBColor, ["#ff0000"], 6);
    machine.apply(OPS.restore, null, 7);
    machine.apply(OPS.restore, null, 8);

    expect(machine.snapshot()).toEqual({
      ctm: [1, 0, 0, 1, 0, 0],
      strokeWidthUserSpace: 2,
      lineCap: 0,
      lineJoin: 0,
      miterLimit: 10,
      dashArray: [],
      dashPhase: 0,
      strokeColor: "#000000",
      fillColor: "#000000",
      strokeAlpha: 1,
      fillAlpha: 1,
      hasClip: false,
    });
  });

  it("deep-copies mutable state across save/restore", () => {
    const machine = createGraphicsStateMachine();
    machine.apply(OPS.setDash, [[4, 2], 1], 1);
    machine.apply(OPS.save, null, 2);
    const nested = machine.snapshot();
    nested.dashArray?.push(99);
    machine.apply(OPS.setDash, [[8, 3], 0], 3);
    machine.apply(OPS.restore, null, 4);

    expect(machine.snapshot().dashArray).toEqual([4, 2]);
  });

  it("tracks clip state without exposing clip geometry", () => {
    const machine = createGraphicsStateMachine();

    machine.apply(OPS.clip, null, 3);
    expect(machine.pendingClip).toBe("nonzero");
    machine.consumeClipPath();

    expect(machine.pendingClip).toBeNull();
    expect(machine.snapshot().hasClip).toBe(true);
  });

  it("handles Form XObject begin as save + matrix + bbox clip and end as restore", () => {
    const machine = createGraphicsStateMachine();
    machine.apply(OPS.setLineWidth, [3], 1);

    machine.apply(
      OPS.paintFormXObjectBegin,
      [[2, 0, 0, 2, 10, 20], [0, 0, 100, 100]],
      2,
    );
    expect(machine.snapshot()).toMatchObject({
      ctm: [2, 0, 0, 2, 10, 20],
      strokeWidthUserSpace: 3,
      hasClip: true,
    });

    machine.apply(OPS.paintFormXObjectEnd, null, 3);
    expect(machine.snapshot()).toMatchObject({
      ctm: [1, 0, 0, 1, 0, 0],
      strokeWidthUserSpace: 3,
      hasClip: false,
    });
  });

  it("supports nested Forms", () => {
    const machine = createGraphicsStateMachine();
    machine.apply(
      OPS.paintFormXObjectBegin,
      [[1, 0, 0, 1, 10, 0], [0, 0, 100, 100]],
      1,
    );
    machine.apply(
      OPS.paintFormXObjectBegin,
      [[2, 0, 0, 2, 0, 5], [0, 0, 50, 50]],
      2,
    );
    expect(machine.snapshot().ctm).toEqual([2, 0, 0, 2, 10, 5]);
    machine.apply(OPS.paintFormXObjectEnd, null, 3);
    expect(machine.snapshot().ctm).toEqual([1, 0, 0, 1, 10, 0]);
    machine.apply(OPS.paintFormXObjectEnd, null, 4);
    machine.finish();
  });

  it("treats Form End without Begin as a hard error", () => {
    const machine = createGraphicsStateMachine();
    expect(() =>
      machine.apply(OPS.paintFormXObjectEnd, null, 1),
    ).toThrow(/stack|form/i);
  });

  it("treats malformed Form begin args as invalid graphics state", () => {
    const machine = createGraphicsStateMachine();
    machine.apply(OPS.paintFormXObjectBegin, [[1, 0], [0, 0, 10]], 9);

    expect(machine.warnings).toEqual([
      "INVALID_GRAPHICS_STATE count=1 firstOperator=9",
    ]);
    expect(machine.snapshot().ctm).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it("fails when save/Form stacks remain unbalanced at end of page", () => {
    const machine = createGraphicsStateMachine();
    machine.apply(OPS.save, null, 1);

    expect(() => machine.finish()).toThrow(/unbalanced|stack/i);
  });
});
