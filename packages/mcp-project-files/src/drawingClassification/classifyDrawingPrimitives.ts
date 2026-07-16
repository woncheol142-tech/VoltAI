import { createHash } from "node:crypto";

import type {
  DrawingPaintedPath,
  DrawingPrimitiveDocument,
} from "../drawingPrimitive/types.js";
import {
  analyzePrimitive,
  type PrimitiveStructuralAnalysis,
} from "./analyzePrimitive.js";
import type {
  DrawingPrimitiveClassificationDocument,
  PrimitiveClassification,
  PrimitiveClassificationKind,
  PrimitiveClassificationStatistics,
} from "./types.js";

type AnalyzedPrimitive = {
  primitive: DrawingPaintedPath;
  analysis: PrimitiveStructuralAnalysis;
  duplicateGroupId: string | null;
  duplicateCount: number;
};

type GeometryGroup = {
  canonical: string;
  members: AnalyzedPrimitive[];
  firstSourceOrder: number;
};

function assertFiniteRecord(
  value: Record<string, number>,
  label: string,
): void {
  for (const [key, number] of Object.entries(value)) {
    if (!Number.isFinite(number)) {
      throw new Error(`Drawing primitive ${label}.${key} must be finite`);
    }
  }
}

function validateDocument(document: DrawingPrimitiveDocument): DrawingPaintedPath[] {
  if (document.primitiveCount !== document.primitives.length) {
    throw new Error(
      `Drawing primitive count is corrupt: expected ${document.primitiveCount}, received ${document.primitives.length}`,
    );
  }
  if (
    !Number.isFinite(document.pageWidth) ||
    document.pageWidth <= 0 ||
    !Number.isFinite(document.pageHeight) ||
    document.pageHeight <= 0
  ) {
    throw new Error("Drawing primitive page dimensions must be finite and positive");
  }

  const ids = new Set<string>();
  const sourceOrders = new Set<number>();
  for (const primitive of document.primitives) {
    if (typeof primitive.id !== "string" || primitive.id.length === 0) {
      throw new Error("Drawing primitive ID must be a non-empty string");
    }
    if (ids.has(primitive.id)) {
      throw new Error(`Drawing primitive ID is duplicated: ${primitive.id}`);
    }
    ids.add(primitive.id);

    if (!Number.isInteger(primitive.sourceOrder) || primitive.sourceOrder < 0) {
      throw new Error("Drawing primitive sourceOrder must be a non-negative integer");
    }
    if (sourceOrders.has(primitive.sourceOrder)) {
      throw new Error(
        `Drawing primitive sourceOrder is duplicated: ${primitive.sourceOrder}`,
      );
    }
    sourceOrders.add(primitive.sourceOrder);
    assertFiniteRecord(primitive.bbox, "bbox");
    assertFiniteRecord(primitive.pageBBox, "pageBBox");
    assertFiniteRecord(primitive.provenance, "provenance");
  }

  const ordered = [...document.primitives].sort(
    (left, right) => left.sourceOrder - right.sourceOrder,
  );
  for (const [index, primitive] of ordered.entries()) {
    if (primitive.sourceOrder !== index) {
      throw new Error(
        `Drawing primitive sourceOrder is corrupt: expected ${index}, received ${primitive.sourceOrder}`,
      );
    }
  }
  return ordered;
}

function length(edge: { from: Point; to: Point }): number {
  return Math.hypot(edge.to.x - edge.from.x, edge.to.y - edge.from.y);
}

type Point = { x: number; y: number };
type Edge = { from: Point; to: Point };

function vector(edge: Edge): Point {
  return { x: edge.to.x - edge.from.x, y: edge.to.y - edge.from.y };
}

function dot(left: Point, right: Point): number {
  return left.x * right.x + left.y * right.y;
}

function cross(left: Point, right: Point): number {
  return left.x * right.y - left.y * right.x;
}

function orientation(a: Point, b: Point, c: Point): number {
  return cross(
    { x: b.x - a.x, y: b.y - a.y },
    { x: c.x - a.x, y: c.y - a.y },
  );
}

function strictSegmentIntersection(
  first: Edge,
  second: Edge,
): boolean {
  const firstA = orientation(first.from, first.to, second.from);
  const firstB = orientation(first.from, first.to, second.to);
  const secondA = orientation(second.from, second.to, first.from);
  const secondB = orientation(second.from, second.to, first.to);
  return (
    ((firstA > 0 && firstB < 0) || (firstA < 0 && firstB > 0)) &&
    ((secondA > 0 && secondB < 0) || (secondA < 0 && secondB > 0))
  );
}

function isRectangleCandidate(analysis: PrimitiveStructuralAnalysis): boolean {
  if (
    analysis.subpathCount !== 1 ||
    !analysis.isClosed ||
    analysis.hasCurve ||
    analysis.meaningfulEdgeCount !== 4
  ) {
    return false;
  }
  const edges = analysis.subpaths[0]?.edges;
  if (!edges || edges.length !== 4 || edges.some(({ kind }) => kind !== "line")) {
    return false;
  }
  const linearEdges: Edge[] = edges;
  const lengths = linearEdges.map(length);
  const maximumLength = Math.max(...lengths);
  const minimumLength = Math.min(...lengths);
  if (
    !Number.isFinite(maximumLength) ||
    maximumLength <= 0 ||
    minimumLength / maximumLength <= 1e-4
  ) {
    return false;
  }

  const vectors = linearEdges.map(vector);
  const angularTolerance = 1e-3;
  for (let index = 0; index < 4; index += 1) {
    const current = vectors[index]!;
    const next = vectors[(index + 1) % 4]!;
    if (
      Math.abs(dot(current, next)) /
        (lengths[index]! * lengths[(index + 1) % 4]!) >
      angularTolerance
    ) {
      return false;
    }
  }
  for (const [leftIndex, rightIndex] of [
    [0, 2],
    [1, 3],
  ] as const) {
    if (
      Math.abs(cross(vectors[leftIndex]!, vectors[rightIndex]!)) /
        (lengths[leftIndex]! * lengths[rightIndex]!) >
      angularTolerance
    ) {
      return false;
    }
    if (
      Math.abs(lengths[leftIndex]! - lengths[rightIndex]!) /
        Math.max(lengths[leftIndex]!, lengths[rightIndex]!) >
      1e-3
    ) {
      return false;
    }
  }

  if (
    strictSegmentIntersection(linearEdges[0]!, linearEdges[2]!) ||
    strictSegmentIntersection(linearEdges[1]!, linearEdges[3]!)
  ) {
    return false;
  }
  const turns = vectors.map((current, index) =>
    cross(current, vectors[(index + 1) % 4]!),
  );
  const turnScale = maximumLength * maximumLength;
  if (
    turns.some((turn) => Math.abs(turn) <= turnScale * 1e-6) ||
    !turns.every((turn) => Math.sign(turn) === Math.sign(turns[0]!))
  ) {
    return false;
  }

  const corners = linearEdges.map(({ from }) => from);
  const twiceArea = Math.abs(
    corners.reduce((sum, point, index) => {
      const next = corners[(index + 1) % corners.length]!;
      return sum + point.x * next.y - point.y * next.x;
    }, 0),
  );
  return twiceArea > turnScale * 2e-6;
}

function classifyKind(
  primitive: DrawingPaintedPath,
  analysis: PrimitiveStructuralAnalysis,
): PrimitiveClassificationKind {
  if (primitive.pageBBox.width === 0 && primitive.pageBBox.height === 0) {
    return "zeroLength";
  }
  if (Math.max(primitive.pageBBox.width, primitive.pageBBox.height) < 1) {
    return "tiny";
  }
  if (analysis.isCompound) return "compoundPath";
  if (analysis.hasCurve) return "curve";
  if (isRectangleCandidate(analysis)) return "rectangleCandidate";
  if (analysis.isClosed && analysis.meaningfulEdgeCount >= 3) {
    return "closedPolygon";
  }
  if (
    analysis.subpathCount === 1 &&
    !analysis.isClosed &&
    analysis.meaningfulEdgeCount >= 2
  ) {
    return "polyline";
  }
  if (
    analysis.subpathCount === 1 &&
    !analysis.isClosed &&
    analysis.meaningfulEdgeCount === 1
  ) {
    return "line";
  }
  return "unknown";
}

function assignDuplicateGroups(values: AnalyzedPrimitive[]): void {
  const buckets = new Map<string, GeometryGroup[]>();
  for (const value of values) {
    const hash = createHash("sha256")
      .update(value.analysis.canonicalGeometry, "utf8")
      .digest("hex");
    const bucket = buckets.get(hash) ?? [];
    let group = bucket.find(
      ({ canonical }) => canonical === value.analysis.canonicalGeometry,
    );
    if (!group) {
      group = {
        canonical: value.analysis.canonicalGeometry,
        members: [],
        firstSourceOrder: value.primitive.sourceOrder,
      };
      bucket.push(group);
      buckets.set(hash, bucket);
    }
    group.members.push(value);
  }

  const duplicateGroups = [...buckets.values()]
    .flat()
    .filter(({ members }) => members.length >= 2)
    .sort((left, right) => left.firstSourceOrder - right.firstSourceOrder);
  for (const [index, group] of duplicateGroups.entries()) {
    const id = `duplicate-${String(index + 1).padStart(6, "0")}`;
    for (const member of group.members) {
      member.duplicateGroupId = id;
      member.duplicateCount = group.members.length;
    }
  }
}

function createStatistics(
  classifications: PrimitiveClassification[],
): PrimitiveClassificationStatistics {
  const statistics: PrimitiveClassificationStatistics = {
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
  };
  const duplicateGroups = new Set<string>();
  for (const classification of classifications) {
    statistics[classification.kind] += 1;
    const duplicateGroupId = classification.diagnostics.duplicateGroupId;
    if (duplicateGroupId !== null) {
      duplicateGroups.add(duplicateGroupId);
      statistics.duplicateMemberCount += 1;
    }
  }
  statistics.duplicateGroupCount = duplicateGroups.size;
  return statistics;
}

function codepointCompare(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function classifyDrawingPrimitives(
  document: DrawingPrimitiveDocument,
): DrawingPrimitiveClassificationDocument {
  const ordered = validateDocument(document);
  const analyzed: AnalyzedPrimitive[] = ordered.map((primitive) => ({
    primitive,
    analysis: analyzePrimitive(
      primitive,
      document.pageWidth,
      document.pageHeight,
    ),
    duplicateGroupId: null,
    duplicateCount: 1,
  }));
  assignDuplicateGroups(analyzed);

  const classifications: PrimitiveClassification[] = analyzed.map(
    ({ primitive, analysis, duplicateGroupId, duplicateCount }) => {
      const kind = classifyKind(primitive, analysis);
      return {
        primitiveId: primitive.id,
        kind,
        confidence: kind === "unknown" ? 0 : 1,
        diagnostics: {
          commandCount: analysis.commandCount,
          subpathCount: analysis.subpathCount,
          closedSubpathCount: analysis.closedSubpathCount,
          lineSegmentCount: analysis.lineSegmentCount,
          curveSegmentCount: analysis.curveSegmentCount,
          meaningfulEdgeCount: analysis.meaningfulEdgeCount,
          duplicateGroupId,
          duplicateCount,
        },
        geometry: {
          bbox: { ...primitive.bbox },
          pageBBox: { ...primitive.pageBBox },
        },
      };
    },
  );

  const unknown = analyzed.filter(
    (_, index) => classifications[index]?.kind === "unknown",
  );
  const warnings = new Set(document.warnings);
  if (unknown.length > 0) {
    warnings.add(
      `UNKNOWN_CLASSIFICATION count=${unknown.length} firstSourceOrder=${unknown[0]!.primitive.sourceOrder}`,
    );
  }

  return {
    schemaVersion: 1,
    source: document.source,
    sourceSha256: document.sourceSha256,
    page: document.page,
    primitiveCount: ordered.length,
    classificationCount: classifications.length,
    statistics: createStatistics(classifications),
    classifications,
    warnings: [...warnings].sort(codepointCompare),
  };
}
