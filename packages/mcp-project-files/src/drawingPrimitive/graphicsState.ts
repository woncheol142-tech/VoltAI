import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

import { multiplyMatrices } from "./geometry.js";

type Color = string | number[] | null;

type GraphicsState = {
  ctm: [number, number, number, number, number, number];
  strokeWidthUserSpace: number | null;
  lineCap: number | null;
  lineJoin: number | null;
  miterLimit: number | null;
  dashArray: number[] | null;
  dashPhase: number | null;
  strokeColor: Color;
  fillColor: Color;
  strokeAlpha: number | null;
  fillAlpha: number | null;
  hasClip: boolean;
};

type StackEntry = { kind: "save" | "form"; state: GraphicsState };

function cloneColor(color: Color): Color {
  return Array.isArray(color) ? [...color] : color;
}

function cloneState(state: GraphicsState): GraphicsState {
  return {
    ...state,
    ctm: [...state.ctm],
    dashArray: state.dashArray === null ? null : [...state.dashArray],
    strokeColor: cloneColor(state.strokeColor),
    fillColor: cloneColor(state.fillColor),
  };
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function finiteMatrix(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === 6 &&
    value.every(finiteNumber)
  );
}

function copyFiniteArrayLike(value: unknown, length: number): number[] | null {
  if (
    (typeof value !== "object" && typeof value !== "function") ||
    value === null
  ) {
    return null;
  }
  const candidate = value as { length?: unknown; [index: number]: unknown };
  if (candidate.length !== length) return null;
  const copied = Array.from({ length }, (_, index) => candidate[index]);
  return copied.every(finiteNumber) ? copied : null;
}

function validFormBBox(bbox: readonly number[]): boolean {
  return bbox[0] <= bbox[2] && bbox[1] <= bbox[3];
}

function validColor(value: unknown): value is string | number[] {
  return (
    typeof value === "string" ||
    (Array.isArray(value) && value.length > 0 && value.every(finiteNumber))
  );
}

function warningStrings(
  warnings: Map<string, { count: number; firstOperator: number }>,
): string[] {
  return [...warnings.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(
      ([code, value]) =>
        `${code} count=${value.count} firstOperator=${value.firstOperator}`,
    );
}

export function createGraphicsStateMachine() {
  let state: GraphicsState = {
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
  };
  const stack: StackEntry[] = [];
  const warningMap = new Map<string, { count: number; firstOperator: number }>();
  let pendingClip: "nonzero" | "evenodd" | null = null;

  const warn = (code: string, operatorIndex: number) => {
    const current = warningMap.get(code);
    if (current) current.count += 1;
    else warningMap.set(code, { count: 1, firstOperator: operatorIndex });
  };

  const restoreForm = () => {
    const entry = stack.at(-1);
    if (!entry || entry.kind !== "form") {
      throw new Error("Graphics state form stack underflow");
    }
    stack.pop();
    state = entry.state;
  };

  const restoreSave = (operatorIndex: number) => {
    const entry = stack.at(-1);
    if (!entry || entry.kind !== "save") {
      warn("STATE_STACK_UNDERFLOW", operatorIndex);
      return;
    }
    stack.pop();
    state = entry.state;
  };

  const applyStyle = (
    operator: number,
    args: unknown,
    operatorIndex: number,
  ): boolean => {
    const values = Array.isArray(args) ? args : [];
    if (operator === OPS.setLineWidth) {
      const value = values[0];
      if (!finiteNumber(value) || value < 0) return false;
      state.strokeWidthUserSpace = value;
      return true;
    }
    if (operator === OPS.setLineCap) {
      if (!finiteNumber(values[0])) return false;
      state.lineCap = values[0];
      return true;
    }
    if (operator === OPS.setLineJoin) {
      if (!finiteNumber(values[0])) return false;
      state.lineJoin = values[0];
      return true;
    }
    if (operator === OPS.setMiterLimit) {
      if (!finiteNumber(values[0]) || values[0] < 0) return false;
      state.miterLimit = values[0];
      return true;
    }
    if (operator === OPS.setDash) {
      const dash = values[0];
      const phase = values[1];
      if (
        !Array.isArray(dash) ||
        !dash.every((item) => finiteNumber(item) && item >= 0) ||
        (dash.length > 0 && dash.every((item) => item === 0)) ||
        !finiteNumber(phase)
      ) {
        return false;
      }
      state.dashArray = [...dash];
      state.dashPhase = phase;
      return true;
    }
    if (
      operator === OPS.setStrokeRGBColor ||
      operator === OPS.setStrokeColor
    ) {
      const color = values.length === 1 ? values[0] : values;
      if (!validColor(color)) return false;
      state.strokeColor = cloneColor(color);
      return true;
    }
    if (operator === OPS.setFillRGBColor || operator === OPS.setFillColor) {
      const color = values.length === 1 ? values[0] : values;
      if (!validColor(color)) return false;
      state.fillColor = cloneColor(color);
      return true;
    }
    if (operator === OPS.setGState) {
      const entries = values[0];
      if (!Array.isArray(entries)) return false;
      const next = cloneState(state);
      let valid = true;
      for (const entry of entries) {
        if (!Array.isArray(entry) || entry.length < 2) {
          valid = false;
          continue;
        }
        const [key, value] = entry;
        if (key === "CA" || key === "ca") {
          if (!finiteNumber(value) || value < 0 || value > 1) {
            valid = false;
          } else if (key === "CA") {
            next.strokeAlpha = value;
          } else {
            next.fillAlpha = value;
          }
        } else {
          warn("UNSUPPORTED_GRAPHICS_STATE", operatorIndex);
        }
      }
      if (!valid) return false;
      state = next;
      return true;
    }
    return true;
  };

  return {
    get pendingClip() {
      return pendingClip;
    },
    get warnings() {
      return warningStrings(warningMap);
    },
    snapshot(): GraphicsState {
      return cloneState(state);
    },
    consumeClipPath(): void {
      if (pendingClip !== null) {
        state.hasClip = true;
        pendingClip = null;
      }
    },
    apply(operator: number, args: unknown, operatorIndex: number): void {
      if (operator === OPS.transform) {
        if (!finiteMatrix(args)) {
          throw new Error("Graphics transform matrix must contain six finite numbers");
        }
        state.ctm = multiplyMatrices(state.ctm, args);
        return;
      }
      if (operator === OPS.save) {
        stack.push({ kind: "save", state: cloneState(state) });
        return;
      }
      if (operator === OPS.restore) {
        restoreSave(operatorIndex);
        return;
      }
      if (operator === OPS.paintFormXObjectBegin) {
        const values = Array.isArray(args) ? args : [];
        const matrixValue = values[0];
        const bboxValue = values[1];
        const matrix =
          matrixValue === null
            ? [1, 0, 0, 1, 0, 0]
            : copyFiniteArrayLike(matrixValue, 6);
        const bbox =
          bboxValue === null ? null : copyFiniteArrayLike(bboxValue, 4);
        const validBBox = bbox !== null && validFormBBox(bbox);
        if (matrix === null || (bboxValue !== null && !validBBox)) {
          warn("INVALID_GRAPHICS_STATE", operatorIndex);
        }
        stack.push({ kind: "form", state: cloneState(state) });
        state.ctm = multiplyMatrices(
          state.ctm,
          matrix ?? [1, 0, 0, 1, 0, 0],
        );
        if (validBBox) state.hasClip = true;
        return;
      }
      if (operator === OPS.paintFormXObjectEnd) {
        restoreForm();
        return;
      }
      if (operator === OPS.clip) {
        pendingClip = "nonzero";
        return;
      }
      if (operator === OPS.eoClip) {
        pendingClip = "evenodd";
        return;
      }
      if (!applyStyle(operator, args, operatorIndex)) {
        warn("INVALID_GRAPHICS_STATE", operatorIndex);
      }
    },
    finish(): void {
      if (stack.length > 0) {
        throw new Error("Graphics state stack is unbalanced");
      }
    },
  };
}
