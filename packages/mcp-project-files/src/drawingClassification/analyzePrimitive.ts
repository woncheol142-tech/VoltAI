import type {
  DrawingPaintedPath,
  DrawingPathCommand,
  NormalizedPoint,
} from "../drawingPrimitive/types.js";

type PagePoint = {
  x: number;
  y: number;
};

type StructuralEdge = {
  from: PagePoint;
  to: PagePoint;
  kind: "line" | "curve";
};

type StructuralSubpath = {
  edges: StructuralEdge[];
  zClosed: boolean;
  explicitClosed: boolean;
};

export type PrimitiveStructuralAnalysis = {
  commandCount: number;
  subpathCount: number;
  closedSubpathCount: number;
  lineSegmentCount: number;
  curveSegmentCount: number;
  meaningfulEdgeCount: number;
  isClosed: boolean;
  hasCurve: boolean;
  isCompound: boolean;
  hasExplicitClosure: boolean;
  subpaths: StructuralSubpath[];
  canonicalGeometry: string;
};

function finitePoint(
  point: unknown,
  command: DrawingPathCommand["command"],
  index: number,
): asserts point is NormalizedPoint {
  if (
    typeof point !== "object" ||
    point === null ||
    !("x" in point) ||
    !("y" in point) ||
    typeof point.x !== "number" ||
    typeof point.y !== "number" ||
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y)
  ) {
    throw new Error(
      `Drawing primitive command ${index} ${command} point must contain finite coordinates`,
    );
  }
}

function validateCommand(
  command: unknown,
  index: number,
): asserts command is DrawingPathCommand {
  if (
    typeof command !== "object" ||
    command === null ||
    !("command" in command) ||
    !("points" in command) ||
    !Array.isArray(command.points)
  ) {
    throw new Error(`Drawing primitive command ${index} is malformed`);
  }
  const commandName = command.command;
  const expectedPoints =
    commandName === "M" || commandName === "L"
      ? 1
      : commandName === "Q"
        ? 2
        : commandName === "C"
          ? 3
          : commandName === "Z"
            ? 0
            : -1;
  if (expectedPoints < 0 || command.points.length !== expectedPoints) {
    throw new Error(`Drawing primitive command ${index} is malformed`);
  }
  for (const point of command.points) {
    finitePoint(point, commandName as DrawingPathCommand["command"], index);
  }
}

function pagePoint(
  point: NormalizedPoint,
  pageWidth: number,
  pageHeight: number,
): PagePoint {
  return {
    x: point.x * pageWidth,
    y: point.y * pageHeight,
  };
}

function samePoint(left: PagePoint, right: PagePoint): boolean {
  return left.x === right.x && left.y === right.y;
}

function canonicalNumber(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function canonicalCommand(command: DrawingPathCommand): unknown[] {
  return [
    command.command,
    ...command.points.flatMap(({ x, y }) => [
      canonicalNumber(x),
      canonicalNumber(y),
    ]),
  ];
}

export function analyzePrimitive(
  primitive: DrawingPaintedPath,
  pageWidth = 1,
  pageHeight = 1,
): PrimitiveStructuralAnalysis {
  if (
    !Number.isFinite(pageWidth) ||
    pageWidth <= 0 ||
    !Number.isFinite(pageHeight) ||
    pageHeight <= 0
  ) {
    throw new Error("Drawing primitive page dimensions must be finite and positive");
  }

  let current: PagePoint | undefined;
  let currentSubpath:
    | (StructuralSubpath & {
        start: PagePoint;
        current: PagePoint;
        segmentCount: number;
      })
    | undefined;
  const subpaths: StructuralSubpath[] = [];
  let lineSegmentCount = 0;
  let curveSegmentCount = 0;
  let closedSubpathCount = 0;
  let meaningfulEdgeCount = 0;

  function finishSubpath(): void {
    if (!currentSubpath) return;
    currentSubpath.explicitClosed =
      !currentSubpath.zClosed &&
      currentSubpath.segmentCount > 0 &&
      samePoint(currentSubpath.current, currentSubpath.start);
    subpaths.push({
      edges: currentSubpath.edges,
      zClosed: currentSubpath.zClosed,
      explicitClosed: currentSubpath.explicitClosed,
    });
    currentSubpath = undefined;
  }

  for (const [index, rawCommand] of primitive.commands.entries()) {
    validateCommand(rawCommand, index);
    const command = rawCommand;

    if (command.command === "M") {
      finishSubpath();
      const point = pagePoint(command.points[0], pageWidth, pageHeight);
      current = point;
      currentSubpath = {
        start: point,
        current: point,
        edges: [],
        zClosed: false,
        explicitClosed: false,
        segmentCount: 0,
      };
      continue;
    }
    if (!current || !currentSubpath) {
      throw new Error(`Drawing primitive command ${index} must follow M`);
    }

    if (command.command === "L") {
      lineSegmentCount += 1;
      currentSubpath.segmentCount += 1;
      const endpoint = pagePoint(command.points[0], pageWidth, pageHeight);
      if (!samePoint(current, endpoint)) {
        currentSubpath.edges.push({ from: current, to: endpoint, kind: "line" });
        meaningfulEdgeCount += 1;
      }
      current = endpoint;
      currentSubpath.current = endpoint;
      continue;
    }

    if (command.command === "Q" || command.command === "C") {
      curveSegmentCount += 1;
      currentSubpath.segmentCount += 1;
      const endpoint = pagePoint(
        command.points[command.points.length - 1],
        pageWidth,
        pageHeight,
      );
      const hasMeaningfulGeometry =
        !samePoint(current, endpoint) ||
        command.points.some((point) =>
          !samePoint(current!, pagePoint(point, pageWidth, pageHeight)),
        );
      if (hasMeaningfulGeometry) {
        currentSubpath.edges.push({ from: current, to: endpoint, kind: "curve" });
        meaningfulEdgeCount += 1;
      }
      current = endpoint;
      currentSubpath.current = endpoint;
      continue;
    }

    if (!currentSubpath.zClosed) {
      closedSubpathCount += 1;
      currentSubpath.zClosed = true;
      if (!samePoint(current, currentSubpath.start)) {
        currentSubpath.edges.push({
          from: current,
          to: currentSubpath.start,
          kind: "line",
        });
        meaningfulEdgeCount += 1;
      }
    }
    current = currentSubpath.start;
    currentSubpath.current = currentSubpath.start;
  }
  finishSubpath();

  if (subpaths.length !== primitive.subpathCount) {
    throw new Error(
      `Drawing primitive subpath metadata is corrupt: expected ${primitive.subpathCount}, analyzed ${subpaths.length}`,
    );
  }
  if (closedSubpathCount !== primitive.closedSubpathCount) {
    throw new Error(
      `Drawing primitive closed-subpath metadata is corrupt: expected ${primitive.closedSubpathCount}, analyzed ${closedSubpathCount}`,
    );
  }

  return {
    commandCount: primitive.commands.length,
    subpathCount: subpaths.length,
    closedSubpathCount,
    lineSegmentCount,
    curveSegmentCount,
    meaningfulEdgeCount,
    isClosed:
      subpaths.length === 1 &&
      (subpaths[0]?.zClosed === true || subpaths[0]?.explicitClosed === true),
    hasCurve: curveSegmentCount > 0,
    isCompound: subpaths.length >= 2,
    hasExplicitClosure: subpaths.some(({ explicitClosed }) => explicitClosed),
    subpaths,
    canonicalGeometry: JSON.stringify(primitive.commands.map(canonicalCommand)),
  };
}
