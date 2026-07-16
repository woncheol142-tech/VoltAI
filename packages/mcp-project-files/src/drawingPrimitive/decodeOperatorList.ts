import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

import { createPrimitiveGeometry, multiplyMatrices } from "./geometry.js";
import { createGraphicsStateMachine } from "./graphicsState.js";
import type {
  DrawingPaintedPath,
  DrawingPaintStyle,
} from "./types.js";

type Point = { x: number; y: number };

type RawCommand =
  | { command: "M" | "L"; points: [Point] }
  | { command: "C"; points: [Point, Point, Point] }
  | { command: "Q"; points: [Point, Point] }
  | { command: "Z"; points: [] };

type OperatorList = {
  fnArray: readonly number[];
  argsArray: readonly unknown[];
};

type PageContext = {
  pageWidth: number;
  pageHeight: number;
  rotation: number;
  cropBox: { x: number; y: number; width: number; height: number };
  viewportTransform: readonly [number, number, number, number, number, number];
};

type WarningValue = { count: number; firstOperator: number };

const KNOWN_OPERATORS = new Set(
  Object.values(OPS).filter((value): value is number => typeof value === "number"),
);

const STATE_OPERATORS = new Set([
  OPS.transform,
  OPS.save,
  OPS.restore,
  OPS.setLineWidth,
  OPS.setLineCap,
  OPS.setLineJoin,
  OPS.setMiterLimit,
  OPS.setDash,
  OPS.setStrokeRGBColor,
  OPS.setFillRGBColor,
  OPS.setStrokeColor,
  OPS.setFillColor,
  OPS.setGState,
  OPS.paintFormXObjectBegin,
  OPS.paintFormXObjectEnd,
  OPS.clip,
  OPS.eoClip,
]);

function isNumericTypedArray(value: unknown): value is ArrayLike<number> {
  return (
    ArrayBuffer.isView(value) &&
    !(value instanceof DataView) &&
    typeof (value as { length?: unknown }).length === "number"
  );
}

function finitePoint(values: ArrayLike<number>, offset: number): Point {
  const x = values[offset];
  const y = values[offset + 1];
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error("Compressed path coordinates must be finite");
  }
  return { x, y };
}

export function decodeCompressedPath(values: ArrayLike<number>): {
  commands: RawCommand[];
  subpathCount: number;
  closedSubpathCount: number;
  pathOperatorCount: number;
} {
  if (values.length === 0) {
    throw new Error("Compressed path cannot be empty");
  }
  const commands: RawCommand[] = [];
  let offset = 0;
  let hasMove = false;
  let currentSubpathClosed = false;
  let subpathCount = 0;
  let closedSubpathCount = 0;

  while (offset < values.length) {
    const opcode = values[offset++];
    if (!Number.isFinite(opcode)) {
      throw new Error("Compressed path opcode must be finite");
    }
    if (opcode === 0) {
      if (offset + 2 > values.length) {
        throw new Error("Compressed path M coordinates are truncated");
      }
      commands.push({ command: "M", points: [finitePoint(values, offset)] });
      offset += 2;
      hasMove = true;
      currentSubpathClosed = false;
      subpathCount += 1;
      continue;
    }
    if (!hasMove) {
      throw new Error("Compressed path must begin with a move command");
    }
    if (opcode === 1) {
      if (offset + 2 > values.length) {
        throw new Error("Compressed path L coordinates are truncated");
      }
      commands.push({ command: "L", points: [finitePoint(values, offset)] });
      offset += 2;
      continue;
    }
    if (opcode === 2) {
      if (offset + 6 > values.length) {
        throw new Error("Compressed path C coordinates are truncated");
      }
      commands.push({
        command: "C",
        points: [
          finitePoint(values, offset),
          finitePoint(values, offset + 2),
          finitePoint(values, offset + 4),
        ],
      });
      offset += 6;
      continue;
    }
    if (opcode === 3) {
      if (offset + 4 > values.length) {
        throw new Error("Compressed path Q coordinates are truncated");
      }
      commands.push({
        command: "Q",
        points: [
          finitePoint(values, offset),
          finitePoint(values, offset + 2),
        ],
      });
      offset += 4;
      continue;
    }
    if (opcode === 4) {
      commands.push({ command: "Z", points: [] });
      if (!currentSubpathClosed) {
        closedSubpathCount += 1;
        currentSubpathClosed = true;
      }
      continue;
    }
    throw new Error(`Unknown compressed path opcode: ${opcode}`);
  }

  return {
    commands,
    subpathCount,
    closedSubpathCount,
    pathOperatorCount: commands.length,
  };
}

function decodeConstructPath(args: unknown): {
  paintOperator: number;
  decoded: ReturnType<typeof decodeCompressedPath>;
} {
  if (!Array.isArray(args) || args.length !== 3) {
    throw new Error("Compressed constructPath args are malformed");
  }
  const [paintOperator, container, minMax] = args;
  if (
    typeof paintOperator !== "number" ||
    ![
      OPS.stroke,
      OPS.fill,
      OPS.eoFill,
      OPS.fillStroke,
      OPS.eoFillStroke,
      OPS.endPath,
    ].includes(paintOperator)
  ) {
    throw new Error("Compressed constructPath paint operator is unsupported");
  }
  if (
    !Array.isArray(container) ||
    container.length !== 1 ||
    !isNumericTypedArray(container[0])
  ) {
    throw new Error("Compressed constructPath path container is malformed");
  }
  if (
    !isNumericTypedArray(minMax) ||
    minMax.length !== 4 ||
    !Array.from(minMax).every(Number.isFinite)
  ) {
    throw new Error("Compressed constructPath minMax is malformed");
  }
  return {
    paintOperator,
    decoded: decodeCompressedPath(container[0]),
  };
}

function paintMapping(paintOperator: number): {
  paint: DrawingPaintedPath["paint"];
  fillRule: DrawingPaintedPath["fillRule"];
} {
  if (paintOperator === OPS.stroke) return { paint: "stroke", fillRule: null };
  if (paintOperator === OPS.fill) return { paint: "fill", fillRule: "nonzero" };
  if (paintOperator === OPS.eoFill) return { paint: "fill", fillRule: "evenodd" };
  if (paintOperator === OPS.fillStroke) {
    return { paint: "fill-stroke", fillRule: "nonzero" };
  }
  return { paint: "fill-stroke", fillRule: "evenodd" };
}

function publicStyle(
  state: ReturnType<ReturnType<typeof createGraphicsStateMachine>["snapshot"]>,
): DrawingPaintStyle {
  return {
    strokeWidthUserSpace: state.strokeWidthUserSpace,
    lineCap: state.lineCap,
    lineJoin: state.lineJoin,
    miterLimit: state.miterLimit,
    dashArray: state.dashArray,
    dashPhase: state.dashPhase,
    strokeColor: state.strokeColor,
    fillColor: state.fillColor,
    strokeAlpha: state.strokeAlpha,
    fillAlpha: state.fillAlpha,
  };
}

function addWarning(
  warnings: Map<string, WarningValue>,
  code: string,
  operatorIndex: number,
): void {
  const current = warnings.get(code);
  if (current) current.count += 1;
  else warnings.set(code, { count: 1, firstOperator: operatorIndex });
}

function warningStrings(
  warnings: Map<string, WarningValue>,
  machineWarnings: readonly string[],
  noPaintedPaths: boolean,
): string[] {
  const values = [
    ...[...warnings.entries()].map(
      ([code, value]) =>
        `${code} count=${value.count} firstOperator=${value.firstOperator}`,
    ),
    ...machineWarnings,
    ...(noPaintedPaths
      ? ["NO_PAINTED_PATHS: page contains no painted paths"]
      : []),
  ];
  return values.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function isOffPage(bbox: DrawingPaintedPath["bbox"]): boolean {
  return (
    bbox.x < 0 ||
    bbox.y < 0 ||
    bbox.x + bbox.width > 1 ||
    bbox.y + bbox.height > 1
  );
}

function validatePageContext(page: PageContext): PageContext["viewportTransform"] {
  if (
    !Number.isFinite(page.pageWidth) ||
    !Number.isFinite(page.pageHeight) ||
    page.pageWidth <= 0 ||
    page.pageHeight <= 0 ||
    !Object.values(page.cropBox).every(Number.isFinite)
  ) {
    throw new Error("Primitive page context must contain finite dimensions");
  }
  multiplyMatrices(page.viewportTransform, [1, 0, 0, 1, 0, 0]);
  return page.viewportTransform;
}

export function decodeOperatorList(
  operatorList: OperatorList,
  page: PageContext,
): { primitives: DrawingPaintedPath[]; warnings: string[] } {
  if (operatorList.fnArray.length !== operatorList.argsArray.length) {
    throw new Error("PDF operator list arrays must have equal lengths");
  }
  const viewportTransform = validatePageContext(page);
  const machine = createGraphicsStateMachine();
  const warnings = new Map<string, WarningValue>();
  const primitives: DrawingPaintedPath[] = [];

  for (let operatorIndex = 0; operatorIndex < operatorList.fnArray.length; operatorIndex += 1) {
    const operator = operatorList.fnArray[operatorIndex];
    const args = operatorList.argsArray[operatorIndex];
    if (operator === OPS.constructPath) {
      let path;
      try {
        path = decodeConstructPath(args);
      } catch {
        addWarning(warnings, "MALFORMED_PATH", operatorIndex);
        continue;
      }
      if (path.paintOperator === OPS.endPath) {
        machine.consumeClipPath();
        continue;
      }
      const state = machine.snapshot();
      const visualTransform = multiplyMatrices(viewportTransform, state.ctm);
      try {
        const geometry = createPrimitiveGeometry(
          path.decoded.commands,
          visualTransform,
          page.pageWidth,
          page.pageHeight,
        );
        const sourceOrder = primitives.length;
        const primitive: DrawingPaintedPath = {
          id: `primitive-${String(sourceOrder + 1).padStart(6, "0")}`,
          type: "path",
          ...paintMapping(path.paintOperator),
          ...geometry,
          subpathCount: path.decoded.subpathCount,
          closedSubpathCount: path.decoded.closedSubpathCount,
          style: publicStyle(state),
          sourceOrder,
          provenance: {
            operatorIndex,
            pathOperatorCount: path.decoded.pathOperatorCount,
          },
        };
        primitives.push(primitive);

        if (primitive.pageBBox.width === 0 && primitive.pageBBox.height === 0) {
          addWarning(warnings, "ZERO_LENGTH_PATH", operatorIndex);
        } else if (
          Math.max(primitive.pageBBox.width, primitive.pageBBox.height) < 1
        ) {
          addWarning(warnings, "TINY_PATH", operatorIndex);
        }
        if (isOffPage(primitive.bbox)) {
          addWarning(warnings, "OFF_PAGE_PATH", operatorIndex);
        }
      } catch {
        addWarning(warnings, "MALFORMED_PATH", operatorIndex);
      }
      continue;
    }

    if (operator !== undefined && STATE_OPERATORS.has(operator)) {
      machine.apply(operator, args, operatorIndex);
      continue;
    }
    if (operator === undefined || !KNOWN_OPERATORS.has(operator)) {
      addWarning(warnings, "UNSUPPORTED_OPERATOR", operatorIndex);
    }
  }

  machine.finish();
  return {
    primitives,
    warnings: warningStrings(
      warnings,
      machine.warnings,
      primitives.length === 0,
    ),
  };
}
