import type {
  DrawingPathCommand,
  NormalizedBBox,
  PageBBox,
} from "./types.js";

export type AffineMatrix = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
];

type Point = { x: number; y: number };

type RawCommand =
  | { command: "M" | "L"; points: [Point] }
  | { command: "C"; points: [Point, Point, Point] }
  | { command: "Q"; points: [Point, Point] }
  | { command: "Z"; points: [] };

const PAGE_PRECISION = 3;
const NORMALIZED_PRECISION = 6;

function canonical(value: number, precision?: number): number {
  if (!Number.isFinite(value)) {
    throw new Error("Primitive geometry must contain finite numbers");
  }
  const rounded = precision === undefined ? value : Number(value.toFixed(precision));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function assertMatrix(matrix: readonly number[]): asserts matrix is AffineMatrix {
  if (matrix.length !== 6 || !matrix.every(Number.isFinite)) {
    throw new Error("Primitive transform matrix must contain six finite numbers");
  }
}

export function multiplyMatrices(
  current: readonly number[],
  next: readonly number[],
): [number, number, number, number, number, number] {
  assertMatrix(current);
  assertMatrix(next);
  const [a1, b1, c1, d1, e1, f1] = current;
  const [a2, b2, c2, d2, e2, f2] = next;
  return [
    canonical(a1 * a2 + c1 * b2),
    canonical(b1 * a2 + d1 * b2),
    canonical(a1 * c2 + c1 * d2),
    canonical(b1 * c2 + d1 * d2),
    canonical(a1 * e2 + c1 * f2 + e1),
    canonical(b1 * e2 + d1 * f2 + f1),
  ];
}

export function transformPoint(
  matrix: readonly number[],
  point: Point,
): Point {
  assertMatrix(matrix);
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new Error("Primitive point coordinates must be finite");
  }
  const [a, b, c, d, e, f] = matrix;
  return {
    x: canonical(a * point.x + c * point.y + e),
    y: canonical(b * point.x + d * point.y + f),
  };
}

function bezierPoint(
  start: number,
  control1: number,
  control2: number,
  end: number,
  t: number,
): number {
  const mt = 1 - t;
  return (
    mt * mt * mt * start +
    3 * mt * mt * t * control1 +
    3 * mt * t * t * control2 +
    t * t * t * end
  );
}

function cubicRoots(
  start: number,
  control1: number,
  control2: number,
  end: number,
): number[] {
  const a = -start + 3 * control1 - 3 * control2 + end;
  const b = 2 * (start - 2 * control1 + control2);
  const c = control1 - start;
  const epsilon = 1e-12;

  if (Math.abs(a) < epsilon) {
    if (Math.abs(b) < epsilon) return [];
    const root = -c / b;
    return root > 0 && root < 1 ? [root] : [];
  }

  const discriminant = b * b - 4 * a * c;
  if (discriminant < -epsilon) return [];
  if (Math.abs(discriminant) < epsilon) {
    const root = -b / (2 * a);
    return root > 0 && root < 1 ? [root] : [];
  }
  const squareRoot = Math.sqrt(discriminant);
  return [(-b + squareRoot) / (2 * a), (-b - squareRoot) / (2 * a)]
    .filter((root) => root > 0 && root < 1);
}

function quadraticPoint(
  start: number,
  control: number,
  end: number,
  t: number,
): number {
  const mt = 1 - t;
  return mt * mt * start + 2 * mt * t * control + t * t * end;
}

function quadraticRoot(start: number, control: number, end: number): number[] {
  const denominator = start - 2 * control + end;
  if (Math.abs(denominator) < 1e-12) return [];
  const root = (start - control) / denominator;
  return root > 0 && root < 1 ? [root] : [];
}

function boundsOfCommands(commands: readonly RawCommand[]): PageBBox {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let current: Point | undefined;
  let subpathStart: Point | undefined;

  const add = (point: Point) => {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  };

  for (const command of commands) {
    if (command.command === "M") {
      current = command.points[0];
      subpathStart = current;
      add(current);
      continue;
    }
    if (!current) {
      throw new Error("Primitive path must begin with a move command");
    }
    if (command.command === "L") {
      add(current);
      current = command.points[0];
      add(current);
      continue;
    }
    if (command.command === "C") {
      const [control1, control2, end] = command.points;
      add(current);
      add(end);
      const roots = new Set([
        ...cubicRoots(current.x, control1.x, control2.x, end.x),
        ...cubicRoots(current.y, control1.y, control2.y, end.y),
      ]);
      for (const root of roots) {
        add({
          x: bezierPoint(current.x, control1.x, control2.x, end.x, root),
          y: bezierPoint(current.y, control1.y, control2.y, end.y, root),
        });
      }
      current = end;
      continue;
    }
    if (command.command === "Q") {
      const [control, end] = command.points;
      add(current);
      add(end);
      const roots = new Set([
        ...quadraticRoot(current.x, control.x, end.x),
        ...quadraticRoot(current.y, control.y, end.y),
      ]);
      for (const root of roots) {
        add({
          x: quadraticPoint(current.x, control.x, end.x, root),
          y: quadraticPoint(current.y, control.y, end.y, root),
        });
      }
      current = end;
      continue;
    }
    if (subpathStart) {
      add(current);
      add(subpathStart);
      current = subpathStart;
    }
  }

  if (![minX, maxX, minY, maxY].every(Number.isFinite)) {
    throw new Error("Primitive path geometry cannot be empty");
  }
  return {
    x: canonical(minX, PAGE_PRECISION),
    y: canonical(minY, PAGE_PRECISION),
    width: canonical(maxX - minX, PAGE_PRECISION),
    height: canonical(maxY - minY, PAGE_PRECISION),
  };
}

function transformCommands(
  commands: readonly RawCommand[],
  matrix: readonly number[],
): RawCommand[] {
  return commands.map((command) => {
    if (command.command === "Z") return { command: "Z", points: [] };
    return {
      command: command.command,
      points: command.points.map((point) => transformPoint(matrix, point)),
    } as RawCommand;
  });
}

function normalizeCommands(
  commands: readonly RawCommand[],
  pageWidth: number,
  pageHeight: number,
): DrawingPathCommand[] {
  return commands.map((command) => {
    if (command.command === "Z") return { command: "Z", points: [] };
    const points = command.points.map(({ x, y }) => ({
      x: canonical(x / pageWidth, NORMALIZED_PRECISION),
      y: canonical(y / pageHeight, NORMALIZED_PRECISION),
    }));
    return { command: command.command, points } as DrawingPathCommand;
  });
}

export function createPrimitiveGeometry(
  commands: readonly RawCommand[],
  visualTransform: readonly number[],
  pageWidth: number,
  pageHeight: number,
): {
  commands: DrawingPathCommand[];
  pageBBox: PageBBox;
  bbox: NormalizedBBox;
} {
  assertMatrix(visualTransform);
  if (
    !Number.isFinite(pageWidth) ||
    !Number.isFinite(pageHeight) ||
    pageWidth <= 0 ||
    pageHeight <= 0
  ) {
    throw new Error("Primitive page dimensions must be positive finite numbers");
  }
  const transformed = transformCommands(commands, visualTransform);
  const pageBBox = boundsOfCommands(transformed);
  return {
    commands: normalizeCommands(transformed, pageWidth, pageHeight),
    pageBBox,
    bbox: {
      x: canonical(pageBBox.x / pageWidth, NORMALIZED_PRECISION),
      y: canonical(pageBBox.y / pageHeight, NORMALIZED_PRECISION),
      width: canonical(pageBBox.width / pageWidth, NORMALIZED_PRECISION),
      height: canonical(pageBBox.height / pageHeight, NORMALIZED_PRECISION),
    },
  };
}
